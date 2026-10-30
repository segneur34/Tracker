import type { RawTrackPoint, TrackPoint } from '../core/types';
import type { LocationFix } from '../platform/location';
import { M_PER_DEG_LAT, ORIGIN, T0, mPerDegLon } from './geo.fixture';

/** Fichier de test seulement : le code de l'application ne l'importe pas. */

/**
 * Trace vers l'est dont chaque point `i` porte la vitesse `speedsMs[i]` (m/s),
 * un point toutes les `stepSeconds` secondes. Le premier point est au départ, le
 * suivant avance de `speedsMs[i] × stepSeconds`. Les champs calculés sont ceux
 * du noyau (vitesse lissée = vitesse, cap 90°) ; l'altitude vient de `altitudeAt`
 * (distance parcourue) quand on la donne.
 */
export const eastwardTrack = (
  speedsMs: number[],
  stepSeconds = 1,
  options: { altitudeAt?: (distanceM: number) => number } = {},
): TrackPoint[] => {
  const perDegLon = mPerDegLon(ORIGIN.lat);
  let meters = 0;
  return speedsMs.map((speedMs, i) => {
    if (i > 0) meters += speedMs * stepSeconds;
    const timeMs = T0 + i * stepSeconds * 1000;
    return {
      lat: ORIGIN.lat,
      lon: ORIGIN.lon + meters / perDegLon,
      time: new Date(timeMs).toISOString(),
      timeMs,
      ...(options.altitudeAt ? { ele: options.altitudeAt(meters) } : {}),
      speedMs,
      smoothedSpeedMs: speedMs,
      bearing: 90,
      speedSource: 'derived' as const,
    };
  });
};

/**
 * Trace brute vers l'est, `hz` points par seconde, à la vitesse de chaque phase
 * (`[durée en s, vitesse en m/s]`), un premier point au départ. `climbPerS`, facultatif,
 * fait monter l'altitude (10 m au départ) d'autant de mètres par seconde.
 */
export const phasesTrack = (
  phases: [number, number][],
  hz = 1,
  options: { startMs?: number; climbPerS?: number } = {},
): RawTrackPoint[] => {
  const startMs = options.startMs ?? T0;
  const step = 1 / hz;
  const perDegLon = mPerDegLon(ORIGIN.lat);
  const points: RawTrackPoint[] = [];
  let meters = 0;
  let t = 0;
  const push = () =>
    points.push({
      lat: ORIGIN.lat,
      lon: ORIGIN.lon + meters / perDegLon,
      time: new Date(startMs + Math.round(t * 1000)).toISOString(),
      ele: options.climbPerS === undefined ? undefined : 10 + options.climbPerS * t,
    });
  push();
  for (const [durationS, speedMs] of phases) {
    for (let i = 0; i < Math.round(durationS * hz); i++) {
      meters += speedMs * step;
      t += step;
      push();
    }
  }
  return points;
};

/** Positions vers le nord, `stepM` mètres par seconde depuis 43,6 N ; `extra` s'ajoute à chaque position. */
export const headingTrack = (count: number, stepM: number, extra: Partial<LocationFix> = {}): LocationFix[] =>
  Array.from({ length: count }, (_, i) => ({ timeMs: i * 1000, lat: ORIGIN.lat + (i * stepM) / M_PER_DEG_LAT, lon: ORIGIN.lon, ...extra }));
