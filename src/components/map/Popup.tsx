import { useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { LayerContext } from './mapContext';

/**
 * Bulle d'un trait, d'un rond ou d'un repère, ouverte quand on le touche :
 * à poser comme enfant de `Polyline`, `CircleMarker` ou `Marker`. Son contenu
 * React est rendu dans un élément à elle, que Leaflet place dans la bulle à
 * son ouverture ; fermée, la bulle n'est pas dans la page. Un contenu qui
 * change pendant qu'elle est ouverte la remet à sa taille.
 */
function Popup({ children }: { children?: ReactNode }) {
  const parent = useContext(LayerContext);
  if (!parent) throw new Error('Popup : à poser dans un trait, un rond ou un repère');
  const [content] = useState(() => document.createElement('div'));
  const [popup] = useState(() => L.popup().setContent(content));
  useEffect(() => {
    parent.bindPopup(popup);
    return () => {
      parent.unbindPopup();
      popup.close();
    };
  }, [parent, popup]);
  useEffect(() => {
    if (popup.isOpen()) popup.update();
  }, [popup, children]);
  return createPortal(children, content);
}

export default Popup;
