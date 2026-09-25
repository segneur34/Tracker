import { routePoints } from '../planning/route';
import { recordToRoute, type RouteRecord } from '../planning/routeRecord';

/**
 * Trace suivie pendant un enregistrement : un itinéraire rangé ou une session
 * déjà enregistrée, dessinée sous la trace en cours pour s'y guider. Seules
 * les positions comptent ; distance restante et alerte hors trace viendront
 * ensuite.
 */

export type FollowedSource = 'route' | 'session';

export interface FollowedTrace {
  name: string;
  source: FollowedSource;
  points: { lat: number; lon: number }[];
}

/** Trace faite des positions données ; `null` sous deux positions exploitables. */
export const followedTraceFromPoints = (
  points: ReadonlyArray<{ lat: number; lon: number }>,
  name: string,
  source: FollowedSource
): FollowedTrace | null => {
  const kept = points
    .filter((p) => isFinite(p.lat) && isFinite(p.lon))
    .map(({ lat, lon }) => ({ lat, lon }));
  return kept.length >= 2 ? { name, source, points: kept } : null;
};

/**
 * Trace d'un itinéraire rangé : ses tronçons à la suite ; un tronçon jamais
 * calculé y figure en ligne droite, comme sur la page Itinéraires.
 */
export const followedTraceFromRoute = (record: RouteRecord): FollowedTrace | null =>
  followedTraceFromPoints(routePoints(recordToRoute(record)), record.name, 'route');
