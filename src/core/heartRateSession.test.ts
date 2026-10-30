import { describe, expect, it } from 'vitest';
import {
  activeDurationS, analyzeHeartRateSession, heartRatePointsFrom, heartRatePreviewPath, repsDone, sessionPhases, type HeartRateSessionPoint,
} from './heartRateSession';
import type { IntervalSeries } from './domainTypes';

const T0 = Date.UTC(2026, 9, 28, 18, 0, 0);
const PARAMS = { smoothS: 5, gapS: 10 };
const BOUNDS = [100, 120, 140, 160, 180];

/** FC d'une séance : 100 bpm, montée à 150 en travail de 60 à 120 s, puis 110. */
const bpmAt = (tS: number): number => (tS < 60 ? 100 : tS < 120 ? 150 : 110);

/** Points à `stepS` réguliers, ou aux pas donnés. */
const points = (durationS: number, steps: (k: number) => number): HeartRateSessionPoint[] => {
  const out: HeartRateSessionPoint[] = [];
  let tS = 0;
  for (let k = 0; tS <= durationS; k++) {
    out.push({ timeMs: T0 + tS * 1000, hr: bpmAt(tS) });
    tS += steps(k);
  }
  return out;
};

const series: IntervalSeries[] = [{
  workout: { reps: 2, workS: 60, restS: 30 },
  laps: [
    { kind: 'travail', rep: 1, startMs: T0 - 10_000, endMs: T0 + 50_000, block: 0 },
    { kind: 'repos', rep: 1, startMs: T0 + 50_000, endMs: T0 + 80_000, block: 0 },
    { kind: 'travail', rep: 2, startMs: T0 + 80_000, endMs: T0 + 140_000, block: 0 },
    { kind: 'repos', rep: 2, startMs: T0 + 140_000, endMs: T0 + 400_000, block: 0 },
  ],
}];

describe('analyzeHeartRateSession (muscu, lot I du 25/10)', () => {
  it('même séance à 1 Hz, à 5 Hz et à mesures irrégulières (0,5 à 3 s) : mêmes moyenne, max, temps par zone', () => {
    const at1Hz = analyzeHeartRateSession(points(180, () => 1), series, PARAMS, BOUNDS)!;
    const at5Hz = analyzeHeartRateSession(points(180, () => 0.2), series, PARAMS, BOUNDS)!;
    const irregular = analyzeHeartRateSession(points(180, (k) => [0.5, 3, 1, 2, 0.5, 1.5][k % 6]), series, PARAMS, BOUNDS)!;
    for (const other of [at5Hz, irregular]) {
      expect(other.stats!.avgBpm).toBeCloseTo(at1Hz.stats!.avgBpm, 0);
      expect(other.stats!.maxBpm).toBe(at1Hz.stats!.maxBpm);
      other.zoneTimes!.forEach((s, zone) => expect(Math.abs(s - at1Hz.zoneTimes![zone])).toBeLessThan(6));
    }
    expect(at1Hz.stats!.maxBpm).toBe(150);
    expect(at1Hz.durationS).toBe(180);
  });

  it('un trou de plus de gapS n’est pas compté', () => {
    const full = points(120, () => 1);
    const holed = full.filter((p) => p.timeMs < T0 + 30_000 || p.timeMs > T0 + 60_000);
    const a = analyzeHeartRateSession(holed, [], PARAMS, BOUNDS)!;
    // De 0 à 29 s, puis de 61 à 120 s : le pas de 29 à 61 s est un trou.
    expect(a.stats!.coveredS).toBeCloseTo(29 + 59, 6);
    // La durée, elle, court de bout en bout.
    expect(a.durationS).toBe(120);
  });

  it('répétitions = phases de travail ; phases bornées à la session', () => {
    const a = analyzeHeartRateSession(points(180, () => 1), series, PARAMS, null)!;
    expect(a.reps).toBe(2);
    expect(a.zoneTimes).toBeNull();
    expect(a.phases[0]).toEqual({ kind: 'travail', rep: 1, startMs: T0, endMs: T0 + 50_000 });
    expect(a.phases[a.phases.length - 1].endMs).toBe(T0 + 180_000);
    expect(sessionPhases(series, T0 + 200_000, T0 + 300_000)).toEqual([{ kind: 'repos', rep: 2, startMs: T0 + 200_000, endMs: T0 + 300_000 }]);
    expect(repsDone(null)).toBe(0);
  });

  it('moins de deux points : rien', () => {
    expect(analyzeHeartRateSession([{ timeMs: T0, hr: 90 }], [], PARAMS, null)).toBeNull();
  });
});

describe('heartRatePointsFrom et activeDurationS', () => {
  it('lit les heures, garde la reprise, écarte un point qui ne vient pas après le précédent', () => {
    const p = heartRatePointsFrom([
      { time: new Date(T0).toISOString(), hr: 90 },
      { time: new Date(T0 + 1000).toISOString() },
      { time: new Date(T0 + 1000).toISOString(), hr: 95 },
      { time: new Date(T0 + 60_000).toISOString(), hr: 100, segmentStart: true },
      { time: new Date(T0 + 70_000).toISOString(), hr: 101 },
    ]);
    expect(p).toEqual([
      { timeMs: T0, hr: 90 }, { timeMs: T0 + 1000 }, { timeMs: T0 + 60_000, hr: 100, segmentStart: true }, { timeMs: T0 + 70_000, hr: 101 },
    ]);
    // Le pas qui mène à la reprise (la pause) n'est pas compté.
    expect(activeDurationS(p)).toBe(11);
  });
});

describe('heartRatePreviewPath', () => {
  it('trace la FC de bas en haut dans le cadre, coupée où elle manque ; rien sans deux FC', () => {
    const pts = [0, 1, 2, 3, 4].map((k) => ({ timeMs: T0 + k * 1000 }));
    expect(heartRatePreviewPath(pts, [100, 120, null, 110, 100], 100, 50, 100)).toBe('M0.0 50.0L25.0 0.0M75.0 25.0L100.0 50.0');
    expect(heartRatePreviewPath(pts, [100, null, null, null, null], 100, 50, 100)).toBeNull();
  });
});
