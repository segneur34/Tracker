import type { FolderEntry } from '../platform/memoryFolder';
import { MARKER_FILE, SETTINGS_FILE } from './folderLayout';
import { isGpxFileName, recordFileName, type SessionRecord } from './record';

/**
 * Rapprochement entre le dossier mémoire et le cache des fiches.
 *
 * Le dossier ne contient pas d'index : deux dossiers se fusionnent en copiant
 * leurs fichiers, et rien ne peut se désynchroniser. Pour ne pas relire des
 * centaines de fiches à chaque lancement, l'application garde une copie des
 * fiches hors du dossier, avec la taille et la date de chaque fichier. Une
 * fiche dont la taille et la date n'ont pas changé est reprise du cache ; les
 * autres sont relues.
 */

/** Fiche gardée en cache, avec la taille et la date du fichier dont elle vient. */
export interface CachedRecord {
  size: number;
  mtimeMs: number;
  record: SessionRecord;
}

/** Cache des fiches, par nom de fiche. */
export type LibraryCache = Record<string, CachedRecord>;

export interface ReconcilePlan {
  /** GPX du dossier `sessions/`, par ordre alphabétique. */
  gpxFiles: string[];
  /** Fiches inchangées, reprises du cache, par nom de GPX. */
  reuse: Record<string, SessionRecord>;
  /** GPX dont la fiche a changé ou n'est pas en cache : fiche à relire. */
  read: string[];
  /** GPX sans fiche : résumé à calculer, fiche à écrire. */
  summarize: string[];
  /** Fiches sans GPX : ignorées et laissées en place. */
  orphanRecords: string[];
  /** GPX posés à la racine du dossier : à ranger dans `sessions/`. */
  rootGpx: string[];
  /**
   * Fiche posée à la racine à côté d'un de ces GPX, par nom de GPX : elle le
   * suit dans `sessions/` (activité, nom, notes, altitude, revêtement gardés).
   * Le marqueur et les réglages ne sont jamais pris pour une fiche.
   */
  rootRecords: Record<string, string>;
  /**
   * GPX et fiches au-delà de `MAX_LISTED_FILE_BYTES`, jamais lus (dossier `sessions/` et racine), laissés en place. Un
   * GPX dont la fiche est trop grosse reste de côté avec elle : refaite depuis le GPX, sa fiche serait écrasée.
   */
  tooLarge: string[];
}

/**
 * Au-delà de cette taille, un GPX ou une fiche n'est pas lu au lancement : il passerait d'un bloc par le pont du
 * téléphone, avec un plantage possible à chaque ouverture tant qu'il reste dans le dossier. Plus gros GPX réel :
 * 2,6 Mo. Les `.imu` ne sont pas concernés, lus à la demande seulement.
 */
export const MAX_LISTED_FILE_BYTES = 30 * 1024 * 1024;

const isOversized = (entry: FolderEntry): boolean => entry.size > MAX_LISTED_FILE_BYTES;

const isRecordFileName = (name: string): boolean => /\.json$/i.test(name);

/** Nom de fiche dont l'extension est ramenée à `.json` (le nom de base reste exact). */
export const lowerRecordExtension = (name: string): string => name.replace(/\.json$/i, '.json');

/**
 * Entrées indexées par leur nom à l'extension en minuscules : la fiche `X.JSON` se retrouve par
 * `recordFileName` (`X.json`), mais le cache la garde sous son nom réel, celui que lit `planReconcile`.
 */
export const indexByRecordName = (entries: readonly FolderEntry[]): Map<string, FolderEntry> =>
  new Map(entries.map((e) => [lowerRecordExtension(e.name), e]));

export const planReconcile = (
  sessionEntries: FolderEntry[],
  rootEntries: FolderEntry[],
  cache: LibraryCache
): ReconcilePlan => {
  const listed = sessionEntries.filter((e) => e.kind === 'file');
  const oversizedRecords = listed.filter((e) => isRecordFileName(e.name) && isOversized(e));
  const blockedByRecord = new Set(oversizedRecords.map((e) => lowerRecordExtension(e.name)));
  const tooLarge = (e: FolderEntry): boolean =>
    (isRecordFileName(e.name) || isGpxFileName(e.name)) && (isOversized(e) || (isGpxFileName(e.name) && blockedByRecord.has(recordFileName(e.name))));
  const files = listed.filter((e) => !tooLarge(e));
  // Fiches indexées par leur nom à l'extension en minuscules : `X.JSON` se rapproche de `X.gpx`.
  const records = new Map(files.filter((e) => isRecordFileName(e.name)).map((e) => [lowerRecordExtension(e.name), e]));
  const gpxFiles = files
    .filter((e) => isGpxFileName(e.name))
    .map((e) => e.name)
    .sort();
  const gpxRecordNames = new Set(gpxFiles.map(recordFileName));

  const plan: ReconcilePlan = { gpxFiles, reuse: {}, read: [], summarize: [], orphanRecords: [], rootGpx: [], rootRecords: {}, tooLarge: listed.filter(tooLarge).map((e) => e.name) };
  for (const gpx of gpxFiles) {
    const entry = records.get(recordFileName(gpx));
    if (!entry) {
      plan.summarize.push(gpx);
      continue;
    }
    const cached = cache[entry.name];
    if (cached && cached.size === entry.size && cached.mtimeMs === entry.mtimeMs) plan.reuse[gpx] = cached.record;
    else plan.read.push(gpx);
  }
  plan.orphanRecords = [...records.entries()]
    .filter(([key]) => !gpxRecordNames.has(key))
    .map(([, entry]) => entry.name)
    .sort();
  const rootFiles = new Map(rootEntries.filter((e) => e.kind === 'file').map((e) => [e.name, e]));
  // Le marqueur et les réglages ne sont jamais pris pour une fiche.
  const rootRecordOf = (gpx: string): FolderEntry | undefined => {
    const name = recordFileName(gpx);
    return name !== MARKER_FILE && name !== SETTINGS_FILE ? rootFiles.get(name) : undefined;
  };
  for (const entry of [...rootFiles.values()].filter((e) => isGpxFileName(e.name))) {
    const record = rootRecordOf(entry.name);
    if (isOversized(entry) || (record && isOversized(record))) {
      plan.tooLarge.push(entry.name, ...(record && isOversized(record) ? [record.name] : []));
      continue;
    }
    plan.rootGpx.push(entry.name);
    if (record) plan.rootRecords[entry.name] = record.name;
  }
  plan.rootGpx.sort();
  plan.tooLarge.sort();
  return plan;
};

/**
 * Fiches `X.JSON` (extension autre qu'en minuscules) posées à côté d'un `X.gpx`, dont `X.json` n'existe pas :
 * à renommer, toute la suite relisant et réécrivant la fiche par `recordFileName(gpx)` (lot 113, sorti de la
 * bibliothèque).
 */
export const oddRecordExtensions = (entries: readonly FolderEntry[]): FolderEntry[] => {
  const names = new Set(entries.map((e) => e.name));
  const gpxRecordNames = new Set(entries.filter((e) => e.kind === 'file' && isGpxFileName(e.name)).map((e) => recordFileName(e.name)));
  return entries.filter(
    (e) => e.kind === 'file' && /\.json$/i.test(e.name) && !e.name.endsWith('.json') && gpxRecordNames.has(lowerRecordExtension(e.name)) && !names.has(lowerRecordExtension(e.name))
  );
};
