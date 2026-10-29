import { errorMessage } from '../core/basics';
import type { LegOptions } from './brouter';
import type { WayType } from './brouterProfile';
import { isAbortError } from './fetchJson';
import { avoidancePolygons, corridorPaths, isAcceptableReturn, returnAttempts, sharedDistanceM, type LoopReturnParams } from './loopReturn';
import {
  cumulativeDistances, isWaysMode, legsPoints, snapToWaypoints, wayTypesOf,
  type LegRequest, type ReturnRequest, type RoutePoint, type RouteVehicle, type Waypoint,
} from './route';
import type { SurfaceRuns } from './surface';

/**
 * Calcul d'un tronçon et du retour d'une boucle, pour `usePlannedRoute` : le
 * serveur demandé (`fetchLeg` de `brouter.ts`) est passé en paramètre, ce qui
 * laisse éprouver les essais du retour sans réseau.
 */

/** Calcul d'un tronçon par le serveur : la signature de `fetchLeg`. */
export type LegFetcher = (
  from: Waypoint,
  to: Waypoint,
  ways: ReadonlyArray<WayType>,
  vehicle: RouteVehicle,
  signal?: AbortSignal,
  options?: LegOptions
) => Promise<{ points: RoutePoint[]; surfaces?: SurfaceRuns }>;

/** Tracé calculé relié aux points, et ses voies si le serveur les a données. */
export interface LegResult {
  points: RoutePoint[];
  surfaces?: SurfaceRuns;
}

/** Résultat d'un calcul : le tracé, ou la raison de l'échec. */
export type LegOutcome = LegResult | { error: string };

/** Retour d'une boucle calculé, et ce qu'en dit la ligne d'état. */
export interface ReturnResult extends LegResult {
  outcome: 'avoided' | 'shortest';
  sharedM: number;
  tooLong?: boolean;
}

export type ReturnOutcome = ReturnResult | { error: string };

const tooFarMessage = (gapM: number): string =>
  `Point à ${Math.round(gapM)} m du chemin le plus proche : rapprochez-le d'un chemin, ou passez ce tronçon en ligne droite.`;

/** Tronçon calculé ; l'échec rendu en clair, un abandon relancé. */
export const computeLeg = async (
  fetchLeg: LegFetcher,
  request: LegRequest,
  vehicle: RouteVehicle,
  maxSnapM: number,
  signal: AbortSignal
): Promise<LegOutcome> => {
  // Une trace importée n'est jamais en attente : elle ne vient ici que par erreur, gardée en ligne droite.
  if (!isWaysMode(request.mode)) return { points: [request.from, request.to] };
  try {
    const computed = await fetchLeg(request.from, request.to, wayTypesOf(request.mode), vehicle, signal);
    const { maxGapM, ...result } = snapToWaypoints(request.from, request.to, computed.points, computed.surfaces);
    if (maxGapM > maxSnapM) return { error: tooFarMessage(maxGapM) };
    return result;
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { error: errorMessage(err, 'Calcul impossible.') };
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
 * La part commune avec l'aller ne se mesure que sur ses morceaux qui suivent
 * des voies (`corridorPaths`) : une ligne droite n'en a pas.
 */
export const computeReturn = async (
  fetchLeg: LegFetcher,
  request: ReturnRequest,
  vehicle: RouteVehicle,
  maxSnapM: number,
  maxRatio: number | null,
  params: LoopReturnParams,
  signal: AbortSignal
): Promise<ReturnOutcome> => {
  const outboundM = lengthM(legsPoints(request.outbound));
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
        sharedM: sharedDistanceM(result.points, corridorPaths(request.outbound), params.sharedToleranceM),
        ...(plan === null ? { tooLong: true } : {}),
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = errorMessage(err, lastError);
    }
  }
  return { error: lastError };
};
