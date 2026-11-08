import { CircleMarker } from './map/paths';
import { useHoveredIndex } from '../hooks/useChartHover';
import { HOVER_MARKER_COLOR } from './mapStyles';

/**
 * Repère du survol d'un graphe sur la carte, le même partout (analyses,
 * planification) : un rond blanc cerclé de noir, posé sur le point de trace
 * survolé.
 */
function HoverMarker({ position }: { position: [number, number] }) {
  return (
    <CircleMarker
      center={position}
      radius={8}
      pathOptions={{ color: HOVER_MARKER_COLOR.stroke, weight: 3, fillColor: HOVER_MARKER_COLOR.fill, fillOpacity: 1 }} />
  );
}

/**
 * Le repère posé sur le point survolé de `points`, lu dans le magasin du
 * survol (`useChartHover`) : seul ce composant se redessine quand le doigt
 * glisse sur un graphe, pas la carte ni ses autres couches. Rien sans point.
 */
export function HoveredTrackMarker({ points }: { points: ReadonlyArray<{ lat: number; lon: number }> }) {
  const index = useHoveredIndex();
  const point = index === null ? undefined : points[index];
  return point ? <HoverMarker position={[point.lat, point.lon]} /> : null;
}

export default HoverMarker;
