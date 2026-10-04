import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchLeg } from '../planning/brouter';
import {
  DEFAULT_MAX_SNAP_M, EMPTY_ROUTE, addWaypoint, closeLoop, insertWaypoint, moveWaypoint, pendingLegRequests, recomputeLegsWithoutSurfaces,
  removeWaypoint, reorderWaypoint, retryFailedLegs, reverseRoute, setLegMode, snapToWaypoints, straightenRoute, withLegError, withLegResult,
  type LegRequest, type PlannedRoute, type RouteMode, type RoutePoint, type RouteVehicle, type Waypoint,
} from '../planning/route';
import type { SurfaceRuns } from '../planning/surface';

/**
 * Itinéraire en cours de planification : les modifications de l'utilisateur,
 * leur annulation, et le calcul des tronçons en attente, un à la fois.
 *
 * Un calcul en cours n'est abandonné que si son tronçon n'attend plus (le
 * point a bougé, a été retiré) ; son résultat est posé sur le tronçon qui
 * porte encore sa clé, même si un point a été inséré avant lui. Les tracés
 * obtenus restent en cache le temps de la page : annuler, ou remettre un
 * point où il était, ne redemande rien au serveur.
 *
 * `vehicle` : règles d'accès de l'activité choisie. En changer ne touche pas
 * aux tronçons prêts ; ceux en attente se calculent avec les nouvelles.
 */

/** Profondeur de l'annulation. */
const HISTORY_LIMIT = 50;
/** Tracés gardés en cache. */
const CACHE_LIMIT = 200;

/** Tracé calculé relié aux points, et ses voies si le serveur les a données. */
interface LegResult {
  points: RoutePoint[];
  surfaces?: SurfaceRuns;
}

/** Résultat d'un calcul : le tracé, ou la raison de l'échec. */
type LegOutcome = LegResult | { error: string };

const computeLeg = async (request: LegRequest, vehicle: RouteVehicle, maxSnapM: number, signal: AbortSignal): Promise<LegOutcome> => {
  // Une trace importée n'est jamais en attente : elle ne vient ici que par erreur, gardée en ligne droite.
  if (request.mode === 'straight' || request.mode === 'imported') return { points: [request.from, request.to] };
  try {
    const computed = await fetchLeg(request.from, request.to, request.mode, vehicle, signal);
    const { maxGapM, ...result } = snapToWaypoints(request.from, request.to, computed.points, computed.surfaces);
    if (maxGapM > maxSnapM) {
      return { error: `Point à ${Math.round(maxGapM)} m du chemin le plus proche : rapprochez-le d'un chemin, ou passez ce tronçon en ligne droite.` };
    }
    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { error: err instanceof Error ? err.message : 'Calcul impossible.' };
  }
};

interface State {
  route: PlannedRoute;
  /** États d'avant chaque modification de l'utilisateur, le plus récent à la fin. */
  history: PlannedRoute[];
}

type Action =
  /** Modification de l'utilisateur : l'état d'avant entre dans l'annulation. */
  | { type: 'edit'; change: (r: PlannedRoute) => PlannedRoute }
  /** Résultat d'un calcul, ou nouvel essai : hors annulation. */
  | { type: 'apply'; change: (r: PlannedRoute) => PlannedRoute }
  | { type: 'undo' }
  /** Nouvel itinéraire (ouvert depuis la mémoire) : l'annulation repart de zéro. */
  | { type: 'replace'; route: PlannedRoute };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'edit': {
      const route = action.change(state.route);
      return route === state.route ? state : { route, history: [...state.history.slice(-(HISTORY_LIMIT - 1)), state.route] };
    }
    case 'apply': {
      const route = action.change(state.route);
      return route === state.route ? state : { ...state, route };
    }
    case 'undo':
      return state.history.length === 0
        ? state
        : { route: state.history[state.history.length - 1], history: state.history.slice(0, -1) };
    case 'replace':
      return { route: action.route, history: [] };
  }
};

/** Clé d'un calcul : celle du tronçon, et les règles d'accès qui le calculent. */
const computeKey = (request: LegRequest, vehicle: RouteVehicle): string => `${request.key}|${vehicle}`;

export const usePlannedRoute = (vehicle: RouteVehicle, maxSnapM = DEFAULT_MAX_SNAP_M) => {
  const [{ route, history }, dispatch] = useReducer(reducer, { route: EMPTY_ROUTE, history: [] });
  const inFlight = useRef<{ key: string; controller: AbortController } | null>(null);
  const cache = useRef(new Map<string, LegResult>());

  // Un calcul à la fois : le premier tronçon en attente, sauf si celui en cours attend toujours.
  useEffect(() => {
    const requests = pendingLegRequests(route);
    const current = inFlight.current;
    if (current && requests.some((r) => computeKey(r, vehicle) === current.key)) return;
    current?.controller.abort();
    inFlight.current = null;

    const request = requests[0];
    if (!request) return;
    const key = computeKey(request, vehicle);
    const cached = cache.current.get(key);
    if (cached) {
      dispatch({ type: 'apply', change: (r) => withLegResult(r, request.key, cached.points, cached.surfaces) });
      return;
    }

    const controller = new AbortController();
    inFlight.current = { key, controller };
    computeLeg(request, vehicle, maxSnapM, controller.signal).then(
      (outcome) => {
        if (inFlight.current?.controller !== controller) return;
        inFlight.current = null;
        if ('points' in outcome) {
          if (cache.current.size >= CACHE_LIMIT) cache.current.delete(cache.current.keys().next().value!);
          cache.current.set(key, outcome);
          dispatch({ type: 'apply', change: (r) => withLegResult(r, request.key, outcome.points, outcome.surfaces) });
        } else {
          dispatch({ type: 'apply', change: (r) => withLegError(r, request.key, outcome.error) });
        }
      },
      () => {
        // Abandonné : le tronçon a changé, un autre calcul a pris la suite.
      }
    );
  }, [route, vehicle, maxSnapM]);

  // Calcul abandonné en quittant la page.
  useEffect(() => () => inFlight.current?.controller.abort(), []);

  const edit = useCallback((change: (r: PlannedRoute) => PlannedRoute) => dispatch({ type: 'edit', change }), []);

  return {
    route,
    canUndo: history.length > 0,
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    /** Nouvel itinéraire (ouvert, chargé d'un GPX, effacé pour repartir) : l'annulation repart de zéro. */
    replace: useCallback((next: PlannedRoute) => dispatch({ type: 'replace', route: next }), []),
    add: useCallback((w: Waypoint, mode: RouteMode) => edit((r) => addWaypoint(r, w, mode)), [edit]),
    insert: useCallback((legIndex: number, w: Waypoint) => edit((r) => insertWaypoint(r, legIndex, w)), [edit]),
    // `mode` : celui choisi sur la page, pour refaire un tronçon de trace importée que l'édition touche.
    move: useCallback((index: number, w: Waypoint, mode: RouteMode) => edit((r) => moveWaypoint(r, index, w, mode)), [edit]),
    remove: useCallback((index: number, mode: RouteMode) => edit((r) => removeWaypoint(r, index, mode)), [edit]),
    reorder: useCallback((from: number, to: number, mode: RouteMode) => edit((r) => reorderWaypoint(r, from, to, mode)), [edit]),
    setMode: useCallback((legIndex: number, mode: RouteMode) => edit((r) => setLegMode(r, legIndex, mode)), [edit]),
    reverse: useCallback(() => edit(reverseRoute), [edit]),
    loop: useCallback((mode: RouteMode) => edit((r) => closeLoop(r, mode)), [edit]),
    /** Parcours de voile : tronçons calculés passés en ligne droite, annulable par « Précédent ». */
    straighten: useCallback(() => edit(straightenRoute), [edit]),
    clear: useCallback(() => edit(() => EMPTY_ROUTE), [edit]),
    retry: useCallback(() => dispatch({ type: 'apply', change: retryFailedLegs }), []),
    /** Tronçons calculés rangés sans leurs voies : recalculés pour en avoir le revêtement, annulable par « Précédent ». */
    recomputeSurfaces: useCallback(() => edit(recomputeLegsWithoutSurfaces), [edit]),
  };
};
