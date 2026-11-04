import { sessionPath } from '../../library/folderLayout';
import { DAMAGED_RECORD_WARNING, FUTURE_RECORD_WARNING, isBlankRecordText } from '../../library/recordText';
import { indexed, type ListIndex } from '../../library/sessionIndex';
import {
  dedupeSessions, imuFileName, isWritableRecord, mergeLightRecord, parseRecordWithRaw, recordFileName,
  type LibrarySession, type RecordUnreadable,
} from '../../library/record';
import type { FileStat, MemoryFolder } from '../../platform/memoryFolder';
import { setState, type LibraryState } from './store';

/**
 * Mémoire ouverte (lot 113) : l'état partagé par toutes les parties de la bibliothèque (`lib`), la liste des
 * sessions, ses index et sa publication, les fiches pas encore écrites et la relecture d'une fiche allégée.
 */

/**
 * État de la mémoire ouverte, partagé par toutes les parties de la bibliothèque (`hooks/sessionLibrary/`) : un
 * seul objet, modifié en place, car une variable importée ne se réaffecte pas.
 */
interface LibraryMemory {
  /** Dossier mémoire en service, `null` s'il n'y en a aucun d'accessible. */
  folder: MemoryFolder | null;
  /** Toutes les sessions lues, doublons compris ; toujours remplacée, jamais modifiée en place (index). */
  all: LibrarySession[];
  /** Noms des fichiers de `sessions/` : un nouveau nom ne doit en écraser aucun, même illisible. */
  knownNames: Set<string>;
  /** Incrémenté à chaque changement de dossier : un calcul en cours pour l'ancien s'arrête. */
  generation: number;
  /** Ouverture en cours : les écritures l'attendent. */
  opening: Promise<void>;
  /**
   * Vrai si `all` a changé depuis la dernière publication de la liste. Un
   * balayage ne publie pas chaque fiche créée ou recalculée (`replaceSession`
   * discret) : la liste part au rythme de son compteur, et à sa fin ; toute
   * autre publication emporte ce qui attendait.
   */
  publishPending: boolean;
  /**
   * Saisies, numérotées dans l'ordre : `lastEdit` garde le numéro de la
   * dernière de chaque fiche. Une relecture du dossier (« Mettre à jour ») garde
   * la version en mémoire d'une fiche saisie pendant qu'elle lisait le disque.
   */
  editCount: number;
  /**
   * Taille et date de chaque fiche à sa dernière lecture ou écriture, par GPX : une différence dit qu'elle a
   * changé sous nos pieds (autre appareil sur le dossier, Syncthing, Drive, copie à chaud), et elle est relue
   * avant d'être écrite (`reconcileWithDisk`). Toute différence compte, pas seulement une date plus récente :
   * une copie pose la date de sa source. Vidé au changement de dossier.
   */
  diskStamps: Map<string, FileStat>;
  /**
   * Sessions dont la fiche n'était pas écrite quand la mémoire a quitté leur dossier (`attach`,
   * `detach`, y compris en passant à « needs-permission ») : leurs saisies attendent le prochain
   * dossier désigné (`takeUnwritten`, `carryUnwritten`).
   */
  heldUnwritten: LibrarySession[];
  /**
   * Lecture en cours des GPX sans fiche (`completeScan`), levée à sa fin ou à son arrêt (changement de
   * `generation` compris). `addGpx` l'attend avant de créer une session : celles qu'elle n'a pas encore
   * publiées ne sont pas dans `all`, et un enregistrement ou un import de la même session ferait un doublon.
   */
  scanCompletion: Promise<void> | null;
  /**
   * Passage en cours, quel qu'il soit (création de fiches ou résumés à refaire) : le recalcul qui
   * suit un réglage changé (`queueOutdatedRefresh`) l'attend, pour ne jamais en lancer deux à la fois.
   */
  scanPass: Promise<void> | null;
  /** Relecture en cours (« Mettre à jour », `refreshLibrary`) : un second appui attend la même. */
  refreshing: Promise<void> | null;
  /**
   * Recalcul des résumés périmés demandé par une écriture qui a relu le disque (`reconcileWithDisk`) :
   * `queueOutdatedRefresh`, posé par la file des résumés à son chargement, la file venant après les écritures.
   */
  onOutdated: () => void;
}

export const lib: LibraryMemory = {
  folder: null,
  all: [],
  knownNames: new Set<string>(),
  generation: 0,
  opening: Promise.resolve(),
  publishPending: false,
  editCount: 0,
  diskStamps: new Map<string, FileStat>(),
  heldUnwritten: [],
  scanCompletion: null,
  scanPass: null,
  refreshing: null,
  onOutdated: () => undefined,
};

/** Dossier où l'on peut ranger : aucun tant que la mémoire est en lecture seule, comme sans dossier. */
export const writableFolder = (): MemoryFolder | null => (lib.folder?.readOnly ? null : lib.folder);

/** Liste publiée : une session par identité, et les doublons écartés. */
export const publishedFields = (): Pick<LibraryState, 'sessions' | 'duplicates'> => {
  const { kept, duplicates } = dedupeSessions(lib.all);
  lib.publishPending = false;
  return { sessions: kept, duplicates: duplicates.map((s) => s.file) };
};

export const publish = (): void => setState(publishedFields());

/** Index d'une liste de sessions par une clé : `all` et la liste publiée sont toujours remplacées, jamais modifiées en place. */
type SessionIndex<K> = ListIndex<LibrarySession, K>;

const byFile: SessionIndex<string> = new WeakMap();

const byStart: SessionIndex<number> = new WeakMap();

export const sessionOfFile = (list: readonly LibrarySession[], file: string): LibrarySession | undefined =>
  indexed(byFile, list, (s) => s.file).get(file);

export const findSession = (file: string): LibrarySession | undefined => sessionOfFile(lib.all, file);

/** Première session de `all` partie à `startMs` : la même trace, sous quelque nom que ce soit. */
export const findSessionAt = (startMs: number): LibrarySession | undefined =>
  indexed(byStart, lib.all, (s) => s.record.summary.startMs).get(startMs);

/**
 * Fichiers en cours de suppression (`removeSession`) : un recalcul ou une
 * relecture qui finit pendant ce temps ne les remet pas dans la liste et
 * n'en réécrit pas la fiche.
 */
export const removing = new Set<string>();

/**
 * Fiches dont la dernière écriture a échoué : le fichier du disque n'est pas
 * la fiche en mémoire, qui n'entre donc pas dans le cache (E-B10). Retentées à
 * chaque `flushWrites` (arrière-plan, « Mettre à jour », changement de
 * dossier), gardées en mémoire par une relecture (`keptInMemory`, `scan`),
 * retirées à la première écriture réussie ; au changement de dossier, leurs
 * saisies passent au nouveau (`carryUnwritten`).
 */
export const unwritten = new Set<string>();

/** Sessions `unwritten` du dossier en service, telles qu'en mémoire (fiches d'une version plus récente exceptées). */
const unwrittenSessions = (): LibrarySession[] =>
  [...unwritten].map((file) => findSession(file)).filter((s): s is LibrarySession => s !== undefined && !s.readOnly);

/** Avant de quitter le dossier (`all` encore plein) : les sessions `unwritten` sont mises de côté. */
export const holdUnwritten = (): void => {
  lib.heldUnwritten = [...lib.heldUnwritten, ...unwrittenSessions()];
  unwritten.clear();
};

/** Sessions à reporter dans le dossier qu'on désigne : celles mises de côté, puis les `unwritten` du dossier quitté. */
export const takeUnwritten = (): LibrarySession[] => {
  const taken = [...lib.heldUnwritten, ...unwrittenSessions()];
  lib.heldUnwritten = [];
  unwritten.clear();
  return taken;
};

/**
 * Champs illisibles de chaque fiche à sa dernière lecture (`parseRecordWithRaw`), par dossier puis
 * par GPX : réécrits tels quels tant qu'ils n'ont pas changé (`serializeRecord`). Gardés hors de la
 * fiche, que le cache allégé recopie champ à champ.
 */
const unreadableByFolder = new WeakMap<MemoryFolder, Map<string, RecordUnreadable>>();

export const unreadableOf = (f: MemoryFolder, file: string): RecordUnreadable | undefined => unreadableByFolder.get(f)?.get(file);

export const rememberUnreadable = (f: MemoryFolder, file: string, unreadable: RecordUnreadable | undefined): void => {
  let byFile = unreadableByFolder.get(f);
  if (!unreadable || Object.keys(unreadable).length === 0) {
    byFile?.delete(file);
    return;
  }
  if (!byFile) {
    byFile = new Map();
    unreadableByFolder.set(f, byFile);
  }
  byFile.set(file, unreadable);
};

/**
 * Met la session à jour dans `all`, tout de suite, et la publie. `quiet`
 * (balayage de fond) : la publication attend le prochain compteur du balayage
 * ou une autre publication (`publishPending`).
 */
export const replaceSession = (session: LibrarySession, quiet = false): void => {
  if (removing.has(session.file)) return;
  lib.all = [...lib.all.filter((s) => s.file !== session.file), session];
  cacheDirty.add(session.file);
  if (quiet) lib.publishPending = true;
  else publish();
};

/**
 * GPX dont l'entrée du cache n'est peut-être plus juste : importés, supprimés,
 * créés, recalculés ou saisis, écrits ou en échec d'écriture, et ceux écartés
 * au dernier passage parce que leur fiche attendait d'être écrite. Une mise à
 * jour du cache (`updateCache`) ne refait que leurs entrées.
 */
export const cacheDirty = new Set<string>();

/** Relectures en cours, une seule par session. */
const hydrating = new Map<string, Promise<void>>();

/**
 * Relit en entier la fiche d'une session tirée du cache allégé (`partial`),
 * et la fond dans la session telle qu'elle est après la lecture : une saisie
 * faite pendant ce temps est gardée (`mergeLightRecord`). Une fiche absente
 * laisse la mémoire telle quelle, qui est alors tout ce qu'on a ; une fiche
 * illisible ou d'une version future met la session en lecture seule. Une
 * erreur de lecture remonte, et la session reste partielle : rien ne doit
 * alors être écrit. `quiet` : relecture du balayage de fond, publiée avec
 * lui (`replaceSession`) ; une autre relecture qui la rejoint la publie.
 */
export const hydrateSession = (f: MemoryFolder, file: string, quiet = false): Promise<void> => {
  if (!findSession(file)?.partial) return Promise.resolve();
  const running = hydrating.get(file);
  if (running) {
    return quiet ? running : running.then(() => {
      if (lib.publishPending) publish();
    });
  }
  const pending = (async () => {
    const read = await f.readText(sessionPath(recordFileName(file)));
    const current = findSession(file);
    if (!current?.partial || lib.folder !== f) return;
    const text = isBlankRecordText(read) ? null : read;
    const parsed = text === null ? null : parseRecordWithRaw(text);
    const parts = parsed?.parts ?? null;
    // Résumé du disque illisible (écriture interrompue) : celui de la mémoire, refait depuis le GPX, le remplace (E-B10).
    const disk = parts ? { ...parts, summary: parts.summary ?? current.record.summary } : null;
    if (text !== null && !disk) {
      replaceSession({ ...current, partial: false, readOnly: true, warning: DAMAGED_RECORD_WARNING }, quiet);
    } else if (disk && !isWritableRecord(disk)) {
      replaceSession({ ...current, record: { ...disk, gpx: file }, partial: false, readOnly: true, warning: FUTURE_RECORD_WARNING }, quiet);
    } else {
      rememberUnreadable(f, file, parsed?.unreadable);
      replaceSession({ ...current, record: disk ? mergeLightRecord(disk, current.record) : current.record, partial: false }, quiet);
    }
  })().finally(() => hydrating.delete(file));
  hydrating.set(file, pending);
  return pending;
};

/** Numéro de la dernière saisie de chaque fiche (`lib.editCount`). */
export const lastEdit = new Map<string, number>();

/** Vrai si la session a ses capteurs (`.imu`) dans la mémoire. */
export const hasSessionMotion = (file: string): boolean => lib.knownNames.has(imuFileName(file));
