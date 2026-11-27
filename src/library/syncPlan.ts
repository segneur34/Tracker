import { uniqueSessionFileName } from './naming';
import { dedupeSessions, imuFileName, isGpxFileName, recordFileName, type SessionRecord } from './record';
import { sameStamp } from './recordMerge';
import {
  SYNC_SIDES, otherSyncSide, syncBaseLine,
  type SyncBase, type SyncBaseSession, type SyncFiles, type SyncSideName, type SyncStamp,
} from './syncBase';
import type { TrashEntry } from './trash';
import { inspectSyncRecord, mergeSyncRecords, renamedSyncRecord, syncRecordChanged, type SyncRecordState } from './syncRecordMerge';

/**
 * Plan d'une synchronisation des sessions entre l'ordinateur et le téléphone : des deux listages et de la base
 * (`syncBase.ts`), la liste de ce qu'il y a à faire. Ce module ne lit ni n'écrit rien ; l'exécutant lit les fiches
 * qu'on lui désigne (`syncRecordsToRead`), puis fait les opérations du plan.
 *
 * Une session est reconnue à l'instant de son premier point, jamais à son nom de fichier, qui dépend du fuseau de
 * l'appareil. Selon qu'elle est sur l'ordinateur, sur le téléphone et dans la base :
 *
 *     ordinateur  téléphone  base
 *        oui         non      non    neuve sur l'ordinateur : recopiée sur le téléphone
 *        non         oui      non    neuve sur le téléphone : recopiée sur l'ordinateur
 *        oui         oui      non    première rencontre : les deux fiches se complètent
 *        oui         oui      oui    suivie : ce qu'un côté a changé passe à l'autre
 *        oui         non      oui    supprimée sur le téléphone : la copie de l'ordinateur va à sa corbeille
 *        non         oui      oui    supprimée sur l'ordinateur : retirée du téléphone
 *        non         non      oui    supprimée des deux côtés : la base l'oublie
 *
 * Rien ne se supprime sans ligne dans la base : une première rencontre (pas de base, dossier sans identifiant parce
 * qu'il a été remis à zéro, autre dossier) ne fait que réunir. Une session n'est tenue pour supprimée d'un côté que
 * si plus aucun fichier n'y porte le nom que la base donnait à son GPX. Une suppression couvre toutes les copies de
 * la session du côté où elle s'applique. Rien n'est retiré du téléphone qui ne soit déjà, à la même taille, dans la
 * corbeille de l'ordinateur ; sinon la copie du téléphone y est d'abord rangée. Et ce qui quitte le téléphone n'y est
 * jamais effacé : il est déposé dans la corbeille de sa mémoire (`phoneDepositPaths`), qu'il tient lui-même. Une
 * session revenue d'une corbeille d'un côté (neuve de ce côté, et dans `SyncBase.removed`) est recopiée de l'autre
 * sans question (`SyncItem.restored`).
 *
 * Chaque opération est sans effet si elle est déjà faite, et la ligne de base d'une session n'est réécrite qu'une
 * fois toutes ses opérations faites : une synchronisation coupée, ou restreinte à une partie du plan
 * (`restrictSyncPlan`), se reprend en recalculant le plan.
 *
 * Une suppression que l'utilisateur a refusée (`SyncInput.keep`) ne se fait pas : la session est traitée comme neuve
 * du côté qui l'a encore, donc recopiée de l'autre, et sa ligne reposée. Une identité gardée n'est pas non plus
 * retenue sur le téléphone à cause de la corbeille. `keep` n'a d'effet que dans ces cas : une identité qui n'y est
 * plus suit le plan ordinaire.
 */

/** Au-delà de ce nombre de sessions à retirer en une fois, la synchronisation demande avant de supprimer. */
export const SYNC_GUARD_MAX_REMOVALS = 10;
/** De même au-delà de cette part des sessions d'un côté. */
export const SYNC_GUARD_MAX_SHARE = 0.25;

/** Seuils du garde-fou (`SyncInput.guardLimits`) ; par défaut ceux ci-dessus. */
export interface SyncGuardLimits {
  maxRemovals: number;
  maxShare: number;
}

export const SYNC_GUARD_LIMITS: SyncGuardLimits = { maxRemovals: SYNC_GUARD_MAX_REMOVALS, maxShare: SYNC_GUARD_MAX_SHARE };

/**
 * Ce que devient une session du téléphone que l'ordinateur a supprimée sans que la synchronisation l'ait su (elle
 * est dans sa corbeille, ou l'a été, et n'a pas de ligne dans la base) : `leave`, laissée sur le téléphone et dite ;
 * `remove`, retirée du téléphone, sa copie rangée d'abord à la corbeille si celle-ci ne la tient plus.
 */
export type SyncHeldChoice = 'leave' | 'remove';
export const SYNC_HELD_ON_PHONE: SyncHeldChoice = 'leave';

/** Les fichiers de `sessions/` d'un côté, rangés par session. */
export interface SyncListing {
  sessions: SyncFiles[];
  /** Fiches et capteurs sans leur GPX : restes d'une suppression ou d'une copie coupée, que l'application ignore. */
  orphans: SyncStamp[];
  /** Tous les noms du dossier, pour y choisir un nom libre. */
  names: string[];
}

/** Une entrée d'un listage de dossier, telle que la donne `MemoryFolder.list`. */
export interface SyncListedEntry {
  name: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
}

const stampOf = (entry: Pick<SyncListedEntry, 'name' | 'size' | 'mtimeMs'>): SyncStamp => ({ name: entry.name, size: entry.size, mtimeMs: entry.mtimeMs });

/**
 * Listage de `sessions/` rangé par session. Les entrées sont celles que l'application de ce côté verrait : les
 * temporaires du téléphone y sont déjà interprétés par celui qui liste. Tout fichier qui n'est ni un GPX, ni une
 * fiche, ni des capteurs est ignoré.
 */
export const syncListing = (entries: readonly SyncListedEntry[]): SyncListing => {
  const files = entries.filter((e) => e.kind === 'file');
  const byName = new Map(files.map((e) => [e.name.toLowerCase(), stampOf(e)]));
  const attached = new Set<string>();
  const beside = (name: string): SyncStamp | null => {
    const found = byName.get(name.toLowerCase()) ?? null;
    if (found) attached.add(found.name);
    return found;
  };
  const sessions = files.filter((e) => isGpxFileName(e.name))
    .map((e): SyncFiles => ({ gpx: stampOf(e), record: beside(recordFileName(e.name)), imu: beside(imuFileName(e.name)) }));
  const orphans = files.filter((e) => /\.(json|imu)$/i.test(e.name) && !attached.has(e.name)).map(stampOf);
  return { sessions, orphans, names: entries.map((e) => e.name) };
};

/** Pourquoi les deux dossiers se rencontrent pour la première fois : rien ne sera supprimé. */
export type SyncFirstReason =
  /** L'un des deux dossiers n'a pas d'identifiant : jamais synchronisé, ou remis à zéro depuis. */
  | 'noComputerId' | 'noPhoneId'
  /** Le dossier du téléphone est une copie de celui de l'ordinateur : il reçoit un identifiant à lui. */
  | 'sameId'
  | 'noBase'
  /** La base a été faite pour un autre dossier de l'ordinateur, ou pour un autre chemin du téléphone (vieille copie). */
  | 'otherComputer' | 'otherPath'
  /**
   * Le marqueur du téléphone porte un passage plus ancien que celui de la base, ou aucun : une copie du dossier remise
   * plus tard, ou recopiée sur un autre téléphone. Elle reçoit un identifiant à elle ; la base de l'identifiant qu'elle
   * portait reste pour le téléphone qui le tient vraiment.
   */
  | 'olderCopy';

export interface SyncPair {
  /** `null` : paire suivie, la base fait foi ; sinon première rencontre. */
  first: SyncFirstReason | null;
  /** La base qui vaut pour cette synchronisation : `null` à une première rencontre, quoi que le disque en garde. */
  base: SyncBase | null;
  /** Côtés dont le marqueur doit recevoir un identifiant neuf (`markerTextWithId`), avant toute autre écriture. */
  newId: Record<SyncSideName, boolean>;
}

/**
 * Ce que sont les deux dossiers l'un pour l'autre, d'après leurs identifiants, la base lue pour ce téléphone et le
 * passage lu dans son marqueur (`readMarkerPass`, `null` s'il n'en porte pas).
 */
export const syncPair = (
  computerId: string | null, phoneId: string | null, phonePath: string | null, base: SyncBase | null, phonePass: number | null,
): SyncPair => {
  const first = (reason: SyncFirstReason, phone = phoneId === null): SyncPair =>
    ({ first: reason, base: null, newId: { computer: computerId === null, phone } });
  if (computerId === null) return first('noComputerId');
  if (phoneId === null) return first('noPhoneId');
  if (phoneId === computerId) return first('sameId', true);
  if (!base) return first('noBase');
  if (base.computerId !== computerId || base.phoneId !== phoneId) return first('otherComputer');
  if (base.phonePath !== null && phonePath !== null && base.phonePath !== phonePath) return first('otherPath');
  if (base.phonePass !== null && (phonePass === null || phonePass < base.phonePass)) return first('olderCopy', true);
  return { first: null, base, newId: { computer: false, phone: false } };
};

/** Ligne de la base dont le GPX de ce côté est ce fichier : même nom, même taille. */
const lineOfGpx = (base: SyncBase | null, side: SyncSideName, gpx: SyncStamp): SyncBaseSession | null =>
  base?.sessions.find((s) => s[side].gpx.name === gpx.name && s[side].gpx.size === gpx.size) ?? null;

/**
 * Noms des fiches à lire d'un côté : celles que la base ne connaît pas, celles dont la taille ou la date a changé
 * depuis, et celles dont la copie gardée de ce côté manque (`hasAncestor`, par session et par côté) : celle-là sera
 * fondue sans ancêtre, au lieu d'attendre pour toujours. Une date nulle ne prouve rien : la fiche est lue. `base` est
 * celle de la paire (`SyncPair.base`).
 */
export const syncRecordsToRead = (
  listing: SyncListing, base: SyncBase | null, side: SyncSideName, hasAncestor: (startMs: number, side: SyncSideName) => boolean,
): string[] =>
  listing.sessions.flatMap((s) => {
    if (!s.record) return [];
    const line = lineOfGpx(base, side, s.gpx);
    return line && hasAncestor(line.startMs, side) && sameStamp(line[side].record ?? undefined, s.record) ? [] : [s.record.name];
  });

/** Une session d'un côté, avec ce qu'on a lu d'elle. */
export interface SyncSideSession extends SyncFiles {
  /** Texte de sa fiche ; `null` : elle manque ; absent : elle n'a pas été lue, son tampon étant celui de la base. */
  recordText?: string | null;
  /** `false` : son GPX a été lu et n'est pas fini (`isCompleteGpxText`) ; l'exécutant le revérifie en le recopiant. */
  gpxComplete?: boolean;
}

export interface SyncSide {
  sessions: SyncSideSession[];
  orphans: SyncStamp[];
  names: string[];
}

/** Un côté prêt pour le plan : son listage, et le texte des fiches lues, par nom de fiche. */
export const syncSide = (listing: SyncListing, texts: ReadonlyMap<string, string | null>): SyncSide => ({
  ...listing,
  sessions: listing.sessions.map((s) => (s.record && texts.has(s.record.name) ? { ...s, recordText: texts.get(s.record.name) ?? null } : s)),
});

/** Les fiches des deux côtés à la dernière synchronisation d'une session ; `null` : copie perdue. */
export interface SyncAncestors {
  computer: string | null;
  phone: string | null;
}

/** Une entrée de la corbeille de l'ordinateur : l'identité de sa session, et ses fichiers avec leur taille. */
export interface SyncTrashed {
  startMs: number;
  files: readonly { name: string; size: number }[];
}

/**
 * Ce que la corbeille de l'ordinateur tient des sessions, d'après son index (`trash.ts`) : chaque entrée de session ou
 * de restes, quelle que soit son origine. Les itinéraires ont leur propre liste (`SyncTrashedRoute`).
 */
export const syncTrashedFrom = (entries: readonly TrashEntry[]): SyncTrashed[] =>
  entries.flatMap((e) => (e.kind !== 'itineraire' && e.startMs !== null ? [{ startMs: e.startMs, files: e.files }] : []));

export interface SyncInput {
  pair: SyncPair;
  computer: SyncSide;
  phone: SyncSide;
  /** Fiches gardées, par identité, pour les lignes de la base. Une copie absente : la fiche se fond sans ancêtre. */
  ancestors: ReadonlyMap<number, SyncAncestors>;
  /** Sessions que tient la corbeille de l'ordinateur. */
  trash: readonly SyncTrashed[];
  /** Par défaut `SYNC_HELD_ON_PHONE`. */
  heldOnPhone?: SyncHeldChoice;
  /**
   * Identités que l'utilisateur a dit garder : une session suivie qui manque d'un côté n'est pas supprimée de l'autre
   * mais recopiée là où elle manque, et une session du téléphone que la corbeille ferait retenir est recopiée sur
   * l'ordinateur. Sans effet sur une identité qui n'est dans aucun de ces cas.
   */
  keep?: readonly number[];
  /** Seuils du garde-fou ; par défaut `SYNC_GUARD_LIMITS`. */
  guardLimits?: SyncGuardLimits;
}

/** Noms des fichiers d'une session à l'arrivée d'une copie. */
export interface SyncTargetNames {
  gpx: string;
  record: string | null;
  imu: string | null;
}

/**
 * Une opération. Les tampons qu'elle porte sont ceux du listage : l'exécutant les compare à l'état du moment (`stat`)
 * et renonce si le fichier a changé depuis.
 */
export type SyncOp =
  /**
   * Session recopiée entière, capteurs puis fiche puis GPX en dernier. `recordText` : la fiche à écrire quand le nom
   * change à l'arrivée ; `null` : recopiée à l'octet. `target` : noms proposés, libres au moment du plan, ou tenus
   * par les seuls restes d'une copie coupée de cette même session, qu'ils remplacent.
   */
  | { kind: 'copy'; to: SyncSideName; source: SyncFiles; target: SyncTargetNames; recordText: string | null }
  /** Fiche fondue, écrite à la place de `file`. */
  | { kind: 'writeRecord'; on: SyncSideName; file: SyncStamp; text: string }
  /** Fiche d'une version plus récente, recopiée à l'octet à la place de `file`, de l'autre côté. */
  | { kind: 'copyRecord'; to: SyncSideName; source: SyncStamp; file: SyncStamp }
  /** Capteurs que ce côté n'a pas, recopiés sous `target`. */
  | { kind: 'copyImu'; to: SyncSideName; source: SyncStamp; target: string }
  /**
   * Fichiers de l'ordinateur mis à sa corbeille, GPX d'abord : une copie de la session supprimée sur le téléphone, ou
   * les restes (fiche, capteurs) d'une suppression coupée. `absent` : le GPX qui ne doit plus être sur le téléphone ;
   * s'il y est (listage en retard), ne rien faire.
   */
  | { kind: 'trash'; files: SyncStamp[]; absent: string | null }
  /**
   * Fichiers retirés du téléphone, GPX d'abord : une copie de la session, ou des restes. Jamais effacés : déposés dans
   * la corbeille du téléphone, dans un sous-dossier neuf nommé d'après l'identité `moveTo` (`startMs`, `trashDirName`),
   * sous leur nom (`phoneDepositPaths`). `absent` : le GPX qui ne doit plus être sur l'ordinateur, même vérification. `keep` : ce que la corbeille
   * de l'ordinateur doit d'abord recevoir du téléphone : `all`, tous ces fichiers (elle ne les tient pas à
   * l'identique) ; `record`, la fiche (`recordText`), changée sur le téléphone depuis, à fondre dans celle de la
   * corbeille ; `none`, rien. Avant de déplacer, l'exécutant relit le listage : un fichier dont la taille ou la date
   * n'est plus celle de `files` reste où il est.
   */
  | {
    kind: 'removeFromPhone'; files: SyncStamp[]; absent: string | null; keep: 'none' | 'record' | 'all'; recordText: string | null;
    moveTo: string;
  };

/** Ce que devient la ligne de base d'une session une fois toutes ses opérations faites. */
export type SyncBaseStep =
  /** La ligne reste telle quelle (ou absente) : la session sera reprise à la synchronisation suivante. */
  | { kind: 'keep' }
  /** La session n'est plus d'aucun côté : `withoutSyncLine`. */
  | { kind: 'forget' }
  /** Session du téléphone laissée où elle est, dont la base doit se souvenir : `withSyncHeld`. */
  | { kind: 'hold' }
  /**
   * La session est des deux côtés sous ces noms : l'exécutant relit leurs tampons (`stat`) et pose la ligne
   * (`withSyncLine`). `ancestors` : les fiches à garder ; `null` : celle déjà gardée vaut encore.
   */
  | { kind: 'set'; computer: SyncTargetNames; phone: SyncTargetNames; ancestors: SyncAncestors };

export type SyncCase = 'newOnComputer' | 'newOnPhone' | 'firstMeeting' | 'followed' | 'deletedOnPhone' | 'deletedOnComputer' | 'deletedOnBoth';

/** Pourquoi une session attend la synchronisation suivante. */
export type SyncLeftReason =
  /** Sans fiche, ou fiche illisible : la session n'est pas finie de ranger sur son appareil. */
  | 'noRecord' | 'unreadableRecord'
  | 'emptyGpx' | 'unfinishedGpx'
  /** Le GPX que la base connaissait d'un côté y est encore sous son nom, mais plus rien n'y dit que c'est cette session. */
  | 'changedGpx'
  /** Fiche d'une version plus récente de l'application, qui ne se réécrit pas. */
  | 'futureRecord'
  /** Sur le téléphone, et supprimée sur l'ordinateur sans que la synchronisation l'ait su : ni ramenée ni supprimée. */
  | 'inTrash'
  /** Une de ses opérations est hors de ce que l'appelant a permis (`restrictSyncPlan`). */
  | 'outOfScope';

export interface SyncItem {
  startMs: number;
  case: SyncCase;
  /** Nom de son GPX de chaque côté, pour le compte rendu. */
  files: Record<SyncSideName, string | null>;
  ops: SyncOp[];
  base: SyncBaseStep;
  left: SyncLeftReason | null;
  /** Champs saisis changés des deux côtés (`conflictLabels`) : la version de l'ordinateur l'a emporté. */
  conflicts: string[];
  /** Côté dont la version l'a emporté, pour chaque chemin de `conflicts`. Absent : l'ordinateur, partout. */
  conflictWinners?: Record<string, SyncSideName>;
  /** Deux traces différentes du même instant : aucun GPX remplacé, seuls les champs saisis fondus. */
  twoTracks: boolean;
  /** Session suivie dont une fiche gardée manquait ou ne valait plus : fondue comme à une première rencontre. */
  withoutAncestor: boolean;
  /**
   * Revenue d'une corbeille : neuve d'un côté (restaurée sur l'ordinateur ou sur le téléphone) alors que la
   * synchronisation avait mené sa suppression au bout (`SyncBase.removed`), ou retrouvée des deux côtés sans ligne
   * alors que le téléphone la tenait pendant qu'elle était à la corbeille (`SyncBase.held`). Absent : faux.
   */
  restored?: boolean;
  /**
   * Supprimée d'un côté (`case`) mais modifiée de l'autre depuis la dernière synchronisation : gardée, elle revient
   * là où elle manquait au lieu d'être retirée. Absent : faux.
   */
  revived?: boolean;
}

/** Un fichier laissé de côté sans être rattaché à une session. */
export interface SyncAside {
  side: SyncSideName;
  file: string;
}

export interface SyncGuard {
  /** Vrai : trop de suppressions pour les faire sans demander. */
  tripped: boolean;
  /** Les seuils appliqués. */
  limits: SyncGuardLimits;
  /** Sessions de l'ordinateur à mettre à la corbeille, et sessions à retirer du téléphone, chacune comptée une fois. */
  toTrash: number;
  fromPhone: number;
  /** Sessions de chaque côté avant toute suppression. */
  count: Record<SyncSideName, number>;
}

export interface SyncPlan {
  pair: SyncPair;
  /** Faux : la base ne doit pas être écrite (téléphone qu'on ne peut pas écrire, `restrictSyncPlan`) ; les lignes restent telles quelles. */
  saveBase: boolean;
  /** Une entrée par session qui demande quelque chose, par instant de départ. */
  items: SyncItem[];
  /** GPX qui doublent une session du même côté : ils ne voyagent pas, et partent avec elle si elle est supprimée. */
  duplicates: (SyncAside & { startMs: number })[];
  /** GPX sans identité (sans fiche, ou fiche illisible, et inconnus de la base) : jamais touchés. */
  unknown: (SyncAside & { reason: SyncLeftReason })[];
  guard: SyncGuard;
}

type SeenState = SyncRecordState | 'none' | 'empty';

/** Une session d'un côté, sa fiche interprétée. */
interface Seen {
  files: SyncSideSession;
  state: SeenState;
  startMs: number | null;
  /** Texte de la fiche : lu, ou celui gardé par la base quand elle n'a pas été lue. */
  text: string | null;
  /** Vrai si la fiche a été lue cette fois : la base ne la connaît pas sous ce tampon. */
  read: boolean;
  record: SessionRecord | null;
}

const LEFT_BY_STATE: Readonly<Record<SeenState, SyncLeftReason | null>> = {
  ok: null, future: null, none: 'noRecord', unreadable: 'unreadableRecord', empty: 'emptyGpx',
};

const namesOf = (files: SyncFiles): SyncTargetNames => ({ gpx: files.gpx.name, record: files.record?.name ?? null, imu: files.imu?.name ?? null });

/** Les fichiers d'une session, GPX d'abord. */
const stampsOf = (files: SyncFiles): SyncStamp[] => [files.gpx, ...(files.record ? [files.record] : []), ...(files.imu ? [files.imu] : [])];

const sameFile = (a: SyncStamp | null, b: SyncStamp | null): boolean =>
  a === null || b === null ? a === b : a.name === b.name && sameStamp(a, b);

/** Vrai si les fichiers d'un côté sont ceux de la ligne de base, au tampon près. */
const sameFiles = (line: SyncFiles, now: SyncFiles): boolean =>
  line.gpx.name === now.gpx.name && line.gpx.size === now.gpx.size && sameFile(line.record, now.record) && sameFile(line.imu, now.imu);

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const interpret = (session: SyncSideSession, side: SyncSideName, input: SyncInput): Seen => {
  const { base } = input.pair;
  const line = lineOfGpx(base, side, session.gpx);
  const unreadable = (state: SeenState, startMs: number | null): Seen => ({ files: session, state, startMs, text: null, read: true, record: null });
  if (session.gpx.size === 0) {
    // GPX vidé (écriture coupée, stockage abîmé) : pas une suppression. Connu de la base par son nom, il attend.
    return unreadable('empty', base?.sessions.find((s) => s[side].gpx.name === session.gpx.name)?.startMs ?? null);
  }
  if (!session.record || session.recordText === null) return unreadable('none', line?.startMs ?? null);
  const read = session.recordText !== undefined;
  const text = session.recordText ?? (line ? input.ancestors.get(line.startMs)?.[side] ?? null : null);
  if (text === null) return unreadable('unreadable', line?.startMs ?? null);
  const info = inspectSyncRecord(text);
  // Un GPX que la base connaît (même nom, même taille) garde l'identité qu'elle lui donne : un résumé refait qui
  // daterait autrement son premier point n'en fait pas une autre session, supprimée ici et neuve là.
  return { files: session, state: info.state, startMs: line?.startMs ?? info.startMs, text, read, record: info.record };
};

/** Celle des copies d'une même session qui compte, comme dans la mémoire (`dedupeSessions`) ; un GPX sans fiche lisible cède à celui qui en a une. */
const chosenCopy = (copies: readonly Seen[]): Seen => {
  const byName = [...copies].sort((a, b) => (a.files.gpx.name < b.files.gpx.name ? -1 : 1));
  const withRecord = byName.filter((s) => s.record);
  if (withRecord.length < 2) return withRecord[0] ?? byName[0];
  // Les fiches sont ramenées au même instant, celui que la base ou la fiche a donné à toutes ces copies.
  const { kept } = dedupeSessions(withRecord.map((s) => {
    const record = s.record as SessionRecord;
    return { file: s.files.gpx.name, record: { ...record, summary: { ...record.summary, startMs: 0 } }, readOnly: false, warning: null };
  }));
  return withRecord.find((s) => s.files.gpx.name === kept[0].file) ?? withRecord[0];
};

interface SideSessions {
  /** La copie qui compte, par identité. */
  kept: Map<number, Seen>;
  /** Toutes les copies d'une identité, celle qui compte comprise. */
  copies: Map<number, Seen[]>;
  duplicates: Seen[];
}

/** Une session par identité ; les autres copies sont gardées à part : elles ne voyagent pas, mais partent avec elle. */
const oneByIdentity = (seen: readonly Seen[]): SideSessions => {
  const copies = new Map<number, Seen[]>();
  for (const s of seen) {
    if (s.startMs !== null) copies.set(s.startMs, [...(copies.get(s.startMs) ?? []), s]);
  }
  const kept = new Map<number, Seen>();
  const duplicates: Seen[] = [];
  for (const [startMs, group] of copies) {
    const chosen = chosenCopy(group);
    kept.set(startMs, chosen);
    duplicates.push(...group.filter((s) => s !== chosen));
  }
  return { kept, copies, duplicates };
};

/**
 * Le côté d'où part la session que cette entrée supprime, telle que le garde-fou la compte : `computer`, supprimée
 * sur le téléphone, sa copie de l'ordinateur va à la corbeille ; `phone`, supprimée sur l'ordinateur, elle est retirée
 * du téléphone. `null` : l'entrée ne supprime aucune session. Les restes (fiche ou capteurs sans GPX) d'une session
 * absente des deux côtés n'en sont pas une : ils ne se comptent ni ne se montrent.
 */
export const syncDeletionSide = (item: SyncItem): SyncSideName | null =>
  item.case === 'deletedOnPhone' && item.ops.some((op) => op.kind === 'trash') ? 'computer'
    : item.case === 'deletedOnComputer' && item.ops.some((op) => op.kind === 'removeFromPhone') ? 'phone'
      : null;

/**
 * Garde-fou d'après les suppressions comptées de chaque côté : déclenché au-delà de `maxRemovals` en tout, ou de la
 * part `maxShare` des sessions d'un côté. Commun aux sessions et aux itinéraires (`syncRoutes.ts`).
 */
export const syncGuardOf = (toTrash: number, fromPhone: number, count: Record<SyncSideName, number>, limits: SyncGuardLimits): SyncGuard => {
  const tripped = toTrash + fromPhone > limits.maxRemovals
    || toTrash > limits.maxShare * count.computer
    || fromPhone > limits.maxShare * count.phone;
  return { tripped, limits, toTrash, fromPhone, count };
};

const guardOf = (items: readonly SyncItem[], count: Record<SyncSideName, number>, limits: SyncGuardLimits): SyncGuard =>
  syncGuardOf(items.filter((i) => syncDeletionSide(i) === 'computer').length, items.filter((i) => syncDeletionSide(i) === 'phone').length, count, limits);

/** Le plan entier, sans restriction : à passer par `restrictSyncPlan` quand tout n'est pas permis. */
export const planSync = (input: SyncInput): SyncPlan => {
  const { pair, ancestors, trash } = input;
  const { base } = pair;
  const seen = { computer: input.computer.sessions.map((s) => interpret(s, 'computer', input)), phone: input.phone.sessions.map((s) => interpret(s, 'phone', input)) };
  const computer = oneByIdentity(seen.computer);
  const phone = oneByIdentity(seen.phone);
  const taken: Record<SyncSideName, string[]> = { computer: [...input.computer.names], phone: [...input.phone.names] };
  const present: Record<SyncSideName, ReadonlySet<string>> = {
    computer: new Set(input.computer.names.map((name) => name.toLowerCase())),
    phone: new Set(input.phone.names.map((name) => name.toLowerCase())),
  };
  const refused = new Set(input.keep ?? []);
  const ancestorsOf = (startMs: number): SyncAncestors => ancestors.get(startMs) ?? { computer: null, phone: null };
  const trashedFiles = (startMs: number) => trash.filter((entry) => entry.startMs === startMs).flatMap((entry) => entry.files);
  const moveTo = (startMs: number): string => String(startMs);

  const itemOf = (startMs: number, kind: SyncCase, o: Seen | null, t: Seen | null): SyncItem => ({
    startMs, case: kind, files: { computer: o?.files.gpx.name ?? null, phone: t?.files.gpx.name ?? null },
    ops: [], base: { kind: 'keep' }, left: null, conflicts: [], twoTracks: false, withoutAncestor: false,
    restored: ((kind === 'newOnComputer' || kind === 'newOnPhone') && base?.removed.includes(startMs) === true)
      || (kind === 'firstMeeting' && base?.held.includes(startMs) === true),
  });

  /** Restes d'une session d'un côté (fiche ou capteurs sans GPX) que la base nomme, à faire partir avec elle. */
  const leftovers = (side: SyncSideName, line: SyncBaseSession | null): SyncStamp[] => {
    const named = new Set([line?.[side].record?.name, line?.[side].imu?.name]);
    return input[side].orphans.filter((f) => named.has(f.name));
  };

  /**
   * Nom d'arrivée d'une copie, et sa fiche si elle doit nommer un autre GPX ; `null` quand le nom est pris et que
   * la fiche ne se réécrit pas. Une copie coupée avant son GPX a laissé à l'arrivée la fiche ou les capteurs seuls,
   * sous le nom visé et à la taille écrite : la copie reprise les remplace, au lieu de prendre un nom de plus à côté.
   */
  const targetOf = (s: Seen, to: SyncSideName, text: string): { gpx: string; recordText: string | null } | null => {
    const source = s.files.gpx.name;
    const stem = source.replace(/\.gpx$/i, '').toLowerCase();
    const renamed = (gpx: string): string | null => (gpx === source ? null : s.state === 'ok' ? renamedSyncRecord(text, gpx) : null);
    const ownLeftover = (f: SyncStamp): boolean => {
      const dot = f.name.lastIndexOf('.');
      const at = f.name.slice(0, dot).toLowerCase();
      if (at !== stem && !(at.startsWith(`${stem}-`) && /^\d+$/.test(at.slice(stem.length + 1)))) return false;
      if (/\.imu$/i.test(f.name)) return s.files.imu?.size === f.size;
      const gpx = at === stem ? source : `${f.name.slice(0, dot)}.gpx`;
      const record = renamed(gpx);
      return gpx === source ? s.files.record?.size === f.size : record !== null && byteLength(record) === f.size;
    };
    const replaced = new Set(input[to].orphans.filter(ownLeftover).map((f) => f.name));
    const gpx = uniqueSessionFileName(source, taken[to].filter((name) => !replaced.has(name)));
    const recordText = renamed(gpx);
    return gpx !== source && recordText === null ? null : { gpx, recordText };
  };

  /**
   * Ce que la corbeille de l'ordinateur doit recevoir d'une copie du téléphone avant qu'elle n'en soit retirée. Rien
   * seulement si elle tient déjà un GPX et des capteurs de la même taille, et si la fiche du téléphone n'a rien que
   * celle de l'ordinateur n'ait reçu ; dans le doute, tout.
   */
  const keepOf = (startMs: number, copy: Seen, line: SyncBaseSession | null): 'none' | 'record' | 'all' => {
    const kept = trashedFiles(startMs);
    const held = (file: SyncStamp | null, kind: RegExp): boolean => file === null || kept.some((f) => kind.test(f.name) && f.size === file.size);
    if (!held(copy.files.gpx, /\.gpx$/i) || !held(copy.files.imu, /\.imu$/i)) return 'all';
    if (!copy.files.record || copy.state === 'none') return 'none';
    const followed = line !== null && line.phone.gpx.name === copy.files.gpx.name && line.phone.gpx.size === copy.files.gpx.size;
    if (!followed || copy.state !== 'ok' || copy.text === null) return 'all';
    if (!copy.read || !syncRecordChanged(ancestorsOf(startMs).phone, copy.text)) return 'none';
    return kept.some((f) => /\.json$/i.test(f.name)) ? 'record' : 'all';
  };

  /** Restes du téléphone à retirer : rien à garder si la fiche est celle de la base et les capteurs déjà à la corbeille. */
  const phoneLeftoversOp = (startMs: number, line: SyncBaseSession | null): SyncOp[] => {
    const files = leftovers('phone', line);
    if (files.length === 0) return [];
    const kept = trashedFiles(startMs);
    const safe = files.every((f) => (/\.imu$/i.test(f.name) ? kept.some((k) => /\.imu$/i.test(k.name) && k.size === f.size) : sameFile(line?.phone.record ?? null, f)));
    return [{ kind: 'removeFromPhone', files, absent: null, keep: safe ? 'none' : 'all', recordText: null, moveTo: moveTo(startMs) }];
  };

  /** Restes de l'ordinateur : à sa corbeille, comme tout ce qui en disparaît. */
  const computerLeftoversOp = (line: SyncBaseSession | null): SyncOp[] => {
    const files = leftovers('computer', line);
    return files.length > 0 ? [{ kind: 'trash', files, absent: null }] : [];
  };

  /**
   * Session d'un seul côté, inconnue de la base, suivie mais que l'utilisateur a dit garder (`keep`), ou supprimée de
   * l'autre côté après avoir été modifiée de celui-ci (`revive`) : recopiée de l'autre côté, et sa ligne posée.
   */
  const fresh = (startMs: number, from: SyncSideName, s: Seen, revive = false): SyncItem => {
    const to = otherSyncSide(from);
    const item = from === 'computer' ? itemOf(startMs, 'newOnComputer', s, null) : itemOf(startMs, 'newOnPhone', null, s);
    // Supprimée sur l'ordinateur sans que la synchronisation l'ait su, et encore sur le téléphone. Elle ne revient
    // d'elle-même que si la synchronisation avait mené sa suppression au bout et qu'elle a été remise depuis. La
    // base s'en souvient : la purge de la corbeille ne la ramène pas. Gardée par l'utilisateur, elle revient. À une
    // première rencontre, rien ne se retire, quel que soit le choix : elle est laissée.
    const heldBack = from === 'phone' && !refused.has(startMs) && !revive
      && (base?.held.includes(startMs) || (trashedFiles(startMs).length > 0 && !base?.removed.includes(startMs)));
    if (heldBack) {
      const remove = pair.first === null && (input.heldOnPhone ?? SYNC_HELD_ON_PHONE) === 'remove';
      return remove ? deletedOnComputer(startMs, null) : { ...item, left: 'inTrash', base: { kind: 'hold' } };
    }
    const stuck = LEFT_BY_STATE[s.state] ?? (s.files.gpxComplete === false ? 'unfinishedGpx' : null);
    if (stuck || s.text === null) return { ...item, left: stuck ?? 'noRecord' };
    // Nom déjà pris de l'autre côté : la fiche doit nommer son nouveau GPX, ce qu'une fiche d'une version plus récente ne permet pas.
    const arrival = targetOf(s, to, s.text);
    if (!arrival) return { ...item, left: 'futureRecord' };
    const { gpx, recordText } = arrival;
    const target: SyncTargetNames = { gpx, record: recordFileName(gpx), imu: s.files.imu ? imuFileName(gpx) : null };
    taken[to].push(gpx, recordFileName(gpx), imuFileName(gpx));
    const sides = { [from]: namesOf(s.files), [to]: target } as Record<SyncSideName, SyncTargetNames>;
    const texts = { [from]: s.text, [to]: recordText ?? s.text } as Record<SyncSideName, string>;
    return {
      ...item,
      files: { ...item.files, [to]: gpx },
      ops: [{ kind: 'copy', to, source: s.files, target, recordText }],
      base: { kind: 'set', computer: sides.computer, phone: sides.phone, ancestors: texts },
    };
  };

  /** Session des deux côtés : fiches fondues, capteurs complétés ; `line` nulle à une première rencontre. */
  const both = (startMs: number, o: Seen, t: Seen, line: SyncBaseSession | null): SyncItem | null => {
    const item = itemOf(startMs, line ? 'followed' : 'firstMeeting', o, t);
    const stuck = LEFT_BY_STATE[o.state] ?? LEFT_BY_STATE[t.state];
    if (stuck || o.text === null || t.text === null) return { ...item, left: stuck ?? 'noRecord' };
    const twoTracks = o.files.gpx.size !== t.files.gpx.size;
    const kept = line ? ancestorsOf(startMs) : { computer: null, phone: null };
    const sides = { computer: o, phone: t };
    const written: SyncAncestors = { computer: null, phone: null };
    const ops: SyncOp[] = [];
    let conflicts: string[] = [];
    let conflictWinners: Record<string, SyncSideName> | null = null;
    let withoutAncestor = false;
    if (o.state === 'future' || t.state === 'future') {
      // Jamais fondue ni réécrite. Suivie, et elle seule a changé : recopiée à l'octet, si le GPX porte le même nom.
      const from: SyncSideName = t.state === 'future' ? 'phone' : 'computer';
      const to = otherSyncSide(from);
      const source = sides[from];
      const target = sides[to];
      const changed = line !== null && syncRecordChanged(kept[from], source.text as string);
      const otherChanged = line !== null && syncRecordChanged(kept[to], target.text as string);
      if (changed || otherChanged) {
        const copyable = changed && !otherChanged && !twoTracks && source.files.gpx.name === target.files.gpx.name;
        if (!copyable || !source.files.record || !target.files.record) return { ...item, left: 'futureRecord' };
        ops.push({ kind: 'copyRecord', to, source: source.files.record, file: target.files.record });
        written[to] = source.text;
      }
    } else {
      const merged = mergeSyncRecords(
        { computer: o.text, phone: t.text, computerAncestor: kept.computer, phoneAncestor: kept.phone }, { editsOnly: twoTracks },
      );
      if (!merged) return { ...item, left: 'unreadableRecord' };
      conflicts = merged.conflicts;
      if (conflicts.length > 0) conflictWinners = merged.winners;
      withoutAncestor = line !== null && merged.union;
      for (const side of SYNC_SIDES) {
        const text = merged[side];
        const file = sides[side].files.record;
        if (text === null || !file) continue;
        ops.push({ kind: 'writeRecord', on: side, file, text });
        written[side] = text;
      }
    }
    const names = { computer: namesOf(o.files), phone: namesOf(t.files) };
    if (!twoTracks) {
      for (const to of SYNC_SIDES) {
        const source = sides[otherSyncSide(to)].files.imu;
        if (!source || sides[to].files.imu) continue;
        const target = imuFileName(sides[to].files.gpx.name);
        ops.push({ kind: 'copyImu', to, source, target });
        names[to] = { ...names[to], imu: target };
      }
    }
    // Rien à écrire, les fichiers sont ceux de la base et ses deux fiches gardées valent : la session n'a pas bougé.
    if (ops.length === 0 && !withoutAncestor && line && sameFiles(line.computer, o.files) && sameFiles(line.phone, t.files)) return null;
    // Une fiche gardée qui manquait ou ne valait plus est reposée, pour que la fois suivante soit une fusion à trois.
    const ancestorsNow: SyncAncestors = {
      computer: written.computer ?? (o.read || !line || withoutAncestor ? o.text : null),
      phone: written.phone ?? (t.read || !line || withoutAncestor ? t.text : null),
    };
    return {
      ...item, ops, conflicts, ...(conflictWinners ? { conflictWinners } : {}), twoTracks, withoutAncestor,
      base: { kind: 'set', ...names, ancestors: ancestorsNow },
    };
  };

  /** Supprimée sur le téléphone : toutes les copies de l'ordinateur vont à sa corbeille. */
  const deletedOnPhone = (startMs: number, line: SyncBaseSession): SyncItem => ({
    ...itemOf(startMs, 'deletedOnPhone', computer.kept.get(startMs) ?? null, null),
    ops: [
      ...(computer.copies.get(startMs) ?? []).map((copy): SyncOp => ({ kind: 'trash', files: stampsOf(copy.files), absent: line.phone.gpx.name })),
      ...phoneLeftoversOp(startMs, line),
    ],
    base: { kind: 'forget' },
  });

  /**
   * Supprimée sur l'ordinateur : toutes les copies du téléphone en sont retirées, chacune d'abord gardée à la
   * corbeille de l'ordinateur si elle n'y est pas déjà à l'identique. `line` nulle : la session n'a jamais été
   * suivie, rien ne dit que l'ordinateur en a reçu quoi que ce soit.
   */
  function deletedOnComputer(startMs: number, line: SyncBaseSession | null): SyncItem {
    const removals = (phone.copies.get(startMs) ?? []).map((copy): SyncOp => {
      const keep = keepOf(startMs, copy, line);
      return {
        kind: 'removeFromPhone', files: stampsOf(copy.files), absent: line?.computer.gpx.name ?? null, keep, recordText: keep === 'record' ? copy.text : null,
        moveTo: moveTo(startMs),
      };
    });
    return {
      ...itemOf(startMs, 'deletedOnComputer', null, phone.kept.get(startMs) ?? null),
      ops: [...computerLeftoversOp(line), ...removals, ...phoneLeftoversOp(startMs, line)],
      base: { kind: 'forget' },
    };
  }

  /**
   * Vrai si la fiche de ce côté a changé depuis la dernière synchronisation, hors résumé : relue (son tampon n'est
   * plus celui de la base) et différente de la fiche gardée, ou sans fiche gardée pour comparer (dans le doute, on
   * garde). Une fiche que seul le résumé refait a changée ne compte pas.
   */
  const changedHere = (startMs: number, side: SyncSideName, s: Seen): boolean =>
    s.read && s.text !== null && s.state === 'ok' && syncRecordChanged(ancestorsOf(startMs)[side], s.text);

  /**
   * Supprimée de l'autre côté, modifiée de celui-ci depuis : la modification l'emporte, comme pour un itinéraire. La
   * session n'est pas retirée ; elle revient là où elle manquait.
   */
  const revived = (startMs: number, here: SyncSideName, s: Seen): SyncItem => ({
    ...fresh(startMs, here, s, true), case: here === 'computer' ? 'deletedOnPhone' : 'deletedOnComputer', revived: true,
  });

  const deletedOnBoth = (startMs: number, line: SyncBaseSession | null): SyncItem =>
    ({ ...itemOf(startMs, 'deletedOnBoth', null, null), ops: [...computerLeftoversOp(line), ...phoneLeftoversOp(startMs, line)], base: { kind: 'forget' } });

  const identities = new Set([...computer.kept.keys(), ...phone.kept.keys(), ...(base?.sessions.map((s) => s.startMs) ?? []), ...(base?.held ?? [])]);
  const items: SyncItem[] = [];
  for (const startMs of [...identities].sort((a, b) => a - b)) {
    const o = computer.kept.get(startMs) ?? null;
    const t = phone.kept.get(startMs) ?? null;
    const line = syncBaseLine(base, startMs);
    // Jamais « supprimée de ce côté » tant qu'un fichier y porte encore le nom que la base donnait à son GPX : il a
    // changé de taille et sa fiche manque ou ne se lit plus, ou le listage en dit trop peu pour conclure.
    const hidden = line !== null && ((!o && present.computer.has(line.computer.gpx.name.toLowerCase())) || (!t && present.phone.has(line.phone.gpx.name.toLowerCase())));
    const item = hidden ? { ...itemOf(startMs, 'followed', o, t), left: 'changedGpx' as const }
      : o && t ? both(startMs, o, t, line)
        : !line ? (o ? fresh(startMs, 'computer', o) : t ? fresh(startMs, 'phone', t) : deletedOnBoth(startMs, null))
          // Suppression refusée : la session retourne là où elle manque, au lieu de partir de là où elle est encore.
          : o ? (refused.has(startMs) ? fresh(startMs, 'computer', o) : changedHere(startMs, 'computer', o) ? revived(startMs, 'computer', o) : deletedOnPhone(startMs, line))
            : t ? (refused.has(startMs) ? fresh(startMs, 'phone', t) : changedHere(startMs, 'phone', t) ? revived(startMs, 'phone', t) : deletedOnComputer(startMs, line))
              : deletedOnBoth(startMs, line);
    if (item) items.push(item);
  }

  const aside = (side: SyncSideName, list: readonly Seen[]) => list.map((s) => ({ side, file: s.files.gpx.name, startMs: s.startMs as number }));
  const unknown = SYNC_SIDES.flatMap((side) => seen[side]
    .filter((s) => s.startMs === null && s.state !== 'empty')
    .map((s) => ({ side, file: s.files.gpx.name, reason: LEFT_BY_STATE[s.state] ?? 'unreadableRecord' })));
  return {
    pair,
    saveBase: true,
    items,
    duplicates: [...aside('computer', computer.duplicates), ...aside('phone', phone.duplicates)],
    unknown,
    guard: guardOf(items, { computer: computer.kept.size, phone: phone.kept.size }, input.guardLimits ?? SYNC_GUARD_LIMITS),
  };
};

/** Ce qu'une synchronisation a le droit de faire : écrire de chaque côté, et supprimer. */
export interface SyncScope {
  computer: boolean;
  phone: boolean;
  /** Faux : ni mise à la corbeille de l'ordinateur, ni retrait du téléphone. */
  deletions: boolean;
}

const opAllowed = (op: SyncOp, scope: SyncScope): boolean => {
  switch (op.kind) {
    case 'copy':
    case 'copyRecord':
    case 'copyImu':
      return scope[op.to];
    case 'writeRecord':
      return scope[op.on];
    case 'trash':
      return scope.deletions && scope.computer;
    case 'removeFromPhone':
      return scope.deletions && scope.phone && (op.keep === 'none' || scope.computer);
  }
};

/**
 * Le plan réduit à ce que `scope` permet : « sans rien supprimer » (`deletions` faux), ou la seule moitié de
 * l'ordinateur (`phone` faux : un téléphone qu'on peut lire sans pouvoir y écrire). Les opérations permises restent.
 * Une session dont une opération est retirée garde sa ligne de base telle quelle (`keep`) : ce qui n'a pas été fait
 * sera retrouvé par le plan suivant, et ce qui a été fait ne se refait pas. Une suppression retenue reste donc à
 * faire, et sera proposée de nouveau. Un téléphone qu'on ne peut pas écrire ne reçoit ni identifiant ni passage : la
 * base ne s'écrit pas du tout, sans quoi une ligne posée sans passage neuf échapperait à la reconnaissance d'une copie.
 */
export const restrictSyncPlan = (plan: SyncPlan, scope: SyncScope): SyncPlan => {
  const saveBase = plan.saveBase && scope.computer && scope.phone;
  const items = plan.items.map((item): SyncItem => {
    const ops = item.ops.filter((op) => opAllowed(op, scope));
    const cut = ops.length < item.ops.length;
    return { ...item, ops, base: cut || !saveBase ? { kind: 'keep' } : item.base, left: item.left ?? (cut ? 'outOfScope' : null) };
  });
  return { ...plan, saveBase, items, guard: guardOf(items, plan.guard.count, plan.guard.limits) };
};
