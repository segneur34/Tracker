/**
 * Lignes des graphes de l'onglet « fractionné », pour chaque séance : les
 * mini-courbes des répétitions et leur échelle commune, l'évolution de leur
 * vitesse avec sa tendance, le profil superposé d'une répétition et son
 * échelle. Calculées une fois par séance et par unité, pas à chaque rendu ;
 * en unités affichées (sortie, `core/units`), la vitesse en m/s gardée à côté
 * (`<clé>Ms`) pour les lectures.
 */
import { INTERVAL_PACE_MIN_SPEED_MS, isInverseUnit, toDisplaySpeed, type DistanceUnit, type SpeedUnit } from '../core/units';
import type { IntervalRep, IntervalSummary } from './intervalStats';

/** Lissage des mini-courbes, pour l'affichage seulement, en secondes. */
export const SPARK_SMOOTHING_S = 5;

/** Ce que lisent les graphes d'une séance. */
export interface IntervalChartSeries {
  reps: IntervalRep[];
  summary: IntervalSummary;
}

/** Ligne de l'évolution : une répétition parcourue ; sa couleur et « sur la carte » se posent au rendu. */
export interface IntervalEvolutionRow {
  rep: number;
  /** Rang de la répétition dans la séance, depuis 0 : sa couleur. */
  repIndex: number;
  speed: number | null;
  speedMs: number | null;
  trend: number | null;
  trendMs: number | null;
  mean: number | null;
  meanMs: number | null;
}

/** Ligne du profil d'une répétition : `t` en secondes depuis le départ, puis `mean`, `r<n>` et leur vitesse en m/s (`<clé>Ms`). */
export type IntervalProfileRow = Record<string, number | null>;

/** Graphes d'une séance. */
export interface IntervalSeriesCharts {
  /** Mini-courbe de chaque répétition, par numéro (`sparkPoints`). */
  sparks: Map<number, (number | null)[]>;
  /** Échelle commune des mini-courbes, en m/s. */
  sparkDomain: { min: number; max: number };
  /** Pas du plus long profil : la largeur des mini-courbes et du profil. */
  length: number;
  /** Évolution : première et dernière répétition parcourues, et leurs lignes. */
  evolution: { first: number; last: number; rows: IntervalEvolutionRow[] };
  /** Profil superposé, et son échelle en unités affichées (`undefined` : celle de Recharts). */
  profile: { rows: IntervalProfileRow[]; domain: [number, number] | undefined };
}

/**
 * Points de la mini-courbe d'une répétition : son profil une fois lancé
 * (comme le maintien), lissé sur `SPARK_SMOOTHING_S` pour l'affichage
 * seulement. Avant la mise en vitesse, `null` : l'échelle commune ne
 * s'étire pas jusqu'au départ arrêté, et la baisse en fin de répétition se voit.
 */
export const sparkPoints = (rep: IntervalRep, stepS: number): (number | null)[] => {
  const from = rep.launchS ?? 0;
  const half = Math.max(0, Math.round(SPARK_SMOOTHING_S / stepS / 2));
  const launched = (k: number) => (k + 0.5) * stepS >= from;
  return rep.profile.map((v, k) => {
    if (v === null || !launched(k)) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(rep.profile.length - 1, k + half); j++) {
      const w = rep.profile[j];
      if (w !== null && launched(j)) {
        sum += w;
        n += 1;
      }
    }
    return sum / n;
  });
};

/**
 * Graphes de chaque séance, dans l'ordre de `series` : `stepS` est le pas du
 * profil de vitesse, en secondes. Une allure sous `INTERVAL_PACE_MIN_SPEED_MS`
 * laisse un trou plutôt qu'une valeur absurde.
 */
export const intervalChartData = (
  series: ReadonlyArray<IntervalChartSeries>,
  stepS: number,
  speedUnit: SpeedUnit,
  distanceUnit: DistanceUnit
): IntervalSeriesCharts[] => {
  const inverse = isInverseUnit(speedUnit);
  const display = (ms: number | null): number | null =>
    ms === null || !isFinite(ms) || (inverse && ms < INTERVAL_PACE_MIN_SPEED_MS) ? null : parseFloat(toDisplaySpeed(ms, speedUnit, distanceUnit).toFixed(2));

  return series.map((s): IntervalSeriesCharts => {
    // Mini-courbes, et leur échelle : celle de la partie lancée de chaque répétition, que le profil reprend.
    const sparks = new Map<number, (number | null)[]>();
    let lo = Infinity;
    let hi = -Infinity;
    let launchedCount = 0;
    let length = 0;
    for (const r of s.reps) {
      const points = sparkPoints(r, stepS);
      sparks.set(r.rep, points);
      for (const v of points) {
        if (v === null) continue;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        launchedCount += 1;
      }
      length = Math.max(length, r.profile.length);
    }
    const sparkDomain = launchedCount > 0 ? { min: lo, max: hi } : { min: 0, max: 1 };

    const { summary } = s;
    const trend = summary.trend;
    const walked = s.reps.filter((r) => r.work.speedMs !== null);
    const first = walked[0]?.rep ?? 1;
    const last = walked[walked.length - 1]?.rep ?? 1;
    const at = (rep: number) => (trend && last > first ? trend.firstMs + ((trend.lastMs - trend.firstMs) * (rep - first)) / (last - first) : null);
    const evolutionRows = walked.map((r): IntervalEvolutionRow => ({
      rep: r.rep,
      repIndex: s.reps.indexOf(r),
      speed: display(r.work.speedMs), speedMs: r.work.speedMs,
      trend: display(at(r.rep)), trendMs: at(r.rep),
      mean: display(summary.meanSpeedMs), meanMs: summary.meanSpeedMs,
    }));

    const profileRows = Array.from({ length }, (_, k) => {
      const row: IntervalProfileRow = { t: parseFloat(((k + 0.5) * stepS).toFixed(2)) };
      row.mean = display(summary.meanProfile[k] ?? null);
      row.meanMs = summary.meanProfile[k] ?? null;
      s.reps.forEach((r) => {
        row[`r${r.rep}`] = display(r.profile[k] ?? null);
        row[`r${r.rep}Ms`] = r.profile[k] ?? null;
      });
      return row;
    });
    // Échelle de la partie lancée de chaque répétition, comme les mini-courbes : le départ arrêté sort par le bas.
    let domain: [number, number] | undefined;
    if (launchedCount > 1) {
      const pad = Math.max((hi - lo) * 0.25, hi * 0.02);
      const ends = [display(Math.max(lo - pad, INTERVAL_PACE_MIN_SPEED_MS)), display(hi + pad)].filter((v): v is number => v !== null);
      if (ends.length === 2) domain = [Math.min(ends[0], ends[1]), Math.max(ends[0], ends[1])];
    }

    return { sparks, sparkDomain, length, evolution: { first, last, rows: evolutionRows }, profile: { rows: profileRows, domain } };
  });
};
