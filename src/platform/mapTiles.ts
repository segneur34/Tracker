import { MAP_BASES, tileUrl, type MapBase } from '../core/mapBase';
import { ancestorTile, isStale, TILE_CACHE_DEFAULTS, tileKey, type AncestorTile, type TileCoord } from '../core/tiles';
import { keepTile, tileStore, type StoredTile } from './tileCache';

/**
 * Tuiles d'un fond de carte (`core/mapBase.ts`), gardées sur l'appareil ou
 * reçues du serveur : pour la couche Leaflet (`components/BaseTileLayer.tsx`,
 * où sont décrites les règles du cache), l'image de partage d'une session
 * (`components/drawShareImage.ts`) et les vignettes de la bibliothèque
 * (`components/drawTrackPreview.ts`).
 *
 * Une tuile demandée deux fois en même temps ne part qu'une fois ; une
 * demande abandonnée (case retirée par Leaflet, vignette démontée) ne coupe
 * la requête que si plus personne ne l'attend, et seule une image reçue
 * entière est gardée. Une tuile que le serveur n'a pas (404) n'est plus
 * redemandée le temps de la page ; après un premier échec du réseau, la
 * remontée vers les zooms inférieurs ne lit plus que la mémoire.
 */

/** Ce qu'une case affiche : la tuile (image), un agrandissement découpé (URL de données), ou rien. */
export type TileContent = Blob | string;

/**
 * Réponse du serveur : l'image, `'absent'` s'il dit ne pas l'avoir (`isAbsentStatus`), retenu le temps de la
 * page, `'echec'` sinon (pas de réponse à temps, serveur saturé ou en panne, autre chose qu'une image) : la
 * tuile sera redemandée à l'affichage suivant.
 */
export type FetchedTile = Blob | 'absent' | 'echec';

export interface TileResolverDeps {
  store: { read(key: string): Promise<StoredTile | null> };
  /** Garde une tuile reçue (et contrôle le plafond). */
  keep: (key: string, blob: Blob) => Promise<void>;
  /** Demande au serveur, coupée par `signal`. */
  fetchTile: (url: string, signal: AbortSignal) => Promise<FetchedTile>;
  isOnline: () => boolean;
  /** Case `ancestor` découpée dans l'image de sa parente, agrandie à `size` pixels ; `null` si l'image est illisible. */
  crop: (blob: Blob, ancestor: AncestorTile, size: number) => Promise<string | null>;
  now: () => number;
}

export interface TileResolver {
  /** Ce qu'affiche la case `coords` de `size` pixels ; `signal` : la case n'est plus voulue. */
  resolveTile: (coords: TileCoord, base: MapBase, size: number, signal?: AbortSignal) => Promise<TileContent | null>;
}

/** Requête en cours d'une tuile, partagée par ceux qui l'attendent. */
interface Pending {
  result: Promise<FetchedTile>;
  controller: AbortController;
  waiters: number;
}

export const createTileResolver = (deps: TileResolverDeps): TileResolver => {
  const pending = new Map<string, Pending>();
  /** Tuiles que le serveur n'a pas, le temps de la page. */
  const absent = new Set<string>();

  /**
   * Tuile `key` demandée au serveur ; une même tuile en cours est partagée.
   * `signal` coupé : ce demandeur rend `'echec'` aussitôt, et la requête n'est
   * coupée que s'il était le dernier à l'attendre.
   */
  const request = (key: string, url: string, signal?: AbortSignal): Promise<FetchedTile> => {
    if (signal?.aborted) return Promise.resolve('echec');
    let entry = pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: Pending = { controller, waiters: 0, result: Promise.resolve<FetchedTile>('echec') };
      created.result = deps.fetchTile(url, controller.signal).then((fresh) => {
        if (pending.get(key) === created) pending.delete(key);
        if (controller.signal.aborted) return 'echec';
        if (fresh === 'absent') absent.add(key);
        else if (typeof fresh !== 'string') void deps.keep(key, fresh).catch(() => undefined);
        return fresh;
      });
      pending.set(key, created);
      entry = created;
    }
    const shared = entry;
    shared.waiters++;
    if (!signal) return shared.result;
    return new Promise<FetchedTile>((resolve) => {
      const onAbort = () => {
        shared.waiters--;
        if (shared.waiters === 0) {
          if (pending.get(key) === shared) pending.delete(key);
          shared.controller.abort();
        }
        resolve('echec');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      void shared.result.then((fresh) => {
        signal.removeEventListener('abort', onAbort);
        if (!signal.aborted) resolve(fresh);
      });
    });
  };

  /** Parente gardée, sinon demandée au serveur si le fond le permet, que le réseau répond et qu'on n'a pas renoncé. */
  const ancestorBlob = async (tile: TileCoord, base: MapBase, network: boolean, signal?: AbortSignal): Promise<Blob | 'echec' | null> => {
    const key = tileKey(tile, MAP_BASES[base].keyPrefix);
    const stored = await deps.store.read(key);
    if (stored) return stored.blob;
    if (!network || !MAP_BASES[base].fetchAncestors || absent.has(key) || !deps.isOnline()) return null;
    const fresh = await request(key, tileUrl(base, tile), signal);
    return fresh === 'absent' ? null : fresh;
  };

  /** Case de `coords` découpée dans la tuile la plus proche des zooms inférieurs. */
  const overzoomedTile = async (coords: TileCoord, size: number, base: MapBase, network: boolean, signal?: AbortSignal): Promise<string | null> => {
    let online = network;
    for (let depth = 1; depth <= MAP_BASES[base].overzoomDepth; depth++) {
      if (signal?.aborted) return null;
      const ancestor = ancestorTile(coords, depth);
      if (!ancestor) return null;
      const blob = await ancestorBlob(ancestor.tile, base, online, signal);
      // Réseau muet : la suite de la remontée ne lit plus que la mémoire.
      if (blob === 'echec') {
        online = false;
        continue;
      }
      if (!blob) continue;
      const cropped = await deps.crop(blob, ancestor, size);
      if (cropped !== null) return cropped;
    }
    return null;
  };

  const resolveTile: TileResolver['resolveTile'] = async (coords, base, size, signal) => {
    const key = tileKey(coords, MAP_BASES[base].keyPrefix);
    const url = tileUrl(base, coords);
    const stored = await deps.store.read(key);
    if (stored) {
      // Vieillie : montrée aussitôt, redemandée en arrière-plan (sans demandeur à abandonner).
      if (deps.isOnline() && isStale(stored.savedAtMs, deps.now(), TILE_CACHE_DEFAULTS.refreshAgeMs) && !pending.has(key)) {
        void request(key, url);
      }
      return stored.blob;
    }
    if (signal?.aborted) return null;
    let network = deps.isOnline();
    if (network && !absent.has(key)) {
      const fresh = await request(key, url, signal);
      if (typeof fresh !== 'string') return fresh;
      if (fresh === 'echec') network = false;
    }
    return overzoomedTile(coords, size, base, network, signal);
  };

  return { resolveTile };
};

/**
 * Vrai pour une réponse qui dit que le serveur n'a pas la tuile (404, 410 : la photo au large chez Esri) ; un
 * refus passager (429 trop de requêtes, 503 indisponible…) n'en est pas un.
 */
export const isAbsentStatus = (status: number): boolean => status === 404 || status === 410;

/** Tuile demandée au serveur, abandonnée au-delà de `TILE_CACHE_DEFAULTS.fetchTimeoutMs` ou quand `signal` est coupé. */
const fetchTile = async (url: string, signal: AbortSignal): Promise<FetchedTile> => {
  const controller = new AbortController();
  const stop = () => controller.abort();
  const timer = setTimeout(stop, TILE_CACHE_DEFAULTS.fetchTimeoutMs);
  signal.addEventListener('abort', stop, { once: true });
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return isAbsentStatus(response.status) ? 'absent' : 'echec';
    // Lue en entier avant d'être rendue : une requête coupée en route ne laisse rien à garder.
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : 'echec';
  } catch {
    return 'echec';
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
};

/**
 * Tuile prête à dessiner sur un canevas : seule lecture d'une tuile en image
 * (découpe d'une parente, image de partage, vignettes).
 */
export const tileImage = (content: TileContent): Promise<HTMLImageElement | ImageBitmap> => {
  if (typeof content !== 'string' && typeof createImageBitmap === 'function') return createImageBitmap(content);
  return new Promise((resolve, reject) => {
    const url = typeof content === 'string' ? content : URL.createObjectURL(content);
    const release = () => { if (typeof content !== 'string') URL.revokeObjectURL(url); };
    const image = new Image();
    image.onload = () => { release(); resolve(image); };
    image.onerror = () => { release(); reject(new Error('tuile illisible')); };
    image.src = url;
  });
};

/** Case d'une parente agrandie, en URL de données (la couche Leaflet la pose telle quelle). */
const cropAncestor = async (blob: Blob, ancestor: AncestorTile, size: number): Promise<string | null> => {
  try {
    const image = await tileImage(blob);
    const part = ('naturalWidth' in image ? image.naturalWidth : image.width) / ancestor.scale;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d')?.drawImage(image, ancestor.col * part, ancestor.row * part, part, part, 0, 0, size, size);
    if ('close' in image) image.close();
    return canvas.toDataURL();
  } catch {
    return null;
  }
};

const resolver = createTileResolver({
  store: tileStore,
  keep: keepTile,
  fetchTile,
  isOnline: () => navigator.onLine !== false,
  crop: cropAncestor,
  now: () => Date.now(),
});

/** Ce qu'une case de la carte affiche : une tuile (gardée ou reçue), un agrandissement, ou rien. */
export const resolveTile = resolver.resolveTile;

/**
 * Tuile d'un fond hors de Leaflet (image de partage, vignettes) : gardée,
 * reçue ou agrandie, comme sur la carte, et gardée à son tour si elle est
 * reçue.
 */
export const loadMapTile = (coords: TileCoord, base: MapBase, signal?: AbortSignal): Promise<TileContent | null> =>
  resolver.resolveTile(coords, base, 256, signal);
