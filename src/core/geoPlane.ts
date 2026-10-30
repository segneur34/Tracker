import { planeProjection, type PlanePoint } from './geo';
import type { LatLon } from './types';

/**
 * Plans locaux équirectangulaires et projection d'un point sur un segment :
 * la seule écriture de cette géométrie (distance à un segment, accrochage à
 * un tracé, couloir d'un retour de boucle, appariement aux voies). Exacte à
 * mieux que le mètre sur quelques kilomètres. Tout est pur ; unités SI
 * (règle 1) : mètres, degrés décimaux.
 */

/** Distance de `p` au segment `[a, b]` d'un plan, en mètres. Segment réduit à un point : distance à ce point. */
export const pointSegmentDistanceM = (p: PlanePoint, a: PlanePoint, b: PlanePoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};

/** Projection de `p` sur le segment `[a, b]`. */
export interface SegmentProjection {
  /** Place du pied sur le segment, de 0 (en `a`) à 1 (en `b`). */
  t: number;
  /** Écart est-ouest puis nord-sud du pied par rapport à `p`, en mètres. */
  offsetX: number;
  offsetY: number;
  /** Distance de `p` au segment, en mètres. */
  distanceM: number;
}

/**
 * Pied de `p` sur le segment `[a, b]`, mesuré dans le plan local centré sur
 * `p`. Segment réduit à un point : `t` vaut 0.
 */
export const projectOnSegment = (p: LatLon, a: LatLon, b: LatLon): SegmentProjection => {
  const plane = planeProjection(p.lat, p).to;
  const { x: ax, y: ay } = plane(a);
  const pb = plane(b);
  const dx = pb.x - ax;
  const dy = pb.y - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  const offsetX = ax + t * dx;
  const offsetY = ay + t * dy;
  return { t, offsetX, offsetY, distanceM: Math.hypot(offsetX, offsetY) };
};

/** Distance de `p` au segment `[a, b]`, en mètres (plan local centré sur `p`). */
export const distanceToSegmentM = (p: LatLon, a: LatLon, b: LatLon): number => projectOnSegment(p, a, b).distanceM;
