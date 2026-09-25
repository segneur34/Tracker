import { segmentDistanceM } from '../core/sessionStats';
import { SLOW_COLOR, gradientColor, type SpeedRangeMs } from '../core/speedGradient';
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

/** Bornes du dégradé de couleur de la pente, en fraction (0,25 = 25 %). */
export interface GradeRange {
  min: number;
  max: number;
}

/**
 * Bornes par défaut de la couleur de la courbe d'altitude : du plat à 25 %,
 * au-delà de quoi la couleur ne change plus.
 */
export const DEFAULT_GRADE_RANGE: GradeRange = { min: 0, max: 0.25 };

/** Vrai pour des bornes utilisables : finies, basse positive ou nulle, haute au-dessus. */
export const isValidGradeRange = (range: { min?: unknown; max?: unknown }): range is GradeRange =>
  typeof range.min === 'number' && typeof range.max === 'number' &&
  isFinite(range.min) && isFinite(range.max) && range.min >= 0 && range.max > range.min;

/**
 * Couleur d'une pente, sur la palette de la trace. La raideur seule compte :
 * une descente à 20 % a la couleur d'une montée à 20 %, le sens se lit sur la
 * courbe. Gris sous la borne basse et là où la pente manque.
 */
export const gradeGradientColor = (grade: number, range: GradeRange): string => {
  const steepness = Math.abs(grade);
  if (!isFinite(steepness) || steepness < range.min) return SLOW_COLOR;
  return gradientColor((steepness - range.min) / (range.max - range.min));
};

/** Arrêt d'un dégradé SVG horizontal : position de 0 à 1 et couleur. */
export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * Arrêts du dégradé horizontal qui colore la courbe d'altitude, un par ligne
 * du graphe, placés selon la distance entre la première et la dernière ligne
 * (l'étendue de l'aire tracée). Dans une suite de couleurs identiques, seuls
 * le premier et le dernier arrêt sont gardés : le rendu ne change pas, le
 * nombre d'arrêts fond sur le plat.
 */
export const gradeGradientStops = (
  rows: { dist: number; grade: number | null }[],
  range: GradeRange
): GradientStop[] => {
  if (rows.length === 0) return [];
  const start = rows[0].dist;
  const span = rows[rows.length - 1].dist - start;
  const stops: GradientStop[] = [];
  for (const row of rows) {
    const stop = {
      offset: span > 0 ? (row.dist - start) / span : 0,
      color: gradeGradientColor(row.grade ?? NaN, range),
    };
    const n = stops.length;
    // Troisième arrêt de même couleur à la suite : il prolonge le précédent.
    if (n >= 2 && stops[n - 1].color === stop.color && stops[n - 2].color === stop.color) stops[n - 1] = stop;
    else stops.push(stop);
  }
  return stops;
};
