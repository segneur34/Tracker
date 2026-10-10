import { useMemo } from 'react';
import { CircleMarker, Polyline } from 'react-leaflet';
import { surfaceHighlight, type SurfaceCategory, type SurfacePath } from '../planning/surface';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';

/**
 * Revêtement choisi dans la barre (`SurfaceBar`), en surbrillance sur la
 * carte : ses morceaux en violet, comme une zone de pente, et un rond au
 * milieu de chaque morceau trop court pour se voir seul, pour que quelques
 * mètres se retrouvent sur une grande boucle (`surfaceHighlight`). Analyse
 * (course, vélo) et planification.
 */
function SurfaceHighlight({ paths, category }: { paths: ReadonlyArray<SurfacePath>; category: SurfaceCategory }) {
  const { lines, marks } = useMemo(() => surfaceHighlight(paths, category), [paths, category]);
  return (
    <>
      {lines.map((positions, idx) => (
        <Polyline key={`surface-shown-${category}-${idx}`} positions={positions}
          pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8, interactive: false }} />
      ))}
      {marks.map((center, idx) => (
        <CircleMarker key={`surface-mark-${category}-${idx}`} center={center} radius={9}
          pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 3, fillColor: '#ffffff', fillOpacity: 0.6, interactive: false }} />
      ))}
    </>
  );
}

export default SurfaceHighlight;
