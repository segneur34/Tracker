import { describe, expect, it } from 'vitest';
import { INTERVAL_PACE_MIN_SPEED_MS, isInverseUnit, toDisplaySpeed, type DistanceUnit, type SpeedUnit } from '../core/units';
import { intervalChartData, SPARK_SMOOTHING_S, sparkPoints } from './intervalCharts';
import type { IntervalRep, IntervalSummary } from './intervalStats';

/**
 * Calculs de `IntervalAnalysis` avant le lot 61, recopiés tels quels (copie
 * gelée) : mini-courbes et leur échelle, lignes de l'évolution (sans la
 * couleur ni « sur la carte », posées au rendu), lignes et échelle du profil.
 */
const frozenSparkPoints = (rep: IntervalRep, stepS: number): (number | null)[] => {
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

const frozen = (series: { reps: IntervalRep[]; summary: IntervalSummary }[], stepS: number, speedUnit: SpeedUnit, distanceUnit: DistanceUnit) => {
  const inverse = isInverseUnit(speedUnit);
  const display = (ms: number | null): number | null =>
    ms === null || !isFinite(ms) || (inverse && ms < INTERVAL_PACE_MIN_SPEED_MS) ? null : parseFloat(toDisplaySpeed(ms, speedUnit, distanceUnit).toFixed(2));
  return series.map((s) => {
    // Tableau des répétitions.
    const sparks = new Map(s.reps.map((r) => [r.rep, frozenSparkPoints(r, stepS)]));
    const sparkLength = Math.max(0, ...s.reps.map((r) => r.profile.length));
    const values = [...sparks.values()].flat().filter((v): v is number => v !== null);
    const sparkDomain = values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
    // Évolution.
    const trend = s.summary.trend;
    const reps = s.reps.filter((r) => r.work.speedMs !== null);
    const first = reps[0]?.rep ?? 1;
    const last = reps[reps.length - 1]?.rep ?? 1;
    const at = (rep: number) => (trend && last > first ? trend.firstMs + ((trend.lastMs - trend.firstMs) * (rep - first)) / (last - first) : null);
    const evolution = reps.map((r) => ({
      rep: r.rep,
      repIndex: s.reps.indexOf(r),
      speed: display(r.work.speedMs), speedMs: r.work.speedMs,
      trend: display(at(r.rep)), trendMs: at(r.rep),
      mean: display(s.summary.meanSpeedMs), meanMs: s.summary.meanSpeedMs,
    }));
    // Profil.
    const length = Math.max(0, ...s.reps.map((r) => r.profile.length));
    const data = Array.from({ length }, (_, k) => {
      const row: Record<string, number | null> = { t: parseFloat(((k + 0.5) * stepS).toFixed(2)) };
      row.mean = display(s.summary.meanProfile[k] ?? null);
      row.meanMs = s.summary.meanProfile[k] ?? null;
      s.reps.forEach((r) => {
        row[`r${r.rep}`] = display(r.profile[k] ?? null);
        row[`r${r.rep}Ms`] = r.profile[k] ?? null;
      });
      return row;
    });
    const launched = s.reps.flatMap((r) => frozenSparkPoints(r, stepS)).filter((v): v is number => v !== null);
    let domain: [number, number] | undefined;
    if (launched.length > 1) {
      const lo = Math.min(...launched);
      const hi = Math.max(...launched);
      const pad = Math.max((hi - lo) * 0.25, hi * 0.02);
      const ends = [display(Math.max(lo - pad, INTERVAL_PACE_MIN_SPEED_MS)), display(hi + pad)].filter((v): v is number => v !== null);
      if (ends.length === 2) domain = [Math.min(...ends), Math.max(...ends)];
    }
    return { sparks, sparkDomain, sparkLength, evolution: { first, last, rows: evolution }, profile: { rows: data, length, domain } };
  });
};

/** Répétition synthétique : `durationS` secondes au pas `stepS`, départ arrêté, trous aux pas multiples de `holeEvery`. */
const rep = (n: number, durationS: number, stepS: number, opts: { speedMs?: number | null; launchS?: number | null; holeEvery?: number; flat?: number } = {}): IntervalRep => {
  const steps = Math.round(durationS / stepS);
  const profile = Array.from({ length: steps }, (_, k) => {
    if (opts.holeEvery && k % opts.holeEvery === opts.holeEvery - 1) return null;
    if (opts.flat !== undefined) return opts.flat;
    const t = (k + 0.5) * stepS;
    return Math.min(5 + 0.1 * n, t * 1.3) - 0.02 * t + 0.13 * Math.sin(t * 2.1 + n);
  });
  const speedMs = opts.speedMs === undefined ? 4.5 - 0.07 * n : opts.speedMs;
  return {
    rep: n,
    work: { kind: 'travail', rep: n, startMs: n * 100_000, endMs: n * 100_000 + durationS * 1000, durationS, distanceM: speedMs === null ? null : speedMs * durationS, speedMs, path: [] },
    rest: null,
    profile,
    launchS: opts.launchS === undefined ? 3.2 : opts.launchS,
    accelMs2: null,
    holdRatio: null,
  };
};

const summaryOf = (reps: IntervalRep[], trend = true): IntervalSummary => {
  const length = Math.max(0, ...reps.map((r) => r.profile.length));
  return {
    count: reps.length,
    meanSpeedMs: reps.length > 0 ? 4.1 : null,
    best: null,
    worst: null,
    regularity: null,
    trend: trend && reps.length >= 3 ? { perRep: -0.01, firstMs: 4.4, lastMs: 3.9 } : null,
    launchS: 3,
    accelMs2: null,
    holdRatio: null,
    meanProfile: Array.from({ length }, (_, k) => (k % 11 === 10 ? null : 3 + 0.01 * k)),
  };
};

const UNITS: [SpeedUnit, DistanceUnit][] = [['kmh', 'km'], ['minkm', 'km'], ['kn', 'nm'], ['ms', 'km']];

const compare = (series: { reps: IntervalRep[]; summary: IntervalSummary }[], stepS: number) => {
  for (const [speedUnit, distanceUnit] of UNITS) {
    const after = intervalChartData(series, stepS, speedUnit, distanceUnit);
    const before = frozen(series, stepS, speedUnit, distanceUnit);
    expect(after).toHaveLength(before.length);
    after.forEach((a, k) => {
      const b = before[k];
      expect([...a.sparks.entries()]).toEqual([...b.sparks.entries()]);
      expect(a.sparkDomain).toEqual(b.sparkDomain);
      expect(a.length).toBe(b.sparkLength);
      expect(a.length).toBe(b.profile.length);
      expect(a.evolution).toEqual(b.evolution);
      expect(JSON.stringify(a.evolution)).toBe(JSON.stringify(b.evolution));
      expect(a.profile.rows).toEqual(b.profile.rows);
      expect(JSON.stringify(a.profile.rows)).toBe(JSON.stringify(b.profile.rows));
      expect(a.profile.domain).toEqual(b.profile.domain);
    });
  }
};

describe('intervalChartData, copie gelée de IntervalAnalysis', () => {
  for (const stepS of [1, 0.2]) {
    it(`pas de ${stepS} s : huit répétitions, trous, une sans vitesse`, () => {
      const reps = Array.from({ length: 8 }, (_, k) => rep(k + 1, 30 + (k % 3), stepS, { holeEvery: 7, speedMs: k === 4 ? null : undefined }));
      compare([{ reps, summary: summaryOf(reps) }], stepS);
    });

    it(`pas de ${stepS} s : deux séances, sans tendance, lancé inconnu`, () => {
      const a = Array.from({ length: 4 }, (_, k) => rep(k + 1, 20, stepS, { launchS: k === 0 ? null : 2 }));
      const b = Array.from({ length: 3 }, (_, k) => rep(k + 1, 60, stepS));
      compare([{ reps: a, summary: summaryOf(a, false) }, { reps: b, summary: summaryOf(b) }], stepS);
    });

    it(`pas de ${stepS} s : une seule répétition`, () => {
      const reps = [rep(1, 40, stepS)];
      compare([{ reps, summary: summaryOf(reps) }], stepS);
    });

    it(`pas de ${stepS} s : valeurs égales`, () => {
      const reps = Array.from({ length: 5 }, (_, k) => rep(k + 1, 25, stepS, { flat: 4, speedMs: 4 }));
      compare([{ reps, summary: summaryOf(reps) }], stepS);
    });

    it(`pas de ${stepS} s : allure absurde, trou plutôt que valeur`, () => {
      const reps = Array.from({ length: 4 }, (_, k) => rep(k + 1, 20, stepS, { flat: k === 2 ? 0.1 : 3, speedMs: k === 1 ? 0.2 : 3 }));
      compare([{ reps, summary: summaryOf(reps) }], stepS);
      const minkm = intervalChartData([{ reps, summary: summaryOf(reps) }], stepS, 'minkm', 'km')[0];
      expect(minkm.evolution.rows[1].speed).toBeNull();
      expect(minkm.profile.rows.some((r) => r.r3 === null && r.r3Ms === 0.1)).toBe(true);
    });
  }

  it('sans répétition, et répétitions sans profil', () => {
    compare([{ reps: [], summary: summaryOf([]) }], 1);
    const reps = [rep(1, 0, 1), rep(2, 0, 1)];
    compare([{ reps, summary: summaryOf(reps) }], 1);
    expect(intervalChartData([{ reps, summary: summaryOf(reps) }], 1, 'kmh', 'km')[0].sparkDomain).toEqual({ min: 0, max: 1 });
  });

  it('sparkPoints reste la mini-courbe d’avant', () => {
    const r = rep(3, 30, 0.2, { holeEvery: 5 });
    expect(sparkPoints(r, 0.2)).toEqual(frozenSparkPoints(r, 0.2));
  });
});
