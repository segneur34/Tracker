import { useContext, useState, type ReactNode } from 'react';
import L from 'leaflet';
import { pathLayerOptions } from './layerProps';
import { LayerContext, PaneContext, useLayer, useOnChange } from './mapContext';

/**
 * Traits et ronds de la carte, sur `leaflet` seul. La couche est créée au
 * premier rendu, avec son style, son calque et son rayon, puis posée sur la
 * carte (`useLayer`) ; ensuite, elle n'est jamais recréée (elle repasserait
 * au-dessus des autres) : positions, rayon et style se mettent à jour quand
 * leur objet change (`setLatLngs`, `setRadius`, `setStyle`). Le style passe
 * toujours par `pathOptions`, et le garder le même objet d'un rendu à l'autre
 * (constante ou `useMemo`) évite de le réappliquer pour rien.
 * `children` : la bulle (`Popup`) du trait ou du rond.
 */

type Positions = L.LatLngExpression[] | L.LatLngExpression[][];

export function Polyline({ positions, pathOptions, eventHandlers, children }: {
  positions: Positions;
  pathOptions?: L.PathOptions;
  eventHandlers?: L.LeafletEventHandlerFnMap;
  children?: ReactNode;
}) {
  const pane = useContext(PaneContext);
  const [layer] = useState(() => L.polyline(positions, pathLayerOptions(pathOptions, pane)));
  useLayer(layer, eventHandlers);
  useOnChange(positions, (next) => layer.setLatLngs(next));
  useOnChange(pathOptions, (next) => layer.setStyle(next ?? {}));
  return children ? <LayerContext value={layer}>{children}</LayerContext> : null;
}

/** Rond de rayon `radius` en pixels, le même à tous les zooms. */
export function CircleMarker({ center, radius, pathOptions, children }: {
  center: L.LatLngExpression;
  radius: number;
  pathOptions?: L.PathOptions;
  children?: ReactNode;
}) {
  const pane = useContext(PaneContext);
  const [layer] = useState(() => L.circleMarker(center, pathLayerOptions(pathOptions, pane, radius)));
  useLayer(layer);
  useOnChange(center, (next) => layer.setLatLng(next));
  useOnChange(pathOptions, (next) => layer.setStyle(next ?? {}));
  useOnChange(radius, (next) => layer.setRadius(next));
  return children ? <LayerContext value={layer}>{children}</LayerContext> : null;
}

/** Cercle de rayon `radius` en mètres, sur le terrain. */
export function Circle({ center, radius, pathOptions }: {
  center: L.LatLngExpression;
  radius: number;
  pathOptions?: L.PathOptions;
}) {
  const pane = useContext(PaneContext);
  const [layer] = useState(() => L.circle(center, pathLayerOptions(pathOptions, pane, radius)));
  useLayer(layer);
  useOnChange(center, (next) => layer.setLatLng(next));
  useOnChange(pathOptions, (next) => layer.setStyle(next ?? {}));
  useOnChange(radius, (next) => layer.setRadius(next));
  return null;
}
