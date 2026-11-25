import { useMemo } from 'react';
import type { PathOptions } from 'leaflet';
import { Polygon } from './map/paths';
import { SURF_MAP_INK_COLOR } from './highlightColors';
import { peakZoneOutline, type PeakZone } from '../surfing/peakZone';

/**
 * Style de la zone du pic : contour de 2 px en tirets, remplissage de la même
 * encre à 8 %. Sans interaction : elle ne capte ni clic ni survol, la
 * surbrillance et le survol de la trace passent au travers. La classe sert au banc.
 */
const ZONE_STYLE: PathOptions = {
  color: SURF_MAP_INK_COLOR, weight: 2, dashArray: '7 6', lineCap: 'butt',
  fillColor: SURF_MAP_INK_COLOR, fillOpacity: 0.08, interactive: false, className: 'an-zone-pic',
};

/** Zone du pic dessinée sur la carte de l'analyse surf ; à poser avant la trace pour qu'elle reste dessous. Rien sans zone. */
function PeakZoneLayer({ zone }: { zone: PeakZone | null }) {
  const positions = useMemo(
    () => (zone ? peakZoneOutline(zone).map((p): [number, number] => [p.lat, p.lon]) : null),
    [zone],
  );
  if (!positions) return null;
  return <Polygon positions={positions} pathOptions={ZONE_STYLE} />;
}

export default PeakZoneLayer;
