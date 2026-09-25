import { segmentDistanceM } from '../core/sessionStats';
import type { SpeedRangeMs } from '../core/speedGradient';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { formatDuration, formatPace, msToKmh } from '../core/units';

/**
 * Analyse propre à la course à pied : pente locale, zones de terrain, allures
 * par zone. Tout repose sur l'altitude lissée et la distance cumulée fournies
 * par le noyau.
 */

/** Demi-largeur, en mètres, de la fenêtre sur laquelle la pente est mesurée. */
export const GRADE_HALF_WINDOW_M = 25;

/** Pente, en fraction, au-dessous de laquelle le terrain est considéré plat. */
export const FLAT_MAX_GRADE = 0.03;
/** Pente, en fraction, à partir de laquelle une montée ou une descente est raide. */
export const STEEP_MIN_GRADE = 0.1;

export type GradeZoneKey = 'steepDown' | 'down' | 'flat' | 'up' | 'steepUp';

export interface GradeZone {
  key: GradeZoneKey;
  label: string;
  /** Description de la plage de pente, pour l'affichage. */
  range: string;
}

export const GRADE_ZONES: GradeZone[] = [
  { key: 'steepUp', label: 'Montée raide', range: `≥ ${STEEP_MIN_GRADE * 100} %` },
  { key: 'up', label: 'Montée', range: `${FLAT_MAX_GRADE * 100} à ${STEEP_MIN_GRADE * 100} %` },
  { key: 'flat', label: 'À peu près plat', range: `± ${FLAT_MAX_GRADE * 100} %` },
  { key: 'down', label: 'Descente', range: `-${FLAT_MAX_GRADE * 100} à -${STEEP_MIN_GRADE * 100} %` },
  { key: 'steepDown', label: 'Descente raide', range: `≤ -${STEEP_MIN_GRADE * 100} %` },
];

export const classifyGrade = (grade: number): GradeZoneKey | null => {
  if (!isFinite(grade)) return null;
  if (grade >= STEEP_MIN_GRADE) return 'steepUp';
  if (grade >= FLAT_MAX_GRADE) return 'up';
  if (grade > -FLAT_MAX_GRADE) return 'flat';
  if (grade > -STEEP_MIN_GRADE) return 'down';
  return 'steepDown';
};

/**
 * Pente locale en chaque point, en fraction (0,05 = 5 %), mesurée entre les
 * points situés à `halfWindowM` avant et après le long de la trace.
 *
 * Une pente calculée entre deux points consécutifs serait dominée par le bruit
 * de l'altitude : quelques dizaines de centimètres d'erreur sur cinq mètres
 * font dix pour cent. Sur cinquante mètres, l'erreur devient négligeable.
 *
 * `NaN` là où l'altitude manque ou la fenêtre ne peut pas être établie.
 */
export const computeGrades = (
  smoothedEle: number[],
  cum: CumulativeTrack,
  halfWindowM = GRADE_HALF_WINDOW_M
): number[] => {
  const n = smoothedEle.length;
  const grades = new Array<number>(n).fill(NaN);
  if (n < 2) return grades;

  let back = 0;
  let ahead = 0;

  for (let i = 0; i < n; i++) {
    const d = cum.cumDist[i];
    while (back < i && d - cum.cumDist[back] > halfWindowM) back++;
    if (ahead < i) ahead = i;
    while (ahead + 1 < n && cum.cumDist[ahead + 1] - d <= halfWindowM) ahead++;

    // Aux extrémités, la fenêtre est tronquée d'un côté : on l'accepte tant
    // qu'elle couvre au moins la moitié de la largeur voulue.
    const span = cum.cumDist[ahead] - cum.cumDist[back];
    if (span < halfWindowM) continue;

    const eleBack = smoothedEle[back];
    const eleAhead = smoothedEle[ahead];
    if (!isFinite(eleBack) || !isFinite(eleAhead)) continue;

    grades[i] = (eleAhead - eleBack) / span;
  }

  return grades;
};

export interface ZoneStats {
  zone: GradeZone;
  distanceM: number;
  timeMs: number;
  /** Vitesse moyenne en mouvement dans la zone, en m/s, ou `null` si aucune donnée. */
  avgSpeedMs: number | null;
  /** Part de la distance totale en mouvement. */
  distanceShare: number;
  /** Mêmes valeurs, formatées (la distance l'est à l'affichage, dans l'unité de l'activité). */
  time: string;
  pace: string;
  speedKmh: string;
}

/**
 * Distance, temps et allure moyenne par zone de pente, sur les seuls segments
 * en mouvement : une pause en haut d'une côte ne doit pas peser sur l'allure
 * de la montée.
 */
export const computeZoneStats = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[]
): ZoneStats[] => {
  const acc: Record<GradeZoneKey, { distanceM: number; timeMs: number }> = {
    steepDown: { distanceM: 0, timeMs: 0 },
    down: { distanceM: 0, timeMs: 0 },
    flat: { distanceM: 0, timeMs: 0 },
    up: { distanceM: 0, timeMs: 0 },
    steepUp: { distanceM: 0, timeMs: 0 },
  };
  let movingDistanceM = 0;

  for (let i = 1; i < track.length; i++) {
    if (!activityMask[i]) continue;
    const zone = classifyGrade(grades[i]);
    if (zone === null) continue;
    const d = segmentDistanceM(track, i);
    acc[zone].distanceM += d;
    acc[zone].timeMs += track[i].timeMs - track[i - 1].timeMs;
    movingDistanceM += d;
  }

  return GRADE_ZONES.map((zone) => {
    const { distanceM, timeMs } = acc[zone.key];
    const avgSpeedMs = timeMs > 0 ? distanceM / (timeMs / 1000) : null;
    return {
      zone,
      distanceM,
      timeMs,
      avgSpeedMs,
      distanceShare: movingDistanceM > 0 ? distanceM / movingDistanceM : 0,
      time: formatDuration(timeMs),
      pace: avgSpeedMs === null ? '-' : `${formatPace(avgSpeedMs)} /km`,
      speedKmh: avgSpeedMs === null ? '-' : `${msToKmh(avgSpeedMs).toFixed(1)} km/h`,
    };
  });
};

/** Allure et vitesse moyennes d'une distance parcourue en un temps donné. */
export const averagePace = (distanceM: number, timeMs: number): { pace: string; speedKmh: string; speedMs: number | null } => {
  if (timeMs <= 0 || distanceM <= 0) return { pace: '-', speedKmh: '-', speedMs: null };
  const speedMs = distanceM / (timeMs / 1000);
  return { pace: `${formatPace(speedMs)} /km`, speedKmh: `${msToKmh(speedMs).toFixed(1)} km/h`, speedMs };
};

/**
 * Bornes par défaut du dégradé de couleur de la trace (`core/speedGradient.ts`),
 * en m/s : 4 km/h, la marche, et 15 km/h.
 */
export const DEFAULT_SPEED_RANGE_MS: SpeedRangeMs = { minMs: 4 / 3.6, maxMs: 15 / 3.6 };
