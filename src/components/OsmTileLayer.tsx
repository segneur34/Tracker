import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ancestorTile, isStale, TILE_CACHE_DEFAULTS, tileKey, type TileCoord } from '../core/tiles';
import { noteTileSaved } from '../hooks/useTileCache';
import { tileStore } from '../platform/tileCache';

/**
 * Fond de carte OpenStreetMap, commun à toutes les cartes de l'application,
 * avec la mention « © OpenStreetMap » qu'exigent les conditions d'usage des
 * tuiles et des données (et celles du calcul d'itinéraire, qui repose sur
 * elles). La mention de Leaflet, facultative, est retirée pour qu'elle tienne
 * même sur l'aperçu de la bibliothèque.
 *
 * Cartes sans réseau : chaque tuile affichée en ligne est gardée sur
 * l'appareil (`platform/tileCache.ts`) et relue ensuite, même sans réseau ;
 * une tuile gardée qui a vieilli est montrée aussitôt, puis redemandée en
 * arrière-plan. Une tuile jamais vue, hors réseau, est remplacée par
 * l'agrandissement d'une tuile gardée des zooms inférieurs (jusqu'à
 * `overzoomDepth`), floue mais lisible, plutôt que par une case vide. Les règles
 * d'OSM interdisent de télécharger une zone à l'avance : rien n'est demandé
 * au serveur qui n'ait été affiché.
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
const resolveTile = async (coords: TileCoord, url: string, size: number): Promise<Blob | string | null> => {
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

class CachedTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    const size = this.getTileSize().x;
    void resolveTile({ z: coords.z, x: coords.x, y: coords.y }, this.getTileUrl(coords), size).then((content) => {
      if (content === null) {
        done(new Error('tuile absente'), tile);
        return;
      }
      const src = typeof content === 'string' ? content : URL.createObjectURL(content);
      const release = () => { if (typeof content !== 'string') URL.revokeObjectURL(src); };
      tile.onload = () => { release(); done(undefined, tile); };
      tile.onerror = () => { release(); done(new Error('tuile illisible'), tile); };
      tile.src = src;
    });
    return tile;
  }
}

function OsmTileLayer() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
    const layer = new CachedTileLayer(OSM_TILE_URL, { attribution: OSM_ATTRIBUTION }).addTo(map);
    return () => {
      layer.remove();
    };
  }, [map]);
  return null;
}

export default OsmTileLayer;
