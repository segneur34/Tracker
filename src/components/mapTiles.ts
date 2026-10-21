import { MAP_BASES, tileUrl, type MapBase } from '../core/mapBase';
import { ancestorTile, isStale, TILE_CACHE_DEFAULTS, tileKey, type TileCoord } from '../core/tiles';
import { noteTileSaved } from '../hooks/useTileCache';
import { tileStore } from '../platform/tileCache';

/**
 * Tuiles d'un fond de carte (`core/mapBase.ts`), gardées sur l'appareil ou
 * reçues du serveur, pour la couche Leaflet (`BaseTileLayer.tsx`, où sont
 * décrites les règles du cache) et pour l'image de partage d'une session
 * (`drawShareImage.ts`).
 */

const isOnline = (): boolean => navigator.onLine !== false;

/**
 * Tuile demandée au serveur : l'image, `'absent'` si le serveur ne l'a pas
 * (404, ou autre chose qu'une image), `'echec'` sans réponse à temps.
 */
const fetchTile = async (url: string): Promise<Blob | 'absent' | 'echec'> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TILE_CACHE_DEFAULTS.fetchTimeoutMs);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return 'absent';
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : 'absent';
  } catch {
    return 'echec';
  } finally {
    window.clearTimeout(timer);
  }
};

const keep = async (key: string, blob: Blob): Promise<void> => {
  await tileStore.write(key, blob);
  noteTileSaved();
};

const loadImage = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('tuile illisible')); };
    image.src = url;
  });

/**
 * Parentes demandées au serveur, en cours ou reçues le temps de la page : les
 * cases voisines d'une tuile absente partagent la même parente, demandée une
 * fois.
 */
const ancestorRequests = new Map<string, Promise<Blob | null>>();

/** Tuile parente : gardée, sinon demandée au serveur si le fond le permet et le réseau répond. */
const ancestorBlob = async (tile: TileCoord, base: MapBase): Promise<Blob | null> => {
  const key = tileKey(tile, MAP_BASES[base].keyPrefix);
  const stored = await tileStore.read(key);
  if (stored) return stored.blob;
  if (!MAP_BASES[base].fetchAncestors || !isOnline()) return null;
  let request = ancestorRequests.get(key);
  if (!request) {
    request = fetchTile(tileUrl(base, tile)).then((fresh) => {
      if (typeof fresh === 'string') return null;
      void keep(key, fresh);
      return fresh;
    });
    ancestorRequests.set(key, request);
    // Une parente reçue est gardée sur l'appareil : la requête n'a pas à rester en mémoire.
    void request.finally(() => ancestorRequests.delete(key));
  }
  return request;
};

/** Case de `coords` découpée dans la tuile la plus proche des zooms inférieurs, en image. */
const overzoomedTile = async (coords: TileCoord, size: number, base: MapBase): Promise<string | null> => {
  for (let depth = 1; depth <= MAP_BASES[base].overzoomDepth; depth++) {
    const ancestor = ancestorTile(coords, depth);
    if (!ancestor) return null;
    const blob = await ancestorBlob(ancestor.tile, base);
    if (!blob) continue;
    try {
      const image = await loadImage(blob);
      const part = image.naturalWidth / ancestor.scale;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d')?.drawImage(image, ancestor.col * part, ancestor.row * part, part, part, 0, 0, size, size);
      return canvas.toDataURL();
    } catch {
      continue;
    }
  }
  return null;
};

/** Ce qu'une case affiche : une tuile (gardée ou reçue), un agrandissement, ou rien. */
export const resolveTile = async (coords: TileCoord, base: MapBase, size: number): Promise<Blob | string | null> => {
  const key = tileKey(coords, MAP_BASES[base].keyPrefix);
  const url = tileUrl(base, coords);
  const stored = await tileStore.read(key);
  if (stored) {
    if (isOnline() && isStale(stored.savedAtMs, Date.now(), TILE_CACHE_DEFAULTS.refreshAgeMs)) {
      void fetchTile(url).then((fresh) => {
        if (typeof fresh !== 'string') void keep(key, fresh);
      });
    }
    return stored.blob;
  }
  if (isOnline()) {
    const fresh = await fetchTile(url);
    if (typeof fresh !== 'string') {
      void keep(key, fresh);
      return fresh;
    }
  }
  return overzoomedTile(coords, size, base);
};

/**
 * Tuile d'un fond hors de Leaflet (image de partage d'une session) : gardée,
 * reçue ou agrandie, comme sur la carte, et gardée à son tour si elle est
 * reçue.
 */
export const loadMapTile = (coords: TileCoord, base: MapBase): Promise<Blob | string | null> => resolveTile(coords, base, 256);
