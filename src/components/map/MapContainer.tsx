import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import L from 'leaflet';
import { MapContext } from './mapContext';
import { attachRotation, type MapRotation } from './rotation';

interface MapContainerProps {
  /** Centre et zoom de départ ; sinon, l'emprise `bounds` cadrée par `boundsOptions`. Lus à la création seulement. */
  center?: L.LatLngExpression;
  zoom?: number;
  bounds?: L.LatLngBoundsExpression;
  boundsOptions?: L.FitBoundsOptions;
  className?: string;
  /**
   * Carte qui peut tourner à l'écran (`rotation.ts`, lue par `rotationOf`), droite au départ ; lu à la création
   * seulement. Faux par défaut : la carte est celle de Leaflet, sans rien autour.
   */
  rotatable?: boolean;
  /** Reçoit la carte Leaflet une fois créée, `null` à sa disparition. */
  ref?: Ref<L.Map | null>;
  /** Couches et commandes de la carte, qui la lisent par `useMap`. */
  children?: ReactNode;
}

/**
 * Carte Leaflet dans une `div`, qui passe la carte à ses enfants par contexte
 * (`useMap`). Centre, zoom et emprise ne servent qu'à la création : une autre
 * trace remonte la carte par une `key` neuve, et la carte garde sinon le
 * cadrage que l'utilisateur lui a donné. Les enfants ne sont rendus qu'une
 * fois la carte cadrée : ils peuvent lire son zoom dès leur premier rendu.
 */
function MapContainer({ center, zoom, bounds, boundsOptions, className, rotatable = false, ref, children }: MapContainerProps) {
  const [map, setMap] = useState<L.Map | null>(null);
  const initialView = useRef({ center, zoom, bounds, boundsOptions, rotatable });
  const created = useRef<L.Map | null>(null);
  const rotation = useRef<MapRotation | null>(null);
  // React peut rappeler la fonction de ref (double montage du mode strict) : une seule carte par `div`.
  const attach = useCallback((div: HTMLDivElement | null) => {
    if (!div || created.current) return;
    const view = initialView.current;
    const next = L.map(div);
    if (view.rotatable) rotation.current = attachRotation(next);
    if (view.center !== undefined && view.zoom !== undefined) next.setView(view.center, view.zoom);
    else if (view.bounds) next.fitBounds(view.bounds, view.boundsOptions);
    created.current = next;
    setMap(next);
  }, []);
  useEffect(() => () => {
    // Le premier rendu, sans carte, n'a rien à défaire : la rotation posée à la création reste.
    if (!map) return;
    rotation.current?.dispose();
    rotation.current = null;
    map.remove();
  }, [map]);
  useImperativeHandle<L.Map | null, L.Map | null>(ref, () => map, [map]);
  return (
    <div className={className} ref={attach}>
      {map && <MapContext value={map}>{children}</MapContext>}
    </div>
  );
}

export default MapContainer;
