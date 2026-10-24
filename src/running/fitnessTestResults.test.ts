import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../core/types';
import { kmhToMs, msToKmh } from '../core/units';
import { FITNESS_TESTS, type SessionTest } from '../recording/fitnessTest';
import { fitnessTestResults, summaryOfTest } from './fitnessTestResults';

const PROTOCOL = FITNESS_TESTS['fc-max'];
const T0 = Date.UTC(2026, 9, 24, 8, 0, 0);

/** Même scénario que `fitnessTest.test.ts` : 6 paliers tenus depuis 6 km/h, le 7e lâché, récupération. */
const at = (t: number): { kmh: number; hr: number } => {
  if (t < 480) return { kmh: 6, hr: 84 };
  if (t < 870) return { kmh: 6 + 0.6 * Math.min(5, Math.floor((t - 480) / 60)), hr: 84 + ((180 - 84) * (t - 480)) / 390 };
  const r = t - 870;
  return { kmh: 4, hr: r <= 60 ? 180 - (30 * r) / 60 : 150 - (10 * (r - 60)) / 60 };
};

const track = (hz: number): TrackPoint[] => {
  const out: TrackPoint[] = [];
  for (let k = 0; k <= 1000 * hz; k++) {
    const t = k / hz;
    const { kmh, hr } = at(t);
    const timeMs = T0 + Math.round(t * 1000);
    out.push({
      lat: 45, lon: 3, time: new Date(timeMs), timeMs, hr, speedMs: kmhToMs(kmh), smoothedSpeedMs: kmhToMs(kmh), bearing: 0, speedSource: 'doppler',
    });
  }
  return out;
};

const steps = Array.from({ length: 7 }, (_, k) => ({ startMs: T0 + (480 + 60 * k) * 1000, targetMs: kmhToMs(6 + 0.6 * k) }));

const TEST: SessionTest = {
  protocol: 'fc-max',
  version: 1,
  settings: { warmupS: 480, warmupPct: 0.45, age: 35, ageSource: 'defaut', targetBpm: 83, bandBpm: 5 },
  startMs: T0,
  rampStartMs: T0 + 480_000,
  v0Ms: kmhToMs(6),
  steps,
  rampEndMs: T0 + 870_000,
  dropMs: T0 + 850_000,
  endReason: 'auto',
  endMs: T0 + 990_000,
  signals: [],
};

describe('fitnessTestResults', () => {
  it('FC max, dernier palier tenu, récupération, à 1 Hz comme à 5 Hz', () => {
    for (const hz of [1, 5]) {
      const r = fitnessTestResults(track(hz), TEST, PROTOCOL);
      expect(r.hrMaxBpm).toBeGreaterThanOrEqual(178);
      expect(r.hrMaxBpm).toBeLessThanOrEqual(180);
      expect(r.stepsHeld).toBe(6);
      expect(msToKmh(r.lastStepSpeedMs!)).toBeCloseTo(9, 6);
      expect(msToKmh(r.maxSpeedMs!)).toBeCloseTo(9, 1);
      expect(r.rampS).toBe(370);
      expect(r.hrAfterBpm).toBeGreaterThanOrEqual(149);
      expect(r.hrAfterBpm).toBeLessThanOrEqual(151);
      expect(r.hrDropBpm).toBeGreaterThanOrEqual(27);
      expect(r.hrDropBpm).toBeLessThanOrEqual(31);
      expect(r.warmupAvgBpm).toBe(84);
    }
  });

  it('un palier lâché avant le début du suivant ne compte pas', () => {
    const r = fitnessTestResults(track(1), { ...TEST, dropMs: T0 + 830_000 }, PROTOCOL);
    expect(r.stepsHeld).toBe(5);
    expect(msToKmh(r.lastStepSpeedMs!)).toBeCloseTo(8.4, 6);
  });

  it('test arrêté pendant l’échauffement : rien de la rampe', () => {
    const r = fitnessTestResults(track(1), { ...TEST, rampStartMs: null, v0Ms: null, steps: [], rampEndMs: null, dropMs: null, endMs: null }, PROTOCOL);
    expect(r.stepsHeld).toBe(0);
    expect(r.lastStepSpeedMs).toBeNull();
    expect(r.maxSpeedMs).toBeNull();
    expect(r.hrAfterBpm).toBeNull();
  });

  it('summaryOfTest garde la FC max, le palier et leur nombre', () => {
    const summary = summaryOfTest(fitnessTestResults(track(1), TEST, PROTOCOL));
    expect(summary?.steps).toBe(6);
    expect(summaryOfTest({ ...fitnessTestResults(track(1), TEST, PROTOCOL), hrMaxBpm: null, stepsHeld: 0 })).toBeNull();
  });
});
