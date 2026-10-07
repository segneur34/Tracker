import { useCallback, useEffect, useReducer, useRef } from 'react';
import { fetchLeg } from '../planning/brouter';
import { LOOP_RETURN_DEFAULTS, avoidancePolygons, isAcceptableReturn, returnAttempts, sharedDistanceM, type LoopReturnParams } from '../planning/loopReturn';
import {
  DEFAULT_MAX_SNAP_M, EMPTY_ROUTE, addBeforeReturn, addWaypoint, closeLoop, cumulativeDistances, insertWaypoint, isLooped, isWaysMode, legsPoints,
  moveWaypoint, nextReturnVariant, openLoop, pendingLegRequests, recomputeLegsWithoutSurfaces, removeLoopStart, removeWaypoint, reorderWaypoint,
  retryFailedLegs, returnRequest, reverseRoute, setLegMode, snapToWaypoints, wayTypesOf, withLegError, withLegResult, withLoopReturn, withReturnError,
  withReturnResult,
  type LegRequest, type PlannedRoute, type ReturnRequest, type RouteMode, type RoutePoint, type RouteVehicle, type Waypoint,
} from '../planning/route';
import type { SurfaceRuns } from '../planning/surface';

/**
 * Itinéraire en cours de planification : les modifications de l'utilisateur,
 * leur annulation, et le calcul des tronçons en attente, un à la fois. Les
 * types de voie cochés au-dessus de la carte (`mode`) et le mode « Boucle »
 * (`loop`) font partie de l'état : « Précédent » les rend avec l'itinéraire.
 *
 * Un calcul en cours n'est abandonné que si son tronçon n'attend plus (le
 * point a bougé, a été retiré) ; son résultat est posé sur le tronçon qui
 * porte encore sa clé, même si un point a été inséré avant lui. Les tracés
 * obtenus restent en cache le temps de la page : annuler, ou remettre un
 * point où il était, ne redemande rien au serveur.
 *
 * En mode « Boucle », chaque modification passe par `withLoopReturn` :
 * l'itinéraire reste bouclé, et le retour, demandé une fois tout l'aller
 * calculé, évite l'aller (`computeReturn`, `planning/loopReturn.ts`).
 *
 * `vehicle` : règles d'accès de l'activité choisie. En changer ne touche pas
 * aux tronçons prêts ; ceux en attente se calculent avec les nouvelles (la
 * page les remet en attente, `setRouteMode`).
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

/** Retour d'une boucle calculé, et ce qu'en dit la ligne d'état. */
interface ReturnResult extends LegResult {
  outcome: 'avoided' | 'shortest';
  sharedM: number;
  tooLong?: boolean;
}

type ReturnOutcome = ReturnResult | { error: string };

const tooFarMessage = (gapM: number): string =>
  `Point à ${Math.round(gapM)} m du chemin le plus proche : rapprochez-le d'un chemin, ou passez ce tronçon en ligne droite.`;

const isAbort = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

const computeLeg = async (request: LegRequest, vehicle: RouteVehicle, maxSnapM: number, signal: AbortSignal): Promise<LegOutcome> => {
  // Une trace importée n'est jamais en attente : elle ne vient ici que par erreur, gardée en ligne droite.
  if (!isWaysMode(request.mode)) return { points: [request.from, request.to] };
  try {
    const computed = await fetchLeg(request.from, request.to, wayTypesOf(request.mode), vehicle, signal);
    const { maxGapM, ...result } = snapToWaypoints(request.from, request.to, computed.points, computed.surfaces);
    if (maxGapM > maxSnapM) return { error: tooFarMessage(maxGapM) };
    return result;
  } catch (err) {
    if (isAbort(err)) throw err;
    return { error: err instanceof Error ? err.message : 'Calcul impossible.' };
  }
};

const lengthM = (points: RoutePoint[]): number => {
  const cum = cumulativeDistances(points);
  return cum.length > 0 ? cum[cum.length - 1] : 0;
};

/**
 * Retour d'une boucle : essais avec le couloir le long de l'aller, du poids
 * le plus fort au plus faible, puis sans couloir (`returnAttempts`), l'un
 * après l'autre ; le premier qui ne dépasse pas `maxRatio` fois l'aller est
 * gardé, le dernier toujours. Un essai avec couloir qui échoue passe au
 * suivant. Sans rapport (`null`), pas de couloir : le retour le plus court.
 */
const computeReturn = async (
  request: ReturnRequest,
  vehicle: RouteVehicle,
  maxSnapM: number,
  maxRatio: number | null,
  params: LoopReturnParams,
  signal: AbortSignal
): Promise<ReturnOutcome> => {
  const outbound = legsPoints(request.outbound);
  const outboundM = lengthM(outbound);
  const plan = maxRatio !== null ? avoidancePolygons(request.outbound, params) : { polygons: [], toleranceM: params.toleranceM };
  let lastError = 'Calcul impossible.';
  for (const polygons of returnAttempts(plan?.polygons ?? null, params.weights)) {
    try {
      const computed = await fetchLeg(request.from, request.to, wayTypesOf(request.mode), vehicle, signal, {
        ...(polygons !== null ? { polygons } : {}),
        alternative: request.variant,
      });
      const { maxGapM, ...result } = snapToWaypoints(request.from, request.to, computed.points, computed.surfaces);
      if (maxGapM > maxSnapM) return { error: tooFarMessage(maxGapM) };
      if (polygons !== null && maxRatio !== null && !isAcceptableReturn(lengthM(result.points), outboundM, maxRatio)) continue;
      return {
        ...result,
        outcome: polygons !== null ? 'avoided' : 'shortest',
        sharedM: sharedDistanceM(result.points, outbound, params.sharedToleranceM),
        ...(plan === null ? { tooLong: true } : {}),
      };
    } catch (err) {
      if (isAbort(err)) throw err;
      lastError = err instanceof Error ? err.message : lastError;
    }
  }
  return { error: lastError };
};

/** Ce que « Précédent » rend : l'itinéraire, les types de voie cochés et le mode « Boucle ». */
interface Snapshot {
  route: PlannedRoute;
  mode: RouteMode;
  loop: boolean;
}

interface State extends Snapshot {
  /** États d'avant chaque modification de l'utilisateur, le plus récent à la fin. */
  history: Snapshot[];
}

/** Modification de l'utilisateur ; `loop` : le mode « Boucle » est allumé. */
type Edit = (r: PlannedRoute, loop: boolean) => PlannedRoute;

type Action =
  /** Modification de l'utilisateur : l'état d'avant entre dans l'annulation. */
  | { type: 'edit'; change: Edit }
  /**
   * Types de voie cochés, et la modification de l'itinéraire qui en découle :
   * une seule étape de l'annulation ; `loop` : le mode « Boucle » change avec eux.
   */
  | { type: 'mode'; mode: RouteMode; change: (r: PlannedRoute) => PlannedRoute; loop?: boolean }
  /** Bouton « Boucle » : allumé, l'itinéraire se boucle ; éteint, le retour est retiré. */
  | { type: 'loop'; on: boolean }
  /** Résultat d'un calcul, ou nouvel essai : hors annulation. */
  | { type: 'apply'; change: (r: PlannedRoute) => PlannedRoute }
  | { type: 'undo' }
  /**
   * Nouvel itinéraire (ouvert depuis la mémoire), et ses types de voie et son
   * mode « Boucle » s'ils changent : l'annulation repart de zéro, l'itinéraire
   * est pris tel quel.
   */
  | { type: 'replace'; route: PlannedRoute; mode?: RouteMode; loop?: boolean };

/** État suivant, l'état d'avant gardé pour l'annulation. */
const remember = (state: State, next: Snapshot): State => ({
  ...next,
  history: [...state.history.slice(-(HISTORY_LIMIT - 1)), { route: state.route, mode: state.mode, loop: state.loop }],
});

/** Itinéraire remis en ordre en mode « Boucle » ; tel quel sinon. */
const settle = (route: PlannedRoute, mode: RouteMode, loop: boolean): PlannedRoute => (loop ? withLoopReturn(route, mode) : route);

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'edit': {
      const route = settle(action.change(state.route, state.loop), state.mode, state.loop);
      return route === state.route ? state : remember(state, { route, mode: state.mode, loop: state.loop });
    }
    case 'mode': {
      const loop = action.loop ?? state.loop;
      const route = settle(action.change(state.route), action.mode, loop);
      if (route === state.route && action.mode === state.mode && loop === state.loop) return state;
      // Sur une carte vide, rien à défaire : les cases changent seules.
      return state.route.waypoints.length === 0 ? { ...state, mode: action.mode, loop } : remember(state, { route, mode: action.mode, loop });
    }
    case 'loop': {
      const route = action.on ? withLoopReturn(state.route, state.mode) : openLoop(state.route);
      if (route === state.route && action.on === state.loop) return state;
      return state.route.waypoints.length === 0 ? { ...state, loop: action.on } : remember(state, { route, mode: state.mode, loop: action.on });
    }
    case 'apply': {
      const route = settle(action.change(state.route), state.mode, state.loop);
      return route === state.route ? state : { ...state, route };
    }
    case 'undo':
      return state.history.length === 0 ? state : { ...state.history[state.history.length - 1], history: state.history.slice(0, -1) };
    case 'replace':
      return { route: action.route, mode: action.mode ?? state.mode, loop: action.loop ?? state.loop, history: [] };
  }
};

/** Clé d'un calcul : celle du tronçon, et les règles d'accès qui le calculent. */
const computeKey = (request: LegRequest, vehicle: RouteVehicle): string => `${request.key}|${vehicle}`;

/** Clé du calcul d'un retour : l'aller, la variante, les règles d'accès et le rapport qui l'acceptent. */
const returnKey = (request: ReturnRequest, vehicle: RouteVehicle, maxRatio: number | null): string =>
  `retour|${request.basis}|${request.variant}|${vehicle}|${maxRatio ?? '-'}`;

/** Garde un résultat en cache, le plus ancien sorti au-delà de `CACHE_LIMIT`. */
const store = <T,>(cache: Map<string, T>, key: string, value: T): void => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
};

export interface PlannedRouteOptions {
  /** Écart au-delà duquel un point est jugé hors de tout chemin, en mètres. */
  maxSnapM?: number;
  /** Rapport au-delà duquel un retour qui évite l'aller est refusé (`SportProfile.loopReturnMaxRatio`) ; `null` : pas d'évitement. */
  maxReturnRatio: number | null;
  /** Couloir et essais du retour d'une boucle. */
  loopParams?: LoopReturnParams;
}

/** `initialMode` : types de voie cochés à l'ouverture de la page ; `initialLoop` : mode « Boucle » à l'ouverture. */
export const usePlannedRoute = (
  vehicle: RouteVehicle,
  initialMode: RouteMode,
  initialLoop: boolean,
  { maxSnapM = DEFAULT_MAX_SNAP_M, maxReturnRatio, loopParams = LOOP_RETURN_DEFAULTS }: PlannedRouteOptions
) => {
  const [{ route, mode, loop, history }, dispatch] = useReducer(
    reducer,
    null,
    (): State => ({ route: EMPTY_ROUTE, mode: initialMode, loop: initialLoop, history: [] })
  );
  const inFlight = useRef<{ key: string; controller: AbortController } | null>(null);
  const cache = useRef(new Map<string, LegResult>());
  const returnCache = useRef(new Map<string, ReturnResult>());

  // Un calcul à la fois : le premier tronçon de l'aller en attente, sauf si celui en cours attend toujours ; tout l'aller
  // calculé, le retour d'une boucle.
  useEffect(() => {
    const requests = pendingLegRequests(route);
    const back = requests.length === 0 ? returnRequest(route) : null;
    const keys = back ? [returnKey(back, vehicle, maxReturnRatio)] : requests.map((r) => computeKey(r, vehicle));
    const current = inFlight.current;
    if (current && keys.includes(current.key)) return;
    current?.controller.abort();
    inFlight.current = null;

    if (back) {
      const key = keys[0];
      const cached = returnCache.current.get(key);
      if (cached) {
        dispatch({ type: 'apply', change: (r) => withReturnResult(r, back.basis, back.variant, cached) });
        return;
      }
      const controller = new AbortController();
      inFlight.current = { key, controller };
      computeReturn(back, vehicle, maxSnapM, maxReturnRatio, loopParams, controller.signal).then(
        (outcome) => {
          if (inFlight.current?.controller !== controller) return;
          inFlight.current = null;
          if ('points' in outcome) {
            store(returnCache.current, key, outcome);
            dispatch({ type: 'apply', change: (r) => withReturnResult(r, back.basis, back.variant, outcome) });
          } else {
            dispatch({ type: 'apply', change: (r) => withReturnError(r, back.basis, back.variant, outcome.error) });
          }
        },
        () => {
          // Abandonné : l'aller a changé, un autre calcul a pris la suite.
        }
      );
      return;
    }

    const request = requests[0];
    if (!request) return;
    const key = keys[0];
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
          store(cache.current, key, outcome);
          dispatch({ type: 'apply', change: (r) => withLegResult(r, request.key, outcome.points, outcome.surfaces) });
        } else {
          dispatch({ type: 'apply', change: (r) => withLegError(r, request.key, outcome.error) });
        }
      },
      () => {
        // Abandonné : le tronçon a changé, un autre calcul a pris la suite.
      }
    );
  }, [route, vehicle, maxSnapM, maxReturnRatio, loopParams]);

  // Calcul abandonné en quittant la page.
  useEffect(() => () => inFlight.current?.controller.abort(), []);

  const edit = useCallback((change: Edit) => dispatch({ type: 'edit', change }), []);

  return {
    route,
    /** Types de voie cochés au-dessus de la carte, ou ligne droite. */
    mode,
    /** Mode « Boucle » : l'itinéraire reste bouclé, le retour évite l'aller. */
    loop,
    canUndo: history.length > 0,
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    /**
     * Nouvel itinéraire (ouvert, chargé d'un GPX, effacé pour repartir), et les
     * types de voie à cocher et le mode « Boucle » s'ils changent : l'annulation
     * repart de zéro, l'itinéraire est pris tel quel.
     */
    replace: useCallback(
      (next: PlannedRoute, nextMode?: RouteMode, nextLoop?: boolean) => dispatch({ type: 'replace', route: next, mode: nextMode, loop: nextLoop }),
      []
    ),
    /**
     * Types de voie cochés, avec la modification de l'itinéraire qui en découle
     * (`setRouteMode`), et le mode « Boucle » s'il change avec eux ; « Précédent »
     * rend le tout.
     */
    chooseMode: useCallback(
      (nextMode: RouteMode, change: (r: PlannedRoute) => PlannedRoute, nextLoop?: boolean) =>
        dispatch({ type: 'mode', mode: nextMode, change, loop: nextLoop }),
      []
    ),
    /** Bouton « Boucle » : allumé, l'itinéraire se boucle et son retour évite l'aller ; éteint, le retour est retiré. */
    setLoop: useCallback((on: boolean) => dispatch({ type: 'loop', on }), []),
    /** « Autre retour » : variante suivante du retour de la boucle. */
    otherReturn: useCallback(() => edit((r) => nextReturnVariant(r)), [edit]),
    // En mode « Boucle », un point posé s'insère avant le retour.
    add: useCallback((w: Waypoint, mode: RouteMode) => edit((r, looping) => (looping ? addBeforeReturn(r, w, mode) : addWaypoint(r, w, mode))), [edit]),
    insert: useCallback((legIndex: number, w: Waypoint) => edit((r) => insertWaypoint(r, legIndex, w)), [edit]),
    // `mode` : celui choisi sur la page, pour refaire un tronçon de trace importée que l'édition touche.
    move: useCallback((index: number, w: Waypoint, mode: RouteMode) => edit((r) => moveWaypoint(r, index, w, mode)), [edit]),
    // En mode « Boucle », retirer le départ (qui est aussi l'arrivée) fait du point suivant le départ.
    remove: useCallback(
      (index: number, mode: RouteMode) =>
        edit((r, looping) =>
          looping && isLooped(r) && (index === 0 || index === r.waypoints.length - 1) ? removeLoopStart(r) : removeWaypoint(r, index, mode)
        ),
      [edit]
    ),
    // En mode « Boucle », le départ reste le départ, et le retour, le dernier tronçon.
    reorder: useCallback(
      (from: number, to: number, mode: RouteMode) =>
        edit((r, looping) => {
          const last = r.waypoints.length - 1;
          if (looping && isLooped(r) && [from, to].some((i) => i === 0 || i === last)) return r;
          return reorderWaypoint(r, from, to, mode);
        }),
      [edit]
    ),
    setLegMode: useCallback((legIndex: number, legMode: RouteMode) => edit((r) => setLegMode(r, legIndex, legMode)), [edit]),
    reverse: useCallback(() => edit(reverseRoute), [edit]),
    /** « Boucler », hors mode « Boucle » : un dernier tronçon ramène au départ. */
    closeLoop: useCallback((mode: RouteMode) => edit((r) => closeLoop(r, mode)), [edit]),
    clear: useCallback(() => edit(() => EMPTY_ROUTE), [edit]),
    retry: useCallback(() => dispatch({ type: 'apply', change: retryFailedLegs }), []),
    /** Tronçons calculés rangés sans leurs voies : recalculés pour en avoir le revêtement, annulable par « Précédent ». */
    recomputeSurfaces: useCallback(() => edit(recomputeLegsWithoutSurfaces), [edit]),
  };
};
