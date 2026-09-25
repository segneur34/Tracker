import { useEffect } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

/**
 * Fond de carte OpenStreetMap, commun à toutes les cartes de l'application,
 * avec la mention « © OpenStreetMap » qu'exigent les conditions d'usage des
 * tuiles et des données (et celles du calcul d'itinéraire, qui repose sur
 * elles). La mention de Leaflet, facultative, est retirée pour qu'elle tienne
 * même sur l'aperçu de la bibliothèque.
 */

export const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function OsmTileLayer() {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix(false);
  }, [map]);
  return <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />;
}

export default OsmTileLayer;
