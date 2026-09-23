import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';
import {
  DEFAULT_SAILING_SPEED_RANGE_MS,
  SLOW_SESSION_ACTIVE_THRESHOLD_KN,
  suggestActiveThresholdKn,
  suggestSpeedRangeMs,
} from './sailingConfig';

/** Trace synthétique : vitesse imposée point par point, cadence réglable. */
const buildTrack = (speedsMs: number[], stepSeconds = 1): TrackPoint[] => {
  const startTime = Date.parse('2026-01-01T10:00:00Z');
  return speedsMs.map((speedMs, i) => ({
    lat: 43.6,
    lon: 3.8 + i * 0.0001,
    time: new Date(startTime + i * stepSeconds * 1000).toISOString(),
    timeMs: startTime + i * stepSeconds * 1000,
    speedMs,
    smoothedSpeedMs: speedMs,
    bearing: 90,
    speedSource: 'derived' as const,
  }));
};

describe('suggestActiveThresholdKn', () => {
  it('régime rapide, wingfoil : défaut du profil', () => {
    expect(suggestActiveThresholdKn('wingfoil', 20)).toBe(SPORT_PROFILES.wingfoil.defaultActiveThreshold);
  });

  it('régime rapide, windsurf : défaut du profil, pas aplati à 8', () => {
    expect(suggestActiveThresholdKn('windsurf', 20)).toBe(SPORT_PROFILES.windsurf.defaultActiveThreshold);
  });

  it('régime rapide, bateau : 1 nœud, pas le défaut du profil (3)', () => {
    expect(suggestActiveThresholdKn('bateau', 15)).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
  });

  it('régime lent, wingfoil : 1 nœud', () => {
    expect(suggestActiveThresholdKn('wingfoil', 6)).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
  });

  it('exactement à la borne (12 nds) : régime lent', () => {
    expect(suggestActiveThresholdKn('wingfoil', 12)).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
  });

  it('pas de trace chargée (allure nulle) : défaut du profil', () => {
    expect(suggestActiveThresholdKn('wingfoil', 0)).toBe(SPORT_PROFILES.wingfoil.defaultActiveThreshold);
    expect(suggestActiveThresholdKn('bateau', 0)).toBe(SPORT_PROFILES.bateau.defaultActiveThreshold);
  });
});

describe('suggestSpeedRangeMs', () => {
  it('borne basse alignée sur le seuil suggéré, borne haute au pic 2 s + 1 nœud', () => {
    const speeds = new Array(30).fill(knotsToMs(5));
    for (let i = 12; i < 19; i++) speeds[i] = knotsToMs(18);
    const track = buildTrack(speeds);
    const cum = buildCumulativeTrack(track);

    const range = suggestSpeedRangeMs('wingfoil', 6, track, cum);

    expect(range.minMs).toBeCloseTo(knotsToMs(suggestActiveThresholdKn('wingfoil', 6)), 5);
    expect(range.maxMs).toBeCloseTo(knotsToMs(18) + knotsToMs(1), 1);
  });

  it('trace vide : repli sur la plage par défaut', () => {
    const range = suggestSpeedRangeMs('wingfoil', 0, [], buildCumulativeTrack([]));
    expect(range).toEqual(DEFAULT_SAILING_SPEED_RANGE_MS);
  });

  it('trace trop courte pour 2 s : repli sur la plage par défaut', () => {
    const track = buildTrack([knotsToMs(10)]);
    const range = suggestSpeedRangeMs('wingfoil', 0, track, buildCumulativeTrack(track));
    expect(range).toEqual(DEFAULT_SAILING_SPEED_RANGE_MS);
  });
});
