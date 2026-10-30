import { EARTH_RADIUS_M } from '../core/geo';

/**
 * Repère commun des tests : mètres par degré, origine de Montpellier et heure de
 * départ. Fichier de test seulement : le code de l'application ne l'importe pas.
 * Les mètres par degré viennent du rayon terrestre du code (`EARTH_RADIUS_M`),
 * pour que les points posés ici soient relus à la même échelle.
 */

/** Mètres par degré de latitude. */
export const M_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;

/** Mètres par degré de longitude à la latitude `latDeg`. */
export const mPerDegLon = (latDeg: number): number => M_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);

/** Origine des traces d'essai. */
export const ORIGIN = { lat: 43.6, lon: 3.8 };

/** Position à `eastM` mètres à l'est et `northM` mètres au nord de `origin`. */
export const at = (eastM: number, northM: number, origin: { lat: number; lon: number } = ORIGIN): { lat: number; lon: number } => ({
  lat: origin.lat + northM / M_PER_DEG_LAT,
  lon: origin.lon + eastM / mPerDegLon(origin.lat),
});

/** Heure de départ des traces d'essai : 1er janvier 2026, 10 h UTC. */
export const T0 = Date.parse('2026-01-01T10:00:00Z');

/**
 * Positions le long d'une ligne brisée de sommets (est, nord) en mètres, un point
 * tous les `stepM` mètres au plus près (au moins un pas par côté), sommets compris.
 */
export const fixesAlong = (vertices: [number, number][], stepM: number, origin: { lat: number; lon: number } = ORIGIN): { lat: number; lon: number }[] => {
  const out = [at(vertices[0][0], vertices[0][1], origin)];
  for (let k = 1; k < vertices.length; k++) {
    const [e0, n0] = vertices[k - 1];
    const [e1, n1] = vertices[k];
    const count = Math.max(1, Math.round(Math.hypot(e1 - e0, n1 - n0) / stepM));
    for (let j = 1; j <= count; j++) out.push(at(e0 + ((e1 - e0) * j) / count, n0 + ((n1 - n0) * j) / count, origin));
  }
  return out;
};
