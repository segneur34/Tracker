import { describe, expect, it } from 'vitest';
import { BIKE_TYPES, cyclingEnergyParams } from '../cycling/energy';
import {
  KM_EFFORT_CLIMB_FACTOR, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, PRESET_PACE_LEVELS, climbPowerWkgForFlatSpeed,
  cyclingDurationS, cyclingRideSpeedMs, cyclingSpeedOnGradeMs, estimateRouteDurationS, runningDurationS,
  type CyclingDurationSettings, type PresetPaceLevel,
} from './duration';
import type { PlannedRoute, RoutePoint } from './route';

const RIDER_KG = 75;
const params = cyclingEnergyParams('route', BIKE_TYPES.route.bikeKg, RIDER_KG);

const bike = (level: PresetPaceLevel): Omit<CyclingDurationSettings, 'family'> => ({
  flatSpeedMs: LEVEL_FLAT_SPEED_MS.velo[level],
  climbPowerW: LEVEL_CLIMB_POWER_WKG[level] * RIDER_KG,
  params,
  maxSpeedMs: BIKE_TYPES.route.maxDescentMs,
});

/** Profil régulier de `lengthM` mètres à pente constante, au pas de 10 m. */
const slope = (lengthM: number, grade: number | null) =>
  Array.from({ length: lengthM / 10 + 1 }, (_, i) => ({ distM: i * 10, grade }));

/** Itinéraire en ligne droite vers le nord, altitude donnée en fonction de la distance (0,01° ≈ 1 112 m). */
const straightRoute = (km: number, eleAt: (m: number) => number | undefined): PlannedRoute => {
  const points: RoutePoint[] = [];
  const steps = Math.round(km * 10);
  for (let i = 0; i <= steps; i++) {
    const m = (i * km * 1000) / steps;
    points.push({ lat: 43.6 + m / 111_195, lon: 3.8, eleM: eleAt(m) });
  }
  return {
    waypoints: [points[0], points[points.length - 1]],
    legs: [{ mode: 'straight', status: 'ready', points }],
  };
};

describe('temps estimé en course (km-effort)', () => {
  it('sur le plat : distance divisée par la vitesse', () => {
    expect(runningDurationS({ distanceM: 10_000, gainM: 0 }, { flatSpeedMs: 10 / 3.6, climbFactor: KM_EFFORT_CLIMB_FACTOR })).toBeCloseTo(3600, 6);
  });

  it('100 m de D+ ajoutent 1 km de plat', () => {
    const flat = runningDurationS({ distanceM: 10_000, gainM: 0 }, { flatSpeedMs: 10 / 3.6, climbFactor: KM_EFFORT_CLIMB_FACTOR });
    const hilly = runningDurationS({ distanceM: 10_000, gainM: 500 }, { flatSpeedMs: 10 / 3.6, climbFactor: KM_EFFORT_CLIMB_FACTOR });
    expect(hilly - flat).toBeCloseTo(5000 / (10 / 3.6), 6);
  });

  it('un D+ inconnu compte pour zéro', () => {
    expect(runningDurationS({ distanceM: 5000, gainM: null }, { flatSpeedMs: 2.5, climbFactor: 10 })).toBeCloseTo(2000, 6);
  });
});

describe('vitesse à vélo selon la pente', () => {
  it('la puissance nulle donne la roue libre, et la vitesse est plafonnée', () => {
    expect(cyclingSpeedOnGradeMs(0, 0, params, 20)).toBeLessThan(0.01);
    expect(cyclingSpeedOnGradeMs(-0.15, 0, params, 10)).toBe(10);
  });

  it('sur le plat : la vitesse du niveau', () => {
    for (const level of PRESET_PACE_LEVELS) {
      expect(cyclingRideSpeedMs(0, bike(level))).toBeCloseTo(LEVEL_FLAT_SPEED_MS.velo[level], 6);
    }
  });

  it('en montée, plus lent que le plat, et 8 % se monte à une allure plausible', () => {
    const climb = cyclingRideSpeedMs(0.08, bike('moyen')) * 3.6;
    expect(climb).toBeGreaterThan(6);
    expect(climb).toBeLessThan(10);
    expect(cyclingRideSpeedMs(0.04, bike('moyen'))).toBeGreaterThan(cyclingRideSpeedMs(0.08, bike('moyen')));
  });

  it('en descente, jamais moins vite que le plat, et plafonné selon le vélo', () => {
    const settings = bike('moyen');
    expect(cyclingRideSpeedMs(-0.005, settings)).toBeCloseTo(settings.flatSpeedMs, 6);
    expect(cyclingRideSpeedMs(-0.03, settings)).toBeGreaterThan(settings.flatSpeedMs);
    expect(cyclingRideSpeedMs(-0.15, settings)).toBe(BIKE_TYPES.route.maxDescentMs);
  });

  it('une pente manquante compte comme plate', () => {
    expect(cyclingRideSpeedMs(NaN, bike('bon'))).toBeCloseTo(LEVEL_FLAT_SPEED_MS.velo.bon, 6);
  });
});

describe('temps à vélo le long d\'un profil', () => {
  it('sur le plat : distance divisée par la vitesse', () => {
    expect(cyclingDurationS(slope(10_000, 0), bike('moyen'))).toBeCloseTo(10_000 / LEVEL_FLAT_SPEED_MS.velo.moyen, 3);
    expect(cyclingDurationS(slope(10_000, null), bike('moyen'))).toBeCloseTo(10_000 / LEVEL_FLAT_SPEED_MS.velo.moyen, 3);
  });

  it('une montée prend plus longtemps, et le temps décroît du débutant à l\'expert', () => {
    const times = PRESET_PACE_LEVELS.map((level) => cyclingDurationS(slope(5000, 0.06), bike(level)));
    expect(times[1]).toBeGreaterThan(5000 / LEVEL_FLAT_SPEED_MS.velo.moyen);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  });
});

describe('puissance de montée d\'une vitesse saisie', () => {
  it('reprend celle d\'un niveau à sa vitesse, interpole entre deux, et borne aux extrêmes', () => {
    expect(climbPowerWkgForFlatSpeed(LEVEL_FLAT_SPEED_MS.velo.bon)).toBeCloseTo(LEVEL_CLIMB_POWER_WKG.bon, 6);
    expect(climbPowerWkgForFlatSpeed(24 / 3.6)).toBeCloseTo((LEVEL_CLIMB_POWER_WKG.moyen + LEVEL_CLIMB_POWER_WKG.bon) / 2, 6);
    expect(climbPowerWkgForFlatSpeed(5 / 3.6)).toBe(LEVEL_CLIMB_POWER_WKG.debutant);
    expect(climbPowerWkgForFlatSpeed(50 / 3.6)).toBe(LEVEL_CLIMB_POWER_WKG.expert);
  });
});

describe('temps estimé d\'un itinéraire', () => {
  it('rien sans réglage (voile) ni sans tracé', () => {
    expect(estimateRouteDurationS(straightRoute(5, () => 100), 3, null)).toBeNull();
    expect(estimateRouteDurationS({ waypoints: [], legs: [] }, 3, { family: 'course', flatSpeedMs: 2.5, climbFactor: 10 })).toBeNull();
  });

  it('course : distance et D+ du tracé, en km-effort', () => {
    // 5 km, 200 m de montée régulière : 7 km-effort à 10 km/h.
    const route = straightRoute(5, (m) => 100 + (m / 5000) * 200);
    const s = estimateRouteDurationS(route, 3, { family: 'course', flatSpeedMs: 10 / 3.6, climbFactor: KM_EFFORT_CLIMB_FACTOR });
    expect(s).not.toBeNull();
    expect(s! / 60).toBeCloseTo(42, 0);
  });

  it('vélo : un tracé sans altitude se fait à la vitesse du plat', () => {
    const s = estimateRouteDurationS(straightRoute(10, () => undefined), 3, { family: 'velo', ...bike('moyen') });
    expect(s).not.toBeNull();
    expect(s!).toBeCloseTo(10_000 / LEVEL_FLAT_SPEED_MS.velo.moyen, -1);
  });
});
