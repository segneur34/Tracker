import { useState, type ReactNode } from 'react';
import { PaneContext, useMap } from './mapContext';

/**
 * Calque nommé de la carte (`map.createPane`), à la hauteur `style.zIndex` :
 * les traits et repères enfants s'y posent, quel que soit l'ordre où ils
 * naissent (Leaflet : 400 pour les tracés, 600 pour les repères). Créé une
 * fois par carte, au premier rendu, et jamais retiré : un calque vidé reste,
 * prêt pour la prochaine fois ; la carte l'emporte en disparaissant.
 */
function Pane({ name, style, children }: { name: string; style?: { zIndex?: number }; children?: ReactNode }) {
  const map = useMap();
  useState(() => {
    if (map.getPane(name)) return;
    const pane = map.createPane(name);
    if (style?.zIndex !== undefined) pane.style.zIndex = String(style.zIndex);
  });
  return <PaneContext value={name}>{children}</PaneContext>;
}

export default Pane;
