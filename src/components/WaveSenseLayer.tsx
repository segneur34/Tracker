import { useMemo, useState } from 'react';
import type { PathOptions } from 'leaflet';
import { Polygon, Polyline } from './map/paths';
import { useMap, useMapEvents } from './map/mapContext';
import { SURF_MAP_INK_COLOR } from './highlightColors';
import { metersPerPixel } from '../core/displayConfig';
import type { PeakZone } from '../surfing/peakZone';
import { waveSenseMarks } from '../surfing/waveSenseMarks';

/** Styles constants (règle 11), à l'encre de la zone du pic, sans interaction ; la classe sert au banc. */
const LINE_STYLE: PathOptions = { color: SURF_MAP_INK_COLOR, weight: 1.5, lineCap: 'round', interactive: false, className: 'an-sens-vagues' };
const SHAFT_STYLE: PathOptions = { color: SURF_MAP_INK_COLOR, weight: 2, lineCap: 'butt', interactive: false, className: 'an-sens-vagues' };
const HEAD_STYLE: PathOptions = {
  color: SURF_MAP_INK_COLOR, weight: 0, fillColor: SURF_MAP_INK_COLOR, fillOpacity: 1, interactive: false, className: 'an-sens-vagues',
};

const toPair = (p: { lat: number; lon: number }): [number, number] => [p.lat, p.lon];

/**
 * Sens des vagues sur la carte de l'analyse surf : une ligne de vague côté
 * large de la zone du pic et une flèche du centre de la zone vers la plage
 * (`waveSenseMarks`). Les longueurs de la flèche sont fixes en pixels :
 * converties en mètres d'après le zoom, recalculées à la fin de chaque zoom,
 * comme les flèches de la trace. Rien sans zone ni sans sens.
 */
function WaveSenseLayer({ zone, directionDeg }: { zone: PeakZone | null; directionDeg: number | null }) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const lat = zone?.center.lat ?? 0;
  const positions = useMemo(() => {
    if (!zone || directionDeg === null) return null;
    const marks = waveSenseMarks(zone, directionDeg, metersPerPixel(zoom, lat));
    return { line: marks.line.map(toPair), shaft: marks.shaft.map(toPair), head: marks.head.map(toPair) };
  }, [zone, directionDeg, zoom, lat]);
  if (!positions) return null;
  return (
    <>
      <Polyline positions={positions.line} pathOptions={LINE_STYLE} />
      <Polyline positions={positions.shaft} pathOptions={SHAFT_STYLE} />
      <Polygon positions={positions.head} pathOptions={HEAD_STYLE} />
    </>
  );
}

export default WaveSenseLayer;
