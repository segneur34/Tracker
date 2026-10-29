import { toDeg, toRad } from './angles';
import type { LatLon } from './types';

/**
 * Géodésie : distance et cap entre deux positions, plans locaux, longueur
 * d'un tracé sans temps. La seule écriture de ces formules. Pur ; unités SI
 * (règle 1) : mètres, degrés décimaux.
 */

/** Rayon terrestre moyen en mètres. */
export const EARTH_RADIUS_M = 6371e3;

/** Distance orthodromique entre deux positions, en mètres. */
export const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/** Cap initial entre deux positions, en degrés depuis le nord, sens horaire. */
export const initialBearing = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

/** Point projeté dans un plan local, en mètres. */
export interface PlanePoint {
  x: number;
  y: number;
}

/**
 * Plan local équirectangulaire autour de `refLat`, aller-retour entre degrés
 * et mètres : x vers l'est, y vers le nord. Sans `origin`, l'origine est en 0°
 * de longitude et de latitude ; avec, elle est en `origin` (écarts calculés
 * avant la mise à l'échelle, plus justes loin du méridien d'origine).
 */
export const planeProjection = (refLat: number, origin?: LatLon) => {
  if (origin) {
    const cosLat = Math.cos(toRad(refLat));
    return {
      to: (p: LatLon): PlanePoint => ({
        x: toRad(p.lon - origin.lon) * cosLat * EARTH_RADIUS_M,
        y: toRad(p.lat - origin.lat) * EARTH_RADIUS_M,
      }),
      from: (q: PlanePoint): LatLon => ({
        lat: origin.lat + toDeg(q.y / EARTH_RADIUS_M),
        lon: origin.lon + toDeg(q.x / EARTH_RADIUS_M / cosLat),
      }),
    };
  }
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(refLat));
  const ky = toRad(1) * EARTH_RADIUS_M;
  return {
    to: (p: LatLon): PlanePoint => ({ x: p.lon * kx, y: p.lat * ky }),
    from: (q: PlanePoint): LatLon => ({ lat: q.y / ky, lon: q.x / kx }),
  };
};

/**
 * Distance cumulée le long des points, en mètres. Un tracé sans temps
 * (itinéraire, ligne de la carte) n'a pas de vitesse : la règle 6 (distance
 * intégrée de la vitesse) vaut pour les traces enregistrées ; ici, la somme
 * des distances entre points est la seule mesure.
 */
export const cumulativeDistancesM = (points: ReadonlyArray<LatLon>): number[] => {
  const cum = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return cum;
};

/** Longueur d'un tracé sans temps, en mètres (distance entre ses points, comme `cumulativeDistancesM`). */
export const pathLengthM = (points: ReadonlyArray<LatLon>): number => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
};
