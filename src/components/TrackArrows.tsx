import L from 'leaflet';
import { memo, useMemo, useState } from 'react';
import Marker from './map/Marker';
import { useMap, useMapEvents } from './map/mapContext';
import { ARROW_MAX, ARROW_SPACING_PX, arrowIndicesBySpacing, metersPerPixel } from '../core/displayConfig';

/** Icônes de flèche de sens, une par degré, faites une fois pour toutes les traces. */
const arrowIcons = new Map<number, L.DivIcon>();
const arrowIcon = (bearing: number) => {
  const deg = ((Math.round(bearing) % 360) + 360) % 360;
  let icon = arrowIcons.get(deg);
  if (!icon) {
    icon = L.divIcon({
      className: 'custom-arrow',
      html: `<svg width="12" height="12" viewBox="0 0 24 24" style="transform: rotate(${deg}deg); display: block;">
               <path d="M12 0L24 24L12 18L0 24Z" fill="#222" stroke="#fff" stroke-width="2"/>
             </svg>`,
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    arrowIcons.set(deg, icon);
  }
  return icon;
};

type ArrowPoint = { lat: number; lon: number; bearing: number; segmentStart?: true };

/** Latitude moyenne d'une trace, pour l'échelle de la carte ; 0 sans point. */
const meanLat = (track: ReadonlyArray<{ lat: number }>): number => {
  let sum = 0;
  for (const point of track) sum += point.lat;
  return track.length > 0 ? sum / track.length : 0;
};

/**
 * Flèches de sens sur la trace d'une analyse (voile, course, vélo, fractionné,
 * surf ; 05/11) : à peu près `ARROW_SPACING_PX` pixels entre deux à l'écran,
 * donc moins en dézoomant et plus en zoomant, au plus `ARROW_MAX`. Recalculées
 * à la fin d'un zoom (`zoomend`), au cran entier ; une flèche gardée d'un zoom
 * à l'autre n'est pas reposée (clé : son point de trace).
 */
function TrackArrows({ track, spacingPx = ARROW_SPACING_PX, maxCount = ARROW_MAX }: {
  track: ReadonlyArray<ArrowPoint>;
  spacingPx?: number;
  maxCount?: number;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => Math.round(map.getZoom()));
  useMapEvents({ zoomend: () => setZoom(Math.round(map.getZoom())) });
  const lat = useMemo(() => meanLat(track), [track]);
  const indices = useMemo(
    () => arrowIndicesBySpacing(track, spacingPx * metersPerPixel(zoom, lat), maxCount),
    [track, spacingPx, zoom, lat, maxCount]
  );
  return (
    <>
      {indices.map((index) => {
        const point = track[index];
        return <Marker key={index} position={[point.lat, point.lon]} icon={arrowIcon(point.bearing)} interactive={false} keyboard={false} />;
      })}
    </>
  );
}

export default memo(TrackArrows);
