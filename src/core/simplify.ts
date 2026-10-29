import { planeProjection, type PlanePoint } from './geo';
import { pointSegmentDistanceM } from './geoPlane';
import type { LatLon } from './types';

/**
 * Simplification d'un tracé (Douglas-Peucker) : on garde les bouts et les
 * points qui s'écartent de plus de la tolérance de la corde qui les entoure.
 * Pièce commune au couloir du retour d'une boucle (`planning/loopReturn.ts`)
 * et à la trace suivie gardée sur l'appareil (`recording/followedTrace.ts`).
 *
 * Tout est pur. Unités SI (règle 1) : mètres, degrés décimaux.
 */

/** Rangs des points gardés par Douglas-Peucker, bouts compris, dans l'ordre ; sans récursion. */
const keptIndices = (points: ReadonlyArray<PlanePoint>, toleranceM: number): number[] => {
  if (points.length < 3) return points.map((_, i) => i);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = pointSegmentDistanceM(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > toleranceM) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
};

/** Points d'un plan gardés par Douglas-Peucker, bouts compris. */
export const simplifyPlane = <P extends PlanePoint>(points: P[], toleranceM: number): P[] =>
  keptIndices(points, toleranceM).map((i) => points[i]);

/**
 * Positions gardées par Douglas-Peucker, bouts compris, dans un plan local
 * équirectangulaire autour de la latitude moyenne : exact à mieux que le pour
 * cent sur quelques dizaines de kilomètres.
 */
export const simplifyLatLon = <P extends LatLon>(points: P[], toleranceM: number): P[] => {
  if (points.length < 3) return points;
  const refLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const plane = points.map(planeProjection(refLat).to);
  return keptIndices(plane, toleranceM).map((i) => points[i]);
};
