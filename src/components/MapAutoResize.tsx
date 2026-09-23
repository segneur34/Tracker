import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/**
 * Leaflet fige la taille de la carte à sa création. Quand le panneau qui la
 * contient est redimensionné, il faut le lui signaler, sinon les tuiles ne
 * couvrent plus toute la surface. À placer comme enfant du `MapContainer`.
 */
function MapAutoResize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  return null;
}

export default MapAutoResize;
