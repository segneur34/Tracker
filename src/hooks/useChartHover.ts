import { useEffect, useSyncExternalStore } from 'react';

/**
 * Point de trace survolé sur un graphe, hors de l'état des modules (27/10) :
 * le survol ne redessine que ce qui le lit, le repère de la carte
 * (`HoveredTrackMarker`) et les lectures au-dessus des graphes
 * (`HoverReadout`), et non toute la page d'analyse, ses panneaux, ses graphes
 * et ses couches Leaflet. Un seul point pour toute l'application : il n'y a
 * jamais qu'une analyse ouverte à la fois, et le module l'efface quand il
 * change de session ou se démonte (`useResetChartHover`).
 */

let hovered: number | null = null;
const listeners = new Set<() => void>();

/** Pose le point survolé (`null` : aucun) ; les abonnés ne sont prévenus que s'il change. */
export const setHoveredIndex = (index: number | null): void => {
  if (index === hovered) return;
  hovered = index;
  listeners.forEach((listener) => listener());
};

export const getHoveredIndex = (): number | null => hovered;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Le point survolé, pour ce qui doit le suivre (repère de la carte, lectures). */
export const useHoveredIndex = (): number | null => useSyncExternalStore(subscribe, getHoveredIndex, getHoveredIndex);

/** Efface le point survolé quand `key` change (autre session) et au démontage du module. */
export const useResetChartHover = (key: unknown): void => {
  useEffect(() => {
    setHoveredIndex(null);
    return () => setHoveredIndex(null);
  }, [key]);
};
