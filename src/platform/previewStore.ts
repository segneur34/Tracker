import { filesystem } from './files';
import { isNativeApp } from './runtime';

/**
 * Document des vignettes de la bibliothèque gardées sur l'appareil d'un
 * lancement à l'autre (lot 118) : seul point d'accès autorisé. Le document est
 * opaque ici (du texte lu et écrit d'un bloc) ; son contenu, sa borne et son
 * écriture différée sont tenus par `library/previewStore.ts`.
 *
 * - Sur le téléphone, `vignettes.json` du dossier privé de l'application
 *   (`Directory.Data`), comme les tuiles (`tileCache.ts`).
 * - Dans le navigateur, une entrée du Cache API (`tracker-vignettes`).
 *
 * Hors du stockage clé-valeur (`storage.ts`, quelques Mo en tout) et du
 * dossier mémoire : ce n'est pas une donnée de session. Une lecture manquée
 * rend `null` ; une écriture refusée lève, pour être retentée.
 */

/** Lecture et écriture du document entier. */
export interface PreviewBackend {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

const NATIVE_FILE = 'vignettes.json';

/** Document dans le dossier privé de l'application, sur le téléphone. */
const nativeBackend: PreviewBackend = {
  read: async () => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    try {
      const { data } = await Filesystem.readFile({ path: NATIVE_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof data === 'string' ? data : null;
    } catch {
      // Absent : aucune vignette gardée.
      return null;
    }
  },
  write: async (text) => {
    const { Filesystem, Directory, Encoding } = await filesystem();
    await Filesystem.writeFile({ path: NATIVE_FILE, data: text, directory: Directory.Data, encoding: Encoding.UTF8 });
  },
};

const CACHE_NAME = 'tracker-vignettes';
/** Adresse fictive du document dans le cache, jamais demandée au réseau. */
const CACHE_URL = '/vignettes-gardees/vignettes.json';

/** Document dans le Cache API de `storage` (`null` : sans cache, rien n'est gardé). */
export const createCachePreviewBackend = (storage: Pick<CacheStorage, 'open'> | null): PreviewBackend => {
  const openCache = async (): Promise<Cache | null> => {
    try {
      return storage ? await storage.open(CACHE_NAME) : null;
    } catch {
      return null;
    }
  };
  return {
    read: async () => {
      const cache = await openCache();
      const response = await cache?.match(CACHE_URL).catch(() => undefined);
      return response ? response.text() : null;
    },
    write: async (text) => {
      const cache = await openCache();
      await cache?.put(CACHE_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    },
  };
};

/** Document de l'appareil, téléphone ou navigateur. */
export const previewDocument: PreviewBackend = isNativeApp()
  ? nativeBackend
  : createCachePreviewBackend(typeof caches === 'undefined' ? null : caches);

/**
 * Appelle `callback` quand la page est quittée ou cachée (l'application passée
 * en arrière-plan aussi), pour écrire le document sans attendre le calme.
 */
export const onPageHidden = (callback: () => void): void => {
  if (typeof window === 'undefined') return;
  window.addEventListener('pagehide', callback);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') callback();
  });
};
