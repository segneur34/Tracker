import { useEffect, useState } from 'react';
import L from 'leaflet';
import { useMap } from './mapContext';

/**
 * Commande posée dans un coin de la carte (`L.Control`), dont le contenu est
 * rendu par React dans l'élément rendu (`createPortal`). Un toucher ou la
 * molette sur la commande ne vont pas à la carte : ni plein écran, ni point
 * posé, ni zoom. Les commandes d'un même coin s'empilent dans l'ordre où elles
 * sont posées (le haut d'abord). Retirée avec le composant.
 */
export function useMapControl(className: string, position: L.ControlPosition = 'topleft'): HTMLElement {
  const map = useMap();
  const [container] = useState(() => {
    const element = L.DomUtil.create('div', className);
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  });
  useEffect(() => {
    const control = new L.Control({ position });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container, position]);
  return container;
}
