import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { OSM_ATTRIBUTION, OSM_TILE_URL, resolveTile } from './mapTiles';

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
