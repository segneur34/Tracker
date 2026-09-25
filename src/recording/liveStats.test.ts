import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { computeLiveStats } from './liveStats';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const M_PER_DEG_LAT = (6371e3 * Math.PI) / 180;

/**
 * Trace vers le nord, à `hz` positions par seconde, de `startS` à `endS`, à la
 * vitesse `speedAt(t)` (m/s) et à l'altitude `eleAt(t)`. Positions et vitesse
 * Doppler cohérentes.
 */
const trace = (
  startS: number,
  endS: number,
  hz: number,
  speedAt: (t: number) => number,
  eleAt?: (t: number) => number,
  startLat = 43.5
): LocationFix[] => {
  const fixes: LocationFix[] = [];
  let lat = startLat;
  const step = 1 / hz;
  for (let t = startS; t <= endS + 1e-9; t += step) {
    if (fixes.length > 0) lat += (speedAt(t) * step) / M_PER_DEG_LAT;
    fixes.push({ timeMs: T0 + t * 1000, lat, lon: 3.9, speedMs: speedAt(t), altitudeM: eleAt?.(t) });
  }
  return fixes;
};

const running = SPORT_PROFILES.running;
const wing = SPORT_PROFILES.wingfoil;

describe('computeLiveStats', () => {
  it('rend des statistiques vides sans trace', () => {
    const stats = computeLiveStats([], running);
    expect(stats.distanceM).toBe(0);
    expect(stats.lastDistanceSpeedMs).toBeNull();
    expect(stats.recentTopsMs).toEqual([null, null]);
  });

  it('donne distance, vitesse moyenne et allure du dernier km à vitesse constante', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 3)], running);
    expect(stats.distanceM).toBeCloseTo(1800, 0);
    expect(stats.averageSpeedMs).toBeCloseTo(3, 3);
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(3, 3);
    expect(stats.currentSpeedMs).toBeCloseTo(3, 3);
  });

  it("laisse l'allure du dernier km vide tant qu'il n'est pas parcouru", () => {
    expect(computeLiveStats([trace(0, 200, 1, () => 3)], running).lastDistanceSpeedMs).toBeNull();
  });

  it('mesure le dernier km sur la fin de trace seulement', () => {
    // 500 s à 2 m/s puis 400 s à 4 m/s : les 1000 derniers mètres tiennent dans la partie à 4 m/s.
    const stats = computeLiveStats([trace(0, 900, 1, (t) => (t <= 500 ? 2 : 4))], running);
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(4, 1);
  });

  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 3 + Math.sin(t / 30);
    const ele = (t: number) => 50 + 20 * Math.sin(t / 120);
    const a = computeLiveStats([trace(0, 1200, 1, speed, ele)], running);
    const b = computeLiveStats([trace(0, 1200, 5, speed, ele)], running);
    expect(b.distanceM).toBeCloseTo(a.distanceM, -1);
    expect(b.lastDistanceSpeedMs!).toBeCloseTo(a.lastDistanceSpeedMs!, 1);
    expect(b.elevationGainM!).toBeCloseTo(a.elevationGainM!, 0);
    expect(b.recentGainM!).toBeCloseTo(a.recentGainM!, 0);
  });

  it('ne compte ni distance ni temps pendant une pause', () => {
    const before = trace(0, 300, 1, () => 3);
    const after = trace(900, 1200, 1, () => 3, undefined, before[before.length - 1].lat);
    const stats = computeLiveStats([before, after], running);
    expect(stats.distanceM).toBeCloseTo(1800, 0);
    expect(stats.movingTimeMs).toBe(600_000);
    // Le dernier km enjambe la pause sans la compter.
    expect(stats.lastDistanceSpeedMs).toBeCloseTo(3, 2);
  });

  it('compte D+ et D−, et le D+ des 5 dernières minutes seulement', () => {
    // Montée de 60 m en 10 min, puis descente de 60 m en 10 min, puis montée de 30 m en 5 min.
    const ele = (t: number) => (t <= 600 ? t / 10 : t <= 1200 ? 60 - (t - 600) / 10 : (t - 1200) / 10);
    const stats = computeLiveStats([trace(0, 1500, 1, () => 3, ele)], running);
    expect(stats.elevationGainM!).toBeGreaterThan(80);
    expect(stats.elevationGainM!).toBeLessThan(95);
    expect(stats.elevationLossM!).toBeGreaterThan(50);
    expect(stats.recentGainM!).toBeGreaterThan(25);
    expect(stats.recentGainM!).toBeLessThan(32);
  });

  it("laisse le dénivelé vide sans altitude", () => {
    const stats = computeLiveStats([trace(0, 300, 1, () => 3)], running);
    expect(stats.elevationGainM).toBeNull();
    expect(stats.recentGainM).toBeNull();
  });

  it('prend les tops sur les 5 dernières minutes seulement', () => {
    // Pointe à 12 m/s au début, hors fenêtre ; 8 m/s pendant 20 s dans la fenêtre ; 5 m/s ailleurs.
    const speed = (t: number) => (t >= 50 && t < 80 ? 12 : t >= 700 && t < 720 ? 8 : 5);
    const stats = computeLiveStats([trace(0, 900, 1, speed)], wing);
    expect(stats.recentTopsMs[0]).toBeCloseTo(8, 0);
    expect(stats.recentTopsMs[1]).toBeCloseTo(8, 0);
  });
});
