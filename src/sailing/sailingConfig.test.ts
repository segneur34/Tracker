import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';
import {
  MANEUVER_FULL_TURN_DEG,
  MANEUVER_MIN_COHERENCE,
  SLOW_SESSION_ACTIVE_THRESHOLD_KN,
  getStillSpeedKn,
  suggestActiveThresholdKn,
  resolveSailingThresholds,
  suggestSpeedRangeMs,
} from './sailingConfig';
import { TURN_MIN_COHERENCE } from './wind';

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

  it('régime lent, wingfoil : 1 nœud', () => {
    expect(suggestActiveThresholdKn('wingfoil', 6)).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
  });

  it('exactement à la borne (12 nds) : régime lent', () => {
    expect(suggestActiveThresholdKn('wingfoil', 12)).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
  });

  it('pas de trace chargée (allure nulle) : défaut du profil', () => {
    expect(suggestActiveThresholdKn('wingfoil', 0)).toBe(SPORT_PROFILES.wingfoil.defaultActiveThreshold);
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
    expect(range).toEqual(SPORT_PROFILES.wingfoil.speedRange);
  });

  it('bateau : de 1 à 15 nœuds, quelle que soit la session', () => {
    const track = buildTrack(new Array(30).fill(knotsToMs(4)));
    const range = suggestSpeedRangeMs('bateau', 4, track, buildCumulativeTrack(track));
    expect(range.minMs).toBeCloseTo(knotsToMs(1), 6);
    expect(range.maxMs).toBeCloseTo(knotsToMs(15), 6);
  });

  it('trace trop courte pour 2 s : repli sur la plage par défaut', () => {
    const track = buildTrack([knotsToMs(10)]);
    const range = suggestSpeedRangeMs('wingfoil', 0, track, buildCumulativeTrack(track));
    expect(range).toEqual(SPORT_PROFILES.wingfoil.speedRange);
  });
});

describe('seuils de la détection des manœuvres (28/10)', () => {
  it('garde-fou de cohérence plus large pour les manœuvres que pour la polaire, qui garde le sien', () => {
    expect(MANEUVER_MIN_COHERENCE).toBe(0.5);
    expect(TURN_MIN_COHERENCE).toBe(0.6);
  });

  it('tient un virage de 270° ou plus pour un tour complet', () => {
    expect(MANEUVER_FULL_TURN_DEG).toBe(270);
  });

  it('lit le plancher d\'arrêt dans le profil du support, en nœuds', () => {
    expect(getStillSpeedKn()).toBe(SPORT_PROFILES.wingfoil.stillThreshold);
    expect(getStillSpeedKn('kite')).toBe(SPORT_PROFILES.kite.stillThreshold);
  });
});

describe('seuils de la session de voile : quatre priorités (lot 72)', () => {
  const wing = SPORT_PROFILES.wingfoil;
  const fast = 20;
  const slow = 5;

  it("sans réglage, la suggestion selon l'allure, jamais le défaut fixe sur une session lente", () => {
    const t = resolveSailingThresholds(wing, null, null, slow);
    expect(t.suggestedKn).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
    expect(t.activeKn).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
    expect(t.defaultKn).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
    expect(resolveSailingThresholds(wing, null, null, fast).activeKn).toBe(wing.defaultActiveThreshold);
  });

  it("le seuil de l'activité (réglé ou pré-réglé) prime sur la suggestion", () => {
    const t = resolveSailingThresholds(wing, 11, null, slow);
    expect(t.defaultKn).toBe(11);
    expect(t.activeKn).toBe(11);
  });

  it("celui de la session prime sur celui de l'activité, qui reste le défaut proposé", () => {
    const t = resolveSailingThresholds(wing, 11, 6.5, fast);
    expect(t.activeKn).toBe(6.5);
    expect(t.defaultKn).toBe(11);
    expect(t.flightKn).toBe(6.5);
    expect(t.withThreshold).toBe(true);
  });

  it("le bateau garde son seuil fixe de réussite, quoi que disent la session et l'activité, et compte tous les virages", () => {
    const boat = SPORT_PROFILES.bateau;
    const t = resolveSailingThresholds(boat, 4, 3, fast);
    expect(t.withThreshold).toBe(false);
    expect(t.activeKn).toBe(boat.withoutActiveThreshold?.maneuverSuccess);
    expect(t.defaultKn).toBe(boat.withoutActiveThreshold?.maneuverSuccess);
    expect(t.flightKn).toBeUndefined();
  });
});
