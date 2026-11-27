import { isFiniteNumber, isObject, parseJson, plural, stringifyJson } from '../core/basics';
import { routeFileBase } from '../planning/routeRecord';
import type { MemoryKind } from '../platform/memoryFolder';
import { ROUTES_DIR, SESSIONS_DIR } from './folderLayout';
import { uniqueSessionFileName } from './naming';

/**
 * Corbeille du programme Windows et du téléphone (élément 217, sous-lot 3a, porté du lot 448 de Gtracker ; corbeilles
 * jumelles, lot 242-1) : ce qu'on y range, combien de temps, et comment le ramener, sans rien lire ni écrire ici (les
 * gestes sur le dossier sont dans `trashFolder.ts`).
 *
 *     corbeille/
 *       corbeille.json                 l'index : une entrée par suppression
 *       <instant>-<startMs ou base>/   les fichiers supprimés, sous leurs noms d'origine
 *         depose.json                  seulement dans un dépôt de l'ordinateur pas encore adopté (`TrashDeposit`)
 *
 * Une session (GPX, fiche, capteurs) ou un itinéraire (fiche, GPX) supprimé y passe au lieu d'être effacé, et y reste
 * `TRASH_KEEP_DAYS` jours, comptés depuis son entrée dans la corbeille. La corbeille est hors de `sessions/` et
 * d'`itineraires/` : ni le balayage ni l'import ne la lisent, ses sessions ne comptent nulle part. Le navigateur n'en a
 * pas.
 *
 * Deux corbeilles jumelles, une par appareil, chacune seule à écrire son index : sur le téléphone, l'ordinateur n'écrit
 * que `depose.json` dans un sous-dossier neuf, puis y déplace les fichiers qu'il retire ; le téléphone adopte ce dépôt
 * (`depositAdoption`, `depositEntry`) en l'inscrivant à son index. L'origine d'une entrée (`TrashOrigin`) se lit du
 * point de vue de la mémoire qui tient l'index : `ordinateur` veut dire « cette mémoire », sur chaque appareil (le nom
 * vient du programme Windows et le format ne change pas).
 */

export const TRASH_DIR = 'corbeille';
export const TRASH_INDEX_FILE = 'corbeille.json';
export const TRASH_INDEX_PATH = `${TRASH_DIR}/${TRASH_INDEX_FILE}`;
export const TRASH_FORMAT = 'tracker-corbeille';
export const TRASH_VERSION = 1;

/** Durée de garde d'une entrée, en jours (demande de l'utilisateur de Gtracker : « au moins 30 jours »). */
export const TRASH_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;
/** La même durée, en millisecondes : valeur par défaut de `keepMs` dans la purge. */
export const TRASH_KEEP_MS = TRASH_KEEP_DAYS * DAY_MS;

/**
 * `restes` : fiche ou capteurs d'une session sans leur GPX, que la synchronisation (à venir) aura dû retirer. Ce
 * n'est pas une session : ni montrée, ni restaurée, ni comptée ; gardée le temps de la corbeille, puis purgée. Rien
 * ne les crée encore : l'index les lit déjà, pour que la synchronisation n'ait pas à changer son format.
 */
export type TrashKind = 'session' | 'itineraire' | 'restes';
/**
 * D'où viennent les fichiers de l'entrée, vu de la mémoire qui tient l'index : `ordinateur`, cette mémoire (suppression
 * faite ici, ou dépôt de l'ordinateur adopté par le téléphone : ce sont ses propres fichiers) ; `telephone`, une copie
 * de l'autre appareil que la synchronisation du programme Windows y a rangée avant de la retirer du téléphone.
 */
export type TrashOrigin = 'ordinateur' | 'telephone';
/** Pourquoi l'entrée est là. */
export type TrashReason = 'supprimee';

export interface TrashFile {
  /** Nom d'origine, sans son dossier, gardé tel quel dans le sous-dossier de l'entrée. */
  name: string;
  size: number;
}

export interface TrashEntry {
  /** Sous-dossier de `corbeille/` qui tient les fichiers. */
  dir: string;
  kind: TrashKind;
  /** Session : instant du premier point (`summary.startMs`), son identité ; `null` pour un itinéraire. */
  startMs: number | null;
  /** Itinéraire : base de ses noms de fichiers ; `null` pour une session. */
  routeBase: string | null;
  /** Itinéraire : création (`RouteRecord.createdAt`), qui le distingue d'un autre de même base. */
  createdAt: string | null;
  /** Nom montré au moment de la suppression, figé. */
  name: string;
  /** Entrée dans la corbeille, horloge de l'ordinateur. */
  deletedAtMs: number;
  origin: TrashOrigin;
  reason: TrashReason;
  /** Fichier qui fait l'entrée : le GPX de la session, la fiche de l'itinéraire. */
  main: string;
  files: TrashFile[];
}

/**
 * Index lu : `absent` (pas encore de corbeille), `ok`, `unreadable` (illisible) ou `newer` (version plus récente de
 * l'application). Les deux derniers ne s'écrivent jamais et ne purgent rien : leurs entrées pourraient être perdues.
 */
export interface TrashIndex {
  state: 'absent' | 'ok' | 'unreadable' | 'newer';
  entries: TrashEntry[];
}

export const isWritableTrash = (index: TrashIndex): boolean => index.state === 'absent' || index.state === 'ok';

const isString = (v: unknown): v is string => typeof v === 'string';
const stringOrNull = (v: unknown): string | null | undefined => (v === null ? null : isString(v) ? v : undefined);

const parseFile = (v: unknown): TrashFile | null =>
  isObject(v) && isString(v.name) && v.name !== '' && isFiniteNumber(v.size) ? { name: v.name, size: v.size } : null;

const parseEntry = (v: unknown): TrashEntry | null => {
  if (!isObject(v)) return null;
  const { dir, kind, startMs, routeBase, createdAt, name, deletedAtMs, origin, reason, main, files } = v;
  if (!isString(dir) || !isTrashDirName(dir) || (kind !== 'session' && kind !== 'itineraire' && kind !== 'restes')) return null;
  if (!(startMs === null || isFiniteNumber(startMs)) || !isString(name) || !isFiniteNumber(deletedAtMs)) return null;
  const base = stringOrNull(routeBase);
  const created = stringOrNull(createdAt);
  if (base === undefined || created === undefined || (origin !== 'ordinateur' && origin !== 'telephone') || reason !== 'supprimee') return null;
  if (!isString(main) || !Array.isArray(files)) return null;
  const parsed = files.map(parseFile);
  if (parsed.some((f) => f === null)) return null;
  return {
    dir, kind, startMs: startMs as number | null, routeBase: base, createdAt: created, name, deletedAtMs, origin, reason, main,
    files: parsed as TrashFile[],
  };
};

/** Index lu dans son texte (`null` : fichier absent). Une seule entrée illisible rend tout l'index illisible. */
export const parseTrashIndex = (text: string | null): TrashIndex => {
  if (text === null) return { state: 'absent', entries: [] };
  const value = parseJson(text);
  if (!isObject(value) || value.format !== TRASH_FORMAT || !isFiniteNumber(value.version)) return { state: 'unreadable', entries: [] };
  if (value.version > TRASH_VERSION) return { state: 'newer', entries: [] };
  if (!Array.isArray(value.entries)) return { state: 'unreadable', entries: [] };
  const entries = value.entries.map(parseEntry);
  if (entries.some((e) => e === null)) return { state: 'unreadable', entries: [] };
  return { state: 'ok', entries: entries as TrashEntry[] };
};

export const serializeTrashIndex = (entries: readonly TrashEntry[]): string =>
  `${stringifyJson({ format: TRASH_FORMAT, version: TRASH_VERSION, entries })}\n`;

/** Caractères qu'un nom de dossier de Windows refuse (les caractères de contrôle aussi, écartés à part). */
const FORBIDDEN_IN_DIR = /[\\/:*?"<>|]/;

/** Le texte, chaque caractère refusé dans un nom de dossier remplacé par `_`. */
const dirSafe = (text: string): string =>
  [...text].map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || FORBIDDEN_IN_DIR.test(c) ? '_' : c)).join('');

/** Longueur maximale de l'identité dans le nom d'un sous-dossier. */
const IDENTITY_MAX = 80;

/** Identité telle que l'écrit le nom d'un sous-dossier : caractères refusés remplacés, blancs réduits, rognée. */
const dirIdentity = (identity: string): string =>
  dirSafe(identity).replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, IDENTITY_MAX) || 'sans-nom';

/** Instant d'entrée en millisecondes, écrit sur 13 chiffres (de 2001 à 2286), puis un tiret, l'identité, un suffixe. */
const TRASH_DIR_NAME = /^\d{13}-(.+?)(-\d+)?$/;

/**
 * Vrai pour un sous-dossier que la corbeille a créé (`trashDirName`), à sa forme exacte : seuls ceux-là sont vidés
 * et effacés par elle. Un dossier posé là à la main (« 2024-vacances ») n'en est pas.
 */
export const isTrashDirName = (name: string): boolean => {
  const m = TRASH_DIR_NAME.exec(name);
  return m !== null && dirIdentity(m[1]) === m[1];
};

/**
 * Sous-dossier d'une entrée neuve : `<instant>-<identité>` (`startMs` d'une session, base d'un itinéraire), suivi
 * de `-2`, `-3`… s'il est déjà pris (`taken`, sans égard à la casse : le disque de Windows l'ignore).
 */
export const trashDirName = (nowMs: number, identity: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const base = `${String(Math.max(0, Math.floor(nowMs))).padStart(13, '0')}-${dirIdentity(identity)}`;
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
};

/**
 * Vrai pour un chemin relatif (`corbeille/<sous-dossier>/x.gpx`, à n'importe quelle profondeur d'un dossier choisi)
 * qui passe par un sous-dossier de la corbeille : un import de dossier ne le prend pas, sans quoi une session mise à
 * la corbeille reviendrait en important le dossier mémoire lui-même. Un dossier « corbeille » quelconque, dont le
 * sous-dossier n'a pas la forme de ceux de la corbeille, est importé comme avant.
 */
export const isTrashPath = (relativePath: string): boolean => {
  const parts = relativePath.split(/[\\/]/);
  return parts.some((part, i) => part.toLowerCase() === TRASH_DIR && i + 1 < parts.length - 1 && isTrashDirName(parts[i + 1]));
};

/**
 * Entrée refaite depuis un sous-dossier de la corbeille dont l'index a disparu (effacé à la main, synchronisation de
 * OneDrive) : la date de mise à la corbeille est l'instant du nom du sous-dossier, et l'identité ce qui le suit. Une
 * identité en chiffres avec un GPX est une session (le GPX qui a sa fiche fait l'entrée) ; une identité dont la
 * fiche `<identité>.json` est là, un itinéraire ; le reste, des restes (jamais montrés, purgés à 30 jours). `name` :
 * nom lu dans la fiche, à défaut celui du fichier. `null` si le sous-dossier n'est pas un de ceux de la corbeille ou
 * s'il est vide.
 */
export const rebuiltTrashEntry = (dir: string, files: readonly TrashFile[], name: string | null): TrashEntry | null => {
  const m = TRASH_DIR_NAME.exec(dir);
  if (m === null || !isTrashDirName(dir) || files.length === 0) return null;
  const identity = m[1];
  const deletedAtMs = Number(dir.slice(0, 13));
  const lower = (n: string) => n.toLowerCase();
  const has = (n: string) => files.some((f) => lower(f.name) === lower(n));
  const base: Omit<TrashEntry, 'kind' | 'startMs' | 'routeBase' | 'name' | 'main'> = {
    dir, createdAt: null, deletedAtMs, origin: 'ordinateur', reason: 'supprimee', files: [...files],
  };
  const gpxs = files.filter((f) => /\.gpx$/i.test(f.name)).map((f) => f.name).sort();
  if (/^\d+$/.test(identity) && gpxs.length > 0) {
    const main = gpxs.find((g) => has(g.replace(/\.gpx$/i, '.json'))) ?? gpxs[0];
    return { ...base, kind: 'session', startMs: Number(identity), routeBase: null, name: name ?? withoutExtension(main), main };
  }
  const record = files.find((f) => lower(f.name) === lower(`${identity}.json`));
  if (record) return { ...base, kind: 'itineraire', startMs: null, routeBase: identity, name: name ?? identity, main: record.name };
  return {
    ...base, kind: 'restes', startMs: /^\d+$/.test(identity) ? Number(identity) : null, routeBase: null,
    name: name ?? identity, main: [...files].map((f) => f.name).sort()[0],
  };
};

/** Fiche dont le nom sert au nom montré d'une entrée refaite (`rebuiltTrashEntry`), `null` sans fiche. */
export const rebuiltEntryRecord = (dir: string, files: readonly TrashFile[]): string | null => {
  const entry = rebuiltTrashEntry(dir, files, null);
  if (!entry || entry.kind === 'restes') return null;
  const json = entry.kind === 'session' ? entry.main.replace(/\.gpx$/i, '.json') : entry.main;
  return files.find((f) => f.name.toLowerCase() === json.toLowerCase())?.name ?? null;
};

/** Chemin d'un fichier d'une entrée, depuis la racine du dossier mémoire. */
export const trashFilePath = (dir: string, name: string): string => `${TRASH_DIR}/${dir}/${name}`;

/**
 * Entrées à purger à `nowMs` : entrées depuis plus de `keepMs` (par défaut `TRASH_KEEP_DAYS` jours). Une date dans
 * le futur (horloge reculée depuis) n'est jamais purgée : elle attend que l'horloge la dépasse.
 */
export const expiredTrashEntries = (entries: readonly TrashEntry[], nowMs: number, keepMs: number = TRASH_KEEP_MS): TrashEntry[] =>
  entries.filter((e) => e.deletedAtMs <= nowMs && nowMs - e.deletedAtMs > keepMs);

/**
 * Sous-dossiers de la corbeille absents de l'index (copie coupée avant l'écriture de l'entrée, entrée retirée
 * avant ses fichiers) : à effacer. Seuls ceux dont le nom est celui d'une entrée (`isTrashDirName`) ; un dossier posé
 * là à la main reste, et un dépôt de l'ordinateur pas encore adopté (`pending` : sous-dossiers qui tiennent
 * `depose.json`) aussi : il n'est jamais pris pour un reste.
 */
export const orphanTrashDirs = (
  entries: readonly TrashEntry[], listing: readonly { name: string; kind: 'file' | 'directory' }[], pending: readonly string[] = [],
): string[] => {
  const known = new Set([...entries.map((e) => e.dir), ...pending].map((d) => d.toLowerCase()));
  return listing.filter((e) => e.kind === 'directory' && isTrashDirName(e.name) && !known.has(e.name.toLowerCase())).map((e) => e.name);
};

// --- Dépôts de l'ordinateur dans la corbeille du téléphone ---

/** Fichier qui fait d'un sous-dossier de la corbeille un dépôt de l'ordinateur, écrit avant tout déplacement. */
export const DEPOSIT_FILE = 'depose.json';
export const DEPOSIT_FORMAT = 'tracker-depot';
export const DEPOSIT_VERSION = 1;

/**
 * Ce que l'ordinateur dit d'un dépôt (`depose.json`) : ce qu'il retire du téléphone, avec les noms et tailles des
 * fichiers qu'il va y déplacer. Le téléphone en fait une entrée de son index (`depositEntry`) une fois les fichiers
 * arrivés, à sa propre horloge.
 */
export interface TrashDeposit {
  /** Qui a déposé : l'ordinateur, seul à le faire. */
  origin: 'ordinateur';
  kind: TrashKind;
  startMs: number | null;
  routeBase: string | null;
  createdAt: string | null;
  name: string;
  files: TrashFile[];
}

export const serializeDeposit = (deposit: TrashDeposit): string => {
  const { origin, kind, startMs, routeBase, createdAt, name, files } = deposit;
  return `${stringifyJson({ format: DEPOSIT_FORMAT, version: DEPOSIT_VERSION, origine: origin, kind, startMs, routeBase, createdAt, name, files })}\n`;
};

/** Dépôt lu dans le texte de `depose.json` ; `null` s'il ne se lit pas (ou d'une version plus récente). */
export const parseDeposit = (text: string | null): TrashDeposit | null => {
  const value = text === null ? null : parseJson(text);
  if (!isObject(value) || value.format !== DEPOSIT_FORMAT || value.version !== DEPOSIT_VERSION || value.origine !== 'ordinateur') return null;
  const { kind, startMs, routeBase, createdAt, name, files } = value;
  if (kind !== 'session' && kind !== 'itineraire' && kind !== 'restes') return null;
  const base = stringOrNull(routeBase);
  const created = stringOrNull(createdAt);
  if (!(startMs === null || isFiniteNumber(startMs)) || base === undefined || created === undefined || !isString(name) || !Array.isArray(files)) return null;
  const parsed = files.map(parseFile);
  if (parsed.some((f) => f === null)) return null;
  return { origin: 'ordinateur', kind, startMs: startMs as number | null, routeBase: base, createdAt: created, name, files: parsed as TrashFile[] };
};

/**
 * Règle d'adoption d'un dépôt : `adopt` s'il est complet (chacun de ses fichiers est arrivé, `present`), ou partiel une
 * fois qu'aucun fichier manquant n'est plus à sa place d'origine (`stillAtOrigin`, noms encore dans `sessions/` ou
 * `itineraires/`) ; `wait` sinon, l'ordinateur ayant pu être coupé entre deux déplacements. Aucune horloge comparée.
 */
export const depositAdoption = (deposit: TrashDeposit, present: readonly string[], stillAtOrigin: readonly string[]): 'adopt' | 'wait' => {
  const here = new Set(present.map((n) => n.toLowerCase()));
  const origin = new Set(stillAtOrigin.map((n) => n.toLowerCase()));
  return deposit.files.some((f) => !here.has(f.name.toLowerCase()) && origin.has(f.name.toLowerCase())) ? 'wait' : 'adopt';
};

/** Fichiers d'un dépôt qui manquent dans son sous-dossier : ceux qu'il faut chercher à leur place d'origine. */
export const depositMissing = (deposit: TrashDeposit, present: readonly string[]): string[] => {
  const here = new Set(present.map((n) => n.toLowerCase()));
  return deposit.files.filter((f) => !here.has(f.name.toLowerCase())).map((f) => f.name);
};

/**
 * Entrée de l'index faite d'un dépôt adopté (`dir`), d'après les fichiers arrivés (`files`, `depose.json` exclu) :
 * entrée dans la corbeille à `nowMs`, horloge de l'appareil qui adopte ; origine `ordinateur`, « cette mémoire ». Une
 * session sans son GPX arrivé, un itinéraire sans sa fiche, ne sont que des restes. `null` si rien n'est arrivé.
 */
export const depositEntry = (dir: string, deposit: TrashDeposit, files: readonly TrashFile[], nowMs: number): TrashEntry | null => {
  if (files.length === 0) return null;
  const lower = (n: string) => n.toLowerCase();
  const sorted = [...files].map((f) => f.name).sort();
  const gpx = sorted.find((n) => /\.gpx$/i.test(n) && deposit.files.some((f) => lower(f.name) === lower(n)));
  const record = deposit.routeBase === null ? undefined : files.find((f) => lower(f.name) === lower(`${deposit.routeBase}.json`))?.name;
  const base = { dir, startMs: null, routeBase: null, createdAt: null, name: deposit.name, deletedAtMs: nowMs, origin: 'ordinateur' as const, reason: 'supprimee' as const, files: [...files] };
  if (deposit.kind === 'session' && deposit.startMs !== null && gpx) return { ...base, kind: 'session', startMs: deposit.startMs, main: gpx };
  if (deposit.kind === 'itineraire' && record) return { ...base, kind: 'itineraire', routeBase: deposit.routeBase, createdAt: deposit.createdAt, main: record };
  return { ...base, kind: 'restes', startMs: deposit.startMs, main: sorted[0] };
};

/**
 * Lignes de la corbeille (`groupedTrashEntries`) dont la session est revenue dans la mémoire (`inMemory`, identités
 * des sessions de la mémoire) : restaurée sur l'autre appareil puis recopiée ici, ou revenue par un import. Elles se
 * règlent (`settleReturnedTrash`) : chaque entrée complète la session sans rien écraser, et ne part qu'une fois tout
 * repris. Les itinéraires, que leur identité ne suffit pas à rapprocher, se règlent à part.
 */
export const returnedTrashGroups = (entries: readonly TrashEntry[], inMemory: ReadonlySet<number>): TrashGroup[] =>
  groupedTrashEntries(entries).filter((g) => g.entry.kind === 'session' && g.entry.startMs !== null && inMemory.has(g.entry.startMs));

/**
 * Entrée déjà faite pour la même session, à reprendre au lieu d'en créer une seconde : une suppression coupée après
 * l'écriture de l'entrée a laissé la session des deux côtés, et on la supprime de nouveau. Même identité, même
 * origine, même fichier principal (`mainName`), et chacun des fichiers à ranger (`files`) y est déjà, sous le même
 * nom et à la même taille : sinon la copie du moment (une fiche saisie depuis) serait retirée sans avoir été gardée.
 * La taille ne suffit pas à conclure : `trashFolder.ts` compare encore les octets.
 */
export const reusableTrashEntry = (
  entries: readonly TrashEntry[], startMs: number, mainName: string, files: readonly TrashFile[], origin: TrashOrigin = 'ordinateur',
  kind: 'session' | 'restes' = 'session',
): TrashEntry | null =>
  entries.find((e) => e.kind === kind && e.startMs === startMs && e.origin === origin && e.main.toLowerCase() === mainName.toLowerCase()
    && files.every((file) => e.files.some((f) => f.name.toLowerCase() === file.name.toLowerCase() && f.size === file.size))) ?? null;

/** Même chose pour un itinéraire : même base, même création, fiche de même taille. */
export const reusableRouteEntry = (entries: readonly TrashEntry[], base: string, createdAt: string, recordSize: number): TrashEntry | null =>
  entries.find((e) => e.kind === 'itineraire' && e.routeBase?.toLowerCase() === base.toLowerCase() && e.createdAt === createdAt
    && e.files.some((f) => f.name === e.main && f.size === recordSize)) ?? null;

/** Entrées que la corbeille montre et sait restaurer : toutes, sauf les restes d'une session (`TrashKind`). */
export const shownTrashEntries = (entries: readonly TrashEntry[]): TrashEntry[] => entries.filter((e) => e.kind !== 'restes');

/** Entrées d'une session, par son identité. */
export const sessionTrashEntries = (entries: readonly TrashEntry[], startMs: number): TrashEntry[] =>
  entries.filter((e) => e.kind === 'session' && e.startMs === startMs);

/** Les entrées, sans celles de `dirs`. */
export const withoutTrashEntries = (entries: readonly TrashEntry[], dirs: readonly string[]): TrashEntry[] => {
  const gone = new Set(dirs.map((d) => d.toLowerCase()));
  return entries.filter((e) => !gone.has(e.dir.toLowerCase()));
};

/**
 * Ordre dans lequel les entrées d'une même session se restaurent : celles de l'ordinateur d'abord, sa mémoire faisant
 * foi, puis de la plus récemment supprimée à la plus ancienne.
 */
export const trashRestoreOrder = (a: TrashEntry, b: TrashEntry): number =>
  Number(a.origin !== 'ordinateur') - Number(b.origin !== 'ordinateur') || b.deletedAtMs - a.deletedAtMs;

/** Une ligne de la corbeille : toutes les entrées d'une même session, ou un itinéraire. */
export interface TrashGroup {
  /** L'entrée montrée et restaurée d'abord (`trashRestoreOrder`) ; les autres ne font que la compléter. */
  entry: TrashEntry;
  /** Les entrées de la ligne, `entry` en tête, dans l'ordre de `trashRestoreOrder`. */
  entries: TrashEntry[];
  /** Entrée dans la corbeille la plus récente de la ligne. */
  deletedAtMs: number;
}

/**
 * Lignes de la corbeille, de la plus récemment supprimée à la plus ancienne : une par session (une même session
 * supprimée deux fois, ou plus tard sa copie du téléphone, n'en fait qu'une), une par itinéraire. Les restes d'une
 * session n'y sont pas.
 */
export const groupedTrashEntries = (entries: readonly TrashEntry[]): TrashGroup[] => {
  const lines = new Map<string, TrashEntry[]>();
  for (const e of shownTrashEntries(entries)) {
    const key = e.kind === 'session' && e.startMs !== null ? `session:${e.startMs}` : `dossier:${e.dir.toLowerCase()}`;
    lines.set(key, [...(lines.get(key) ?? []), e]);
  }
  return [...lines.values()]
    .map((line) => {
      const sorted = [...line].sort(trashRestoreOrder);
      return { entry: sorted[0], entries: sorted, deletedAtMs: Math.max(...line.map((e) => e.deletedAtMs)) };
    })
    .sort((a, b) => b.deletedAtMs - a.deletedAtMs);
};

/** La ligne qui tient `entry` ; à défaut, une ligne d'elle seule. */
export const trashGroupOf = (entries: readonly TrashEntry[], entry: TrashEntry): TrashGroup =>
  groupedTrashEntries(entries).find((g) => g.entries.some((e) => e.dir === entry.dir))
    ?? { entry, entries: [entry], deletedAtMs: entry.deletedAtMs };

/** Une copie à faire pour restaurer : de la corbeille vers la mémoire. */
export interface TrashCopy {
  from: string;
  to: string;
}

const withoutExtension = (name: string): string => name.replace(/\.[^.]+$/, '');

/**
 * Restauration d'une session : capteurs, fiche, puis GPX en dernier (une coupure laisse une fiche ou des capteurs
 * sans GPX, ignorés, jamais un GPX sans fiche qui recevrait une fiche neuve), sous un nom de GPX libre dans
 * `sessions/` (`taken` : noms déjà là, `uniqueSessionFileName`). Seule la session de l'entrée revient, pas les
 * copies en double rangées avec elle. Rend aussi le nom du GPX restauré.
 */
export const sessionRestorePlan = (entry: TrashEntry, taken: Iterable<string>): { gpx: string; copies: TrashCopy[] } => {
  const gpx = uniqueSessionFileName(entry.main, taken);
  const stem = withoutExtension(entry.main).toLowerCase();
  const targetStem = withoutExtension(gpx);
  const has = (ext: string) => entry.files.find((f) => f.name.toLowerCase() === `${stem}.${ext}`);
  const copies = (['imu', 'json', 'gpx'] as const)
    .map((ext) => has(ext))
    .filter((f): f is TrashFile => f !== undefined)
    .map((f) => ({ from: trashFilePath(entry.dir, f.name), to: `${SESSIONS_DIR}/${targetStem}${f.name.slice(stem.length)}` }));
  return { gpx, copies };
};

/**
 * Restauration d'un itinéraire : le GPX, puis la fiche, qui fait foi et le fait paraître dans la liste, sous une
 * base libre de `itineraires/` (`routeFileBase`). Rend la base retenue.
 */
export const routeRestorePlan = (entry: TrashEntry, taken: Iterable<string>): { base: string; copies: TrashCopy[] } => {
  const original = entry.routeBase ?? withoutExtension(entry.main);
  const base = routeFileBase(original, taken);
  const stem = original.toLowerCase();
  const copies = (['gpx', 'json'] as const)
    .map((ext) => entry.files.find((f) => f.name.toLowerCase() === `${stem}.${ext}`))
    .filter((f): f is TrashFile => f !== undefined)
    .map((f) => ({ from: trashFilePath(entry.dir, f.name), to: `${ROUTES_DIR}/${base}${f.name.slice(stem.length)}` }));
  return { base, copies };
};

// --- Textes ---

/**
 * Vrai si le dossier ouvert (`kind`, `readOnly`) a une corbeille : le dossier du disque du programme Windows, ou le
 * dossier mémoire du téléphone, en écriture. Ailleurs (navigateur, dossier choisi dans le navigateur), les
 * suppressions restent définitives et leurs phrases ne changent pas. La même condition décide de la mise à la
 * corbeille (`trashFolderOf`).
 */
export const deletesToTrash = (kind: MemoryKind | null | undefined, readOnly: boolean): boolean =>
  (kind === 'disk' || kind === 'device') && !readOnly;

/** Bouton qui met à la corbeille, à la place de celui qui supprime (`otherwise`) quand le dossier ouvert en a une. */
export const trashDeleteButton = (toTrash: boolean, otherwise: string): string =>
  toTrash ? `Mettre à la corbeille (${TRASH_KEEP_DAYS} jours)` : otherwise;

/**
 * Phrase de la fenêtre « Jeter cette session ? » de l'analyse : définitive (`otherwise`), ou la corbeille quand le
 * dossier ouvert en a une.
 */
export const sessionDiscardText = (toTrash: boolean, otherwise: string): string =>
  toTrash
    ? `Son fichier, sa fiche et ses mesures de capteurs partent à la corbeille de cet appareil, où ils restent ${TRASH_KEEP_DAYS} jours (Réglages › Mémoire).`
    : otherwise;

/** Combien la corbeille garde de sessions et d'itinéraires : une par ligne (`groupedTrashEntries`). */
export const trashCounts = (entries: readonly TrashEntry[]): { sessions: number; routes: number } => {
  const groups = groupedTrashEntries(entries);
  return {
    sessions: groups.filter((g) => g.entry.kind === 'session').length,
    routes: groups.filter((g) => g.entry.kind === 'itineraire').length,
  };
};

/** Ligne de Réglages › Mémoire : « Corbeille : 4 sessions, gardées 30 jours » ; `null` si elle est vide. */
export const trashSummaryText = ({ sessions, routes }: { sessions: number; routes: number }): string | null => {
  if (sessions + routes === 0) return null;
  const days = TRASH_KEEP_DAYS;
  if (routes === 0) return `Corbeille : ${plural(sessions, 'session')}, gardée${sessions > 1 ? 's' : ''} ${days} jours`;
  if (sessions === 0) return `Corbeille : ${plural(routes, 'itinéraire')}, gardé${routes > 1 ? 's' : ''} ${days} jours`;
  return `Corbeille : ${plural(sessions, 'session')} et ${plural(routes, 'itinéraire')}, gardés ${days} jours`;
};
