import { useEffect, useSyncExternalStore } from 'react';
import { createListeners } from './createStore';

/**
 * Point de trace survolé sur un graphe, hors de l'état des modules (27/10) :
 * le survol ne redessine que ce qui le lit, le repère de la carte
 * (`HoveredTrackMarker`) et les lectures au-dessus des graphes
 * (`HoverReadout`), et non toute la page d'analyse, ses panneaux, ses graphes
 * et ses couches Leaflet. Un seul point pour toute l'application : il n'y a
 * jamais qu'une analyse ouverte à la fois, et le module l'efface quand il
 * change de session ou se démonte (`useResetChartHover`).
 */

/** Valeur survolée d'un graphe, hors de l'état React : seuls ses lecteurs se redessinent. */
export interface HoverStore<T> {
  /** Pose la valeur (`null` : aucune) ; les abonnés ne sont prévenus que si elle change. */
  set: (value: T | null) => void;
  get: () => T | null;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Magasin d'une valeur survolée : celui du point de trace, commun à toute
 * l'application, et ceux d'un graphe qui lit son survol lui-même (profil des
 * répétitions, courbe des sauts), pour que le doigt qui glisse ne redessine
 * que la lecture, pas le graphe.
 */
export const createHoverStore = <T>(): HoverStore<T> => {
  let value: T | null = null;
  const listeners = createListeners();
  return {
    set: (next) => {
      if (next === value) return;
      value = next;
      listeners.notify();
    },
    get: () => value,
    subscribe: listeners.subscribe,
  };
};

/** La valeur d'un magasin du survol, pour ce qui doit la suivre. */
export const useHoverStore = <T>(store: HoverStore<T>): T | null => useSyncExternalStore(store.subscribe, store.get, store.get);

const trackStore = createHoverStore<number>();

/** Pose le point survolé (`null` : aucun) ; les abonnés ne sont prévenus que s'il change. */
export const setHoveredIndex = (index: number | null): void => trackStore.set(index);

export const getHoveredIndex = (): number | null => trackStore.get();

/** Le point survolé, pour ce qui doit le suivre (repère de la carte, lectures). */
export const useHoveredIndex = (): number | null => useHoverStore(trackStore);

/** Efface le point survolé quand `key` change (autre session) et au démontage du module. */
export const useResetChartHover = (key: unknown): void => {
  useEffect(() => {
    setHoveredIndex(null);
    return () => setHoveredIndex(null);
  }, [key]);
};
