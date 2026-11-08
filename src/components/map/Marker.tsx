import { useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import L from 'leaflet';
import { definedOptions, markerChanges, type MarkerState } from './layerProps';
import { LayerContext, PaneContext, useLayer } from './mapContext';

/**
 * Repère de la carte (icône, fanion, balise, point d'itinéraire), sur
 * `leaflet` seul. Créé au premier rendu, sans les options non données (une
 * icône absente garde celle de Leaflet), puis posé sur la carte ; ensuite,
 * position, icône, décalage en hauteur et glisser se mettent à jour quand ils
 * changent, comparés à la référence. `interactive` et `keyboard` ne sont lus
 * qu'à la création. `ref` reçoit le repère Leaflet, déjà posé quand les
 * effets du parent passent (`getElement()` y trouve l'icône). `children` : sa
 * bulle (`Popup`).
 */
function Marker({ position, icon, interactive, keyboard, zIndexOffset, draggable, eventHandlers, ref, children }: {
  position: L.LatLngExpression;
  icon?: L.Icon | L.DivIcon;
  interactive?: boolean;
  keyboard?: boolean;
  zIndexOffset?: number;
  draggable?: boolean;
  eventHandlers?: L.LeafletEventHandlerFnMap;
  ref?: Ref<L.Marker>;
  children?: ReactNode;
}) {
  const pane = useContext(PaneContext);
  const [marker] = useState(() => L.marker(position, definedOptions({ icon, interactive, keyboard, zIndexOffset, draggable, pane })));
  useLayer(marker, eventHandlers);
  useImperativeHandle(ref, () => marker, [marker]);

  const state: MarkerState<L.Icon | L.DivIcon> = { position, icon, zIndexOffset, draggable };
  const applied = useRef(state);
  useEffect(() => {
    const changes = markerChanges(applied.current, state);
    applied.current = state;
    for (const change of changes) {
      if (change === 'position') marker.setLatLng(state.position);
      else if (change === 'icon') marker.setIcon(state.icon ?? new L.Icon.Default());
      else if (change === 'zIndexOffset') marker.setZIndexOffset(state.zIndexOffset ?? 0);
      else {
        // Le repère ne crée sa poignée qu'une fois posé : avant, l'option suffit.
        L.setOptions(marker, { draggable: state.draggable ?? false });
        if (state.draggable) marker.dragging?.enable();
        else marker.dragging?.disable();
      }
    }
  });

  return children ? <LayerContext value={marker}>{children}</LayerContext> : null;
}

export default Marker;
