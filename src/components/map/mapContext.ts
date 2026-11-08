import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { Layer, LeafletEvent, LeafletEventHandlerFnMap, Map as LeafletMap } from 'leaflet';
import { eventNamesKey } from './layerProps';

/**
 * Contextes et crochets des composants de carte maison (`components/map/`),
 * écrits sur `leaflet` seul. Chaque carte passe la sienne à ses couches par
 * contexte, jamais par une variable de module : plusieurs cartes vivent en
 * même temps (analyse et vue agrandie, direct et planification).
 */

/** La carte Leaflet qui contient le composant ; `null` hors d'un `MapContainer`. */
export const MapContext = createContext<LeafletMap | null>(null);

/** Nom du calque (`Pane`) qui entoure le composant ; sans lui, celui que Leaflet donne à la couche. */
export const PaneContext = createContext<string | undefined>(undefined);

/** Couche qui porte le composant : celle d'un trait ou d'un repère, à qui un `Popup` se rattache. */
export const LayerContext = createContext<Layer | null>(null);

/** La carte qui contient le composant ; une erreur hors d'un `MapContainer`. */
export function useMap(): LeafletMap {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap : composant hors d\'une carte (MapContainer)');
  return map;
}

type AnyHandler = (event: LeafletEvent) => void;

/**
 * Écoute des événements de la carte (`click`, `moveend`…) ; les
 * gestionnaires peuvent changer à chaque rendu, le dernier donné est appelé.
 * La carte n'est rebranchée que si la liste des noms change. Rend la carte.
 */
export function useMapEvents(handlers: LeafletEventHandlerFnMap): LeafletMap {
  const map = useMap();
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const names = eventNamesKey(handlers);
  useEffect(() => {
    if (!names) return undefined;
    const listeners = names.split(' ').map((name): [string, AnyHandler] => [
      name,
      (event) => (latest.current as Record<string, AnyHandler | undefined>)[name]?.(event),
    ]);
    for (const [name, listener] of listeners) map.on(name, listener);
    return () => {
      for (const [name, listener] of listeners) map.off(name, listener);
    };
  }, [map, names]);
  return map;
}

/**
 * Pose `layer` sur la carte du contexte tant que le composant vit, et y
 * branche `eventHandlers` (débranchés et rebranchés quand l'objet change).
 * L'ajout se fait dans un effet : React passe les enfants avant leur parent,
 * les frères dans l'ordre, si bien que les couches s'empilent dans l'ordre du
 * rendu, et qu'une couche montée plus tard passe au-dessus.
 */
export function useLayer(layer: Layer, eventHandlers?: LeafletEventHandlerFnMap): LeafletMap {
  const map = useMap();
  useEffect(() => {
    map.addLayer(layer);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, layer]);
  useEffect(() => {
    if (!eventHandlers) return undefined;
    layer.on(eventHandlers);
    return () => {
      layer.off(eventHandlers);
    };
  }, [layer, eventHandlers]);
  return map;
}

/**
 * Appelle `apply` quand `value` change d'un rendu à l'autre, comparé à la
 * référence ; rien au premier rendu, où la couche a été créée avec cette
 * valeur. Un objet neuf à chaque rendu est donc réappliqué à chaque rendu.
 */
export function useOnChange<T>(value: T, apply: (value: T) => void): void {
  const applied = useRef(value);
  useEffect(() => {
    if (applied.current === value) return;
    applied.current = value;
    apply(value);
  });
}
