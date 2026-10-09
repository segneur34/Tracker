import { CircleMarker } from 'react-leaflet';

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

export default HoverMarker;
