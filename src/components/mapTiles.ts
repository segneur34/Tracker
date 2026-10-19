import L from 'leaflet';
import { ancestorTile, isStale, TILE_CACHE_DEFAULTS, tileKey, type TileCoord } from '../core/tiles';
import { noteTileSaved } from '../hooks/useTileCache';
import { tileStore } from '../platform/tileCache';

/**
 * Tuiles du fond OpenStreetMap, gardées sur l'appareil ou reçues du serveur,
 * pour la couche Leaflet (`OsmTileLayer.tsx`, où sont décrites les règles du
 * cache) et pour l'image de partage d'une session (`drawShareImage.ts`).
 */

export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const isOnline = (): boolean => navigator.onLine !== false;

/** Tuile demandée au serveur, `null` en cas d'échec ou d'attente trop longue. */
const fetchTile = async (url: string): Promise<Blob | null> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TILE_CACHE_DEFAULTS.fetchTimeoutMs);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.type.startsWith('image/') ? blob : null;
  } catch {
    return null;
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

/** Case de `coords` découpée dans la tuile gardée la plus proche des zooms inférieurs, en image. */
const overzoomedTile = async (coords: TileCoord, size: number): Promise<string | null> => {
  for (let depth = 1; depth <= TILE_CACHE_DEFAULTS.overzoomDepth; depth++) {
    const ancestor = ancestorTile(coords, depth);
    if (!ancestor) return null;
    const stored = await tileStore.read(tileKey(ancestor.tile));
    if (!stored) continue;
    try {
      const image = await loadImage(stored.blob);
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
export const resolveTile = async (coords: TileCoord, url: string, size: number): Promise<Blob | string | null> => {
  const key = tileKey(coords);
  const stored = await tileStore.read(key);
  if (stored) {
    if (isOnline() && isStale(stored.savedAtMs, Date.now(), TILE_CACHE_DEFAULTS.refreshAgeMs)) {
      void fetchTile(url).then((fresh) => fresh && keep(key, fresh));
    }
    return stored.blob;
  }
  if (isOnline()) {
    const fresh = await fetchTile(url);
    if (fresh) {
      void keep(key, fresh);
      return fresh;
    }
  }
  return overzoomedTile(coords, size);
};

/**
 * Tuile du fond hors de Leaflet (image de partage d'une session) : gardée,
 * reçue ou agrandie, comme sur la carte, et gardée à son tour si elle est
 * reçue. Même sous-domaine que Leaflet, pour la même adresse.
 */
export const loadMapTile = (coords: TileCoord): Promise<Blob | string | null> =>
  resolveTile(coords, L.Util.template(OSM_TILE_URL, { s: 'abc'[(coords.x + coords.y) % 3], ...coords }), 256);
