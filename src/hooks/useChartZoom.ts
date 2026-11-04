import { useMemo, useState, useSyncExternalStore } from 'react';
import { clampRange, sameRange, zoomViewOf, type XRange } from '../core/chartZoom';
import { CHART_ZOOM_MIN_FRACTION } from '../core/displayConfig';
import { createListeners } from './createStore';

/** Zoom d'un graphe, tel que `ZoomableChart` le lit et le change : l'instantané d'une source (`useZoomState`). */
export interface ChartZoom {
  /** Étendue complète de l'axe, `null` sans données. */
  full: XRange | null;
  /** Plage zoomée, ou `null` : tout voir. */
  view: XRange | null;
  /** Plage affichée : la plage zoomée, sinon l'étendue. */
  shown: XRange | null;
  /** Largeur minimale d'une plage, dans l'unité de l'axe. */
  minSpan: number;
  set: (next: XRange | null) => void;
  reset: () => void;
}

/**
 * Zoom d'un ou de plusieurs graphes qui partagent leur axe, hors de l'état du
 * module (lot 127) : une image de pincement ne redessine que ce qui le lit
 * (`ZoomView`, `useZoomState`), pas toute la page d'analyse, comme le survol
 * (`useChartHover`). Rendue stable tant que l'étendue et la session ne
 * changent pas : elle passe telle quelle à un panneau mémoïsé.
 */
export interface ChartZoomSource {
  /** Étendue complète de l'axe, `null` sans données. */
  full: XRange | null;
  /** Largeur minimale d'une plage, dans l'unité de l'axe. */
  minSpan: number;
  /**
   * Plage rangée (bornée à sa pose), `null` : tout voir ; la même référence
   * tant qu'elle ne change pas, instantané de `useSyncExternalStore`. La plage
   * affichée en vient par `zoomViewOf` (`currentZoomView`).
   */
  get: () => XRange | null;
  subscribe: (listener: () => void) => () => void;
  /** Pose la plage, bornée à l'étendue et à `minSpan` ; `null` : tout voir. */
  set: (next: XRange | null) => void;
  reset: () => void;
}

/** Plage rangée d'un zoom, avec la session (`resetKey`) où elle a été posée. */
export interface ChartZoomEntry {
  key: unknown;
  range: XRange | null;
}

/** Magasin d'un zoom : la dernière plage posée et sa session ; les abonnés ne sont prévenus que si l'une ou l'autre change. */
export interface ChartZoomStore {
  get: () => ChartZoomEntry;
  set: (key: unknown, range: XRange | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export const createChartZoomStore = (): ChartZoomStore => {
  let entry: ChartZoomEntry = { key: undefined, range: null };
  const listeners = createListeners();
  return {
    get: () => entry,
    set: (key, range) => {
      if (entry.key === key && sameRange(entry.range, range)) return;
      entry = { key, range };
      listeners.notify();
    },
    subscribe: listeners.subscribe,
  };
};

/**
 * Source d'un zoom sur un magasin, pour une étendue et une session : une
 * plage posée dans une autre session ne se lit pas (« tout voir » à chaque
 * session, comme avant le lot 127).
 */
export const chartZoomSource = (store: ChartZoomStore, full: XRange | null, resetKey: unknown): ChartZoomSource => {
  const minSpan = full ? (full.max - full.min) * CHART_ZOOM_MIN_FRACTION : 0;
  return {
    full,
    minSpan,
    get: () => {
      const entry = store.get();
      return entry.key === resetKey ? entry.range : null;
    },
    subscribe: store.subscribe,
    set: (next) => store.set(resetKey, next && full ? clampRange(next, full, minSpan) : null),
    reset: () => store.set(resetKey, null),
  };
};

/** Plage affichée d'une source à l'instant, hors rendu (clic de « Afficher », effacement du tronçon). */
export const currentZoomView = (source: ChartZoomSource): XRange | null => zoomViewOf(source.get(), source.full, source.minSpan);

/**
 * Zoom d'un axe, tenu hors de l'état React. Il reste dans l'étendue quand
 * celle-ci change (point ajouté à un itinéraire) et revient à « tout voir »
 * quand `resetKey` change (autre session). Le lire par `useZoomState` ou
 * `ZoomView`, au plus près des graphes.
 */
export const useChartZoomSource = (fullRange: XRange | null, resetKey?: unknown): ChartZoomSource => {
  const [store] = useState(createChartZoomStore);
  const fullMin = fullRange?.min;
  const fullMax = fullRange?.max;
  // Un seul objet tant que les bornes ne changent pas : `shown`, les `domain` des axes et le tronçon
  // d'« Afficher » (`useZoomOnMap`) ne sont pas refaits à chaque rendu (27/10).
  const full = useMemo(
    () => (fullMin === undefined || fullMax === undefined ? null : { min: fullMin, max: fullMax }),
    [fullMin, fullMax]
  );
  return useMemo(() => chartZoomSource(store, full, resetKey), [store, full, resetKey]);
};

/** L'instantané d'une source, qui suit le zoom : seul le composant qui l'appelle se redessine à chaque image. */
export const useZoomState = (source: ChartZoomSource): ChartZoom => {
  const raw = useSyncExternalStore(source.subscribe, source.get, source.get);
  const { full, minSpan, set, reset } = source;
  const view = useMemo(() => zoomViewOf(raw, full, minSpan), [raw, full, minSpan]);
  // Rendu stable tant que la plage ne change pas : un graphe mémoïsé qui le reçoit ne se redessine pas.
  return useMemo(() => ({ full, view, shown: view ?? full, minSpan, set, reset }), [full, view, minSpan, set, reset]);
};

/**
 * Zoom d'un graphe tenu par le composant qui le dessine (répétitions, sauts,
 * planification, statistiques) : la source et son instantané au même endroit.
 */
export const useChartZoom = (fullRange: XRange | null, resetKey?: unknown): ChartZoom =>
  useZoomState(useChartZoomSource(fullRange, resetKey));
