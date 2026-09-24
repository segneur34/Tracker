import type { FolderEntry } from '../platform/memoryFolder';
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
}

const isRecordFileName = (name: string): boolean => /\.json$/i.test(name);

export const planReconcile = (
  sessionEntries: FolderEntry[],
  rootEntries: FolderEntry[],
  cache: LibraryCache
): ReconcilePlan => {
  const files = sessionEntries.filter((e) => e.kind === 'file');
  const records = new Map(files.filter((e) => isRecordFileName(e.name)).map((e) => [e.name, e]));
  const gpxFiles = files
    .filter((e) => isGpxFileName(e.name))
    .map((e) => e.name)
    .sort();
  const gpxRecordNames = new Set(gpxFiles.map(recordFileName));

  const plan: ReconcilePlan = { gpxFiles, reuse: {}, read: [], summarize: [], orphanRecords: [], rootGpx: [] };
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
  plan.orphanRecords = [...records.keys()].filter((name) => !gpxRecordNames.has(name)).sort();
  plan.rootGpx = rootEntries
    .filter((e) => e.kind === 'file' && isGpxFileName(e.name))
    .map((e) => e.name)
    .sort();
  return plan;
};
