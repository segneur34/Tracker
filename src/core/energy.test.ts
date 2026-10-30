import { describe, expect, it } from 'vitest';
import { integrateEnergy, type EnergyStepCost } from './energy';
import { GRADE_ANALYSIS } from './sportProfiles';
import type { TrackPoint } from './types';

const START = Date.parse('2026-01-01T10:00:00Z');

/** Trace rectiligne à 3 m/s, un point toutes les `stepS` secondes. */
const line = (stepS: number, durationS: number): TrackPoint[] => {
  const track: TrackPoint[] = [];
  for (let k = 0; k * stepS <= durationS + 1e-9; k++) {
    const timeMs = START + Math.round(k * stepS * 1000);
    track.push({
      lat: 43.6, lon: 3.8 + (3 * k * stepS) / 80000, time: new Date(timeMs).toISOString(), timeMs,
      speedMs: 3, smoothedSpeedMs: 3, bearing: 90, speedSource: 'derived',
    });
  }
  return track;
};

/** 4 J par mètre, dont un quart en travail mécanique. */
const cost: EnergyStepCost = (_i, d) => ({ net: 4 * d, mechanical: d });

describe('integrateEnergy', () => {
  it('donne le même bilan à 1 Hz et à 5 Hz', () => {
    for (const stepS of [1, 0.2]) {
      const track = line(stepS, 100);
      const grades = track.map((_, k) => (k * stepS < 50 + stepS / 2 ? 0.05 : NaN));
      const r = integrateEnergy(track, grades, track.map(() => true), 2, cost, GRADE_ANALYSIS);
      expect(r.movingTimeS).toBeCloseTo(100, 6);
      expect(r.movingDistanceM).toBeCloseTo(300, 6);
      expect(r.net).toBeCloseTo(1200, 6);
      expect(r.mechanical).toBeCloseTo(300, 6);
      expect(r.rest).toBeCloseTo(200, 6);
      expect(r.cumulativeTotal[track.length - 1]).toBeCloseTo(1400, 6);
      // Pente manquante : au plat.
      expect(r.byZone.up.timeS).toBeCloseTo(50, 6);
      expect(r.byZone.flat.timeS).toBeCloseTo(50, 6);
      expect(r.mechanicalPower[0]).toBeNaN();
      expect(r.mechanicalPower[1]).toBeCloseTo(3, 6);
    }
  });

  it('compte le repos en pause, et rien sur un pas de temps nul', () => {
    const track = line(1, 10);
    track[5] = { ...track[5], timeMs: track[4].timeMs };
    const mask = track.map((_, k) => k < 8);
    const r = integrateEnergy(track, [], mask, 1, cost, GRADE_ANALYSIS);
    expect(r.rest).toBeCloseTo(10, 9);
    expect(r.movingTimeS).toBeCloseTo(7, 9);
    expect(r.cumulativeTotal[5]).toBe(r.cumulativeTotal[4]);
    expect(r.mechanicalPower[9]).toBeNaN();
  });
});
