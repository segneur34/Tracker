import { segmentDistanceM } from '../core/sessionStats';
import { SLOW_COLOR, gradientColor, type SpeedRangeMs } from '../core/speedGradient';
import type { GradeProfile } from '../core/sportProfiles';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { formatDuration, formatPace, kmhToMs, msToKmh, speedUnitSymbol, type DistanceUnit } from '../core/units';

/**
 * Analyse propre à la course à pied : pente locale, zones de terrain, allures
 * par zone. Tout repose sur l'altitude lissée et la distance cumulée fournies
 * par le noyau ; la fenêtre et les seuils des zones viennent du profil
 * (`SportProfile.grade`).
 */

export type GradeZoneKey = 'steepDown' | 'down' | 'flat' | 'up' | 'steepUp';

export interface GradeZone {
  key: GradeZoneKey;
  label: string;
  /** Description de la plage de pente, pour l'affichage. */
  range: string;
}

/** Les zones de pente, de la montée raide à la descente raide, avec leurs plages. */
export const gradeZones = (p: GradeProfile): GradeZone[] => {
  const flat = p.flatMaxGrade * 100;
  const steep = p.steepMinGrade * 100;
  return [
    { key: 'steepUp', label: 'Montée raide', range: `≥ ${steep} %` },
    { key: 'up', label: 'Montée', range: `${flat} à ${steep} %` },
    { key: 'flat', label: 'À peu près plat', range: `± ${flat} %` },
    { key: 'down', label: 'Descente', range: `-${flat} à -${steep} %` },
    { key: 'steepDown', label: 'Descente raide', range: `≤ -${steep} %` },
  ];
};

export const classifyGrade = (grade: number, p: GradeProfile): GradeZoneKey | null => {
  if (!isFinite(grade)) return null;
  if (grade >= p.steepMinGrade) return 'steepUp';
  if (grade >= p.flatMaxGrade) return 'up';
  if (grade > -p.flatMaxGrade) return 'flat';
  if (grade > -p.steepMinGrade) return 'down';
  return 'steepDown';
};

/**
 * Pente locale en chaque point, en fraction (0,05 = 5 %), mesurée entre
 * l'altitude à `halfWindowM` avant et après lui le long de la trace.
 *
 * Une pente calculée entre deux points consécutifs serait dominée par le bruit
 * de l'altitude : quelques dizaines de centimètres d'erreur sur cinq mètres
 * font dix pour cent. Sur cinquante mètres, l'erreur devient négligeable.
 *
 * L'altitude aux bornes de la fenêtre est interpolée entre les deux points
 * qui les encadrent : des points espacés de plus de `halfWindowM` (montre
 * économe, vélo rapide) ont leur pente comme les autres (règle 10). La fenêtre
 * ne franchit pas une reprise après pause (`segmentStart` des `points`, s'ils
 * sont donnés) : la distance n'y avance pas, l'altitude peut y sauter.
 *
 * `NaN` là où l'altitude manque à une borne, ou là où la fenêtre, tronquée au
 * bord de la trace ou du segment, couvre moins de `halfWindowM`.
 */
export const computeGrades = (
  smoothedEle: readonly number[],
  cum: Pick<CumulativeTrack, 'cumDist'>,
  halfWindowM: number,
  points?: ReadonlyArray<{ segmentStart?: true }>
): number[] => {
  const n = smoothedEle.length;
  const grades = new Array<number>(n).fill(NaN);
  if (n < 2) return grades;
  const dist = cum.cumDist;

  /** Altitude à la distance `x`, entre les points `k` et `k + 1` qui l'encadrent. */
  const eleBetween = (k: number, x: number): number => {
    const span = dist[k + 1] - dist[k];
    const t = span > 0 ? (x - dist[k]) / span : 0;
    return smoothedEle[k] + t * (smoothedEle[k + 1] - smoothedEle[k]);
  };

  let first = 0;
  while (first < n) {
    // Segment [first, last] : jusqu'à la prochaine reprise.
    let last = first;
    while (last + 1 < n && !points?.[last + 1]?.segmentStart) last++;
    const segStart = dist[first];
    const segEnd = dist[last];
    // Points encadrant les bornes basse et haute : ils n'avancent qu'avec la trace.
    let lowK = first;
    let highK = first;
    for (let i = first; i <= last; i++) {
      const d = dist[i];
      const lo = Math.max(segStart, d - halfWindowM);
      const hi = Math.min(segEnd, d + halfWindowM);
      const span = hi - lo;
      if (!(span >= halfWindowM) || last === first) continue;
      while (lowK + 1 < last && dist[lowK + 1] <= lo) lowK++;
      while (highK + 1 < last && dist[highK + 1] < hi) highK++;
      const eleLo = eleBetween(lowK, lo);
      const eleHi = eleBetween(highK, hi);
      if (!isFinite(eleLo) || !isFinite(eleHi)) continue;
      grades[i] = (eleHi - eleLo) / span;
    }
    first = last + 1;
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
  activityMask: boolean[],
  p: GradeProfile,
  distanceUnit: DistanceUnit = 'km'
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
    const zone = classifyGrade(grades[i], p);
    if (zone === null) continue;
    const d = segmentDistanceM(track, i);
    acc[zone].distanceM += d;
    acc[zone].timeMs += track[i].timeMs - track[i - 1].timeMs;
    movingDistanceM += d;
  }

  return gradeZones(p).map((zone) => {
    const { distanceM, timeMs } = acc[zone.key];
    const avgSpeedMs = timeMs > 0 ? distanceM / (timeMs / 1000) : null;
    return {
      zone,
      distanceM,
      timeMs,
      avgSpeedMs,
      distanceShare: movingDistanceM > 0 ? distanceM / movingDistanceM : 0,
      time: formatDuration(timeMs),
      pace: avgSpeedMs === null ? '-' : `${formatPace(avgSpeedMs, distanceUnit)} ${speedUnitSymbol('minkm', distanceUnit)}`,
      speedKmh: avgSpeedMs === null ? '-' : `${msToKmh(avgSpeedMs).toFixed(1)} km/h`,
    };
  });
};

/**
 * Tracés d'une zone de pente, à montrer sur la carte : les suites de segments
 * en mouvement dont la pente tombe dans la zone, retenus comme par
 * `computeZoneStats` (le segment qui arrive au point `i` porte la pente de
 * `i`). Chaque tracé est une suite de positions `[lat, lon]`, coupée à chaque
 * changement de zone, à chaque pause et là où la pente manque.
 */
export const gradeZonePaths = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  zone: GradeZoneKey,
  p: GradeProfile
): [number, number][][] => {
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  for (let i = 1; i < track.length; i++) {
    if (!activityMask[i] || classifyGrade(grades[i], p) !== zone) {
      current = null;
      continue;
    }
    if (current === null) {
      current = [[track[i - 1].lat, track[i - 1].lon]];
      paths.push(current);
    }
    current.push([track[i].lat, track[i].lon]);
  }
  return paths;
};

/** Allure et vitesse moyennes d'une distance parcourue en un temps donné. */
export const averagePace = (distanceM: number, timeMs: number, distanceUnit: DistanceUnit = 'km'): { pace: string; speedKmh: string; speedMs: number | null } => {
  if (timeMs <= 0 || distanceM <= 0) return { pace: '-', speedKmh: '-', speedMs: null };
  const speedMs = distanceM / (timeMs / 1000);
  return { pace: `${formatPace(speedMs, distanceUnit)} ${speedUnitSymbol('minkm', distanceUnit)}`, speedKmh: `${msToKmh(speedMs).toFixed(1)} km/h`, speedMs };
};

/**
 * Bornes par défaut du dégradé de couleur de la trace (`core/speedGradient.ts`),
 * en m/s : 4 km/h, la marche, et 15 km/h.
 */
export const DEFAULT_SPEED_RANGE_MS: SpeedRangeMs = { minMs: kmhToMs(4), maxMs: kmhToMs(15) };

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

/**
 * Nombre de paliers de la couleur de pente sur la carte : le dégradé reste
 * lisible, et les segments voisins de même palier se fondent en un seul trait.
 */
export const GRADE_COLOR_STEPS = 20;

/** Couleur d'une pente ramenée au plus proche des `steps` paliers entre les bornes ; gris comme `gradeGradientColor`. */
export const gradeStepColor = (grade: number, range: GradeRange, steps = GRADE_COLOR_STEPS): string => {
  const steepness = Math.abs(grade);
  if (!isFinite(steepness) || steepness < range.min) return SLOW_COLOR;
  const t = Math.min(1, (steepness - range.min) / (range.max - range.min));
  return gradientColor(Math.round(t * steps) / steps);
};

/** Un trait de couleur sur la carte : suite de positions `[lat, lon]`. */
export interface ColoredPath {
  positions: [number, number][];
  color: string;
}

/**
 * Trace colorée par la pente, pour la carte : le segment qui arrive au point
 * `i` porte la pente de `i` (comme `gradeZonePaths`), à la couleur de son
 * palier (`gradeStepColor`). Les segments voisins de même couleur forment un
 * seul trait, qui reprend la dernière position du précédent.
 */
export const gradeColorPaths = (
  positions: ReadonlyArray<[number, number]>,
  grades: ReadonlyArray<number | null>,
  range: GradeRange,
  steps = GRADE_COLOR_STEPS
): ColoredPath[] => {
  const paths: ColoredPath[] = [];
  let current: ColoredPath | null = null;
  for (let i = 1; i < positions.length; i++) {
    const color = gradeStepColor(grades[i] ?? NaN, range, steps);
    if (current !== null && current.color === color) {
      current.positions.push(positions[i]);
    } else {
      current = { color, positions: [positions[i - 1], positions[i]] };
      paths.push(current);
    }
  }
  return paths;
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
