import { EARTH_RADIUS_M, toRad } from './kinematics';

/**
 * Plans locaux équirectangulaires et projection d'un point sur un segment :
 * la seule écriture de cette géométrie (distance à un segment, accrochage à
 * un tracé, couloir d'un retour de boucle, appariement aux voies). Exacte à
 * mieux que le mètre sur quelques kilomètres. Tout est pur ; unités SI
 * (règle 1) : mètres, degrés décimaux.
 */

interface LatLon {
  lat: number;
  lon: number;
}

/** Point projeté dans un plan local, en mètres. */
export interface PlanePoint {
  x: number;
  y: number;
}

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
  const cosLat = Math.cos(toRad(p.lat));
  const x = (q: LatLon) => toRad(q.lon - p.lon) * cosLat * EARTH_RADIUS_M;
  const y = (q: LatLon) => toRad(q.lat - p.lat) * EARTH_RADIUS_M;
  const ax = x(a);
  const ay = y(a);
  const dx = x(b) - ax;
  const dy = y(b) - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  const offsetX = ax + t * dx;
  const offsetY = ay + t * dy;
  return { t, offsetX, offsetY, distanceM: Math.hypot(offsetX, offsetY) };
};

/** Distance de `p` au segment `[a, b]`, en mètres (plan local centré sur `p`). */
export const distanceToSegmentM = (p: LatLon, a: LatLon, b: LatLon): number => projectOnSegment(p, a, b).distanceM;

/** Plan local autour de `refLat`, aller-retour entre degrés et mètres (origine en 0° de longitude et de latitude). */
export const planeProjection = (refLat: number) => {
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(refLat));
  const ky = toRad(1) * EARTH_RADIUS_M;
  return {
    to: (p: LatLon): PlanePoint => ({ x: p.lon * kx, y: p.lat * ky }),
    from: (q: PlanePoint): LatLon => ({ lat: q.y / ky, lon: q.x / kx }),
  };
};
