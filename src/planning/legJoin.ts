import type { RouteMode, RoutePoint, WaysMode } from './route';

/**
 * Deux pièces de base des tronçons d'un itinéraire, sans autre dépendance que
 * les types de `route.ts` (`route.ts`, `surface.ts` et `loopReturn.ts` les
 * lisent tous trois, sans cycle). Pur.
 */

/** Vrai pour un mode calculé par les types de voie (ni ligne droite, ni trace importée). */
export const isWaysMode = (mode: RouteMode): mode is WaysMode => mode !== 'straight' && mode !== 'imported';

/** Tronçon que la carte calcule (type de voie), par opposition à une ligne droite ou une trace importée. */
export const isComputedLeg = (leg: { mode: RouteMode }): boolean => isWaysMode(leg.mode);

/** Vrai si les deux points sont au même endroit (mêmes coordonnées). */
export const samePlace = (a: RoutePoint | undefined, b: RoutePoint | undefined): boolean =>
  !!a && !!b && a.lat === b.lat && a.lon === b.lon;

/**
 * Tronçons qui se suivent, mis bout à bout, le point de jonction compté une
 * fois. Sans `keep`, un seul trait. Avec `keep`, un trait par suite de
 * tronçons retenus : un tronçon écarté coupe la suite, sans relier la fin de
 * l'un au début du suivant.
 */
export const joinLegs = <L extends { points: ReadonlyArray<RoutePoint> }>(
  legs: ReadonlyArray<L>,
  keep?: (leg: L) => boolean
): RoutePoint[][] => {
  const paths: RoutePoint[][] = [];
  let current: RoutePoint[] | null = null;
  for (const leg of legs) {
    if (keep && !keep(leg)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      paths.push(current);
    }
    const start = samePlace(current[current.length - 1], leg.points[0]) ? 1 : 0;
    for (let i = start; i < leg.points.length; i++) current.push(leg.points[i]);
  }
  return paths;
};
