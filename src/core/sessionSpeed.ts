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

import { medianOfSorted } from './basics';
import { haversineDistance } from './geo';
import {
  detectTrackDeviceSpeedUnit,
  DEVICE_SPEED_FACTOR,
  rawPointTimeMs,
  spreadEqualTimes,
  type DeviceSpeedUnit,
  type KinematicsOptions,
} from './kinematics';
import { DEFAULT_MAX_ACCELERATION } from './speedFilter';
import { MAX_GAP_S, SAILING_SPORTS, type SportProfile } from './sportProfiles';
import type { RawTrackPoint } from './types';

/**
 * Part de la session qui doit être plus lente que la vitesse de référence.
 * Un maximum se laisserait fixer par la première aberration venue ; le
 * neuvième décile décrit l'allure réellement tenue.
 */
const REFERENCE_PERCENTILE = 0.9;

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
 *
 * Le pas de reprise après une pause (`segmentStart`) et le pas plus long que
 * `maxGapS` (trou de la trace, `SportProfile.maxGapS`) sont écartés (lot 99) :
 * leur vitesse est une moyenne sur un chemin inconnu, presque nulle quand le
 * pas enjambe une pause ou un arrêt, et ne dit rien de l'allure tenue ; la
 * cinématique ne leur prête pas non plus de vitesse propre (règle 6 : seule
 * leur distance est bornée, `gapDistanceM`). Une trace faite uniquement de
 * trous ou de reprises (cadence économique, règle 10) les garde, faute d'autre mesure, avec
 * une durée plafonnée à `maxGapS` : sans ce plafond, le point qui précède une
 * coupure de trois quarts d'heure pèserait autant que tout le reste.
 *
 * `deviceUnit` : unité de la vitesse appareil déjà détectée
 * (`detectTrackDeviceSpeedUnit`, `null` sans vitesse appareil) ; absente, elle
 * est détectée ici.
 */
export const referenceSpeedMs = (
  points: RawTrackPoint[], deviceUnit?: DeviceSpeedUnit | null, maxGapS: number = MAX_GAP_S
): number => {
  if (points.length < 2) return 0;

  const unit = deviceUnit === undefined ? detectTrackDeviceSpeedUnit(points) : deviceUnit;
  const deviceFactor = unit === null ? 0 : DEVICE_SPEED_FACTOR[unit];

  // Points d'une même date répartis dans leur intervalle, comme dans `computeKinematics`.
  const timesMs = spreadEqualTimes(points, points.map(rawPointTimeMs));
  const reference = referenceOf(points, timesMs, unit, deviceFactor, maxGapS, false);
  // Rien que des trous ou des reprises : ils restent la seule mesure, comme avant le lot 99.
  return reference ?? referenceOf(points, timesMs, unit, deviceFactor, maxGapS, true) ?? 0;
};

/**
 * Pas compté dans l'allure : ni la reprise d'une pause (le pas qui mène au
 * point `segmentStart` enjambe la pause) ni un trou plus long que `maxGapS`,
 * sauf `keepGaps` (repli, où tous les pas comptent, durée plafonnée à
 * `maxGapS`). Une durée illisible (NaN) passe, vers le repli lent.
 */
const keptStep = (point: RawTrackPoint, dt: number, maxGapS: number, keepGaps: boolean): boolean =>
  keepGaps || (!point.segmentStart && !(dt > maxGapS));

/** Neuvième décile pondéré des pas retenus (`keptStep`), `null` s'il n'en reste aucun. */
const referenceOf = (
  points: RawTrackPoint[], timesMs: number[], unit: DeviceSpeedUnit | null, deviceFactor: number,
  maxGapS: number, keepGaps: boolean
): number | null => {

  // Échantillons en tableaux typés, triés par indices (lot 56).
  const speeds = new Float64Array(points.length - 1);
  const weights = new Float64Array(points.length - 1);
  let size = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    if (dt <= 0 || !keptStep(points[i], dt, maxGapS, keepGaps)) continue;

    const p0 = points[i - 1];
    const p1 = points[i];
    const derived = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon) / dt;
    const speed =
      unit !== null && p1.speedMs !== undefined ? p1.speedMs * deviceFactor : derived;

    // Date illisible ou vitesse NaN : le tri d'un NaN n'est pas sûr, on garde le calcul d'origine.
    if (Number.isNaN(dt) || Number.isNaN(speed)) return referenceFromSamples(points, timesMs, unit, deviceFactor, maxGapS, keepGaps);
    speeds[size] = speed;
    weights[size] = Math.min(dt, maxGapS);
    size++;
  }

  if (size === 0) return null;

  const order = stableSortedOrder(speeds, size);
  let totalWeight = 0;
  for (let k = 0; k < size; k++) totalWeight += weights[order[k]];
  const target = totalWeight * REFERENCE_PERCENTILE;

  let cumulated = 0;
  for (let k = 0; k < size; k++) {
    cumulated += weights[order[k]];
    if (cumulated >= target) return speeds[order[k]];
  }
  return speeds[order[size - 1]];
};

/**
 * Indices des `size` premières valeurs (sans NaN) dans l'ordre du tri stable
 * `(a, b) => a - b` : croissantes, et à égalité (−0 et +0 compris) dans
 * l'ordre des indices. Tri natif des valeurs, puis rangement par comptage :
 * sans fonction de comparaison, plusieurs fois plus rapide (lot 56).
 */
const stableSortedOrder = (values: Float64Array, size: number): Uint32Array => {
  const sorted = values.slice(0, size).sort();
  // Valeurs distinctes, croissantes ; −0 et +0 n'en font qu'une.
  const distinct = new Float64Array(size);
  let count = 0;
  for (let k = 0; k < size; k++) if (count === 0 || sorted[k] !== distinct[count - 1]) distinct[count++] = sorted[k];
  const groupOf = new Uint32Array(size);
  const starts = new Uint32Array(count + 1);
  for (let k = 0; k < size; k++) {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (distinct[mid] < values[k]) lo = mid + 1;
      else hi = mid;
    }
    groupOf[k] = lo;
    starts[lo + 1]++;
  }
  for (let g = 0; g < count; g++) starts[g + 1] += starts[g];
  const order = new Uint32Array(size);
  for (let k = 0; k < size; k++) order[starts[groupOf[k]]++] = k;
  return order;
};

/** `referenceSpeedMs` d'avant le lot 56, objets et tri, pour une trace qui porte une date illisible. */
const referenceFromSamples = (
  points: RawTrackPoint[], timesMs: number[], unit: DeviceSpeedUnit | null, deviceFactor: number,
  maxGapS: number, keepGaps: boolean
): number | null => {
  const samples: { speed: number; weight: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    if (dt <= 0 || !keptStep(points[i], dt, maxGapS, keepGaps)) continue;

    const p0 = points[i - 1];
    const p1 = points[i];
    const derived = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon) / dt;
    const speed =
      unit !== null && p1.speedMs !== undefined ? p1.speedMs * deviceFactor : derived;

    samples.push({ speed, weight: Math.min(dt, maxGapS) });
  }

  if (samples.length === 0) return null;

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
 * par point, ne décrit ni une accélération ni le détail d'un virage. Les dates
 * égales d'un fichier tronqué à la seconde sont réparties comme pour la
 * cinématique (`spreadEqualTimes`) : un 5 Hz tronqué donne 0,2 s, pas 1 s.
 * Des points sans position (FC seule) gardent leurs dates.
 */
export const samplingIntervalS = (
  points: ReadonlyArray<Pick<RawTrackPoint, 'time' | 'rawTimeMs'> & { lat?: number; lon?: number }>
): number => {
  if (points.length < 2) return 0;
  const timesMs = spreadEqualTimes(points, points.map(rawPointTimeMs));

  // Écarts tous positifs et finis : le tri numérique d'un tableau typé les range comme `(a, b) => a - b`.
  const gaps = new Float64Array(points.length - 1);
  let size = 0;
  let previousMs = timesMs[0];
  for (let i = 1; i < points.length; i++) {
    const timeMs = timesMs[i];
    if (timeMs > previousMs) gaps[size++] = (timeMs - previousMs) / 1000;
    previousMs = timeMs;
  }

  if (size === 0) return 0;
  return medianOfSorted(gaps.subarray(0, size).sort());
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

/** Ce que les filtres de la cinématique lisent du profil d'un calcul. */
export type KinematicsProfile = Pick<SportProfile, 'id' | 'medianWindowSeconds' | 'maxDetourRatio' | 'maxPlausibleSpeedMs' | 'maxGapS'>;

/**
 * Filtres accordés à l'allure de la session : en voile seulement, bateau
 * compris (règle 4). Les modules d'analyse et le résumé de la bibliothèque
 * (`library/summary.ts`, `analysisTrack`) en décident ici, pour donner les
 * mêmes chiffres.
 */
export const scalesFiltersToSession = (profile: Pick<SportProfile, 'id'>): boolean => SAILING_SPORTS.includes(profile.id);

/**
 * Options de la cinématique tirées du profil d'un calcul (lot 72) : fenêtre
 * médiane, détour, plafond de vitesse, trou de trace ; accélération et
 * plafond accordés à l'allure de la session (`referenceMs`, en m/s) si
 * `scaleToSession`, sinon le plafond du support seul. Une seule écriture,
 * lue par l'analyse (`useGpxSession`) et par le résumé (`analysisTrack`).
 */
export const kinematicsOptionsOf = (
  profile: KinematicsProfile,
  { scaleToSession, referenceMs }: { scaleToSession: boolean; referenceMs: number }
): KinematicsOptions => {
  const filters = scaleToSession
    ? sessionFilterThresholds(referenceMs, profile.maxPlausibleSpeedMs)
    : { maxAcceleration: undefined, maxSpeedMs: profile.maxPlausibleSpeedMs };
  return {
    medianWindowSeconds: profile.medianWindowSeconds,
    maxDetourRatio: profile.maxDetourRatio,
    maxAcceleration: filters.maxAcceleration,
    maxSpeedMs: filters.maxSpeedMs,
    maxGapS: profile.maxGapS,
  };
};
