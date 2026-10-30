import { describe, expect, it } from 'vitest';
import { shareableStats } from '../core/shareImage';
import type { SessionSummary } from './record';
import { summaryShareStats } from './shareStats';

const summary = (patch: Partial<SessionSummary> = {}): SessionSummary => ({
  calcVersion: 6,
  startMs: 0,
  endMs: 3600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  movingDistanceM: 9000,
  elevationGainM: 120,
  maxSpeedMs: 5,
  pointCount: 3600,
  samplingS: 1,
  ...patch,
});

const values = (stats: ReturnType<typeof summaryShareStats>) => Object.fromEntries(stats.map((s) => [s.key, s.value]));

describe('summaryShareStats', () => {
  it('donne à pied les chiffres de l\'onglet « général », sous les mêmes clés', () => {
    const v = values(summaryShareStats(summary(), 'course', { speed: 'kmh', distance: 'km' }));
    expect(v.distance).toBe('10,00 km');
    expect(v.totalTime).toBe('1 h 00');
    expect(v.activeTime).toBe('50 min');
    expect(v.movingAverage).toBe('10,8 km/h');
    expect(v.overallAverage).toBe('10,0 km/h');
    expect(v.elevationGain).toBe('+120 m');
  });

  it('écarte, une fois filtrés, les chiffres que la session n\'a pas', () => {
    const stats = shareableStats(summaryShareStats(summary({ elevationGainM: null }), 'velo', { speed: 'kmh', distance: 'km' }));
    const keys = stats.map((s) => s.key);
    expect(keys).not.toContain('elevationGain');
    expect(keys).not.toContain('heartRate');
    expect(keys).not.toContain('cadence');
  });

  it('ajoute la FC et la cadence quand la session en a', () => {
    const v = values(summaryShareStats(summary({
      heartRate: { avgBpm: 151.6, maxBpm: 180, coveredS: 3000, histogram: { fromBpm: 150, seconds: [3000] } },
      cadence: { avgSpm: 171.2, steps: 8000 },
    }), 'course', { speed: 'minkm', distance: 'km' }));
    expect(v.heartRate).toBe('152 bpm');
    expect(v.cadence).toBe('171 pas/min');
  });

  it('donne en voile la moyenne active et les manœuvres, dans l\'unité de l\'activité', () => {
    const v = values(summaryShareStats(summary({ maneuverCount: 14 }), 'voile', { speed: 'kn', distance: 'nm' }));
    expect(v.activeAverage).toBe('5,8 nds');
    expect(v.maneuvers).toBe('14');
    expect(v.distance).toBe('5,40 NM');
  });

  it('donne en surf les vagues, sans vol hors foil', () => {
    const stats = shareableStats(summaryShareStats(summary({ waveCount: 12, longestWaveM: 84.4, longestFlightS: null }), 'surf', { speed: 'kmh', distance: 'km' }));
    const v = values(stats);
    expect(v.waves).toBe('12');
    expect(v.longestWave).toBe('84 m');
    expect(v.longestFlight).toBeUndefined();
  });
});
