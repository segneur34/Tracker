import { base64ToBlob, blobToBase64 } from '../core/base64';
import { filesystem } from './files';
import { isNativeApp } from './runtime';

/**
 * Images finies des vignettes de la bibliothèque (trace sur son fond), gardées
 * sur l'appareil d'un lancement à l'autre (lot 121) : seul point d'accès
 * autorisé. Un fichier PNG par image et un index, opaque ici (du texte lu et
 * écrit d'un bloc) ; leur contenu, leur borne et l'écriture différée de
 * l'index sont tenus par `library/previewImageStore.ts`.
 *
 * - Sur le téléphone, le dossier `vignettes-images/` du dossier privé de
 *   l'application (`Directory.Data`), avec `index.json` dedans.
 * - Dans le navigateur, le Cache API (`tracker-vignettes-images`).
 *
 * Magasin frère de celui des tuiles (`tileCache.ts`), pas le même : ni le
 * plafond ni les comptes ni « Vider » de Réglages ne le voient. Hors du
 * stockage clé-valeur et du dossier mémoire : ce n'est pas une donnée de
 * session. Une lecture manquée rend `null` ; une écriture refusée lève.
 */

/** Fichiers d'images, nommés sans extension, et index. */
export interface PreviewImageBackend {
  readIndex(): Promise<string | null>;
  writeIndex(text: string): Promise<void>;
  read(name: string): Promise<Blob | null>;
  write(name: string, blob: Blob): Promise<void>;
  remove(names: readonly string[]): Promise<void>;
  /** Noms de toutes les images rangées. */
  names(): Promise<string[]>;
}

const IMAGE_TYPE = 'image/png';
const NATIVE_DIR = 'vignettes-images';
const NATIVE_INDEX = `${NATIVE_DIR}/index.json`;
const nativePath = (name: string): string => `${NATIVE_DIR}/${name}.png`;

/**
 * Dossier créé une fois avant la première écriture : plusieurs images écrites
 * ensemble avec `recursive` se disputent sa création, et l'une échoue (comme
 * les tuiles).
 */
let nativeDir: Promise<void> | null = null;

const ensureNativeDir = (): Promise<void> => (nativeDir ??= (async () => {
  const { Filesystem, Directory } = await filesystem();
  try {
    await Filesystem.mkdir({ path: NATIVE_DIR, directory: Directory.Data, recursive: true });
  } catch {
    // Déjà là.
  }
})());

/** Images dans le dossier privé de l'application, sur le téléphone. */
const nativeBackend: PreviewImageBackend = {
  readIndex: async () => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path: NATIVE_INDEX, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : null;
    } catch {
      // Absent : aucune image gardée.
      return null;
    }
  },
  writeIndex: async (text) => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    await ensureNativeDir();
    await Filesystem.writeFile({ path: NATIVE_INDEX, data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
  },
  read: async (name) => {
    const { Filesystem, Directory } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path: nativePath(name), directory: Directory.Data });
      return typeof data === 'string' ? base64ToBlob(data, IMAGE_TYPE) : null;
    } catch {
      return null;
    }
  },
  write: async (name, blob) => {
    const { Filesystem, Directory } = await filesystem();
    await ensureNativeDir();
    await Filesystem.writeFile({ path: nativePath(name), data: await blobToBase64(blob), directory: Directory.Data });
  },
  remove: async (names) => {
    const { Filesystem, Directory } = await filesystem();
    for (const name of names) {
      try {
        await Filesystem.deleteFile({ path: nativePath(name), directory: Directory.Data });
      } catch {
        // Déjà absente.
      }
    }
  },
  names: async () => {
    const { Filesystem, Directory } = await filesystem();
    try {
      const { files } = await Filesystem.readdir({ path: NATIVE_DIR, directory: Directory.Data });
      return files.filter((f) => f.type === 'file' && f.name.endsWith('.png')).map((f) => f.name.slice(0, -4));
    } catch {
      // Dossier absent : aucune image.
      return [];
    }
  },
};

const CACHE_NAME = 'tracker-vignettes-images';
const CACHE_PATH = '/vignettes-images/';
/** Adresses fictives dans le cache, jamais demandées au réseau ; l'index porte un nom qu'aucune image ne porte. */
const cacheUrl = (name: string): string => `${CACHE_PATH}${name}.png`;
const INDEX_URL = `${CACHE_PATH}_index.json`;

/** Images dans le Cache API de `storage` (`null` : sans cache, rien n'est gardé). */
export const createCachePreviewImageBackend = (storage: Pick<CacheStorage, 'open'> | null): PreviewImageBackend => {
  const openCache = async (): Promise<Cache | null> => {
    try {
      return storage ? await storage.open(CACHE_NAME) : null;
    } catch {
      return null;
    }
  };
  return {
    readIndex: async () => {
      const cache = await openCache();
      const response = await cache?.match(INDEX_URL).catch(() => undefined);
      return response ? response.text() : null;
    },
    writeIndex: async (text) => {
      const cache = await openCache();
      await cache?.put(INDEX_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    },
    read: async (name) => {
      const cache = await openCache();
      const response = await cache?.match(cacheUrl(name)).catch(() => undefined);
      return response ? response.blob().catch(() => null) : null;
    },
    write: async (name, blob) => {
      const cache = await openCache();
      await cache?.put(cacheUrl(name), new Response(blob, { headers: { 'content-type': IMAGE_TYPE, 'content-length': String(blob.size) } }));
    },
    remove: async (names) => {
      const cache = await openCache();
      if (!cache) return;
      for (const name of names) await cache.delete(cacheUrl(name)).catch(() => false);
    },
    names: async () => {
      const cache = await openCache();
      if (!cache) return [];
      try {
        return (await cache.keys())
          .map((request) => new URL(request.url, 'http://local').pathname)
          .filter((path) => path.startsWith(CACHE_PATH) && path.endsWith('.png'))
          .map((path) => path.slice(CACHE_PATH.length, -4));
      } catch {
        return [];
      }
    },
  };
};

/** Images de l'appareil, téléphone ou navigateur. */
export const previewImageFiles: PreviewImageBackend = isNativeApp()
  ? nativeBackend
  : createCachePreviewImageBackend(typeof caches === 'undefined' ? null : caches);
