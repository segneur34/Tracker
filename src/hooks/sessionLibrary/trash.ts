import { sessionActivity } from '../../core/activities';
import { errorMessage } from '../../core/basics';
import { sessionDisplayName } from '../../library/sessionName';
import {
  deletesToTrash, sessionTrashEntries, shownTrashEntries, trashFilePath, trashRestoreOrder, type TrashEntry,
} from '../../library/trash';
import { adoptDeposits, dropTrashEntries, purgeTrash, readTrashIndex, stashInTrash, type TrashRequest } from '../../library/trashFolder';
import {
  imuFileName, parseRecordWithRaw, recordFileName, type LibrarySession, type RecordUnreadable, type RecordWithoutSummary,
} from '../../library/record';
import { isBlankRecordText, recordToKeep, type KeptRecordText } from '../../library/recordText';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { createStore } from '../createStore';
import { readStoredActivities } from '../useSportSettings';
import { lib } from './memory';

/**
 * Corbeille du programme Windows et du téléphone, côté mémoire (`library/trash.ts`, `library/trashFolder.ts`) :
 * purgée à l'ouverture du dossier, remplie par la suppression d'une session ou d'un itinéraire, et, sur le téléphone,
 * par les dépôts de l'ordinateur qu'elle adopte à l'ouverture et à chaque relecture ; allégée d'une session qui revient
 * (`settleReturnedTrash`, `trashRestore.ts`). Seuls le dossier du disque et celui du téléphone en ont une ; ailleurs,
 * rien ne change.
 */

export interface TrashState {
  /** Entrées de la corbeille du dossier ouvert (sans les restes d'une session) ; vide sans corbeille (navigateur). */
  entries: TrashEntry[];
  /** L'index ne se lit pas : rien n'entre ni ne sort de la corbeille. */
  error: string | null;
}

export const trashStore = createStore<TrashState>({ entries: [], error: null });

/** Le dossier ouvert s'il a une corbeille (`deletesToTrash` : dossier du disque ou du téléphone, en écriture) ; `null` sinon. */
export const trashFolderOf = (f: MemoryFolder | null): MemoryFolder | null => (f && deletesToTrash(f.kind, f.readOnly === true) ? f : null);

/** Phrase d'une corbeille illisible ou d'une version plus récente. */
const lockedText = (state: string): string | null =>
  state === 'unreadable' ? 'La corbeille ne se lit pas : son fichier corbeille/corbeille.json est abîmé. Rien ne la remplit ni ne la vide.'
    : state === 'newer' ? "La corbeille vient d'une version plus récente de Tracker : mettez l'application à jour pour l'ouvrir."
      : null;

let trashGate: Promise<void> = Promise.resolve();

/**
 * Tient la corbeille pendant `action`, un seul à la fois et dans l'ordre d'arrivée : une synchronisation (qui compte
 * sur ce qu'elle tient pour retirer une session du téléphone), « Restaurer », « Supprimer définitivement », « Vider la
 * corbeille », la purge et l'adoption des dépôts, le réglage des sessions revenues. Aucun ne croise un autre. Une
 * action tenue n'attend jamais `trashReleased` (elle s'attendrait elle-même).
 */
export const holdTrashDuring = <T,>(action: () => Promise<T>): Promise<T> => {
  const running = trashGate.then(action, action);
  trashGate = running.then(() => undefined, () => undefined);
  return running;
};

/** Attend qu'aucun geste ne tienne la corbeille (ceux déjà lancés compris). */
export const trashReleased = (): Promise<void> => trashGate;

/** Relit l'index de la corbeille du dossier ouvert ; vide sans corbeille. */
export const reloadTrash = async (): Promise<void> => {
  const f = trashFolderOf(lib.folder);
  if (!f) {
    trashStore.set({ entries: [], error: null });
    return;
  }
  try {
    const index = await readTrashIndex(f);
    if (f !== lib.folder) return;
    trashStore.set({ entries: shownTrashEntries(index.entries), error: lockedText(index.state) });
  } catch (err) {
    trashStore.set({ entries: [], error: `Corbeille non relue : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * À l'ouverture d'un dossier (`purge`) et à chaque relecture : purge des entrées de plus de 30 jours et des restes
 * (ouverture seulement), adoption des dépôts de l'ordinateur (téléphone), puis lecture de la corbeille. Les sessions
 * revenues se règlent ensuite (`settleReturnedTrash`), une fois la mémoire lue. Sans effet sans corbeille ; un échec
 * n'empêche rien d'autre.
 */
export const startTrash = async (opened: MemoryFolder, purge = true): Promise<void> => {
  const f = trashFolderOf(opened);
  if (!f) {
    trashStore.set({ entries: [], error: null });
    return;
  }
  await holdTrashDuring(async () => {
    try {
      if (purge) await purgeTrash(f, Date.now());
    } catch {
      // Purge reprise au lancement suivant ; la corbeille se lit quand même.
    }
    try {
      await adoptDeposits(f, Date.now());
    } catch {
      // Dépôts repris à la relecture suivante : ils restent sur le disque, rien n'est perdu.
    }
  });
  if (f === lib.folder) await reloadTrash();
};

/**
 * Nom montré d'une session au moment où elle part à la corbeille, le même que dans la liste des sessions : le nom
 * saisi, sinon « Activité · Lieu » (une session sans activité inscrite prend celle de son calcul, `sessionActivity`),
 * sinon le nom de son fichier.
 */
export const recordShownName = (record: LibrarySession['record'], file: string): string => {
  const activity = sessionActivity(readStoredActivities(), record.activityId, record.sport);
  return sessionDisplayName(record, activity?.name ?? null) ?? file.replace(/\.gpx$/i, '');
};

/**
 * Met à la corbeille une copie d'une session (`paths` : ses fichiers et ceux de ses copies en double, dans l'ordre
 * de leur retrait, GPX d'abord) avant que l'appelant ne retire les originaux. Lève si la copie échoue : rien n'est
 * alors retiré.
 */
export const stashSession = async (f: MemoryFolder, session: LibrarySession, paths: string[], main: string): Promise<void> => {
  const request: TrashRequest = {
    kind: 'session', paths, main, startMs: session.record.summary.startMs, name: recordShownName(session.record, session.file),
  };
  await stashInTrash(f, request, Date.now());
  await reloadTrash();
};

/**
 * Même chose pour un itinéraire du dossier `folder` (`paths` : sa fiche, puis son GPX, dans l'ordre de leur
 * retrait) ; sans effet hors du programme Windows.
 */
export const stashRoute = async (
  folder: MemoryFolder, route: { base: string; name: string; createdAt: string }, paths: string[], main: string,
): Promise<void> => {
  const f = trashFolderOf(folder);
  if (!f) return;
  const request: TrashRequest = { kind: 'itineraire', paths, main, routeBase: route.base, createdAt: route.createdAt, name: route.name };
  await stashInTrash(f, request, Date.now());
  await reloadTrash();
};

/** Fiche lue d'un texte, à donner à `addGpx` comme le fait un import (`recordToCopy`) ; `record: null` sans fiche. */
export const recordOptionsFromText = (
  text: string | null,
): { record: RecordWithoutSummary | null; unreadable?: RecordUnreadable; keepRecordText?: KeptRecordText } => {
  if (text === null || isBlankRecordText(text)) return { record: null };
  const parsed = parseRecordWithRaw(text);
  const keepRecordText = recordToKeep(text, parsed);
  return keepRecordText ? { record: null, keepRecordText } : { record: parsed?.parts ?? null, unreadable: parsed?.unreadable };
};

/** Ce que la corbeille garde d'une session qui revient dans la mémoire (`trashCopyOf`). */
export interface TrashCopyOfSession {
  /** Entrées de l'ordinateur pour cette session, toutes. */
  dirs: string[];
  /** La plus récente, celle dont la fiche et les capteurs sont repris. */
  dir: string;
  /** Texte de sa fiche, `null` sans fiche. */
  recordText: string | null;
  /** Ses capteurs, `null` sans capteurs. */
  motion: Uint8Array | null;
}

/**
 * La copie de la corbeille d'une session (identité `startMs`) qui revient dans la mémoire par un import ou par
 * « Récupérer » : la fiche et les capteurs de son entrée la plus récente venue de l'ordinateur. `null` si la corbeille
 * n'en a pas (ou hors du programme Windows) ; `'unreadable'` si l'entrée ne se lit pas : elle doit alors rester.
 */
export const trashCopyOf = async (startMs: number): Promise<TrashCopyOfSession | 'unreadable' | null> => {
  const f = trashFolderOf(lib.folder);
  if (!f) return null;
  const entries = sessionTrashEntries(trashStore.get().entries, startMs).filter((e) => e.origin === 'ordinateur').sort(trashRestoreOrder);
  if (entries.length === 0) return null;
  const [entry] = entries;
  try {
    const recordText = await f.readText(trashFilePath(entry.dir, recordFileName(entry.main)));
    const motion = await f.readBytes(trashFilePath(entry.dir, imuFileName(entry.main)));
    return { dirs: entries.map((e) => e.dir), dir: entry.dir, recordText, motion };
  } catch {
    return 'unreadable';
  }
};

/**
 * Retire de la corbeille les entrées `dirs` d'une session revenue dans la mémoire, après que sa fiche et ses
 * capteurs en ont été repris (`addGpx`), pour qu'elle ne soit pas montrée deux fois. Sans effet hors du programme
 * Windows ; un échec est tu (l'entrée reste, sans gêne).
 */
export const forgetTrashEntries = async (dirs: readonly string[]): Promise<void> => {
  const f = trashFolderOf(lib.folder);
  if (!f || dirs.length === 0) return;
  try {
    await dropTrashEntries(f, dirs);
  } catch {
    // L'entrée reste dans la corbeille ; « Supprimer définitivement » l'en retire.
  }
  await reloadTrash();
};
