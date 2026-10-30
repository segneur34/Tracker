import { useCallback, useEffect, useReducer, useRef } from 'react';
import { jsonStore } from '../platform/storage';
import { fetchLeg, type ProfileIdStore } from '../planning/brouter';
import { computeLeg, computeReturn, type LegFetcher, type LegResult, type ReturnResult } from '../planning/legCalculation';
import { LOOP_RETURN_DEFAULTS, type LoopReturnParams } from '../planning/loopReturn';
import { plannedRouteReducer, type Edit, type PlannedRouteState } from '../planning/plannedRouteReducer';
import {
  DEFAULT_MAX_SNAP_M, EMPTY_ROUTE, addBeforeReturn, addWaypoint, closeLoop, insertWaypoint, isLooped,
  moveWaypoint, nextReturnVariant, pendingLegRequests, recomputeLegsWithoutSurfaces, removeLoopStart, removeWaypoint, reorderWaypoint,
  retryFailedLegs, returnRequest, reverseRoute, setLegMode, withLegError, withLegResult, withReturnError,
  withReturnResult,
  type LegRequest, type PlannedRoute, type ReturnRequest, type RouteMode, type RouteVehicle, type Waypoint,
} from '../planning/route';

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
 * calculé, évite l'aller (`computeReturn`, `planning/legCalculation.ts`).
 *
 * `vehicle` : règles d'accès de l'activité choisie. En changer ne touche pas
 * aux tronçons prêts ; ceux en attente se calculent avec les nouvelles (la
 * page les remet en attente, `setRouteMode`).
 */

/** Id du profil de calcul envoyé au serveur, retenu sur l'appareil (`planning/brouter.ts`). */
const PROFILE_KEY = 'tracker.brouterProfile';
const profileStore: ProfileIdStore = {
  read: () => jsonStore.read<{ id?: unknown }>(PROFILE_KEY)?.id ?? null,
  write: (id) => jsonStore.write(PROFILE_KEY, { id }),
};
const fetchStoredLeg: LegFetcher = (from, to, ways, vehicle, signal, options) =>
  fetchLeg(from, to, ways, vehicle, profileStore, signal, options);

/** Tracés gardés en cache. */
const CACHE_LIMIT = 200;

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
    plannedRouteReducer,
    null,
    (): PlannedRouteState => ({ route: EMPTY_ROUTE, mode: initialMode, loop: initialLoop, history: [] })
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
      computeReturn(fetchStoredLeg, back, vehicle, maxSnapM, maxReturnRatio, loopParams, controller.signal).then(
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
    computeLeg(fetchStoredLeg, request, vehicle, maxSnapM, controller.signal).then(
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
