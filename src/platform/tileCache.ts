import type { CachedTileEntry } from '../core/tiles';
import { isNativeApp } from './runtime';

/**
 * Tuiles de carte gardées sur l'appareil (cartes sans réseau, `core/tiles.ts`) :
 * seul point d'accès autorisé.
 *
 * - Sur le téléphone, un dossier plat `tuiles/` du dossier privé de
 *   l'application (`Directory.Data`, que le système ne vide pas de lui-même,
 *   contrairement à `Directory.Cache`). La date d'une tuile est celle de son
 *   fichier, lue avec la liste du dossier au premier accès.
 * - Dans le navigateur, le Cache API, la date dans un en-tête posé à l'écriture.
 *
 * Ce cache est propre à l'appareil : il n'entre pas dans le dossier mémoire.
 * Aucune erreur ne remonte : une tuile illisible est une tuile absente.
 */

export interface StoredTile {
  blob: Blob;
  savedAtMs: number;
}

export interface TileStore {
  read(key: string): Promise<StoredTile | null>;
  write(key: string, blob: Blob): Promise<void>;
  /** Toutes les tuiles gardées, avec leur taille et leur date. */
  list(): Promise<CachedTileEntry[]>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

const TILE_DIR = 'tuiles';
const TILE_TYPE = 'image/png';

const filesystem = () => import('@capacitor/filesystem');

const base64ToBlob = (data: string): Blob => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: TILE_TYPE });
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Tuiles présentes et leur date, lues une fois dans le dossier puis tenues à
 * jour : une tuile absente ne coûte aucun appel au téléphone (le système
 * journalise chaque lecture manquée), une présente un seul.
 */
let nativeIndex: Promise<Map<string, CachedTileEntry>> | null = null;

const readNativeIndex = async (): Promise<Map<string, CachedTileEntry>> => {
  const { Filesystem, Directory } = await filesystem();
  try {
    const { files } = await Filesystem.readdir({ path: TILE_DIR, directory: Directory.Data });
    return new Map(files
      .filter((f) => f.type === 'file' && f.name.endsWith('.png'))
      .map((f) => [f.name.slice(0, -4), { key: f.name.slice(0, -4), bytes: f.size, savedAtMs: f.mtime }]));
  } catch {
    // Dossier absent : aucune tuile gardée.
    return new Map();
  }
};

const nativeEntries = (): Promise<Map<string, CachedTileEntry>> => (nativeIndex ??= readNativeIndex());

/**
 * Dossier créé une fois avant la première écriture : plusieurs tuiles écrites
 * ensemble avec `recursive` se disputent sa création, et l'une échoue.
 */
let nativeDir: Promise<void> | null = null;

const ensureNativeDir = (): Promise<void> => (nativeDir ??= (async () => {
  const { Filesystem, Directory } = await filesystem();
  try {
    await Filesystem.mkdir({ path: TILE_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // Déjà là.
  }
})());

const nativeStore: TileStore = {
  read: async (key) => {
    const entry = (await nativeEntries()).get(key);
    if (!entry) return null;
    const { Filesystem, Directory } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path: `${TILE_DIR}/${key}.png`, directory: Directory.Data });
      return typeof data === 'string' ? { blob: base64ToBlob(data), savedAtMs: entry.savedAtMs } : null;
    } catch {
      (await nativeEntries()).delete(key);
      return null;
    }
  },
  write: async (key, blob) => {
    const { Filesystem, Directory } = await filesystem();
    await ensureNativeDir();
    try {
      await Filesystem.writeFile({ path: `${TILE_DIR}/${key}.png`, data: await blobToBase64(blob), directory: Directory.Data });
      (await nativeEntries()).set(key, { key, bytes: blob.size, savedAtMs: Date.now() });
    } catch {
      // Disque plein ou refusé : la tuile reste affichée, simplement pas gardée.
    }
  },
  list: async () => [...(await nativeEntries()).values()],
  remove: async (keys) => {
    const { Filesystem, Directory } = await filesystem();
    const entries = await nativeEntries();
    for (const key of keys) {
      entries.delete(key);
      try {
        await Filesystem.deleteFile({ path: `${TILE_DIR}/${key}.png`, directory: Directory.Data });
      } catch {
        // Déjà absente.
      }
    }
  },
  clear: async () => {
    const { Filesystem, Directory } = await filesystem();
    (await nativeEntries()).clear();
    try {
      await Filesystem.rmdir({ path: TILE_DIR, directory: Directory.Data, recursive: true });
    } catch {
      // Dossier absent.
    }
    nativeDir = null;
  },
};

const CACHE_NAME = 'tracker-tuiles';
const SAVED_AT_HEADER = 'x-tracker-saved-at';
/** Adresse fictive d'une tuile dans le cache, jamais demandée au réseau. */
const cacheUrl = (key: string): string => `/tuiles-gardees/${key}.png`;
const keyOfUrl = (url: string): string => url.slice(url.lastIndexOf('/') + 1, -4);

const openCache = async (): Promise<Cache | null> => {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
};

const browserStore: TileStore = {
  read: async (key) => {
    const cache = await openCache();
    const response = await cache?.match(cacheUrl(key)).catch(() => undefined);
    if (!response) return null;
    return { blob: await response.blob(), savedAtMs: Number(response.headers.get(SAVED_AT_HEADER)) || 0 };
  },
  write: async (key, blob) => {
    const cache = await openCache();
    const headers = { 'content-type': TILE_TYPE, 'content-length': String(blob.size), [SAVED_AT_HEADER]: String(Date.now()) };
    await cache?.put(cacheUrl(key), new Response(blob, { headers })).catch(() => undefined);
  },
  list: async () => {
    const cache = await openCache();
    if (!cache) return [];
    const entries: CachedTileEntry[] = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      entries.push({
        key: keyOfUrl(new URL(request.url).pathname),
        bytes: Number(response.headers.get('content-length')) || 0,
        savedAtMs: Number(response.headers.get(SAVED_AT_HEADER)) || 0,
      });
    }
    return entries;
  },
  remove: async (keys) => {
    const cache = await openCache();
    if (cache) for (const key of keys) await cache.delete(cacheUrl(key));
  },
  clear: async () => {
    try {
      if (typeof caches !== 'undefined') await caches.delete(CACHE_NAME);
    } catch {
      // Cache inaccessible : rien à vider.
    }
  },
};

export const tileStore: TileStore = isNativeApp() ? nativeStore : browserStore;
