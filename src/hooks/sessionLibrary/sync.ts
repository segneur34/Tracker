import { errorMessage, newId, stringifyJson } from '../../core/basics';
import { JOURNALS_DIR, MARKER_FILE, RESTING_HR_FILE, SESSIONS_DIR, SETTINGS_DIR, sessionPath, settingsPath } from '../../library/folderLayout';
import { isCompleteGpxText } from '../../library/pendingTemps';
import type { SessionRecord } from '../../library/record';
import {
  SYNC_DIR, SYNC_SIDES, emptySyncBase, hasSyncMemory, markerTextWithId, markerTextWithPass, markerTextWithSync, otherSyncSide, parseSyncBase, readMarkerDevice, readMarkerId, readMarkerPass,
  serializeSyncBase, syncAncestorPath, syncBaseLine, syncBasePath, syncRefusal, withSyncDone, withSyncHeld, withSyncLine, withoutSyncLine,
  withoutSyncMemory,
  type SyncBase, type SyncFiles, type SyncSideName, type SyncStamp,
} from '../../library/syncBase';
import { emptySyncOutcome, type SyncOutcome, type SyncUnknownActivity } from '../../library/syncOutcome';
import {
  planSync, restrictSyncPlan, syncDeletionSide, syncListing, syncPair, syncRecordsToRead, syncSide,
  type SyncAncestors, type SyncFirstReason, type SyncHeldChoice, type SyncItem, type SyncListing, type SyncOp, type SyncPlan,
  type SyncTargetNames, type SyncTrashed,
} from '../../library/syncPlan';
import { planSyncExtras, unknownSyncActivity, type SyncExtrasPlan, type SyncNamedText } from '../../library/syncExtras';
import { inspectSyncRecord, mergeSyncRecords } from '../../library/syncRecordMerge';
import {
  deletesToTrash, isWritableTrash, sessionRestorePlan, sessionTrashEntries, trashFilePath, trashRestoreOrder, type TrashCopy, type TrashDeposit,
  type TrashEntry, type TrashOrigin,
} from '../../library/trash';
import {
  addFilesToTrashEntry, copyFromTrash, dropTrashEntries, readTrashIndex, rewriteTrashText, stashFilesInTrash, trashHoldsCopies, trashLeftoversIn,
} from '../../library/trashFolder';
import { planRouteSync, restrictRouteSyncPlan, type RouteSyncInput, type RouteSyncItem, type RouteSyncPlan } from '../../library/syncRoutes';
import type { FileStat, MemoryFolder } from '../../platform/memoryFolder';
import { isPhoneRecordingError } from '../../platform/phoneCable';
import { sessionDraftStore } from '../sessionDraftStore';
import { readStoredActivities } from '../useSportSettings';
import { deviceId, flushWrites } from './deviceSettings';
import { holdSummaryPasses } from './summaryQueue';
import { canImportSessions } from './importer';
import { refreshLibrary } from './lifecycle';
import { lib } from './memory';
import { libraryState, setState } from './store';
import {
  depositOnPhone, executeRoutePlan, keepRoutes, readRouteSyncInput, routeDeletionKeysOf, routeOpWritesPhone, routePlanFiles, routeRemovalsOf, trashedRouteIds,
  type RouteKeepAnswer, type SyncRemote, type SyncRouteDeletionKey,
} from './syncRouteFiles';
import { holdTrashDuring, recordShownName, reloadTrash, trashFolderOf } from './trash';

/**
 * Exécutant de la synchronisation des sessions entre le dossier mémoire de l'ordinateur et un dossier distant (le
 * téléphone) : il lit ce que le plan demande (`library/syncPlan.ts`), fait ses opérations une à une, et tient la base
 * (`library/syncBase.ts`). Seules les opérations du plan s'exécutent, jamais une boucle sur un listage.
 *
 * - Une copie s'écrit capteurs, fiche, puis GPX en dernier : une coupure laisse une fiche ou des capteurs sans GPX,
 *   que l'application ignore, jamais un GPX sans fiche qui en recevrait une neuve.
 * - Un retrait commence par le GPX. Avant de retirer quoi que ce soit du téléphone, son listage est relu et chaque
 *   fichier doit être celui du plan (taille, date) ; sinon la session est laissée pour la fois suivante.
 * - Ce qui quitte l'ordinateur passe par sa corbeille ; ce qu'il faut sauver du téléphone avant de l'en retirer y
 *   entre aussi, dans une entrée à part, d'origine « telephone ». Rien n'est jamais effacé du téléphone : un retrait
 *   y est un dépôt dans la corbeille de sa mémoire (`depositOnPhone` : `depose.json` d'abord, puis le GPX), que le
 *   téléphone adopte ensuite dans son propre index ; l'ordinateur n'écrit jamais l'index du téléphone.
 * - La ligne de base d'une session n'est réécrite qu'une fois toutes ses opérations faites, et seulement si ses
 *   fichiers sont encore ceux que la synchronisation a lus ou écrits : la reprise ne refait rien en double et ne
 *   prend rien pour supprimé à tort. `synchro/en-cours.json`, posé au départ et retiré à la fin, dit qu'une
 *   synchronisation a été coupée.
 * - Une session dont l'état a changé depuis le listage est laissée ; une erreur sur l'ordinateur arrête cette session ;
 *   une erreur du dossier distant (câble débranché) arrête tout.
 * - Après les sessions, les itinéraires suivent leur propre plan (`library/syncRoutes.ts`, `syncRouteFiles.ts`), fait
 *   au départ avec celui des sessions : un seul garde-fou, une seule confirmation. Ils ne sont touchés que si le
 *   téléphone liste `itineraires/` (`phoneRoutes`).
 * - Une suppression refusée (« Tout garder », `keepRefused`) et une session de la corbeille gardée (« Les garder »,
 *   `heldOnPhone: 'keep'`) se règlent avant le plan, sur l'ordinateur seul : la base oublie la session, ou elle sort
 *   de la corbeille de l'ordinateur si elle y est encore, et le plan la remet là où elle manque. Rien n'y supprime ni
 *   n'écrase ; l'oubli vient en premier, pour qu'une suite coupée ne laisse pas la suppression refusée se faire.
 * - Puis les fichiers de réglages, les tests de FC repos et les journaux suivent leur propre plan
 *   (`library/syncExtras.ts`) : réglages recopiés (jamais adoptés), FC repos fondue, journaux copiés vers
 *   l'ordinateur seulement ; rien n'est supprimé.
 * - Le téléphone qui enregistre une session n'est pas touché : refus avant toute écriture (`phoneRecording`), et arrêt
 *   de tout si un enregistrement commence en route (la coquille refuse alors chaque écriture).
 * - À la fin, si un fichier du téléphone a été écrit ou mis de côté, l'instant de la synchronisation est posé dans son
 *   marqueur (`markerTextWithSync`) : l'application du téléphone, qui le relit au retour au premier plan et toutes les
 *   25 s tant qu'elle est affichée (`library/syncWatch.ts`), relit alors sa mémoire seule.
 */

/** Témoin d'une synchronisation en cours : présent au départ suivant, la précédente a été coupée. */
export const SYNC_RUNNING_PATH = `${SYNC_DIR}/en-cours.json`;

export type { SyncOutcome, SyncUnknownActivity } from '../../library/syncOutcome';
export type { SyncRemote, SyncRouteDeletionKey } from './syncRouteFiles';

/** Réponse sur ce que la corbeille de l'ordinateur tient et qui est encore sur le téléphone ; `keep` : « Les garder ». */
export type SyncHeldAnswer = SyncHeldChoice | 'keep';

export interface SyncOptions {
  /** Faux : le dossier distant se lit sans s'écrire, seule la moitié de l'ordinateur est faite. Par défaut : s'il n'est pas en lecture seule. */
  phoneWritable?: boolean;
  /**
   * Dit si le téléphone enregistre une session, demandé une fois ses marqueurs lus et avant toute écriture : vrai, rien
   * n'est fait (refus `phoneRecording`). Absent : jamais (tests).
   */
  phoneRecording?: () => Promise<boolean>;
  /**
   * Vrai : seulement lire et planifier, sans rien écrire d'aucun côté (ni témoin, ni marqueur, ni copie de sécurité) :
   * de quoi montrer la confirmation chiffrée avant de synchroniser. L'issue porte `preview` vrai, le plan entier
   * permis (`plan`, suppressions comprises), celui des itinéraires et celui des fichiers d'à côté (`extrasPlan`).
   */
  dryRun?: boolean;
  /** « Synchroniser sans rien supprimer ». */
  withoutDeletions?: boolean;
  /** L'utilisateur a confirmé les suppressions que le garde-fou retenait. */
  confirmDeletions?: boolean;
  /**
   * Les suppressions que la confirmation a montrées (session et côté d'où elle part). Donnée, la confirmation ne vaut
   * que si le plan du moment n'en fait pas d'autre : sinon rien n'est supprimé, et le garde-fou repose sa question.
   */
  confirmedDeletions?: readonly SyncDeletionKey[];
  /**
   * « Tout garder » : les suppressions que la question du garde-fou a montrées et que l'utilisateur refuse (session ou
   * itinéraire, et côté d'où il serait parti). Chacune est défaite là où elle a été faite : supprimée sur le
   * téléphone, la session y est recopiée ; supprimée sur l'ordinateur, elle sort de sa corbeille, ou revient du
   * téléphone si la corbeille ne la tient plus. Une clé n'agit que si la session est encore dans le cas montré ; une
   * suppression apparue depuis reste soumise au garde-fou. Un téléphone qu'on ne peut pas écrire ne reçoit rien : la
   * session reste sur l'ordinateur, comme une session neuve qui l'attend, et la question ne revient pas.
   */
  keepRefused?: { sessions?: readonly SyncDeletionKey[]; routes?: readonly SyncRouteDeletionKey[] };
  /** Où est le dossier sur le téléphone ; un autre chemin que celui de la base en fait une paire neuve. */
  phonePath?: string | null;
  /**
   * Sort des sessions et des itinéraires de la corbeille de l'ordinateur encore sur le téléphone : `leave` (par
   * défaut) et `remove`, comme le plan (`SyncHeldChoice`) ; `keep`, « Les garder » : chacun revient sur l'ordinateur,
   * sorti de sa corbeille si elle le tient encore, sinon recopié du téléphone, et il est de nouveau suivi.
   */
  heldOnPhone?: SyncHeldAnswer;
  /**
   * Avec `heldOnPhone: 'keep'`, les sessions (`startMs`) et les itinéraires (identités) que la question a montrés :
   * eux seuls sont gardés, un autre apparu depuis reste laissé et la question revient pour lui. Aucune des deux
   * listes : tous sont gardés ; une seule donnée, l'autre vaut une liste vide.
   */
  heldToKeep?: readonly number[];
  heldRoutesToKeep?: readonly string[];
  /**
   * Avec `heldOnPhone: 'remove'`, les sessions de la corbeille encore sur le téléphone que l'utilisateur a vues et
   * accepté de retirer (`startMs`). Donnée, si une autre attend d'être retirée, aucune ne l'est : elles restent
   * laissées, et la question revient avec la liste du moment.
   */
  heldToRemove?: readonly number[];
  /**
   * Vrai : le téléphone liste `itineraires/`, les itinéraires se synchronisent. Faux : ils ne sont pas touchés du tout
   * (un listage muet les ferait croire supprimés), et le compte rendu dit qu'ils attendent le câble ou la mise à jour.
   * Absent : ils ne sont pas touchés, sans rien en dire.
   */
  phoneRoutes?: boolean;
  /**
   * Les suppressions d'itinéraires que la confirmation a montrées. Comme `confirmedDeletions` : donnée, la
   * confirmation ne vaut que si le plan du moment n'en fait pas d'autre ; absente alors que `confirmedDeletions` est
   * donnée, elle vaut une liste vide.
   */
  confirmedRouteDeletions?: readonly SyncRouteDeletionKey[];
  /** Comme `heldToRemove`, pour les itinéraires de la corbeille encore sur le téléphone (leurs identités). */
  heldRoutesToRemove?: readonly string[];
  /** Horloge de l'ordinateur (corbeille, base). */
  now?: () => number;
  /** Identifiant neuf d'un dossier, écrit dans son marqueur. */
  newFolderId?: () => string;
  /**
   * Vrai si la session de ce fichier (`sessions/` de l'ordinateur) porte un brouillon non enregistré : elle n'est
   * alors jamais mise à la corbeille (`SyncOutcome.drafted`). Absent : aucun brouillon.
   */
  hasUnsavedDraft?: (file: string) => boolean;
  /** Nom montré dans la corbeille d'une session qui y entre. */
  shownName?: (record: SessionRecord | null, gpx: string) => string;
  /**
   * Fichiers de sessions traités sur leur total (« 12 fichiers sur 50 ») : chaque fichier copié, réécrit, mis à la
   * corbeille ou retiré compte une fois ; une session laissée en route compte comme faite.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Appelée à la première rencontre d'un téléphone qu'on peut écrire, avant la moindre écriture (témoin, marqueurs) :
   * la copie de sécurité des deux dossiers. Rend où la copie est rangée. Si elle lève, rien n'est fait : refus
   * `safetyCopy`, sa raison dans `error`.
   */
  beforeWrites?: (first: SyncFirstReason) => Promise<string | null>;
  /**
   * Vrai si le dossier d'une copie de sécurité (chemin rendu par `beforeWrites`) est encore là et non vide : seule une
   * telle copie est reprise par une synchronisation coupée. Absent : jamais, la copie est refaite.
   */
  safetyCopyExists?: (path: string) => Promise<boolean>;
  /**
   * Appelée une fois le plan fait et réduit à ce qui est permis, avant la première opération : de quoi dire « Première
   * synchronisation… » avant toute copie.
   */
  onPlanned?: (plan: SyncPlan, first: SyncFirstReason | null) => void;
  /**
   * Identifiant de l'ordinateur, celui de son fichier de réglages : ce fichier fait foi, il n'est jamais remplacé sur
   * l'ordinateur par une copie venue du téléphone. Absent : aucun fichier de même nom des deux côtés n'est remplacé.
   * Celui du téléphone se lit dans son marqueur (`readMarkerDevice`).
   */
  computerDeviceId?: string | null;
  /** Identifiants des activités de chaque appareil ; un côté absent n'est pas vérifié. */
  knownActivities?: Partial<Record<SyncSideName, readonly string[]>>;
}

const emptyOutcome = emptySyncOutcome;

/** Fichiers de sessions que touche une opération, pour l'avancement. */
const filesOfOp = (op: SyncOp): number => {
  switch (op.kind) {
    case 'copy':
      return 1 + (op.source.record && op.target.record ? 1 : 0) + (op.source.imu && op.target.imu ? 1 : 0);
    case 'trash':
    case 'removeFromPhone':
      return op.files.length;
    default:
      return 1;
  }
};

/** Opérations d'une session qui écrivent ou retirent quelque chose sur le téléphone. */
const phoneOpsOf = (item: SyncItem | undefined): number =>
  item?.ops.filter((op) => op.kind === 'removeFromPhone' || ('to' in op && op.to === 'phone') || ('on' in op && op.on === 'phone')).length ?? 0;

/**
 * Âge au plus d'une copie de sécurité que la reprise d'une première rencontre coupée réutilise : au-delà, les dossiers
 * ont pu changer depuis (une reprise des mois plus tard), la copie qu'elle garderait ne couvrirait plus l'état
 * d'avant les écritures, et une copie neuve est faite.
 */
const SAFETY_COPY_MAX_AGE_MS = 3_600_000;

/**
 * Dossier de la copie de sécurité que garde le témoin d'une synchronisation coupée, avec l'instant où elle a été
 * faite, s'il couvre ce téléphone et n'est pas périmé (`SAFETY_COPY_MAX_AGE_MS`). Un instant dans le futur (horloge
 * reculée) ou absent du témoin (témoin d'une version qui ne l'écrivait pas) la fait tenir pour périmée : une copie
 * neuve est faite.
 */
const witnessSafetyCopy = async (
  text: string | null, phone: string, nowMs: number, exists: (path: string) => Promise<boolean>,
): Promise<{ path: string; atMs: number } | null> => {
  try {
    const witness: unknown = text === null ? null : JSON.parse(text);
    if (typeof witness !== 'object' || witness === null) return null;
    const { safetyCopy, phone: covered, safetyCopyAtMs: atMs } = witness as { safetyCopy?: unknown; phone?: unknown; safetyCopyAtMs?: unknown };
    if (typeof safetyCopy !== 'string' || covered !== phone || typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;
    const age = nowMs - atMs;
    if (age < 0 || age > SAFETY_COPY_MAX_AGE_MS) return null;
    // La copie a pu être effacée ou déplacée depuis : elle n'est reprise que si elle est encore là, non vide.
    return (await exists(safetyCopy).catch(() => false)) ? { path: safetyCopy, atMs } : null;
  } catch {
    return null;
  }
};

/** Une suppression : la session (`startMs`) et le côté d'où elle part (`computer` : mise à la corbeille). */
export interface SyncDeletionKey {
  startMs: number;
  side: SyncSideName;
}

const sameDeletion = (a: SyncDeletionKey, b: SyncDeletionKey): boolean => a.startMs === b.startMs && a.side === b.side;

/**
 * Les suppressions que font ces sessions, une par session, du côté où elle s'applique : celles que le garde-fou
 * compte et que sa question montre (`syncDeletionSide`), supprimée sur le téléphone, elle part de l'ordinateur, sinon
 * du téléphone. Les restes d'une session absente des deux côtés n'en sont pas.
 */
const deletionKeysOf = (items: readonly SyncItem[]): SyncDeletionKey[] =>
  items.flatMap((item) => {
    const side = syncDeletionSide(item);
    return side ? [{ startMs: item.startMs, side }] : [];
  });

/** Une opération à laquelle l'exécutant renonce : l'état du moment n'est pas celui du plan. */
class StaleError extends Error {}

/** Le dossier distant ne répond plus, ou refuse d'écrire parce qu'il enregistre : toute la synchronisation s'arrête. */
class SyncLinkError extends Error {
  recording: boolean;
  constructor(message: string, recording = false) {
    super(message);
    this.recording = recording;
  }
}

/** Le dossier distant, dont chaque erreur devient une perte de liaison (ou un enregistrement commencé en route). */
const linkedFolder = (folder: SyncRemote): SyncRemote => {
  const guard = async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (err) {
      throw new SyncLinkError(errorMessage(err, String(err)), isPhoneRecordingError(err));
    }
  };
  return {
    kind: folder.kind,
    label: folder.label,
    ...(folder.readOnly ? { readOnly: true as const } : {}),
    list: (dir) => guard(() => folder.list(dir)),
    readText: (path) => guard(() => folder.readText(path)),
    readBytes: (path) => guard(() => folder.readBytes(path)),
    stat: (path) => guard(() => folder.stat(path)),
    writeText: (path, text) => guard(() => folder.writeText(path, text)),
    writeBytes: (path, bytes) => guard(() => folder.writeBytes(path, bytes)),
    // Jamais appelé par l'exécutant : rien ne s'efface du téléphone.
    remove: (path) => guard(() => folder.remove(path)),
    moveAside: (path, to) => guard(() => folder.moveAside(path, to)),
    asideTaken: () => guard(() => folder.asideTaken()),
  };
};

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, k) => byte === b[k]);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Même fichier : même taille, et même date quand les deux en ont une. */
const sameFileStat = (a: FileStat, b: FileStat): boolean => a.size === b.size && (a.mtimeMs === 0 || b.mtimeMs === 0 || a.mtimeMs === b.mtimeMs);

/** Nom du GPX d'une session d'après ses fichiers : le sien, ou celui que nomme une fiche ou des capteurs restés seuls. */
const mainOf = (files: readonly SyncStamp[]): string =>
  files.find((f) => /\.gpx$/i.test(f.name))?.name ?? (files[0]?.name ?? '').replace(/\.(json|imu)$/i, '.gpx');

const defaultShownName = (record: SessionRecord | null, gpx: string): string => record?.name ?? gpx.replace(/\.gpx$/i, '');

const parentDir = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Fichiers de réglages, tests de FC repos et journaux : lus des deux côtés, puis écrits selon leur plan
 * (`planSyncExtras`), chacun seulement s'il est encore tel qu'il a été lu, et jamais vers un côté qu'on ne peut pas
 * écrire. Un journal n'est copié que du téléphone vers l'ordinateur, là où rien ne porte son nom. Rien n'est supprimé. Une erreur du téléphone arrête tout (liaison perdue) ; une erreur de l'ordinateur en
 * écrivant laisse ce fichier et passe au suivant. Aucun n'entre dans le garde-fou des suppressions.
 */
const readExtrasPlan = async (
  folders: Record<SyncSideName, MemoryFolder>, deviceIds: Record<SyncSideName, string | null>,
): Promise<SyncExtrasPlan> => {
  const settingsOf = async (folder: MemoryFolder): Promise<SyncNamedText[]> => {
    const files: SyncNamedText[] = [];
    for (const entry of await folder.list(SETTINGS_DIR)) {
      if (entry.kind !== 'file' || !/\.json$/i.test(entry.name)) continue;
      files.push({ name: entry.name, text: await folder.readText(settingsPath(entry.name)) });
    }
    return files;
  };
  const rootOf = async (path: string): Promise<Record<SyncSideName, string | null>> =>
    ({ computer: await folders.computer.readText(path), phone: await folders.phone.readText(path) });
  const journalsOf = async (folder: MemoryFolder): Promise<SyncStamp[]> =>
    (await folder.list(JOURNALS_DIR)).filter((e) => e.kind === 'file').map((e) => ({ name: e.name, size: e.size, mtimeMs: e.mtimeMs }));
  return planSyncExtras({
    settings: { computer: await settingsOf(folders.computer), phone: await settingsOf(folders.phone) },
    restingHr: await rootOf(RESTING_HR_FILE),
    journals: { computer: await journalsOf(folders.computer), phone: await journalsOf(folders.phone) },
    computerDeviceId: deviceIds.computer,
    phoneDeviceId: deviceIds.phone,
  });
};

/** Exécute le plan des fichiers d'à côté (`readExtrasPlan`), voir plus haut. */
const syncExtraFiles = async (
  folders: Record<SyncSideName, MemoryFolder>, scope: Record<SyncSideName, boolean>, plan: SyncExtrasPlan, outcome: SyncOutcome,
): Promise<void> => {
  outcome.extras.left.push(...plan.left);
  for (const copy of plan.copies) {
    try {
      // L'ordinateur ne doit pas encore porter ce nom ; le journal du téléphone doit être celui du listage.
      if (await folders.computer.stat(copy.path)) {
        outcome.extras.left.push({ kind: 'journal', path: copy.path, side: 'computer', reason: 'changed' });
        continue;
      }
      const bytes = await folders.phone.readBytes(copy.path);
      if (!bytes || bytes.byteLength !== copy.source.size) {
        outcome.extras.left.push({ kind: 'journal', path: copy.path, side: 'phone', reason: 'changed' });
        continue;
      }
      await folders.computer.writeBytes(copy.path, bytes);
      outcome.extras.copied.push(copy);
    } catch (err) {
      if (err instanceof SyncLinkError) throw err;
      outcome.extras.left.push({ kind: 'journal', path: copy.path, side: 'computer', reason: 'failed' });
    }
  }
  for (const op of plan.ops) {
    if (!scope[op.to]) {
      outcome.extras.withheld.push(op);
      continue;
    }
    const folder = folders[op.to];
    try {
      // Relu juste avant d'écrire : le câble ne voit un fichier que par son dernier listage.
      await folder.list(parentDir(op.path));
      if ((await folder.readText(op.path)) !== op.replaces) {
        outcome.extras.left.push({ kind: op.kind, path: op.path, side: op.to, reason: 'changed' });
        continue;
      }
      await folder.writeText(op.path, op.text);
      outcome.extras.done.push(op);
    } catch (err) {
      if (err instanceof SyncLinkError) throw err;
      outcome.extras.left.push({ kind: op.kind, path: op.path, side: op.to, reason: 'failed' });
    }
  }
};

/**
 * Synchronise les sessions de `computer` (le dossier mémoire de l'ordinateur, qui doit avoir une corbeille) et de
 * `remote` (le téléphone). N'agit sur aucun état de l'application : `synchronizePhone` y ajoute le verrou et la
 * relecture. Ne lève pas : tout ce qui s'est passé est dans le résultat.
 */
export const executeSync = async (computer: MemoryFolder, remote: SyncRemote, options: SyncOptions = {}): Promise<SyncOutcome> => {
  const now = options.now ?? Date.now;
  const shownName = options.shownName ?? defaultShownName;
  const phone = linkedFolder(remote);
  const folders: Record<SyncSideName, MemoryFolder> = { computer, phone };
  const scope = { computer: true, phone: options.phoneWritable ?? remote.readOnly !== true, deletions: options.withoutDeletions !== true };
  const outcome = emptyOutcome(null);
  outcome.phoneWritable = scope.phone;
  /** Vrai dès qu'un fichier de sessions ou d'itinéraires du téléphone a été écrit ou mis de côté. */
  let phoneChanged = false;
  /**
   * Le téléphone qui a changé l'apprend par l'instant posé dans son marqueur (`markerTextWithSync`), relu par son
   * application (`syncWatch.ts`). Écriture de plus, jamais un échec de la synchronisation : sans elle, le téléphone
   * relit sa mémoire à son prochain lancement ou à « Mettre à jour ». Rien si la coquille refuse (enregistrement).
   */
  const notifyPhone = async (): Promise<void> => {
    if (!outcome.phoneChanged) return;
    try {
      const text = markerTextWithSync(await phone.readText(MARKER_FILE), now());
      if (text !== null) await phone.writeText(MARKER_FILE, text);
    } catch {
      // Téléphone injoignable à cet instant : il verra les changements à sa prochaine relecture.
    }
  };
  try {
    if (!deletesToTrash(computer.kind, computer.readOnly === true)) return emptyOutcome('noTrash');
    const markers = { computer: await computer.readText(MARKER_FILE), phone: await phone.readText(MARKER_FILE) };
    const refusal = syncRefusal(markers.computer, markers.phone);
    if (refusal) return emptyOutcome(refusal);
    // Le téléphone qui enregistre n'est pas touché, pas même son marqueur : rien n'est fait.
    if (scope.phone && options.phoneRecording && (await options.phoneRecording())) return emptyOutcome('phoneRecording');
    // Le plan dépend de la corbeille (ce qu'elle tient déjà, ce qu'elle a retenu) : illisible, rien ne se fait.
    if (!isWritableTrash(await readTrashIndex(computer))) return emptyOutcome('trashLocked');
    const ids = { computer: readMarkerId(markers.computer), phone: readMarkerId(markers.phone) };
    const read = ids.phone ? parseSyncBase(await computer.readText(syncBasePath(ids.phone))) : { state: 'absent' as const };
    if (read.state === 'newer') return emptyOutcome('newerBase');
    // La base de la paire change avant le plan quand une réponse de l'utilisateur lui fait oublier une session.
    let pair = syncPair(ids.computer, ids.phone, options.phonePath ?? null, read.state === 'ok' ? read.base : null, readMarkerPass(markers.phone));
    outcome.first = pair.first;
    const running = await computer.readText(SYNC_RUNNING_PATH);
    outcome.interrupted = running !== null;
    // La copie de sécurité d'une première rencontre coupée en route n'est pas refaite : le témoin la garde, avec le
    // téléphone qu'elle couvre (son identifiant, ou son marqueur tant qu'il n'en a pas).
    const phoneKey = (): string => ids.phone ?? `marqueur:${markers.phone ?? ''}`;
    /** Instant où la copie de sécurité a été faite, gardé d'une reprise à l'autre pour la périmer. */
    let safetyCopyAtMs = now();
    const writeWitness = (startedAtMs: number): Promise<void> => computer.writeText(SYNC_RUNNING_PATH,
      `${stringifyJson({ startedAtMs, ...(outcome.safetyCopy ? { safetyCopy: outcome.safetyCopy, safetyCopyAtMs, phone: phoneKey() } : {}) })}\n`);
    const dryRun = options.dryRun === true;
    const safetyCopyExists = options.safetyCopyExists ?? (async () => false);
    const deviceIdsOf = (): Record<SyncSideName, string | null> => ({ computer: options.computerDeviceId ?? null, phone: readMarkerDevice(markers.phone) });
    if (dryRun) {
      // Rien à faire ici : la copie de sécurité, le témoin et les marqueurs attendent la vraie synchronisation.
    } else if (pair.first !== null && options.beforeWrites) {
      // Première rencontre : les deux dossiers sont copiés avant toute écriture, même vers un téléphone en lecture seule
      // (l'ordinateur, lui, va recevoir).
      const earlier = await witnessSafetyCopy(running, phoneKey(), now(), safetyCopyExists);
      try {
        if (earlier) {
          outcome.safetyCopy = earlier.path;
          safetyCopyAtMs = earlier.atMs;
        } else {
          outcome.safetyCopy = await options.beforeWrites(pair.first);
          safetyCopyAtMs = now();
        }
      } catch (err) {
        return { ...emptyOutcome('safetyCopy'), first: pair.first, interrupted: false, error: errorMessage(err, String(err)) };
      }
    } else if (running !== null) {
      // Première rencontre coupée après que la base a commencé à s'écrire : la paire est déjà suivie, mais la copie
      // faite au départ couvre encore cette synchronisation ; son dossier se redit, et le témoin le garde.
      const earlier = await witnessSafetyCopy(running, phoneKey(), now(), safetyCopyExists);
      if (earlier) {
        outcome.safetyCopy = earlier.path;
        safetyCopyAtMs = earlier.atMs;
      }
    }
    const startedAtMs = now();
    if (!dryRun) await writeWitness(startedAtMs);
    /** Marqueur du téléphone tel qu'il est maintenant sur le téléphone. */
    let phoneMarker = markers.phone;
    for (const side of SYNC_SIDES) {
      if (dryRun || !pair.newId[side] || !scope[side]) continue;
      const id = (options.newFolderId ?? newId)();
      const text = markerTextWithId(markers[side], id);
      if (text === null) continue;
      await folders[side].writeText(MARKER_FILE, text);
      ids[side] = id;
      if (side === 'phone') phoneMarker = text;
      if (side === 'phone' && outcome.safetyCopy) await writeWitness(startedAtMs);
    }
    // Passage neuf dans le marqueur du téléphone, avant toute ligne de la base : une copie faite avant ce point porte
    // moins que la base, même si la synchronisation s'arrête en route (`syncPair`, `olderCopy`).
    let phonePass: number | null = null;
    if (scope.phone && !dryRun) {
      const pass = Math.max(readMarkerPass(phoneMarker) ?? 0, pair.base?.phonePass ?? 0) + 1;
      const text = markerTextWithPass(phoneMarker, pass);
      if (text !== null) {
        await phone.writeText(MARKER_FILE, text);
        phonePass = pass;
      }
    }

    let listings: Record<SyncSideName, SyncListing> = { computer: syncListing([]), phone: syncListing([]) };
    /** Tampon attendu de chaque fichier de `sessions/` : celui du listage, puis celui de nos propres écritures. */
    const expected: Record<SyncSideName, Map<string, FileStat>> = { computer: new Map(), phone: new Map() };
    const ancestors = new Map<number, SyncAncestors>();
    const sideOf = async (side: SyncSideName) => {
      const texts = new Map<string, string | null>();
      for (const name of syncRecordsToRead(listings[side], pair.base, side, (startMs, of) => (ancestors.get(startMs)?.[of] ?? null) !== null)) {
        texts.set(name, await folders[side].readText(sessionPath(name)));
      }
      const state = syncSide(listings[side], texts);
      // Un GPX que la base ne connaît pas est lu pour savoir s'il est fini : il faudra de toute façon le recopier.
      const known = new Set(pair.base?.sessions.map((s) => s[side].gpx.name));
      for (const session of state.sessions) {
        if (known.has(session.gpx.name)) continue;
        session.gpxComplete = isCompleteGpxText((await folders[side].readText(sessionPath(session.gpx.name))) ?? '');
      }
      return state;
    };
    const trashNow = async (): Promise<TrashEntry[]> => (await readTrashIndex(computer)).entries;
    const trashedOf = (entries: readonly TrashEntry[]): SyncTrashed[] =>
      entries.flatMap((e) => (e.kind !== 'itineraire' && e.startMs !== null ? [{ startMs: e.startMs, files: e.files }] : []));
    /**
     * Lit ce que le plan demande : les deux listages, les fiches gardées des lignes de la base, les fiches à relire et
     * la corbeille. Refait quand une réponse de l'utilisateur a changé l'ordinateur ou la base avant le plan.
     */
    const readInput = async () => {
      listings = { computer: syncListing(await computer.list(SESSIONS_DIR)), phone: syncListing(await phone.list(SESSIONS_DIR)) };
      for (const side of SYNC_SIDES) {
        expected[side].clear();
        const stamps = [...listings[side].sessions.flatMap((s) => [s.gpx, s.record, s.imu]), ...listings[side].orphans];
        for (const stamp of stamps) if (stamp) expected[side].set(stamp.name, { size: stamp.size, mtimeMs: stamp.mtimeMs });
      }
      ancestors.clear();
      for (const line of pair.base?.sessions ?? []) {
        ancestors.set(line.startMs, {
          computer: await computer.readText(syncAncestorPath(pair.base?.phoneId as string, line.startMs, 'computer')),
          phone: await computer.readText(syncAncestorPath(pair.base?.phoneId as string, line.startMs, 'phone')),
        });
      }
      return { computer: await sideOf('computer'), phone: await sideOf('phone'), ancestors, trash: trashedOf(await trashNow()) };
    };
    let input = await readInput();
    const keepHeld = options.heldOnPhone === 'keep';
    const heldChoice: SyncHeldChoice | undefined = options.heldOnPhone === 'keep' ? undefined : options.heldOnPhone;
    /** Le plan entier des sessions ; `keep` : les identités que l'utilisateur garde. */
    const sessionPlanOf = (keep: readonly number[]): SyncPlan => {
      const whole = planSync({ ...input, pair, heldOnPhone: heldChoice, keep });
      if (heldChoice !== 'remove' || !options.heldToRemove) return whole;
      // Retirer seulement les sessions montrées : une autre apparue depuis la question les fait toutes laisser.
      const shown = new Set(options.heldToRemove);
      const heldNow = planSync({ ...input, pair, heldOnPhone: 'leave', keep });
      return heldNow.items.some((item) => item.left === 'inTrash' && !shown.has(item.startMs)) ? heldNow : whole;
    };
    /** Le plan entier des itinéraires, de même. */
    const routePlanOf = (from: Omit<RouteSyncInput, 'heldOnPhone' | 'keep'>, keep: readonly string[]): RouteSyncPlan => {
      const whole = planRouteSync({ ...from, heldOnPhone: heldChoice, keep });
      if (heldChoice !== 'remove' || !options.heldRoutesToRemove) return whole;
      const shown = new Set(options.heldRoutesToRemove);
      const heldNow = planRouteSync({ ...from, heldOnPhone: 'leave', keep });
      return heldNow.items.some((item) => item.left === 'inTrash' && !shown.has(item.id)) ? heldNow : whole;
    };

    /** Écrit la base changée avant le plan, et la retient comme celle de la paire. */
    const writeBase = async (next: SyncBase): Promise<void> => {
      await computer.writeText(syncBasePath(next.phoneId), serializeSyncBase(next));
      pair = { ...pair, base: next };
    };
    /**
     * La base oublie ces sessions (`withoutSyncMemory`), d'une seule écriture, puis leurs fiches gardées : sans ligne,
     * rien ne les supprime, et le plan les recopie là où elles manquent. Vrai si la base a changé.
     */
    const forgetSessions = async (starts: readonly number[]): Promise<boolean> => {
      const known = pair.base;
      const gone = known ? starts.filter((startMs) => hasSyncMemory(known, startMs)) : [];
      if (!known || gone.length === 0) return false;
      await writeBase(gone.reduce((base, startMs) => withoutSyncMemory(base, startMs), known));
      for (const startMs of gone) {
        for (const side of SYNC_SIDES) await computer.remove(syncAncestorPath(known.phoneId, startMs, side));
      }
      return true;
    };
    /**
     * Ce qui ferait sortir de la corbeille de l'ordinateur la session `startMs` : les copies d'une entrée qui la
     * tient avec son GPX et sa fiche, celle venue de l'ordinateur d'abord, la plus récente, sous un nom libre (une
     * fiche ou des capteurs restés seuls d'une restauration coupée sont repris en place). `null` si aucune entrée ne
     * convient.
     */
    const trashRestoreOf = async (startMs: number): Promise<{ entry: TrashEntry; copies: TrashCopy[] } | null> => {
      const entries = sessionTrashEntries(await trashNow(), startMs)
        .sort((a, b) => Number(a.origin !== 'ordinateur') - Number(b.origin !== 'ordinateur') || b.deletedAtMs - a.deletedAtMs);
      for (const entry of entries) {
        const names = (await computer.list(SESSIONS_DIR)).map((e) => e.name);
        const leftovers = new Set(await trashLeftoversIn(computer, entry, SESSIONS_DIR, names));
        const { copies } = sessionRestorePlan(entry, names.filter((name) => !leftovers.has(name)));
        const brings = (ext: RegExp): boolean => copies.some((copy) => ext.test(copy.to));
        if (brings(/\.gpx$/i) && brings(/\.json$/i) && (await trashHoldsCopies(computer, copies))) return { entry, copies };
      }
      return null;
    };

    /**
     * Retient le nom montré de chaque session de `items` qui n'en a pas encore, d'abord par ce qui est déjà lu : sa
     * fiche relue pour le plan, sinon celle gardée à la dernière synchronisation (`ancestors`), l'ordinateur d'abord,
     * sinon le nom que la corbeille lui garde. Seule une session que le compte rendu montre (`shown`) est lue s'il le
     * faut, sur l'ordinateur, puis sur le téléphone en dernier recours ; à défaut, elle prend le nom de son GPX. Un nom
     * ne fait que dire : une lecture en échec passe à la suivante.
     */
    const nameSessions = async (items: readonly SyncItem[], shown: (item: SyncItem) => boolean): Promise<void> => {
      const trashed = await trashNow();
      const recordOf = (text: string | null | undefined): SessionRecord | null => (text ? inspectSyncRecord(text).record : null);
      for (const item of items) {
        if (outcome.names.sessions[item.startMs] !== undefined) continue;
        const listedOn = (side: SyncSideName) => (item.files[side] === null ? undefined : input[side].sessions.find((s) => s.gpx.name === item.files[side]));
        // Fiche non relue pour le plan : son tampon est celui de la base, son texte celui qu'elle a gardé.
        const knownOn = (side: SyncSideName): SessionRecord | null => recordOf(listedOn(side)?.recordText ?? ancestors.get(item.startMs)?.[side]);
        const readOn = async (side: SyncSideName): Promise<SessionRecord | null> => {
          const listed = listedOn(side);
          return listed?.record ? recordOf(await folders[side].readText(sessionPath(listed.record.name)).catch(() => null)) : null;
        };
        const kept = sessionTrashEntries(trashed, item.startMs).sort(trashRestoreOrder)[0];
        let record = knownOn('computer') ?? knownOn('phone');
        if (!record && !kept && shown(item)) record = (await readOn('computer')) ?? (await readOn('phone'));
        const gpx = item.files.computer ?? item.files.phone;
        const name = record && gpx ? shownName(record, gpx) : kept ? kept.name : gpx ? shownName(null, gpx) : null;
        if (name !== null) outcome.names.sessions[item.startMs] = name;
      }
    };
    /** Retient le nom de chaque itinéraire de `items` : la base de ses fichiers, celle de l'ordinateur d'abord. */
    const nameRoutes = (items: readonly RouteSyncItem[]): void => {
      for (const item of items) {
        const name = item.files.computer ?? item.files.phone;
        if (name !== null && outcome.names.routes[item.id] === undefined) outcome.names.routes[item.id] = name;
      }
    };

    // Réponses « Tout garder » et « Les garder », sur l'ordinateur seul et avant le plan. Une réponse n'agit que sur
    // une session encore dans le cas que la question a montré, d'après le plan du moment sans ces réponses.
    const refusedSessions = options.keepRefused?.sessions ?? [];
    const heldLists = options.heldToKeep !== undefined || options.heldRoutesToKeep !== undefined;
    if (!dryRun && (refusedSessions.length > 0 || keepHeld)) {
      const refusedOn = (startMs: number, side: SyncSideName): boolean => refusedSessions.some((key) => sameDeletion(key, { startMs, side }));
      const heldKept = (startMs: number): boolean => keepHeld && (!heldLists || (options.heldToKeep ?? []).includes(startMs));
      const wanted = sessionPlanOf([]).items.filter((item) => {
        const side = syncDeletionSide(item);
        return side ? refusedOn(item.startMs, side) : item.left === 'inTrash' && (heldKept(item.startMs) || refusedOn(item.startMs, 'phone'));
      });
      outcome.kept.sessions = wanted.map((item) => item.startMs);
      // Nommées tant qu'elles sont encore là où la question les a vues : la corbeille peut les rendre sous un autre nom.
      await nameSessions(wanted, () => true);
      // D'abord, d'une seule écriture, la base oublie tout ce qui ne doit plus pouvoir se supprimer de soi-même si la
      // suite est coupée : les sessions supprimées sur le téléphone (le plan les y recopie, ou elles l'attendent comme
      // des sessions neuves s'il ne s'écrit pas), et celles de l'ordinateur que sa corbeille ne peut pas rendre (le
      // plan les recopie depuis le téléphone). Une session suivie que la corbeille rend garde sa ligne : ses deux
      // fiches se fondront avec leurs ancêtres, sans rien perdre de ce qui a été saisi depuis sur le téléphone.
      const fromTrash: number[] = [];
      const forgotten: number[] = [];
      for (const item of wanted) {
        const onPhoneOnly = syncDeletionSide(item) !== 'computer';
        const restorable = onPhoneOnly && (await trashRestoreOf(item.startMs)) !== null;
        if (restorable) fromTrash.push(item.startMs);
        if (!restorable || syncBaseLine(pair.base, item.startMs) === null) forgotten.push(item.startMs);
      }
      let changed = await forgetSessions(forgotten);
      // Puis chaque session que la corbeille tient en sort : capteurs, fiche, GPX en dernier, et l'entrée retirée
      // ensuite seulement. Une coupure entre les deux la laisse dans la mémoire et dans la corbeille, jamais deux fois
      // dans la mémoire.
      for (const startMs of fromTrash) {
        const restore = await trashRestoreOf(startMs);
        if (!restore) {
          if (await forgetSessions([startMs])) changed = true;
          continue;
        }
        await copyFromTrash(computer, restore.copies);
        await dropTrashEntries(computer, [restore.entry.dir]);
        outcome.kept.fromTrash.sessions.push(startMs);
        changed = true;
      }
      if (changed) input = await readInput();
    }
    // Une session de l'ordinateur qui porte un brouillon non enregistré n'est jamais mise à sa corbeille : sa suppression
    // attend (ni faite, ni comptée, ni à confirmer), et le compte rendu le dit.
    const hasDraft = options.hasUnsavedDraft ?? (() => false);
    const planned = sessionPlanOf(outcome.kept.sessions);
    const drafted = planned.items.filter((item) => item.ops.some((op) => op.kind === 'trash' && op.files.some((file) => hasDraft(file.name))));
    outcome.drafted = drafted;
    const full: SyncPlan = drafted.length === 0 ? planned : {
      ...planned,
      items: planned.items.map((item): SyncItem => (drafted.includes(item) ? { ...item, ops: [], base: { kind: 'keep' }, left: 'outOfScope' } : item)),
    };
    await nameSessions(full.items, (item) => item.ops.length > 0 || item.restored === true || outcome.kept.sessions.includes(item.startMs));
    // Itinéraires : leur plan est fait maintenant, pour que le garde-fou et sa confirmation les comptent avec les
    // sessions ; ils ne sont exécutés qu'après elles. Rien ne les touche (ni lecture ni écriture) sans `phoneRoutes`.
    outcome.routes.waiting = options.phoneRoutes === false;
    let routeInput = options.phoneRoutes === true ? await readRouteSyncInput(folders, pair.base) : null;
    const routeAnswer: RouteKeepAnswer = {
      refused: options.keepRefused?.routes ?? [],
      held: !keepHeld ? null : heldLists ? options.heldRoutesToKeep ?? [] : 'all',
    };
    if (!dryRun && routeInput && (routeAnswer.refused.length > 0 || routeAnswer.held !== null)) {
      const asked = routePlanOf(routeInput, []);
      const kept = await keepRoutes(asked, routeAnswer, { computer, base: () => pair.base, setBase: writeBase });
      outcome.kept.routes = kept.kept;
      nameRoutes(asked.items.filter((item) => kept.kept.includes(item.id)));
      outcome.kept.fromTrash.routes = kept.fromTrash;
      if (kept.changed) routeInput = await readRouteSyncInput(folders, pair.base);
    }
    const routeFull: RouteSyncPlan | null = routeInput ? routePlanOf(routeInput, outcome.kept.routes) : null;
    if (routeFull) nameRoutes(routeFull.items);
    // Le garde-fou ne compte que les suppressions que cette passe peut faire : un téléphone qu'on ne peut pas écrire
    // ne perd rien, et ses retraits ne retiennent pas les mises à la corbeille de l'ordinateur.
    const possible = restrictSyncPlan(full, { ...scope, deletions: true });
    const routePossible = routeFull ? restrictRouteSyncPlan(routeFull, { ...scope, deletions: true }) : null;
    const routeShown = options.confirmedRouteDeletions ?? (options.confirmedDeletions ? [] : undefined);
    const confirmed = options.confirmDeletions === true
      && (!options.confirmedDeletions || deletionKeysOf(possible.items).every((key) => options.confirmedDeletions?.some((c) => sameDeletion(c, key))))
      && (!routeShown || routeDeletionKeysOf(routePossible?.items ?? []).every((key) => routeShown.some((c) => c.id === key.id && c.side === key.side)));
    const unconfirmedShown = options.confirmDeletions === true && !confirmed;
    const tripped = possible.guard.tripped || routePossible?.guard.tripped === true;
    outcome.deletions = !scope.deletions ? 'excluded' : (tripped || unconfirmedShown) && !confirmed ? 'awaitingConfirmation' : 'made';
    const plan = restrictSyncPlan(full, { ...scope, deletions: outcome.deletions === 'made' });
    outcome.plan = plan;
    const deletionsOf = (item: SyncItem | undefined): number => item?.ops.filter((op) => op.kind === 'trash' || op.kind === 'removeFromPhone').length ?? 0;
    // Seulement ce que le garde-fou compte : les restes d'une session absente des deux côtés, retenus avec le reste,
    // ne sont pas une suppression à montrer ni à confirmer.
    outcome.withheldDeletions = possible.items.filter((item) =>
      syncDeletionSide(item) !== null && deletionsOf(item) > deletionsOf(plan.items.find((i) => i.startMs === item.startMs)));
    if (!scope.phone) outcome.withheldForPhone = full.items.filter((item) => phoneOpsOf(item) > 0);
    const routePlan = routeFull ? restrictRouteSyncPlan(routeFull, { ...scope, deletions: outcome.deletions === 'made' }) : null;
    if (routeFull && routePossible && routePlan) {
      outcome.routes.plan = routePlan;
      outcome.routes.withheldDeletions = routePossible.items.filter((item) => routeRemovalsOf(item) > routeRemovalsOf(routePlan.items.find((i) => i.id === item.id)));
      if (!scope.phone) outcome.routes.withheldForPhone = routeFull.items.filter((item) => item.ops.some(routeOpWritesPhone));
    }
    if (dryRun) {
      outcome.preview = true;
      outcome.plan = possible;
      outcome.routes.plan = routePossible;
      outcome.extrasPlan = await readExtrasPlan(folders, deviceIdsOf());
      return outcome;
    }
    options.onPlanned?.(plan, pair.first);

    let base: SyncBase = pair.base ?? emptySyncBase(ids.computer ?? '', ids.phone ?? '', options.phonePath ?? null);
    if (phonePass !== null) base = { ...base, phonePass };
    const saveBase = async (): Promise<void> => {
      if (plan.saveBase) await computer.writeText(syncBasePath(base.phoneId), serializeSyncBase(base));
    };

    /** Renonce si le fichier n'est plus celui du plan. */
    const expect = async (side: SyncSideName, file: SyncStamp | null): Promise<void> => {
      if (!file) return;
      const at = await folders[side].stat(sessionPath(file.name));
      if (!at || !sameFileStat(at, file)) throw new StaleError(file.name);
    };
    const bytesOf = async (side: SyncSideName, name: string): Promise<Uint8Array> => {
      const bytes = await folders[side].readBytes(sessionPath(name));
      if (!bytes) throw new StaleError(name);
      return bytes;
    };
    const write = async (side: SyncSideName, name: string, bytes: Uint8Array): Promise<void> => {
      if (side === 'phone') phoneChanged = true;
      await folders[side].writeBytes(sessionPath(name), bytes);
      const at = await folders[side].stat(sessionPath(name));
      if (at) expected[side].set(name, at);
      else expected[side].delete(name);
    };
    /** Écrit un fichier qui ne doit pas exister, sinon seulement sous la forme d'un reste de même taille d'une copie coupée. */
    const writeNew = async (side: SyncSideName, name: string, bytes: Uint8Array): Promise<void> => {
      const at = await folders[side].stat(sessionPath(name));
      if (at && at.size !== bytes.byteLength) throw new StaleError(name);
      await write(side, name, bytes);
    };
    /** Retire un fichier de l'ordinateur ; sa copie est déjà dans la corbeille. Jamais pour le téléphone. */
    const removeFromComputer = async (name: string): Promise<void> => {
      await computer.remove(sessionPath(name));
      expected.computer.delete(name);
    };
    /**
     * Dépose des fichiers du téléphone dans sa corbeille (`depositOnPhone`), GPX d'abord : un dépôt neuf nommé d'après
     * l'identité `moveTo`, son `depose.json` (nom montré, fichiers et tailles) écrit avant tout déplacement.
     */
    const depositSession = async (item: SyncItem, moveTo: string, files: readonly SyncStamp[]): Promise<void> => {
      phoneChanged = true;
      const main = mainOf(files);
      const deposit: TrashDeposit = {
        origin: 'ordinateur', kind: files.some((f) => /\.gpx$/i.test(f.name)) ? 'session' : 'restes', startMs: item.startMs, routeBase: null,
        createdAt: null, name: outcome.names.sessions[item.startMs] ?? main.replace(/\.gpx$/i, ''),
        files: files.map((f) => ({ name: f.name, size: f.size })),
      };
      await depositOnPhone(phone, moveTo, deposit, files.map((f) => sessionPath(f.name)), now());
      for (const file of files) expected.phone.delete(file.name);
    };
    /** Fichiers d'un côté à poser dans la base : présents, et tels que la synchronisation les a lus ou écrits. */
    const filesOf = async (side: SyncSideName, names: SyncTargetNames): Promise<SyncFiles> => {
      const stamp = async (name: string | null): Promise<SyncStamp | null> => {
        if (name === null) return null;
        const at = await folders[side].stat(sessionPath(name));
        const wanted = expected[side].get(name);
        if (!at || !wanted || !sameFileStat(at, wanted)) throw new StaleError(name);
        return { name, size: at.size, mtimeMs: at.mtimeMs };
      };
      const gpx = await stamp(names.gpx);
      return { gpx: gpx as SyncStamp, record: await stamp(names.record), imu: await stamp(names.imu) };
    };

    /**
     * Range des fichiers d'une session à la corbeille. Avec leur GPX : une entrée de session. Sans lui (fiche ou
     * capteurs restés seuls) : avec une entrée de la même session qui peut les recevoir sans rien écraser, de la même
     * origine et du même GPX d'abord ; sinon dans une entrée de restes, que la corbeille ne montre ni ne restaure.
     * Puis la copie rangée est RELUE, octet pour octet, contre ce qui a été lu : rien ne quitte un appareil sur la foi
     * d'une écriture qui n'a pas été vérifiée. Une relecture qui diffère arrête la session (rien n'est retiré).
     */
    const stash = async (startMs: number, origin: TrashOrigin, stamps: readonly SyncStamp[], files: { name: string; bytes: Uint8Array }[]): Promise<void> => {
      const main = mainOf(stamps);
      const recordBytes = files.find((f) => /\.json$/i.test(f.name))?.bytes;
      const name = shownName(recordBytes ? inspectSyncRecord(decode(recordBytes)).record : null, main);
      let dir: string | null = null;
      if (files.some((f) => /\.gpx$/i.test(f.name))) {
        dir = (await stashFilesInTrash(computer, { startMs, name, origin, main, files }, now())).dir;
      } else {
        const rank = (e: TrashEntry): number => (e.origin === origin ? 0 : 2) + (e.main.toLowerCase() === main.toLowerCase() ? 0 : 1);
        const hosts = sessionTrashEntries(await trashNow(), startMs).sort((a, b) => rank(a) - rank(b));
        for (const host of hosts) {
          if (await addFilesToTrashEntry(computer, host.dir, files)) {
            dir = host.dir;
            break;
          }
        }
        dir ??= (await stashFilesInTrash(computer, { startMs, name, origin, main, files, kind: 'restes' }, now())).dir;
      }
      for (const file of files) {
        const kept = await computer.readBytes(trashFilePath(dir, file.name)).catch(() => null);
        if (!kept || !sameBytes(kept, file.bytes)) {
          throw new Error(`la copie de « ${file.name} » dans la corbeille de l'ordinateur, relue, n'est pas identique : rien n'a été retiré`);
        }
      }
    };

    /** Range à la corbeille, à part, les fichiers du téléphone d'une session avant leur retrait. */
    const keepFromPhone = async (startMs: number, files: readonly SyncStamp[]): Promise<void> => {
      const read = [];
      for (const file of files) read.push({ name: file.name, bytes: await bytesOf('phone', file.name) });
      await stash(startMs, 'telephone', files, read);
      if (!outcome.keptFromPhone.includes(startMs)) outcome.keptFromPhone.push(startMs);
    };

    /** Fichier du téléphone et l'un des fichiers de la corbeille identiques octet pour octet ; une lecture en échec ou un fichier absent : non. */
    const sameContent = async (file: SyncStamp, candidates: readonly { dir: string; name: string }[]): Promise<boolean> => {
      if (candidates.length === 0) return false;
      const mine = await phone.readBytes(sessionPath(file.name));
      if (!mine) return false;
      for (const c of candidates) {
        const theirs = await computer.readBytes(trashFilePath(c.dir, c.name)).catch(() => null);
        if (theirs && sameBytes(theirs, mine)) return true;
      }
      return false;
    };

    /**
     * Vrai si la corbeille, relue sur le disque au moment du retrait, tient encore ce que le plan a compté : un GPX et
     * des capteurs identiques, octet pour octet, à ceux du téléphone (la taille ne suffit pas), et une fiche : présente
     * (`present`), sans exigence (`any`), ou identique au contenu (`same`) : une note ou un vent changés sans changer
     * la longueur du texte ne passent pas pour tenus. Elle a pu être vidée depuis.
     */
    const trashStillHolds = async (startMs: number, files: readonly SyncStamp[], record: 'any' | 'present' | 'same'): Promise<boolean> => {
      const held: { dir: string; name: string; size: number }[] = [];
      for (const entry of (await trashNow()).filter((e) => e.startMs === startMs && e.kind !== 'itineraire')) {
        for (const f of entry.files) {
          if ((await computer.stat(trashFilePath(entry.dir, f.name)))?.size === f.size) held.push({ dir: entry.dir, name: f.name, size: f.size });
        }
      }
      for (const file of files) {
        const ext = /\.[^.]+$/.exec(file.name)?.[0].toLowerCase() ?? '';
        const same = (f: { name: string }): boolean => f.name.toLowerCase().endsWith(ext);
        const sameSize = held.filter((f) => same(f) && f.size === file.size);
        const ok = ext === '.json' && record !== 'same' ? record === 'any' || held.some(same) : await sameContent(file, sameSize);
        if (!ok) return false;
      }
      return true;
    };

    /**
     * Fiche du téléphone, changée depuis la base, fondue dans celle que la corbeille garde de l'ordinateur. Si elle ne
     * se fond pas sans perte (fiche de la corbeille absente ou illisible, champ changé des deux côtés), la copie du
     * téléphone est rangée entière, à part.
     */
    const keepPhoneRecord = async (item: SyncItem, op: Extract<SyncOp, { kind: 'removeFromPhone' }>): Promise<void> => {
      const line = syncBaseLine(base, item.startMs);
      const candidates = sessionTrashEntries(await trashNow(), item.startMs)
        .filter((e) => e.origin === 'ordinateur')
        .map((entry) => ({ entry, json: entry.files.find((f) => /\.json$/i.test(f.name)) }))
        .filter((c): c is { entry: TrashEntry; json: { name: string; size: number } } => c.json !== undefined)
        .sort((a, b) => b.entry.deletedAtMs - a.entry.deletedAtMs);
      const target = candidates.find((c) => c.entry.main.toLowerCase() === line?.computer.gpx.name.toLowerCase()) ?? candidates[0];
      const trashText = target ? await computer.readText(trashFilePath(target.entry.dir, target.json.name)) : null;
      const kept = ancestors.get(item.startMs) ?? { computer: null, phone: null };
      const merged = trashText === null || op.recordText === null ? null
        : mergeSyncRecords({ computer: trashText, phone: op.recordText, computerAncestor: kept.computer, phoneAncestor: kept.phone });
      if (!target || !merged || merged.conflicts.length > 0) {
        await keepFromPhone(item.startMs, op.files);
        return;
      }
      if (merged.computer !== null) await rewriteTrashText(computer, target.entry.dir, target.json.name, merged.computer);
    };

    /** Activités inconnues des fiches écrites pour la session en cours, retenues si toute la session est faite. */
    let receivedActivities: SyncUnknownActivity[] = [];
    const noteActivity = (side: SyncSideName, startMs: number, recordText: string): void => {
      const known = options.knownActivities?.[side];
      const activityId = known ? unknownSyncActivity(recordText, known) : null;
      if (activityId !== null) receivedActivities.push({ side, startMs, activityId });
    };

    /** Vrai quand le listage du téléphone a déjà été relu pour la session en cours. */
    let phoneRelisted = false;
    /**
     * Relit le listage du téléphone, une fois par session, avant de remplacer l'une de ses fiches : le câble ne voit un
     * fichier que par son dernier listage, et une fiche enregistrée sur le téléphone depuis le plan (une note saisie
     * pendant la synchronisation) serait sinon écrasée par la fusion faite avant elle. Changée, la session est sautée
     * et fondue à la fois suivante. Une copie neuve (`writeNew`) n'en a pas besoin : elle ne remplace rien.
     */
    const relistPhone = async (): Promise<void> => {
      if (phoneRelisted) return;
      await phone.list(SESSIONS_DIR);
      phoneRelisted = true;
    };

    const execute = async (op: SyncOp, item: SyncItem): Promise<void> => {
      switch (op.kind) {
        case 'copy': {
          const from = otherSyncSide(op.to);
          for (const file of [op.source.gpx, op.source.record, op.source.imu]) await expect(from, file);
          const gpx = await bytesOf(from, op.source.gpx.name);
          if (!isCompleteGpxText(decode(gpx))) throw new StaleError(op.source.gpx.name);
          if (await folders[op.to].stat(sessionPath(op.target.gpx))) throw new StaleError(op.target.gpx);
          if (op.source.imu && op.target.imu) await writeNew(op.to, op.target.imu, await bytesOf(from, op.source.imu.name));
          if (op.source.record && op.target.record) {
            const record = op.recordText === null ? await bytesOf(from, op.source.record.name) : encode(op.recordText);
            await writeNew(op.to, op.target.record, record);
            noteActivity(op.to, item.startMs, decode(record));
          }
          await writeNew(op.to, op.target.gpx, gpx);
          return;
        }
        case 'writeRecord':
          if (op.on === 'phone') await relistPhone();
          await expect(op.on, op.file);
          await write(op.on, op.file.name, encode(op.text));
          noteActivity(op.on, item.startMs, op.text);
          return;
        case 'copyRecord': {
          const from = otherSyncSide(op.to);
          await expect(from, op.source);
          if (op.to === 'phone') await relistPhone();
          await expect(op.to, op.file);
          const record = await bytesOf(from, op.source.name);
          await write(op.to, op.file.name, record);
          noteActivity(op.to, item.startMs, decode(record));
          return;
        }
        case 'copyImu': {
          const from = otherSyncSide(op.to);
          await expect(from, op.source);
          await writeNew(op.to, op.target, await bytesOf(from, op.source.name));
          return;
        }
        case 'trash': {
          if (op.absent !== null && (await phone.stat(sessionPath(op.absent)))) throw new StaleError(op.absent);
          const files = [];
          for (const file of op.files) {
            const bytes = await computer.readBytes(sessionPath(file.name));
            // Le GPX doit être celui du plan ; une fiche saisie depuis est gardée telle qu'elle est maintenant.
            if (/\.gpx$/i.test(file.name) && (!bytes || bytes.byteLength !== file.size)) throw new StaleError(file.name);
            if (bytes) files.push({ name: file.name, bytes });
          }
          if (files.length === 0) return;
          await stash(item.startMs, 'ordinateur', op.files, files);
          for (const file of files) await removeFromComputer(file.name);
          return;
        }
        case 'removeFromPhone': {
          if (op.absent !== null && (await computer.stat(sessionPath(op.absent)))) throw new StaleError(op.absent);
          // Le listage du téléphone est relu : rien n'en part qui ne soit encore, à l'identique, ce que le plan a vu.
          await phone.list(SESSIONS_DIR);
          for (const file of op.files) await expect('phone', file);
          // Le plan a compté sur la corbeille telle qu'il l'a lue : relue maintenant, elle doit tenir encore la copie.
          // Tout garder : rien à ranger si la corbeille tient déjà ces mêmes fichiers (une session supprimée sur
          // l'ordinateur avant toute synchronisation), sinon la copie du téléphone y entre à part.
          const held = await trashStillHolds(item.startMs, op.files, op.keep === 'all' ? 'same' : op.keep === 'none' ? 'present' : 'any');
          if (!held) await keepFromPhone(item.startMs, op.files);
          else if (op.keep === 'record') await keepPhoneRecord(item, op);
          await depositSession(item, op.moveTo, op.files);
        }
      }
    };

    const filesOfItem = (item: SyncItem): number => item.ops.reduce((sum, op) => sum + filesOfOp(op), 0);
    const sessionFiles = plan.items.reduce((sum, item) => sum + filesOfItem(item), 0);
    const total = sessionFiles + (routePlan ? routePlanFiles(routePlan) : 0);
    let before = 0;
    options.onProgress?.(0, total);
    for (const item of plan.items) {
      receivedActivities = [];
      phoneRelisted = false;
      let reached = before;
      before += filesOfItem(item);
      try {
        for (const op of item.ops) {
          await execute(op, item);
          reached += filesOfOp(op);
          options.onProgress?.(reached, total);
        }
        if (item.base.kind === 'forget') {
          base = withoutSyncLine(base, item.startMs);
          await saveBase();
          for (const side of SYNC_SIDES) await computer.remove(syncAncestorPath(base.phoneId, item.startMs, side));
        } else if (item.base.kind === 'hold') {
          base = withSyncHeld(base, item.startMs);
          await saveBase();
        } else if (item.base.kind === 'set' && plan.saveBase) {
          const line = { startMs: item.startMs, computer: await filesOf('computer', item.base.computer), phone: await filesOf('phone', item.base.phone) };
          for (const side of SYNC_SIDES) {
            const text = item.base.ancestors[side];
            if (text !== null) await computer.writeText(syncAncestorPath(base.phoneId, item.startMs, side), text);
          }
          base = withSyncLine(base, line);
          await saveBase();
        }
        outcome.done.push(item);
        for (const note of receivedActivities) {
          if (!outcome.unknownActivities.some((u) => u.side === note.side && u.startMs === note.startMs)) outcome.unknownActivities.push(note);
        }
      } catch (err) {
        if (err instanceof SyncLinkError) throw err;
        if (err instanceof StaleError) outcome.skipped.push(item);
        else outcome.failed.push({ item, detail: errorMessage(err, String(err)) });
        if (before > reached) options.onProgress?.(before, total);
      }
    }
    if (routeInput && routePlan) {
      let reachedRoutes = sessionFiles;
      options.onProgress?.(reachedRoutes, total);
      await executeRoutePlan(routePlan, routeInput, {
        folders,
        phone,
        isLinkError: (err) => err instanceof SyncLinkError,
        now,
        base: () => base,
        setBase: async (next) => {
          base = next;
          await saveBase();
        },
        onPhoneChange: () => {
          phoneChanged = true;
        },
        onFiles: (files) => {
          reachedRoutes += files;
          options.onProgress?.(reachedRoutes, total);
        },
      }, outcome.routes);
    }
    options.onProgress?.(total, total);
    await syncExtraFiles(folders, scope, await readExtrasPlan(folders, deviceIdsOf()), outcome);
    const extrasStopped = outcome.extras.left.some((l) => l.reason === 'changed' || l.reason === 'failed');
    const routesStopped = outcome.routes.skipped.length > 0 || outcome.routes.failed.length > 0;
    // Entière seulement si la restriction n'a rien retiré du plan : une opération écartée (retrait non permis, restes
    // d'une session déjà supprimée, téléphone en lecture seule) laisse la base sans date de fin, et la synchronisation
    // suivante la reprend. « Sans rien supprimer » sans rien à retirer reste entière.
    outcome.cut = plan.items.filter((item) => item.left === 'outOfScope' && !drafted.some((d) => d.startMs === item.startMs)).length
      + (routePlan?.items.filter((item) => item.left === 'outOfScope').length ?? 0);
    outcome.complete = scope.phone && outcome.cut === 0 && outcome.skipped.length === 0 && outcome.drafted.length === 0 && outcome.failed.length === 0
      && !extrasStopped && !routesStopped;
    if (outcome.complete) {
      const entries = await trashNow();
      const trashed = new Set(trashedOf(entries).map((e) => e.startMs));
      base = withSyncDone(base, now(), trashed, routePlan ? trashedRouteIds(entries) : undefined);
      await saveBase();
    }
    outcome.phoneChanged = phoneChanged || outcome.extras.done.some((op) => op.to === 'phone');
    await notifyPhone();
    await computer.remove(SYNC_RUNNING_PATH);
    return outcome;
  } catch (err) {
    const detail = errorMessage(err, String(err));
    outcome.phoneChanged = phoneChanged;
    if (err instanceof SyncLinkError) {
      return err.recording ? { ...outcome, recordingStarted: true, complete: false } : { ...outcome, linkLost: detail, complete: false };
    }
    // Arrêtée par une erreur de l'ordinateur : ce qui a déjà changé sur le téléphone s'y voit quand même.
    await notifyPhone();
    return { ...outcome, error: detail, complete: false };
  }
};

export interface SyncLockOptions extends SyncOptions {
  /**
   * Vrai pendant un enregistrement (`isRecordingActive` de l'enregistreur, passé par l'appelant : l'enregistreur
   * dépend de la bibliothèque, pas l'inverse). Absent : aucun enregistrement possible.
   */
  recording?: () => boolean;
}

const settle = (pending: Promise<unknown> | null): Promise<unknown> => pending?.then(() => undefined, () => undefined) ?? Promise.resolve();

/**
 * Synchronise la mémoire ouverte avec le dossier distant `phone` (le téléphone branché) : la mémoire doit être
 * ouverte en écriture sur le dossier du disque du programme Windows (qui a la corbeille). Pendant toute la durée, la
 * mémoire est tenue comme pendant un import (« import en cours » : imports et remises à zéro attendent), et la
 * corbeille aussi (`holdTrashDuring` : restaurer, supprimer définitivement, vider et purger attendent), après que les
 * saisies en attente ont été écrites ; à la fin, la mémoire et la corbeille sont relues. Refusée pendant un import,
 * une autre synchronisation ou un enregistrement (`busy`). Ne lève pas.
 */
export const synchronizePhone = async (phone: SyncRemote, options: SyncLockOptions = {}): Promise<SyncOutcome> => {
  await lib.opening.catch(() => undefined);
  const memory = libraryState();
  if (!canImportSessions(memory)) return emptyOutcome('memory');
  // Deux imports, ou un import et une synchronisation, rangeraient deux fois la même session.
  if (memory.importing || options.recording?.()) return emptyOutcome('busy');
  setState({ importing: true });
  try {
    return await holdTrashDuring(async () => {
      await flushWrites();
      // Un passage qui crée des fiches s'attend (une fiche écrite en même temps écraserait la fusion) ; un passage qui
      // ne fait que refaire des résumés cède entre deux traces, et reprend après.
      await settle(lib.scanCompletion);
      const release = await holdSummaryPasses();
      try {
        const folder = trashFolderOf(lib.folder);
        if (!folder) return emptyOutcome('noTrash');
        return await executeSync(folder, phone, {
          shownName: (record, gpx) => (record ? recordShownName(record, gpx) : gpx),
          hasUnsavedDraft: (file) => sessionDraftStore.get(file) !== null,
          computerDeviceId: deviceId(),
          // Le téléphone n'est pas vérifié : son fichier de réglages ne se distingue pas sûrement des copies des autres.
          knownActivities: { computer: readStoredActivities().map((a) => a.id) },
          ...options,
        });
      } finally {
        release();
      }
    });
  } catch (err) {
    return { ...emptyOutcome(null), error: errorMessage(err, String(err)) };
  } finally {
    // Un passage à blanc n'a rien écrit : rien à relire.
    if (options.dryRun !== true) await refreshLibrary().catch(() => undefined);
    setState({ importing: false });
    await reloadTrash();
  }
};
