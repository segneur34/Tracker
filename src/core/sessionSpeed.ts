/**
 * Régime de vitesse d'une session, et seuils de filtrage qui s'y accordent.
 *
 * Les seuils du filtrage étaient calibrés pour un support rapide : une
 * accélération de 10 m/s² et un plafond de 58 nœuds ne veulent rien dire sur
 * une session de planche où l'on n'a jamais dépassé 10 nœuds, et laissent
 * passer un pic d'enregistrement qui fabrique ensuite un virement inexistant.
 *
 * La session porte pourtant l'information : sa propre vitesse de croisière.
 * Tout se règle donc sur elle, ce qui rend l'analyse insensible à l'échelle du
 * support. Les rapports ci-dessous sont des ordres de grandeur physiques, pas
 * des seuils de support : ceux-ci restent dans `SPORT_PROFILES`, qui borne le
 * résultat.
 */

import { haversineDistance, detectTrackDeviceSpeedUnit, DEVICE_SPEED_FACTOR, pointTimeMs } from './kinematics';
import { DEFAULT_MAX_ACCELERATION } from './speedFilter';
import type { RawTrackPoint } from './types';

/**
 * Part de la session qui doit être plus lente que la vitesse de référence.
 * Un maximum se laisserait fixer par la première aberration venue ; le
 * neuvième décile décrit l'allure réellement tenue.
 */
const REFERENCE_PERCENTILE = 0.9;

/**
 * Durée maximale attribuée à un point, en secondes. Sans ce plafond, le point
 * qui précède une coupure d'enregistrement de trois quarts d'heure pèserait
 * autant que tout le reste de la session.
 */
const MAX_SAMPLE_S = 10;

/**
 * Accélération maximale plausible, par unité de vitesse de référence et par
 * seconde : il faut environ une seconde et quart pour atteindre l'allure de
 * croisière. Au-delà, le point est suspect — ce qui ne le condamne pas, le
 * filtre cherche ensuite si la série revient.
 */
const ACCEL_PER_REFERENCE = 0.8;

/** Accélération minimale retenue, en m/s², pour ne pas figer une session très lente. */
const MIN_ACCEL_MS2 = 2;

/** Plafond de vitesse, en multiple de la référence. Filet de sécurité, borné par le profil. */
const CEILING_PER_REFERENCE = 3;

/**
 * Vitesse de référence de la session, en m/s : le neuvième décile des vitesses
 * brutes, **pondéré par la durée de chaque point** et non par leur nombre.
 *
 * La pondération par la durée est ce qui rend le résultat identique pour une
 * trace à 1 Hz et la même à 5 Hz. Compter les points donnerait deux réponses
 * différentes dès que la fréquence d'enregistrement varie en cours de session.
 *
 * Le calcul porte sur les vitesses brutes, avant tout filtrage, puisque c'est
 * le filtrage qui en dépend.
 */
export const referenceSpeedMs = (points: RawTrackPoint[]): number => {
  if (points.length < 2) return 0;

  const deviceUnit = detectTrackDeviceSpeedUnit(points);
  const deviceFactor = deviceUnit === null ? 0 : DEVICE_SPEED_FACTOR[deviceUnit];

  const samples: { speed: number; weight: number }[] = [];
  let previousMs = pointTimeMs(points[0].time);

  for (let i = 1; i < points.length; i++) {
    const timeMs = pointTimeMs(points[i].time);
    const dt = (timeMs - previousMs) / 1000;
    previousMs = timeMs;
    if (dt <= 0) continue;

    const p0 = points[i - 1];
    const p1 = points[i];
    const derived = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon) / dt;
    const speed =
      deviceUnit !== null && p1.speedMs !== undefined ? p1.speedMs * deviceFactor : derived;

    samples.push({ speed, weight: Math.min(dt, MAX_SAMPLE_S) });
  }

  if (samples.length === 0) return 0;

  samples.sort((a, b) => a.speed - b.speed);
  const totalWeight = samples.reduce((sum, s) => sum + s.weight, 0);
  const target = totalWeight * REFERENCE_PERCENTILE;

  let cumulated = 0;
  for (const sample of samples) {
    cumulated += sample.weight;
    if (cumulated >= target) return sample.speed;
  }
  return samples[samples.length - 1].speed;
};

/**
 * Intervalle médian entre deux points, en secondes, ou 0 si la trace est trop
 * courte.
 *
 * La médiane, et non la moyenne : une session comporte des coupures — un
 * passage à terre, une pause — qui tireraient la moyenne sans rien dire de la
 * cadence réelle. C'est cet intervalle qui décide de ce qu'une trace permet
 * d'analyser : un enregistrement économique, à plusieurs dizaines de secondes
 * par point, ne décrit ni une accélération ni le détail d'un virage.
 */
export const samplingIntervalS = (points: RawTrackPoint[]): number => {
  if (points.length < 2) return 0;

  const gaps: number[] = [];
  let previousMs = pointTimeMs(points[0].time);
  for (let i = 1; i < points.length; i++) {
    const timeMs = pointTimeMs(points[i].time);
    if (timeMs > previousMs) gaps.push((timeMs - previousMs) / 1000);
    previousMs = timeMs;
  }

  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
};

/**
 * Seuils de filtrage accordés à la session.
 *
 * Le plafond du support garde le dernier mot : la mise à l'échelle peut le
 * resserrer, jamais l'ouvrir au-delà de ce qui est physiquement plausible.
 */
export const sessionFilterThresholds = (
  referenceMs: number,
  supportMaxSpeedMs: number
): { maxAcceleration: number; maxSpeedMs: number } => {
  // Trace trop courte ou immobile : on s'en remet aux valeurs du noyau.
  if (referenceMs <= 0) {
    return { maxAcceleration: DEFAULT_MAX_ACCELERATION, maxSpeedMs: supportMaxSpeedMs };
  }
  return {
    maxAcceleration: Math.max(MIN_ACCEL_MS2, ACCEL_PER_REFERENCE * referenceMs),
    maxSpeedMs: Math.min(supportMaxSpeedMs, CEILING_PER_REFERENCE * referenceMs),
  };
};
