import { isFiniteNumber, isObject, parseJson, stringifyJson } from '../core/basics';
import {
  JOURNALS_DIR, MARKER_FILE, MEMORY_FORMAT, MEMORY_VERSION, RESTING_HR_FILE, ROUTES_DIR, SESSIONS_DIR, SETTINGS_DIR, readMarkerVersion,
} from './folderLayout';
import { trashFilePath } from './trash';

/**
 * Base de la synchronisation entre l'ordinateur et un téléphone : l'état des deux dossiers à la fin de la dernière
 * synchronisation, gardé par l'ordinateur seul, dans son dossier mémoire. Le téléphone ne garde rien.
 *
 *     synchro/
 *       <id du téléphone>.json                          la base : une ligne par session présente des deux côtés
 *       <id du téléphone>/fiches/<startMs>-ordinateur.json   la fiche de l'ordinateur à cette synchronisation
 *       <id du téléphone>/fiches/<startMs>-telephone.json    celle du téléphone
 *
 * Une ligne n'existe que pour une session rapprochée des deux côtés : c'est ce qui permet de lire une absence comme
 * une suppression. Une session qui n'a pas de ligne n'est jamais supprimée, seulement recopiée ou fondue. Les deux
 * fiches gardées sont les ancêtres de la fusion à trois (`syncRecordMerge.ts`) : une par côté, parce que la fiche
 * d'un appareil porte ce qui lui est propre (son résumé, le nom de son GPX, sa date d'entrée).
 *
 * Les itinéraires ont leurs lignes à part (`routes`, `removedRoutes`, `heldRoutes`), sans fiche gardée : une ligne
 * n'est posée que lorsque les deux côtés tiennent la même fiche, et un itinéraire se recopie entier (`syncRoutes.ts`).
 * Une version qui ne connaît pas ces champs les ignore ; si elle réécrit la base, la synchronisation suivante est une
 * première rencontre pour les itinéraires, d'où rien ne se supprime. Les champs inconnus de cette version sont gardés
 * à la réécriture (`unknownFields`).
 *
 * Les dossiers se reconnaissent à un identifiant tiré au hasard, écrit par la synchronisation dans leur marqueur
 * (`tracker.json`, champ `id`) : l'application ne lit du marqueur de sa mémoire que son format et sa version, et ne
 * l'écrit que s'il manque (`hooks/sessionLibrary/lifecycle.ts`). Un dossier recréé revient donc sans identifiant, et
 * rien ne se déduit de lui.
 *
 * Une copie du dossier du téléphone garde son identifiant : remise plus tard, ou recopiée sur un second téléphone,
 * elle passerait pour le même téléphone, et ce qu'elle n'a pas encore vu pour des suppressions. Chaque synchronisation
 * qui écrit le téléphone pose donc, avant toute autre chose, un compteur de passages dans son marqueur (`passage`), et
 * la base le retient (`phonePass`) : un marqueur qui porte moins, ou rien, est une copie plus ancienne, et la paire
 * repart comme une première rencontre. Un compteur plutôt qu'un instant : rien ne dépend des horloges.
 *
 * Un marqueur peut aussi porter l'identifiant d'appareil de la mémoire (`appareil`, celui de son fichier de réglages) :
 * l'ordinateur y reconnaît le fichier de réglages propre au téléphone relié (`planSyncExtras`). Aucune version de
 * l'application ne l'écrit encore : il est lu nul, et la règle des réglages le prévoit.
 *
 * Ce module ne lit ni n'écrit aucun fichier.
 */

export const SYNC_DIR = 'synchro';
export const SYNC_BASE_FORMAT = 'tracker-synchro';
export const SYNC_BASE_VERSION = 1;

/** Les deux côtés d'une synchronisation. */
export type SyncSideName = 'computer' | 'phone';
export const SYNC_SIDES: readonly SyncSideName[] = ['computer', 'phone'];
export const otherSyncSide = (side: SyncSideName): SyncSideName => (side === 'computer' ? 'phone' : 'computer');

/** Un fichier de `sessions/` vu d'un côté : son nom, sa taille et sa date, comme le listage les donne. */
export interface SyncStamp {
  name: string;
  size: number;
  /** Peut valoir 0 (fournisseur du téléphone qui ne la donne pas) : le fichier est alors toujours relu. */
  mtimeMs: number;
}

/** Les fichiers d'une session d'un côté. */
export interface SyncFiles {
  gpx: SyncStamp;
  record: SyncStamp | null;
  imu: SyncStamp | null;
}

/** Une session présente des deux côtés à la fin de sa dernière synchronisation. */
export interface SyncBaseSession {
  /** Instant du premier point : l'identité de la session, la même que dans la mémoire. */
  startMs: number;
  computer: SyncFiles;
  phone: SyncFiles;
}

/** Les fichiers d'un itinéraire d'un côté, et la date de rangement que porte sa fiche (`RouteRecord.updatedAt`). */
export interface SyncRouteFiles {
  json: SyncStamp;
  /** Le GPX exporté à côté de la fiche ; `null` s'il manque. */
  gpx: SyncStamp | null;
  updatedAt: string;
}

/** Un itinéraire présent des deux côtés, avec la même fiche, à la fin de sa dernière synchronisation. */
export interface SyncBaseRoute {
  /** Identité de l'itinéraire (`syncRouteId`) : sa date de création, sinon la base de ses noms. */
  id: string;
  computer: SyncRouteFiles;
  phone: SyncRouteFiles;
}

export interface SyncBase {
  /** Identifiant du dossier de l'ordinateur à qui cette base appartient : un autre dossier en fait une paire neuve. */
  computerId: string;
  phoneId: string;
  /** Où est le dossier sur le téléphone ; un autre chemin (une vieille copie) en fait une paire neuve. */
  phonePath: string | null;
  /** Fin de la dernière synchronisation menée au bout, horloge de l'ordinateur ; `null` : aucune encore. */
  syncedAtMs: number | null;
  /**
   * Dernier passage écrit dans le marqueur du téléphone (`markerTextWithPass`) ; un marqueur qui porte moins est une
   * copie plus ancienne. `null` : base d'une version qui ne le posait pas, le contrôle ne joue pas pour elle.
   */
  phonePass: number | null;
  sessions: SyncBaseSession[];
  /**
   * Sessions dont la synchronisation a mené la suppression au bout, encore dans la corbeille de l'ordinateur. Une
   * telle session revue sur le téléphone y a été remise exprès : elle revient. Sans cette trace, une session de la
   * corbeille encore sur le téléphone est laissée où elle est, ni ramenée ni supprimée.
   */
  removed: number[];
  /**
   * Sessions du téléphone laissées où elles sont parce que l'ordinateur les avait supprimées sans que la
   * synchronisation y soit pour rien (elles étaient dans sa corbeille, sans ligne ici). Retenues pour qu'elles ne
   * reviennent pas d'elles-mêmes sur l'ordinateur le jour où sa corbeille les purge : tant qu'elles sont ici, elles
   * restent laissées, et dites.
   */
  held: number[];
  /** Itinéraires présents des deux côtés, par identité. */
  routes: SyncBaseRoute[];
  /** Comme `removed`, pour les itinéraires dont la synchronisation a mené la suppression au bout. */
  removedRoutes: string[];
  /** Comme `held`, pour les itinéraires du téléphone laissés où ils sont. */
  heldRoutes: string[];
  /** Champs que cette version ne connaît pas, lus dans la base et réécrits tels quels. */
  unknownFields?: Record<string, unknown>;
}

/**
 * Base lue : `absent` (jamais synchronisé avec ce téléphone), `ok`, `unreadable` (illisible : la paire repart comme
 * une première rencontre, sans aucune suppression) ou `newer` (écrite par une version plus récente : ne pas
 * synchroniser, elle serait réécrite sans ce que cette version n'y comprend pas).
 */
export type SyncBaseRead =
  | { state: 'absent' | 'unreadable' | 'newer' }
  | { state: 'ok'; base: SyncBase };

/**
 * Identifiant de dossier acceptable : il sert de nom de fichier sur l'ordinateur. Tout autre texte trouvé dans un
 * marqueur est tenu pour absent, et remplacé.
 */
export const isSyncId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value);

export const syncBasePath = (phoneId: string): string => `${SYNC_DIR}/${phoneId}.json`;

const ANCESTOR_SUFFIX: Readonly<Record<SyncSideName, string>> = { computer: 'ordinateur', phone: 'telephone' };

/** Où est gardée la fiche d'un côté à la dernière synchronisation de la session. */
export const syncAncestorPath = (phoneId: string, startMs: number, side: SyncSideName): string =>
  `${SYNC_DIR}/${phoneId}/fiches/${startMs}-${ANCESTOR_SUFFIX[side]}.json`;

/** Ce qu'est un fichier du dossier mémoire pour la synchronisation, d'après son chemin depuis la racine. */
export type SyncFileRole =
  /** `sessions/` : GPX, fiche ou capteurs (`syncPlan.ts`). */
  | 'session'
  /** `itineraires/` : fiche ou GPX exporté (`syncRoutes.ts`). */
  | 'route'
  /** `reglages/*.json` : recopiés, jamais adoptés (`syncExtras.ts`). */
  | 'settings'
  /** `fc-repos.json` : fondu (`syncExtras.ts`). */
  | 'restingHr'
  /** `journaux/` : copiés du téléphone vers l'ordinateur seulement (`syncExtras.ts`). */
  | 'journal'
  /** `tracker.json` : seul son identifiant compte, il ne voyage pas. */
  | 'marker'
  /** Tout le reste : `LISEZMOI.txt`, la corbeille, `synchro/`, l'ancien `reglages.json`, les temporaires, l'inconnu. */
  | 'ignored';

/**
 * Suffixes d'une écriture en cours : `.tracker-tmp` et `.tracker-new` du téléphone (`MemoryFolderPlugin.java`), et le
 * `.tmp` d'une écriture privée. Jamais lus ni recopiés tels quels : celui qui liste le téléphone les interprète.
 */
const TEMP_SUFFIXES = ['.tracker-tmp', '.tracker-new', '.tmp'];

const isTempName = (name: string): boolean => TEMP_SUFFIXES.some((suffix) => name.length > suffix.length && name.toLowerCase().endsWith(suffix));

/** Rôle d'un fichier pour la synchronisation (`path` depuis la racine du dossier mémoire, séparé par `/`). */
export const syncFileRole = (path: string): SyncFileRole => {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  if (name === '' || isTempName(name)) return 'ignored';
  if (parts.length === 1) return name === MARKER_FILE ? 'marker' : name === RESTING_HR_FILE ? 'restingHr' : 'ignored';
  if (parts.length !== 2) return 'ignored';
  switch (parts[0]) {
    case SESSIONS_DIR:
      return /\.(gpx|json|imu)$/i.test(name) ? 'session' : 'ignored';
    case ROUTES_DIR:
      return /\.(gpx|json)$/i.test(name) ? 'route' : 'ignored';
    case SETTINGS_DIR:
      return /\.json$/i.test(name) ? 'settings' : 'ignored';
    case JOURNALS_DIR:
      return 'journal';
    default:
      return 'ignored';
  }
};

/**
 * Où va ce qu'on retire du téléphone : jamais effacé, il est déplacé dans la corbeille de sa mémoire, dans un dépôt
 * neuf (`corbeille/<dir>/`, `dir` choisi par `trashDirName` parmi les sous-dossiers déjà là), sous son nom d'origine,
 * après que `depose.json` y a été écrit (`trash.ts`, `TrashDeposit`). Le téléphone adopte ensuite le dépôt dans sa
 * propre corbeille. Destinations des fichiers `paths` (depuis la racine de la mémoire, `sessions/…` ou
 * `itineraires/…`), dans l'ordre donné.
 */
export const phoneDepositPaths = (dir: string, paths: readonly string[]): Map<string, string> =>
  new Map(paths.map((p) => [p, trashFilePath(dir, p.slice(p.lastIndexOf('/') + 1))]));

const readMarker = (text: string | null): Record<string, unknown> | null => {
  const marker = text === null ? undefined : parseJson(text);
  return isObject(marker) && marker.format === MEMORY_FORMAT ? marker : null;
};

/** Identifiant écrit dans un marqueur ; `null` sans marqueur, sans identifiant, ou si ce n'en est pas un. */
export const readMarkerId = (text: string | null): string | null => {
  const id = readMarker(text)?.id;
  return isSyncId(id) ? id : null;
};

/**
 * Texte du marqueur avec cet identifiant, tout le reste gardé tel quel (champs que cette version ne connaît pas
 * compris). `null` si le texte n'est pas un marqueur : on n'en fabrique pas un à la place de l'application.
 */
export const markerTextWithId = (text: string | null, id: string): string | null => {
  const marker = readMarker(text);
  return marker ? `${stringifyJson({ ...marker, id })}\n` : null;
};

/**
 * Instant de la dernière synchronisation qui a changé ce dossier, écrit par l'ordinateur dans le marqueur du téléphone
 * (champ `synchro`, horloge de l'ordinateur) ; `null` sans marqueur ou sans cet instant. Le téléphone ne compare que
 * deux lectures entre elles : un instant qui change dit que ses sessions ont changé sous lui (`syncWatch.ts`).
 */
export const readMarkerSync = (text: string | null): number | null => {
  const synchro = readMarker(text)?.synchro;
  return isFiniteNumber(synchro) ? synchro : null;
};

/**
 * Texte du marqueur avec l'instant d'une synchronisation, tout le reste gardé tel quel, toujours différent de celui
 * qu'il portait (deux synchronisations de la même milliseconde se distinguent encore). `null` si le texte n'est pas
 * un marqueur, ou s'il est d'une version plus récente : un tel marqueur n'est jamais réécrit.
 */
export const markerTextWithSync = (text: string | null, atMs: number): string | null => {
  const marker = readMarker(text);
  if (!marker || readMarkerVersion(text) > MEMORY_VERSION) return null;
  const synchro = atMs === readMarkerSync(text) ? atMs + 1 : atMs;
  return `${stringifyJson({ ...marker, synchro })}\n`;
};

/**
 * Passage écrit par l'ordinateur dans le marqueur du téléphone (champ `passage`, entier croissant) ; `null` sans
 * marqueur ou sans passage. Distinct de `synchro`, que le téléphone surveille pour savoir que ses sessions ont changé.
 */
export const readMarkerPass = (text: string | null): number | null => {
  const passage = readMarker(text)?.passage;
  return Number.isSafeInteger(passage) && (passage as number) >= 0 ? (passage as number) : null;
};

/**
 * Texte du marqueur avec ce passage, tout le reste gardé tel quel. `null` si le texte n'est pas un marqueur, ou s'il
 * est d'une version plus récente : un tel marqueur n'est jamais réécrit.
 */
export const markerTextWithPass = (text: string | null, pass: number): string | null => {
  const marker = readMarker(text);
  if (!marker || readMarkerVersion(text) > MEMORY_VERSION) return null;
  return `${stringifyJson({ ...marker, passage: pass })}\n`;
};

/** Identifiant d'appareil acceptable dans un marqueur : un texte court, sans plus de contrôle. */
const isDeviceId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 128;

/**
 * Identifiant de l'appareil qui a ouvert ce dossier comme sa mémoire (champ `appareil`, celui de son fichier de
 * réglages) ; `null` sans marqueur ou sans identifiant (version qui ne l'écrivait pas). L'ordinateur le lit dans le
 * marqueur du téléphone pour reconnaître le fichier de réglages propre au téléphone relié.
 */
export const readMarkerDevice = (text: string | null): string | null => {
  const device = readMarker(text)?.appareil;
  return isDeviceId(device) ? device : null;
};

/**
 * Texte du marqueur avec cet identifiant d'appareil, tout le reste gardé tel quel. `null` si le texte n'est pas un
 * marqueur, s'il porte déjà cet identifiant (rien à réécrire), ou s'il est d'une version plus récente.
 */
export const markerTextWithDevice = (text: string | null, device: string): string | null => {
  const marker = readMarker(text);
  if (!marker || !isDeviceId(device) || marker.appareil === device || readMarkerVersion(text) > MEMORY_VERSION) return null;
  return `${stringifyJson({ ...marker, appareil: device })}\n`;
};

/** Pourquoi deux dossiers ne se synchronisent pas, avant tout listage. */
export type SyncRefusal = 'computerNoMarker' | 'phoneNoMarker' | 'computerNewer' | 'phoneNewer';

/**
 * Refus d'après les marqueurs des deux dossiers (leur texte, `null` s'il manque) : un dossier sans marqueur n'est pas
 * un dossier mémoire (dossier vide ou mal désigné), et un dossier d'une version plus récente n'est pas réécrit.
 */
export const syncRefusal = (computerMarker: string | null, phoneMarker: string | null): SyncRefusal | null => {
  if (!readMarker(computerMarker)) return 'computerNoMarker';
  if (!readMarker(phoneMarker)) return 'phoneNoMarker';
  if (readMarkerVersion(computerMarker) > MEMORY_VERSION) return 'computerNewer';
  if (readMarkerVersion(phoneMarker) > MEMORY_VERSION) return 'phoneNewer';
  return null;
};

export const emptySyncBase = (computerId: string, phoneId: string, phonePath: string | null): SyncBase =>
  ({ computerId, phoneId, phonePath, syncedAtMs: null, phonePass: null, sessions: [], removed: [], held: [], routes: [], removedRoutes: [], heldRoutes: [] });

const parseStamp = (v: unknown): SyncStamp | null =>
  isObject(v) && typeof v.name === 'string' && v.name !== '' && isFiniteNumber(v.size) && isFiniteNumber(v.mtimeMs)
    ? { name: v.name, size: v.size, mtimeMs: v.mtimeMs }
    : null;

/** Fichier facultatif : `null` écrit, ou un tampon ; `undefined` s'il est mal formé. */
const parseOptionalStamp = (v: unknown): SyncStamp | null | undefined => (v === null || v === undefined ? null : parseStamp(v) ?? undefined);

const parseFiles = (v: unknown): SyncFiles | null => {
  if (!isObject(v)) return null;
  const gpx = parseStamp(v.gpx);
  const record = parseOptionalStamp(v.record);
  const imu = parseOptionalStamp(v.imu);
  return gpx && record !== undefined && imu !== undefined ? { gpx, record, imu } : null;
};

const parseSession = (v: unknown): SyncBaseSession | null => {
  if (!isObject(v) || !isFiniteNumber(v.startMs)) return null;
  const computer = parseFiles(v.computer);
  const phone = parseFiles(v.phone);
  return computer && phone ? { startMs: v.startMs, computer, phone } : null;
};

const parseRouteFiles = (v: unknown): SyncRouteFiles | null => {
  if (!isObject(v) || typeof v.updatedAt !== 'string') return null;
  const json = parseStamp(v.json);
  const gpx = parseOptionalStamp(v.gpx);
  return json && gpx !== undefined ? { json, gpx, updatedAt: v.updatedAt } : null;
};

const parseRouteLine = (v: unknown): SyncBaseRoute | null => {
  if (!isObject(v) || typeof v.id !== 'string' || v.id === '') return null;
  const computer = parseRouteFiles(v.computer);
  const phone = parseRouteFiles(v.phone);
  return computer && phone ? { id: v.id, computer, phone } : null;
};

/** Champs de la base que cette version lit ; les autres sont gardés tels quels (`SyncBase.unknownFields`). */
const KNOWN_BASE_FIELDS = new Set([
  'format', 'version', 'computerId', 'phoneId', 'phonePath', 'syncedAtMs', 'phonePass', 'sessions', 'removed', 'held', 'routes', 'removedRoutes',
  'heldRoutes',
  'unknownFields',
]);

/**
 * Base lue dans son texte (`null` : fichier absent). Lecture tolérante : une ligne mal formée, ou en double, est
 * écartée seule, et sa session redevient une première rencontre, d'où rien ne se supprime. L'en-tête, lui, doit se
 * lire : sans les identifiants de la paire, la base entière est illisible.
 */
export const parseSyncBase = (text: string | null): SyncBaseRead => {
  if (text === null) return { state: 'absent' };
  const value = parseJson(text);
  if (!isObject(value) || value.format !== SYNC_BASE_FORMAT || !isFiniteNumber(value.version)) return { state: 'unreadable' };
  if (value.version > SYNC_BASE_VERSION) return { state: 'newer' };
  if (!isSyncId(value.computerId) || !isSyncId(value.phoneId)) return { state: 'unreadable' };
  const seen = new Set<number>();
  const sessions = (Array.isArray(value.sessions) ? value.sessions : []).flatMap((line): SyncBaseSession[] => {
    const session = parseSession(line);
    if (!session || seen.has(session.startMs)) return [];
    seen.add(session.startMs);
    return [session];
  });
  /** Liste d'identités sans ligne ; mal formée ou absente : vide. */
  const starts = (list: unknown, without: ReadonlySet<number>): number[] =>
    [...new Set((Array.isArray(list) ? list : []).filter((v): v is number => isFiniteNumber(v) && !seen.has(v) && !without.has(v)))];
  const held = starts(value.held, new Set());
  const removed = starts(value.removed, new Set(held));
  const routeIds = new Set<string>();
  const routes = (Array.isArray(value.routes) ? value.routes : []).flatMap((line): SyncBaseRoute[] => {
    const route = parseRouteLine(line);
    if (!route || routeIds.has(route.id)) return [];
    routeIds.add(route.id);
    return [route];
  });
  /** Liste d'identités d'itinéraires sans ligne ; mal formée ou absente : vide. */
  const ids = (list: unknown, without: ReadonlySet<string>): string[] =>
    [...new Set((Array.isArray(list) ? list : []).filter((v): v is string => typeof v === 'string' && v !== '' && !routeIds.has(v) && !without.has(v)))];
  const heldRoutes = ids(value.heldRoutes, new Set());
  const removedRoutes = ids(value.removedRoutes, new Set(heldRoutes));
  const unknown = Object.entries(value).filter(([key]) => !KNOWN_BASE_FIELDS.has(key));
  return {
    state: 'ok',
    base: {
      computerId: value.computerId,
      phoneId: value.phoneId,
      phonePath: typeof value.phonePath === 'string' ? value.phonePath : null,
      syncedAtMs: isFiniteNumber(value.syncedAtMs) ? value.syncedAtMs : null,
      phonePass: Number.isSafeInteger(value.phonePass) && (value.phonePass as number) >= 0 ? (value.phonePass as number) : null,
      sessions,
      removed,
      held,
      routes,
      removedRoutes,
      heldRoutes,
      ...(unknown.length > 0 ? { unknownFields: Object.fromEntries(unknown) } : {}),
    },
  };
};

export const serializeSyncBase = (base: SyncBase): string => {
  const { unknownFields, ...known } = base;
  return `${stringifyJson({ ...unknownFields, format: SYNC_BASE_FORMAT, version: SYNC_BASE_VERSION, ...known })}\n`;
};

export const syncBaseLine = (base: SyncBase | null, startMs: number): SyncBaseSession | null =>
  base?.sessions.find((s) => s.startMs === startMs) ?? null;

/** La base avec cette ligne, à la place de celle de la même session : la session est de nouveau des deux côtés. */
export const withSyncLine = (base: SyncBase, line: SyncBaseSession): SyncBase => ({
  ...base,
  sessions: [...base.sessions.filter((s) => s.startMs !== line.startMs), line].sort((a, b) => a.startMs - b.startMs),
  removed: base.removed.filter((startMs) => startMs !== line.startMs),
  held: base.held.filter((startMs) => startMs !== line.startMs),
});

const withStart = (list: readonly number[], startMs: number): number[] =>
  (list.includes(startMs) ? [...list] : [...list, startMs].sort((a, b) => a - b));

/** La base sans la ligne d'une session qui n'est plus d'aucun côté, sa suppression retenue (`SyncBase.removed`). */
export const withoutSyncLine = (base: SyncBase, startMs: number): SyncBase => ({
  ...base,
  sessions: base.sessions.filter((s) => s.startMs !== startMs),
  removed: withStart(base.removed, startMs),
  held: base.held.filter((held) => held !== startMs),
});

/** La base qui se souvient d'une session du téléphone laissée où elle est (`SyncBase.held`). */
export const withSyncHeld = (base: SyncBase, startMs: number): SyncBase => ({
  ...base,
  removed: base.removed.filter((removed) => removed !== startMs),
  held: withStart(base.held, startMs),
});

/**
 * La base qui ne sait plus rien d'une session : ni ligne, ni suppression retenue, ni session laissée sur le téléphone.
 * Pour une suppression que l'utilisateur a refusée : rien n'est posé dans `removed`, la session n'est pas tenue pour
 * supprimée, et le plan suivant la traite comme neuve là où elle est encore (recopiée de l'autre côté). Sans ligne,
 * rien ne se supprime : cet oubli ne peut rien faire perdre.
 */
export const withoutSyncMemory = (base: SyncBase, startMs: number): SyncBase => ({
  ...base,
  sessions: base.sessions.filter((s) => s.startMs !== startMs),
  removed: base.removed.filter((removed) => removed !== startMs),
  held: base.held.filter((held) => held !== startMs),
});

/** Vrai si la base retient quoi que ce soit de cette session (ligne, suppression retenue, session laissée). */
export const hasSyncMemory = (base: SyncBase, startMs: number): boolean =>
  base.sessions.some((s) => s.startMs === startMs) || base.removed.includes(startMs) || base.held.includes(startMs);

/**
 * La base à la fin d'une synchronisation menée au bout : sa date, et les suppressions retenues réduites à celles
 * que la corbeille de l'ordinateur tient encore (`trashed`, leurs identités) ; les autres ne servent plus. De même
 * pour les itinéraires (`trashedRoutes`, leurs identités, `syncRouteId`) ; sans cette liste (itinéraires non
 * synchronisés cette fois), leurs suppressions retenues restent telles quelles.
 */
export const withSyncDone = (base: SyncBase, nowMs: number, trashed: ReadonlySet<number>, trashedRoutes?: ReadonlySet<string>): SyncBase => ({
  ...base,
  syncedAtMs: nowMs,
  removed: base.removed.filter((startMs) => trashed.has(startMs)),
  removedRoutes: trashedRoutes ? base.removedRoutes.filter((id) => trashedRoutes.has(id)) : base.removedRoutes,
});

/** Ligne de la base d'un itinéraire, par son identité. */
export const syncRouteBaseLine = (base: SyncBase | null, id: string): SyncBaseRoute | null =>
  base?.routes.find((r) => r.id === id) ?? null;

const withId = (list: readonly string[], id: string): string[] => (list.includes(id) ? [...list] : [...list, id].sort());

/** La base avec cette ligne d'itinéraire, à la place de celle de la même identité : il est de nouveau des deux côtés. */
export const withRouteLine = (base: SyncBase, line: SyncBaseRoute): SyncBase => ({
  ...base,
  routes: [...base.routes.filter((r) => r.id !== line.id), line].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  removedRoutes: base.removedRoutes.filter((id) => id !== line.id),
  heldRoutes: base.heldRoutes.filter((id) => id !== line.id),
});

/** La base sans la ligne d'un itinéraire qui n'est plus d'aucun côté, sa suppression retenue (`removedRoutes`). */
export const withoutRouteLine = (base: SyncBase, id: string): SyncBase => ({
  ...base,
  routes: base.routes.filter((r) => r.id !== id),
  removedRoutes: withId(base.removedRoutes, id),
  heldRoutes: base.heldRoutes.filter((held) => held !== id),
});

/** La base qui se souvient d'un itinéraire du téléphone laissé où il est (`heldRoutes`). */
export const withRouteHeld = (base: SyncBase, id: string): SyncBase => ({
  ...base,
  removedRoutes: base.removedRoutes.filter((removed) => removed !== id),
  heldRoutes: withId(base.heldRoutes, id),
});

/** Comme `withoutSyncMemory`, pour un itinéraire : ni ligne, ni suppression retenue, ni itinéraire laissé sur le téléphone. */
export const withoutRouteMemory = (base: SyncBase, id: string): SyncBase => ({
  ...base,
  routes: base.routes.filter((r) => r.id !== id),
  removedRoutes: base.removedRoutes.filter((removed) => removed !== id),
  heldRoutes: base.heldRoutes.filter((held) => held !== id),
});

/** Vrai si la base retient quoi que ce soit de cet itinéraire. */
export const hasRouteMemory = (base: SyncBase, id: string): boolean =>
  base.routes.some((r) => r.id === id) || base.removedRoutes.includes(id) || base.heldRoutes.includes(id);
