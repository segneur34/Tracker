import { CircleMarker } from 'react-leaflet';
import { useHoveredIndex } from '../hooks/useChartHover';

/**
 * Repère du survol d'un graphe sur la carte, le même partout (analyses,
 * planification) : un rond blanc cerclé de noir, posé sur le point de trace
 * survolé. Couleurs de données, en dur comme celles de la trace.
 */
function HoverMarker({ position }: { position: [number, number] }) {
  return (
    <CircleMarker
      center={position}
      radius={8}
      pathOptions={{ color: '#1b1f24', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }} />
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
