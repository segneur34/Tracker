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
}

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
  const files = sessionEntries.filter((e) => e.kind === 'file');
  // Fiches indexées par leur nom à l'extension en minuscules : `X.JSON` se rapproche de `X.gpx`.
  const records = new Map(files.filter((e) => isRecordFileName(e.name)).map((e) => [lowerRecordExtension(e.name), e]));
  const gpxFiles = files
    .filter((e) => isGpxFileName(e.name))
    .map((e) => e.name)
    .sort();
  const gpxRecordNames = new Set(gpxFiles.map(recordFileName));

  const plan: ReconcilePlan = { gpxFiles, reuse: {}, read: [], summarize: [], orphanRecords: [], rootGpx: [], rootRecords: {} };
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
  plan.rootGpx = rootEntries
    .filter((e) => e.kind === 'file' && isGpxFileName(e.name))
    .map((e) => e.name)
    .sort();
  const rootFiles = new Set(rootEntries.filter((e) => e.kind === 'file').map((e) => e.name));
  for (const gpx of plan.rootGpx) {
    const name = recordFileName(gpx);
    if (rootFiles.has(name) && name !== MARKER_FILE && name !== SETTINGS_FILE) plan.rootRecords[gpx] = name;
  }
  return plan;
};
