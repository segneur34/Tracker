import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { cyclingEnergyParams } from '../cycling/energy';
import type { LocationFix } from '../platform/location';
import { DEFAULT_ENERGY_PARAMS, runningCostJkgM } from '../running/energy';
import { LIVE_STATS_DEFAULTS, computeLiveStats, type LiveEnergySetup } from './liveStats';

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

  it('prend la vitesse max sur toute la session, tenue 2 s, sans franchir une pause', () => {
    // Pointe à 12 m/s pendant 30 s au début, hors de la fenêtre récente : elle compte pour le max.
    const speed = (t: number) => (t >= 50 && t < 80 ? 12 : 5);
    const stats = computeLiveStats([trace(0, 900, 1, speed)], wing);
    expect(stats.maxSpeedMs).toBeCloseTo(12, 0);
    expect(stats.recentTopsMs[0]).toBeCloseTo(5, 0);
    // Deux segments à 4 m/s séparés d'une pause d'un quart d'heure : pas de vitesse fictive par-dessus la pause.
    const before = trace(0, 120, 1, () => 4);
    const after = trace(1020, 1140, 1, () => 4, undefined, before[before.length - 1].lat + 0.05);
    expect(computeLiveStats([before, after], running).maxSpeedMs).toBeCloseTo(4, 1);
    expect(computeLiveStats([], running).maxSpeedMs).toBeNull();
  });

  it('donne la même vitesse max à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 5 + 3 * Math.sin(t / 20);
    const a = computeLiveStats([trace(0, 600, 1, speed)], wing);
    const b = computeLiveStats([trace(0, 600, 5, speed)], wing);
    expect(b.maxSpeedMs!).toBeCloseTo(a.maxSpeedMs!, 1);
  });
});

describe('computeLiveStats : derniers mètres, pente, vitesse ascensionnelle', () => {
  it('donne la vitesse des 300 derniers mètres', () => {
    // 800 s à 2 m/s puis 100 s à 4 m/s : les 300 derniers mètres tiennent dans la partie à 4 m/s.
    const stats = computeLiveStats([trace(0, 900, 1, (t) => (t <= 800 ? 2 : 4))], running);
    expect(stats.recentDistanceSpeedMs).toBeCloseTo(4, 1);
    expect(computeLiveStats([trace(0, 60, 1, () => 3)], running).recentDistanceSpeedMs).toBeNull();
  });

  it('donne le D+ des 300 derniers mètres et la pente du moment', () => {
    // Plat 10 min, puis rampe à 5 % (0,15 m/s à 3 m/s) pendant 5 min : 45 m, dont 15 sur les 300 derniers mètres.
    const ele = (t: number) => (t <= 600 ? 100 : 100 + 0.15 * (t - 600));
    const stats = computeLiveStats([trace(0, 900, 1, () => 3, ele)], running);
    expect(stats.recentDistanceGainM!).toBeGreaterThan(13);
    expect(stats.recentDistanceGainM!).toBeLessThan(16);
    expect(stats.currentGrade!).toBeCloseTo(0.05, 2);
  });

  it('donne la vitesse ascensionnelle sur le temps enregistré, pause exclue', () => {
    const ele = (t: number) => 0.15 * t;
    const straight = computeLiveStats([trace(0, 600, 1, () => 3, ele)], running);
    expect(straight.climbRateMh!).toBeGreaterThan(500);
    expect(straight.climbRateMh!).toBeLessThan(560);
    // Pause de 100 s dans la fenêtre de 5 min : la vitesse ascensionnelle reste celle de la marche.
    const before = trace(0, 300, 1, () => 3, ele);
    const after = trace(400, 600, 1, () => 3, ele, before[before.length - 1].lat);
    const paused = computeLiveStats([before, after], running);
    expect(paused.climbRateMh!).toBeGreaterThan(500);
    expect(paused.climbRateMh!).toBeLessThan(560);
    // Trop tôt : rien.
    expect(computeLiveStats([trace(0, 30, 1, () => 3, ele)], running).climbRateMh).toBeNull();
  });

  it("laisse pente, D+ récent et vitesse ascensionnelle vides sans altitude", () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 3)], running);
    expect(stats.recentDistanceGainM).toBeNull();
    expect(stats.currentGrade).toBeNull();
    expect(stats.climbRateMh).toBeNull();
  });
});

describe('computeLiveStats : puissance et énergie', () => {
  const noAir = { ...DEFAULT_ENERGY_PARAMS, airDragJs2M3Kg: 0 };
  const withEnergy = (energy: LiveEnergySetup) => ({ ...LIVE_STATS_DEFAULTS, energy });

  it('donne en course la puissance mécanique sur 15 s et l\'énergie de course', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running, withEnergy({ family: 'course', params: noAir, massKg: 75 }));
    expect(stats.recentPowerW!).toBeCloseTo(4.18 * 0.25 * 4 * 75, 0);
    expect(stats.effortJ! / (4.18 * 75 * 2400)).toBeCloseTo(1, 3);
    expect(stats.energyPerKg).toBe(false);
  });

  it("compte la pente jusqu'au dernier point, sans plat fictif en bout de trace", () => {
    // Rampe à 10 % à 3 m/s : toute la fenêtre de 15 s est en montée.
    const ele = (t: number) => 0.3 * t;
    const stats = computeLiveStats([trace(0, 600, 1, () => 3, ele)], running, withEnergy({ family: 'course', params: noAir, massKg: 70 }));
    const expected = runningCostJkgM(0.1, noAir) * 0.25 * 3 * 70;
    expect(stats.recentPowerW! / expected).toBeCloseTo(1, 2);
  });

  it('donne des valeurs par kilo sans poids', () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running, withEnergy({ family: 'course', params: noAir, massKg: null }));
    expect(stats.recentPowerW!).toBeCloseTo(4.18 * 0.25 * 4, 2);
    expect(stats.energyPerKg).toBe(true);
  });

  it('donne la même puissance à 1 Hz et à 5 Hz', () => {
    const speed = (t: number) => 3 + Math.sin(t / 30);
    const ele = (t: number) => 50 + 20 * Math.sin(t / 120);
    const options = withEnergy({ family: 'course', params: DEFAULT_ENERGY_PARAMS, massKg: 70 });
    const a = computeLiveStats([trace(0, 600, 1, speed, ele)], running, options);
    const b = computeLiveStats([trace(0, 600, 5, speed, ele)], running, options);
    expect(b.recentPowerW! / a.recentPowerW!).toBeCloseTo(1, 1);
    expect(b.effortJ! / a.effortJ!).toBeCloseTo(1, 2);
  });

  it('ne donne aucune puissance à vélo dans une descente raide', () => {
    const ele = (t: number) => 500 - 0.8 * t;
    const options = withEnergy({ family: 'velo', params: cyclingEnergyParams('route', 8.5, 75) });
    const stats = computeLiveStats([trace(0, 300, 1, () => 8, ele)], SPORT_PROFILES.cycling, options);
    expect(stats.recentPowerW).toBe(0);
  });

  it("ne calcule ni puissance ni énergie sans modèle d'énergie", () => {
    const stats = computeLiveStats([trace(0, 600, 1, () => 4)], running);
    expect(stats.recentPowerW).toBeNull();
    expect(stats.effortJ).toBeNull();
  });
});
