import { base64ToBlob, blobToBase64 } from '../core/base64';
import { inRange } from '../core/basics';
import { shouldCheckCap, TILE_CACHE_DEFAULTS, tilesToEvict, type CachedTileEntry } from '../core/tiles';
import { filesystem } from './files';
import { isNativeApp } from './runtime';
import { jsonStore } from './storage';

/**
 * Tuiles de carte gardées sur l'appareil (cartes sans réseau, `core/tiles.ts`) :
 * seul point d'accès autorisé.
 *
 * - Sur le téléphone, un dossier plat `tuiles/` du dossier privé de
 *   l'application (`Directory.Data`, que le système ne vide pas de lui-même,
 *   contrairement à `Directory.Cache`). La date d'une tuile est celle de son
 *   fichier, lue avec la liste du dossier au premier accès.
 * - Dans le navigateur, le Cache API, la date dans un en-tête posé à l'écriture,
 *   et un index de toutes les tuiles rangé avec elles (`createBrowserTileStore`).
 *
 * Ici aussi le plafond de la place occupée (`keepTile`), contrôlé au fil des
 * tuiles gardées, et réglé dans Réglages (`hooks/useTileCache.ts`).
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
/**
 * Type par défaut d'une tuile. Toutes sont nommées `.png`, les photos du fond
 * satellite (JPEG) comprises : le décodeur d'image reconnaît le format au contenu.
 */
const TILE_TYPE = 'image/png';


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
      return typeof data === 'string' ? { blob: base64ToBlob(data, TILE_TYPE), savedAtMs: entry.savedAtMs } : null;
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
const TILE_PATH = '/tuiles-gardees/';
/** Adresse fictive d'une tuile dans le cache, jamais demandée au réseau. */
const cacheUrl = (key: string): string => `${TILE_PATH}${key}.png`;
const pathOf = (url: string): string => new URL(url, 'http://local').pathname;
const keyOfUrl = (url: string): string => {
  const path = pathOf(url);
  return path.slice(path.lastIndexOf('/') + 1, -4);
};
/**
 * Index des tuiles gardées (clé, taille, date), rangé dans le même cache sous
 * un nom qu'aucune tuile ne porte : sans lui, la liste des tuiles demandait une
 * lecture par tuile (10 000 tuiles, 10 000 lectures).
 */
const INDEX_URL = `${TILE_PATH}_index.json`;
const isIndexUrl = (url: string): boolean => pathOf(url) === INDEX_URL;
/** Calme après la dernière tuile gardée ou effacée, avant de réécrire l'index. */
const INDEX_WRITE_DELAY_MS = 1000;

/** Index tel que rangé : `[taille en octets, date d'écriture en ms]` par clé. */
interface StoredIndex {
  tiles: Record<string, [number, number]>;
}

const parseIndex = (raw: unknown): Map<string, CachedTileEntry> | null => {
  const tiles = (raw as Partial<StoredIndex> | null)?.tiles;
  if (!tiles || typeof tiles !== 'object') return null;
  const entries = new Map<string, CachedTileEntry>();
  for (const [key, row] of Object.entries(tiles)) {
    if (!Array.isArray(row)) return null;
    entries.set(key, { key, bytes: Number(row[0]) || 0, savedAtMs: Number(row[1]) || 0 });
  }
  return entries;
};

/** Le magasin du navigateur, et l'écriture de son index que `pagehide` déclenche aussitôt. */
export interface BrowserTileStore extends TileStore {
  /** Réécrit l'index s'il a changé depuis sa dernière écriture. */
  flushIndex(): Promise<void>;
}

/**
 * Tuiles gardées dans le Cache API de `storage` (`null` : sans cache, rien
 * n'est gardé). L'index est lu une fois, au premier besoin, puis tenu en
 * mémoire et réécrit après `INDEX_WRITE_DELAY_MS` de calme. Absent, il est
 * refait en lisant chaque tuile ; présent, il sert aussitôt, et il est comparé
 * en arrière-plan aux tuiles du cache : d'un autre compte (une page fermée
 * avant de l'écrire, un autre onglet), il est refait de même.
 */
export const createBrowserTileStore = (storage: Pick<CacheStorage, 'open' | 'delete'> | null): BrowserTileStore => {
  const openCache = async (): Promise<Cache | null> => {
    try {
      return storage ? await storage.open(CACHE_NAME) : null;
    } catch {
      return null;
    }
  };

  const rebuild = async (cache: Cache, requests: readonly Request[]): Promise<Map<string, CachedTileEntry>> => {
    const entries = new Map<string, CachedTileEntry>();
    for (const request of requests) {
      const response = await cache.match(request).catch(() => undefined);
      if (!response) continue;
      const key = keyOfUrl(request.url);
      entries.set(key, {
        key,
        bytes: Number(response.headers.get('content-length')) || 0,
        savedAtMs: Number(response.headers.get(SAVED_AT_HEADER)) || 0,
      });
    }
    return entries;
  };

  let index: Promise<Map<string, CachedTileEntry>> | null = null;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flushIndex = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || !index) return;
    dirty = false;
    const tiles: StoredIndex['tiles'] = {};
    for (const e of (await index).values()) tiles[e.key] = [e.bytes, e.savedAtMs];
    const cache = await openCache();
    try {
      await cache?.put(INDEX_URL, new Response(JSON.stringify({ tiles }), { headers: { 'content-type': 'application/json' } }));
    } catch {
      dirty = true;
    }
  };

  const schedule = (): void => {
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flushIndex();
    }, INDEX_WRITE_DELAY_MS);
  };

  /** Tuiles du cache, sans l'index ; la liste des clés coûte à elle seule quelques secondes pour 10 000 tuiles. */
  const tileRequests = async (cache: Cache): Promise<readonly Request[]> =>
    (await cache.keys()).filter((r) => !isIndexUrl(r.url));

  /**
   * Index rangé comparé, en arrière-plan, aux tuiles du cache : d'un autre
   * compte, il est refait et `entries` reprend son contenu.
   */
  const verify = async (cache: Cache, entries: Map<string, CachedTileEntry>): Promise<void> => {
    try {
      const startedAtMs = Date.now();
      const requests = await tileRequests(cache);
      if (requests.length === entries.size) return;
      const rebuilt = await rebuild(cache, requests);
      // Une tuile gardée ou effacée pendant la relecture reste comme la page l'a laissée.
      for (const [key, entry] of entries) if (!rebuilt.has(key) && entry.savedAtMs < startedAtMs) entries.delete(key);
      for (const [key, entry] of rebuilt) {
        const known = entries.get(key);
        if (!known || known.savedAtMs < startedAtMs) entries.set(key, entry);
      }
      schedule();
    } catch {
      // Cache illisible : l'index rangé reste.
    }
  };

  const loadIndex = async (): Promise<Map<string, CachedTileEntry>> => {
    const cache = await openCache();
    if (!cache) return new Map();
    try {
      const stored: unknown = await cache.match(INDEX_URL).then((r) => r?.json()).catch(() => null);
      const parsed = parseIndex(stored);
      if (parsed) {
        void verify(cache, parsed);
        return parsed;
      }
      const rebuilt = await rebuild(cache, await tileRequests(cache));
      schedule();
      return rebuilt;
    } catch {
      return new Map();
    }
  };

  const entries = (): Promise<Map<string, CachedTileEntry>> => (index ??= loadIndex());

  return {
    read: async (key) => {
      const cache = await openCache();
      const response = await cache?.match(cacheUrl(key)).catch(() => undefined);
      if (!response) return null;
      return { blob: await response.blob(), savedAtMs: Number(response.headers.get(SAVED_AT_HEADER)) || 0 };
    },
    write: async (key, blob) => {
      const cache = await openCache();
      if (!cache) return;
      const savedAtMs = Date.now();
      const headers = { 'content-type': blob.type || TILE_TYPE, 'content-length': String(blob.size), [SAVED_AT_HEADER]: String(savedAtMs) };
      try {
        await cache.put(cacheUrl(key), new Response(blob, { headers }));
      } catch {
        // Place refusée : la tuile reste affichée, simplement pas gardée.
        return;
      }
      (await entries()).set(key, { key, bytes: blob.size, savedAtMs });
      schedule();
    },
    list: async () => [...(await entries()).values()],
    remove: async (keys) => {
      const cache = await openCache();
      if (!cache) return;
      const known = await entries();
      for (const key of keys) {
        await cache.delete(cacheUrl(key)).catch(() => false);
        known.delete(key);
      }
      schedule();
    },
    clear: async () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      dirty = false;
      index = Promise.resolve(new Map());
      try {
        await storage?.delete(CACHE_NAME);
      } catch {
        // Cache inaccessible : rien à vider.
      }
    },
    flushIndex,
  };
};

const createBrowserStore = (): TileStore => {
  const store = createBrowserTileStore(typeof caches === 'undefined' ? null : caches);
  // Page quittée ou passée en arrière-plan : l'index part aussitôt, sans attendre le calme.
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void store.flushIndex());
  return store;
};

export const tileStore: TileStore = isNativeApp() ? nativeStore : createBrowserStore();

/** Clé du plafond, propre à l'appareil (hors de `reglages.json`). */
const CAP_STORAGE_KEY = 'tracker.tileCache';

/** Plafond permis dans Réglages, en mégaoctets. */
export const TILE_CAP_LIMITS_MB = { min: 10, max: 20_000 } as const;

export const isValidTileCap = (value: unknown): value is number =>
  inRange(value, TILE_CAP_LIMITS_MB.min, TILE_CAP_LIMITS_MB.max);

/** Plafond de la place occupée par les tuiles gardées, en mégaoctets. */
export const tileCapMb = (): number => {
  const value = jsonStore.read<{ capMb?: number }>(CAP_STORAGE_KEY)?.capMb;
  return isValidTileCap(value) ? value : TILE_CACHE_DEFAULTS.capMb;
};

/** Plafond retenu sur l'appareil ; `null` revient au défaut. */
export const writeTileCapMb = (next: number | null): void => {
  jsonStore.write(CAP_STORAGE_KEY, next === null ? {} : { capMb: next });
};

/** Efface les tuiles les plus anciennes jusqu'à repasser sous le plafond. */
export const evictTiles = async (): Promise<void> => {
  const keys = tilesToEvict(await tileStore.list(), tileCapMb() * 1e6);
  if (keys.length > 0) await tileStore.remove(keys);
};

let lastCapCheckMs = 0;

/** Garde une tuile reçue, puis contrôle le plafond, au plus une fois par intervalle. */
export const keepTile = async (key: string, blob: Blob): Promise<void> => {
  await tileStore.write(key, blob);
  const now = Date.now();
  if (!shouldCheckCap(lastCapCheckMs, now, TILE_CACHE_DEFAULTS.evictIntervalMs)) return;
  lastCapCheckMs = now;
  await evictTiles();
};
