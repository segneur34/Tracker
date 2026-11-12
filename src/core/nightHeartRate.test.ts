import { describe, expect, it } from 'vitest';
import type { HeartRateSessionPoint } from './heartRateSession';
import { nightHrResults, nightSessionName, type NightHrResults } from './nightHeartRate';
import { EXAMPLE_NIGHT, NIGHT_HR_TEST, exampleNightHr } from '../recording/nightHrTest';

/** Coucher d'exemple : 12/11/2026 à 23 h 20, heure de Paris (fuseau des tests). */
const T0 = new Date(2026, 10, 12, 23, 20, 0).getTime();
const HOUR_S = 3600;

/**
 * Nuit synthétique : une mesure toutes les `1 / hz` secondes de 0 à `durationS`
 * compris, FC `bpm(t)` ; `keep(t)` faux retire la mesure (trou de la ceinture).
 */
const night = (
  durationS: number,
  bpm: (tS: number) => number,
  { hz = 1, keep = () => true }: { hz?: number; keep?: (tS: number) => boolean } = {}
): HeartRateSessionPoint[] => {
  const stepMs = 1000 / hz;
  const out: HeartRateSessionPoint[] = [];
  for (let k = 0; k * stepMs <= durationS * 1000; k++) {
    const tS = (k * stepMs) / 1000;
    if (k > 0 && k * stepMs < durationS * 1000 && !keep(tS)) continue;
    out.push({ timeMs: T0 + k * stepMs, hr: bpm(tS) });
  }
  return out;
};

const run = (points: HeartRateSessionPoint[], restingBpm?: number | null): NightHrResults => {
  const r = nightHrResults(points, NIGHT_HR_TEST, { restingBpm });
  expect(r).not.toBeNull();
  return r!;
};

/** FC d'exemple tenue sur la seconde entière : le même signal, qu'on le lise à 1 Hz ou à 5 Hz. */
const heldExample = (tS: number) => exampleNightHr(Math.floor(tS));

describe('nightHrResults : règle 2, mêmes chiffres quelle que soit la cadence', () => {
  const at1 = run(night(EXAMPLE_NIGHT.durationS, heldExample));
  const at5 = run(night(EXAMPLE_NIGHT.durationS, heldExample, { hz: 5 }));

  it('même nuit de 8 h à 1 Hz et à 5 Hz : mêmes chiffres', () => {
    expect(at5.durationS).toBe(at1.durationS);
    expect(at5.coveredS).toBeCloseTo(at1.coveredS, 3);
    expect(at5.avgBpm).toBeCloseTo(at1.avgBpm, 6);
    expect(at5.low!.bpm).toBeCloseTo(at1.low!.bpm, 6);
    expect(Math.abs(at5.low!.atMs - at1.low!.atMs)).toBeLessThanOrEqual(60_000);
    expect(at5.surges.map((s) => s.startMs)).toEqual(at1.surges.map((s) => s.startMs));
    expect(at5.halves.first).toBeCloseTo(at1.halves.first!, 6);
    expect(at5.halves.second).toBeCloseTo(at1.halves.second!, 6);
    expect(Math.abs(at5.stabilizedAtMs! - at1.stabilizedAtMs!)).toBeLessThanOrEqual(60_000);
    expect(Math.abs(at5.nearLowS! - at1.nearLowS!)).toBeLessThanOrEqual(60);
    expect(at5.hourly.map((h) => h.startMs)).toEqual(at1.hourly.map((h) => h.startMs));
    at5.hourly.forEach((h, k) => expect(h.avgBpm).toBeCloseTo(at1.hourly[k].avgBpm!, 6));
    expect(at5.quality.gapCount).toBe(0);
    expect(at1.quality.medianStepS).toBe(1);
    expect(at5.quality.medianStepS).toBeCloseTo(0.2, 9);
    expect(at5.curve.length).toBe(at1.curve.length);
  });

  it("nuit d'exemple : creux au milieu, vers 3 h 30 de nuit, trois sursauts à leurs heures", () => {
    expect(at1.low!.place).toBe('milieu');
    expect(at1.low!.bpm).toBeLessThan(52);
    expect(at1.low!.bpm).toBeGreaterThan(48);
    expect(Math.abs((at1.low!.atMs - T0) / 1000 - EXAMPLE_NIGHT.lowAtS)).toBeLessThan(HOUR_S);
    expect(at1.surges).toHaveLength(EXAMPLE_NIGHT.surges.length);
    at1.surges.forEach((s, k) => {
      const centerS = EXAMPLE_NIGHT.surges[k].atS;
      expect((s.startMs - T0) / 1000).toBeGreaterThan(centerS - 60);
      expect((s.endMs - T0) / 1000).toBeLessThan(centerS + 60);
      expect(s.peakBpm - s.baselineBpm).toBeGreaterThanOrEqual(NIGHT_HR_TEST.surge.riseBpm);
    });
    expect(at1.incomplete).toBe(false);
    expect(at1.coverage).toBeCloseTo(1, 6);
    expect(at1.stabilizedAtMs).not.toBeNull();
  });

  it("la nuit d'exemple lue à 5 Hz (sans tenir la seconde) donne les mêmes chiffres, à l'arrondi près", () => {
    const fine = run(night(EXAMPLE_NIGHT.durationS, exampleNightHr, { hz: 5 }));
    const coarse = run(night(EXAMPLE_NIGHT.durationS, exampleNightHr));
    expect(Math.abs(fine.avgBpm - coarse.avgBpm)).toBeLessThan(0.3);
    expect(Math.abs(fine.low!.bpm - coarse.low!.bpm)).toBeLessThan(0.5);
    expect(fine.surges).toHaveLength(coarse.surges.length);
    expect(fine.low!.place).toBe(coarse.low!.place);
  });

  it('une ceinture qui saute des secondes (sous la tenue de 5 s) donne les mêmes chiffres, sans trou', () => {
    const holed = run(night(EXAMPLE_NIGHT.durationS, heldExample, { keep: (t) => t % 7 !== 3 && !(t % 600 >= 100 && t % 600 < 103) }));
    expect(Math.abs(holed.avgBpm - at1.avgBpm)).toBeLessThan(0.2);
    expect(Math.abs(holed.low!.bpm - at1.low!.bpm)).toBeLessThan(0.5);
    expect(holed.surges).toHaveLength(at1.surges.length);
    expect(holed.quality.gapCount).toBe(0);
    expect(holed.quality.maxStepS).toBe(5);
    expect(holed.coverage).toBeCloseTo(1, 6);
  });
});

describe('nightHrResults : trous', () => {
  const flat = (tS: number) => (tS === 3600 ? 80 : 50);
  // Trou de 60 s après la mesure de 3 600 s (une mesure haute), puis un de 30 s.
  const points = night(4 * HOUR_S, flat, { keep: (t) => !(t > 3600 && t < 3660) && !(t > 7200 && t < 7230) });
  const r = run(points);

  it('un trou n\'est jamais comblé au-delà de la tenue de 5 s', () => {
    // 59 s puis 29 s sans mesure, dont 5 s tenues chaque fois.
    expect(r.coveredS).toBeCloseTo(4 * HOUR_S - (60 - 5) - (30 - 5), 6);
    // La mesure haute ne vaut que 5 s : la moyenne n'en est presque pas tirée.
    expect(r.avgBpm).toBeLessThan(50.02);
  });

  it('compte les trous de plus de 10 s, le plus long et son heure, et les intervalles', () => {
    expect(r.quality.gapCount).toBe(2);
    expect(r.quality.longestGap).toEqual({ s: 60, atMs: T0 + 3600 * 1000 });
    expect(r.quality.maxStepS).toBe(60);
    expect(r.quality.medianStepS).toBe(1);
  });

  it('compte le début et la fin sans mesure comme des trous, et ignore les mesures hors des bornes', () => {
    const odd = night(HOUR_S, (t) => (t < 30 ? 300 : t > HOUR_S - 20 ? 10 : 55));
    const res = run(odd);
    expect(res.quality.gapCount).toBe(2);
    expect(res.avgBpm).toBeCloseTo(55, 9);
    expect(res.coveredS).toBeLessThan(HOUR_S - 40);
  });

  it('compte les reprises lues dans les segments du GPX', () => {
    const resumed = night(HOUR_S, () => 55).map((p, i) => (i === 1800 || i === 2400 ? { ...p, segmentStart: true as const } : p));
    expect(run(resumed).quality.resumes).toBe(2);
  });

  it('rend null sans aucune mesure lisible ou sous deux points', () => {
    expect(nightHrResults(night(HOUR_S, () => 0), NIGHT_HR_TEST)).toBeNull();
    expect(nightHrResults([{ timeMs: T0, hr: 50 }], NIGHT_HR_TEST)).toBeNull();
  });
});

describe('nightHrResults : creux, sursauts, nuit courte', () => {
  /** FC de 60 bpm avec un creux de 10 bpm sur 20 min, centré à la fraction `f` de 8 h. */
  const dipAt = (f: number) => (tS: number) => (Math.abs(tS - f * 8 * HOUR_S) < 600 ? 50 : 60);

  it('place le creux en début, au milieu, en fin de nuit', () => {
    for (const [f, place] of [[0.15, 'debut'], [0.5, 'milieu'], [0.85, 'fin']] as const) {
      const r = run(night(8 * HOUR_S, dipAt(f)));
      expect(r.low!.place).toBe(place);
      expect(r.low!.bpm).toBeCloseTo(50, 9);
      expect(Math.abs((r.low!.atMs - T0) / 1000 - f * 8 * HOUR_S)).toBeLessThanOrEqual(450);
    }
  });

  it('compte 2 sursauts, ignore un trop court, réunit deux bosses trop rapprochées', () => {
    const bump = (tS: number) => {
      if (tS >= 3600 && tS < 3630) return 65; // 30 s : un sursaut
      if (tS >= 5400 && tS < 5405) return 65; // 5 s : trop court
      if ((tS >= 7200 && tS < 7220) || (tS >= 7250 && tS < 7270)) return 65; // deux bosses à 30 s : un seul
      return 50;
    };
    const r = run(night(4 * HOUR_S, bump));
    expect(r.surges).toHaveLength(2);
    expect(r.surges[0]).toMatchObject({ startMs: T0 + 3600_000, endMs: T0 + 3630_000, peakBpm: 65, baselineBpm: 50 });
    expect(r.surges[1]).toMatchObject({ startMs: T0 + 7200_000, endMs: T0 + 7270_000 });
  });

  it('dit incomplète une nuit de 2 h, chiffres compris', () => {
    const r = run(night(2 * HOUR_S, heldExample));
    expect(r.incomplete).toBe(true);
    expect(r.low).not.toBeNull();
    expect(r.avgBpm).toBeGreaterThan(0);
  });

  it("donne l'écart à la FC repos en bpm et en %, null sans elle", () => {
    const points = night(4 * HOUR_S, dipAt(0.25));
    expect(run(points).restingGap).toBeNull();
    expect(run(points, null).restingGap).toBeNull();
    const gap = run(points, 55).restingGap!;
    expect(gap.bpm).toBeCloseTo(-5, 9);
    expect(gap.pct).toBeCloseTo((-5 / 55) * 100, 9);
  });

  it('mesure la stabilisation, le temps près du creux et les deux moitiés', () => {
    // 70 bpm la première heure, 50 ensuite, sur 4 h.
    const r = run(night(4 * HOUR_S, (t) => (t < HOUR_S ? 70 : 50)));
    // Lissée sur 300 s, la courbe passe sous 53 bpm vers 1 h 01 min 45 s, sous 55 vers 1 h 01 min 15 s.
    expect(Math.abs((r.stabilizedAtMs! - T0) / 1000 - 3705)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.nearLowS! - (4 * HOUR_S - 3675))).toBeLessThanOrEqual(2);
    expect(r.halves.first).toBeCloseTo(60, 6);
    expect(r.halves.second).toBeCloseTo(50, 6);
  });

  it("range la nuit par heure d'horloge, la première et la dernière coupées", () => {
    // De 23 h 20 à 7 h 20 : 23 h, puis 0 h à 6 h, puis 7 h.
    const r = run(night(8 * HOUR_S, () => 55));
    expect(r.hourly).toHaveLength(9);
    expect(r.hourly[0]).toMatchObject({ startMs: T0, avgBpm: 55 });
    expect(new Date(r.hourly[0].endMs).getHours()).toBe(0);
    for (const h of r.hourly.slice(1)) expect(new Date(h.startMs).getMinutes()).toBe(0);
    expect(r.hourly[8].endMs).toBe(T0 + 8 * HOUR_S * 1000);
    expect(r.hourly[8].coveredS).toBeCloseTo(20 * 60, 6);
  });

  it("une ligne par heure de temps réel aux changements d'heure (automne : deux « 2 h » ; printemps : 1 h puis 3 h)", () => {
    const flat = (startMs: number): HeartRateSessionPoint[] =>
      Array.from({ length: 6 * HOUR_S + 1 }, (_, k) => ({ timeMs: startMs + k * 1000, hr: 55 }));
    // 25/10/2026 : à 3 h d'été, il est 2 h d'hiver. Coucher le 24 à 23 h (21 h UTC), 6 h de nuit.
    const autumn = run(flat(Date.UTC(2026, 9, 24, 21)));
    expect(autumn.hourly.map((h) => new Date(h.startMs).getHours())).toEqual([23, 0, 1, 2, 2, 3]);
    for (const h of autumn.hourly) expect(h.endMs - h.startMs).toBe(HOUR_S * 1000);
    // 29/03/2026 : à 2 h d'hiver, il est 3 h d'été. Coucher le 28 à 23 h (22 h UTC), 6 h de nuit.
    const spring = run(flat(Date.UTC(2026, 2, 28, 22)));
    expect(spring.hourly.map((h) => new Date(h.startMs).getHours())).toEqual([23, 0, 1, 3, 4, 5]);
    for (const h of spring.hourly) expect(h.endMs - h.startMs).toBe(HOUR_S * 1000);
  });

  it('tient 10 h à 1 Hz (36 000 points) en temps borné, courbe décimée au pas du protocole', () => {
    const points = night(10 * HOUR_S, exampleNightHr);
    const started = performance.now();
    const r = run(points);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(r.curve).toHaveLength(Math.ceil((10 * HOUR_S) / NIGHT_HR_TEST.curveStepS));
    for (let k = 1; k < r.curve.length; k++) expect(r.curve[k].minutes).toBeGreaterThan(r.curve[k - 1].minutes);
    for (const c of r.curve) {
      expect(c.index).toBeGreaterThanOrEqual(0);
      expect(c.index).toBeLessThan(points.length);
      // Le point de la courbe et celui du survol sont au même instant, à la demi-seconde près.
      expect(Math.abs((points[c.index].timeMs - T0) / 60_000 - c.minutes) * 60).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('nightSessionName', () => {
  it('nomme la nuit du jour du départ au jour de la fin', () => {
    expect(nightSessionName(new Date(2026, 10, 12, 23, 10).getTime(), new Date(2026, 10, 13, 7, 0).getTime())).toBe('Nuit du 12 au 13/11');
    expect(nightSessionName(new Date(2026, 10, 13, 0, 30).getTime(), new Date(2026, 10, 13, 7, 0).getTime())).toBe('Nuit du 13/11');
    expect(nightSessionName(new Date(2026, 9, 31, 23, 0).getTime(), new Date(2026, 10, 1, 7, 0).getTime())).toBe('Nuit du 31/10 au 1/11');
    expect(nightSessionName(new Date(2026, 11, 31, 23, 0).getTime(), new Date(2027, 0, 1, 7, 0).getTime())).toBe('Nuit du 31/12 au 1/01');
  });
});
