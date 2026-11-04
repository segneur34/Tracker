import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';
import { RECORD_LIGHT_FIELDS_KEY, RECORD_READER_VERSION, lightRecord, recordFileName, type LibrarySession } from './record';
import { indexByRecordName, type LibraryCache } from './reconcile';

/**
 * Cache des fiches, gardé sur l'appareil hors du dossier (lot 113, sorti de la bibliothèque) : sa forme rangée,
 * sa lecture et le calcul de ses entrées. La bibliothèque le lit et l'écrit (`hooks/sessionLibrary/cache.ts`).
 */

/** Le cache tel que rangé dans le stockage de l'appareil. */
export interface StoredCache {
  folder: string;
  /**
   * Fiches allégées (`lightRecord`) : sans altitude du terrain, voies ni
   * sauts, relus sur le disque quand on en a besoin. Absent d'un cache d'avant,
   * dont les fiches sont entières.
   */
  light?: boolean;
  /**
   * Champs gardés par les fiches allégées (`RECORD_LIGHT_FIELDS_KEY`). Un cache fait sous une autre
   * liste, ou d'avant cette empreinte, est ignoré : toutes les fiches sont relues, puis il est refait.
   */
  fields?: string;
  /** Version du lecteur qui a rendu ces fiches (`RECORD_READER_VERSION`), 1 si absente : une autre est ignorée de même. */
  reader?: number;
  entries: LibraryCache;
}

/** Cache lu : ses entrées, et si ses fiches sont allégées. */
export interface ReadCache {
  entries: LibraryCache;
  light: boolean;
}

/** Identité d'un dossier mémoire dans le cache : un cache d'un autre dossier est ignoré. */
export const folderId = (f: Pick<MemoryFolder, 'kind' | 'label'>): string => `${f.kind}:${f.label}`;

/**
 * Entrées du cache rangé pour le dossier `id` : aucune si le cache est d'un autre dossier, d'une autre liste
 * de champs allégés ou d'un autre lecteur de fiches.
 */
export const storedCacheFor = (cache: StoredCache | null, id: string): ReadCache =>
  cache && cache.folder === id && cache.entries && cache.fields === RECORD_LIGHT_FIELDS_KEY && (cache.reader ?? 1) === RECORD_READER_VERSION
    ? { entries: cache.entries, light: cache.light === true }
    : { entries: {}, light: false };

/** Cache à ranger pour le dossier `id`, fiches allégées. */
export const storedCache = (id: string, entries: LibraryCache): StoredCache =>
  ({ folder: id, light: true, fields: RECORD_LIGHT_FIELDS_KEY, reader: RECORD_READER_VERSION, entries });

/**
 * Entrées du cache d'après le contenu réel de `sessions/` (`listed`) : celles de `items` sont refaites, les
 * autres recopiées de `kept` s'il est allégé (sinon le cache repart de rien). Un nom seul (`string`) est une
 * session sortie de la liste, dont l'entrée est retirée ; une session en lecture seule n'y entre pas. Une
 * fiche dont l'écriture attend (`writePending`) diffère encore du fichier : elle n'entre pas, et revient dans
 * `stillDirty`, pour la prochaine mise à jour.
 */
export const nextCacheEntries = (
  listed: readonly FolderEntry[],
  kept: ReadCache | null,
  items: readonly (LibrarySession | string)[],
  writePending: (file: string) => boolean
): { entries: LibraryCache; stillDirty: string[] } => {
  const byName = indexByRecordName(listed);
  const entries: LibraryCache = kept?.light ? { ...kept.entries } : {};
  const stillDirty: string[] = [];
  for (const item of items) {
    const file = typeof item === 'string' ? item : item.file;
    const name = recordFileName(file);
    const entry = byName.get(name);
    delete entries[name];
    if (entry) delete entries[entry.name];
    if (typeof item === 'string' || item.readOnly) continue;
    // Une fiche en attente ou en cours d'écriture diffère encore du fichier : elle sera relue au prochain lancement.
    if (writePending(file)) {
      stillDirty.push(file);
      continue;
    }
    if (entry) entries[entry.name] = { size: entry.size, mtimeMs: entry.mtimeMs, record: lightRecord(item.record) };
  }
  return { entries, stillDirty };
};
