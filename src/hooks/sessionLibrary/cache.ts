import { SESSIONS_DIR } from '../../library/folderLayout';
import { folderId, nextCacheEntries, storedCache, storedCacheFor, type ReadCache, type StoredCache } from '../../library/libraryCache';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { jsonStore } from '../../platform/storage';
import { cacheDirty, findSession, lib, unwritten } from './memory';
import { recordTimers, writing } from './recordWrites';

/**
 * Cache des fiches, gardé sur l'appareil hors du dossier (lot 113) : lu au balayage, mis à jour un instant après
 * un import ou une suppression, refait en entier à la fin d'un balayage (`library/libraryCache.ts`).
 */

const CACHE_KEY = 'tracker.libraryCache';

export const readCache = (f: MemoryFolder): ReadCache => storedCacheFor(jsonStore.read<StoredCache>(CACHE_KEY), folderId(f));

/** Après un import ou une suppression, le cache est mis à jour une fois, ce délai écoulé depuis le dernier. */
const CACHE_UPDATE_DELAY_MS = 1000;

let cacheTimer: ReturnType<typeof setTimeout> | null = null;

/** Mise à jour du cache en attente : le dossier et sa génération. */
let cachePending: { f: MemoryFolder; gen: number } | null = null;

/**
 * Cache d'après le contenu réel de `sessions/` et les fiches connues,
 * allégées. `whole` : refait en entier (fin de balayage) ; sinon, seules les
 * entrées de `cacheDirty` sont refaites, les autres recopiées du cache rangé
 * (refait en entier s'il est d'un autre dossier ou d'avant l'allègement).
 */
const updateCache = async (f: MemoryFolder, gen: number, whole: boolean): Promise<void> => {
  const entries = await f.list(SESSIONS_DIR);
  if (gen !== lib.generation) return;
  const kept = whole ? null : readCache(f);
  const sessions = kept?.light ? [...cacheDirty].map((file) => findSession(file) ?? file) : lib.all;
  cacheDirty.clear();
  const next = nextCacheEntries(entries, kept, sessions, (file) => recordTimers.has(file) || writing.has(file) || unwritten.has(file));
  for (const file of next.stillDirty) cacheDirty.add(file);
  jsonStore.write(CACHE_KEY, storedCache(folderId(f), next.entries));
};

/** Cache refait en entier, d'après tout `all` (fin de balayage). */
export const rebuildCache = (f: MemoryFolder, gen: number): Promise<void> => updateCache(f, gen, true);

/** Met à jour le cache dans `CACHE_UPDATE_DELAY_MS`, une fois pour toutes les demandes faites d'ici là. */
export const scheduleCacheUpdate = (f: MemoryFolder): void => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cachePending = { f, gen: lib.generation };
  cacheTimer = setTimeout(() => void flushCacheUpdate(), CACHE_UPDATE_DELAY_MS);
};

/** Fait tout de suite la mise à jour du cache en attente, s'il y en a une. */
export const flushCacheUpdate = async (): Promise<void> => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cacheTimer = null;
  const pending = cachePending;
  cachePending = null;
  if (pending) await updateCache(pending.f, pending.gen, false).catch(() => undefined);
};

/** Changement de dossier ou relecture : la mise à jour en attente n'a plus lieu d'être, le balayage refera tout le cache. */
export const cancelCacheUpdate = (): void => {
  if (cacheTimer !== null) clearTimeout(cacheTimer);
  cacheTimer = null;
  cachePending = null;
  cacheDirty.clear();
};
