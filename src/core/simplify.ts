import { EARTH_RADIUS_M, toRad } from './kinematics';

/**
 * Simplification d'un tracé (Douglas-Peucker) : on garde les bouts et les
 * points qui s'écartent de plus de la tolérance de la corde qui les entoure.
 * Pièce commune au couloir du retour d'une boucle (`planning/loopReturn.ts`)
 * et à la trace suivie gardée sur l'appareil (`recording/followedTrace.ts`).
 *
 * Tout est pur. Unités SI (règle 1) : mètres, degrés décimaux.
 */

/** Point projeté dans un plan local, en mètres. */
export interface PlanePoint {
  x: number;
  y: number;
}

interface LatLon {
  lat: number;
  lon: number;
}

/** Distance de `p` au segment `[a, b]`, en mètres. */
export const pointSegmentDistanceM = (p: PlanePoint, a: PlanePoint, b: PlanePoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};

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
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(refLat));
  const ky = toRad(1) * EARTH_RADIUS_M;
  const plane = points.map((p) => ({ x: p.lon * kx, y: p.lat * ky }));
  return keptIndices(plane, toleranceM).map((i) => points[i]);
};
