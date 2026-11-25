import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import { DEFAULT_RECORDING, SPORT_PROFILES, type SportProfile } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import { fromSettledStart, judgeSettle, type GpsSettleSettings } from './gpsSettle';
import { computeLiveStats } from './liveStats';

const T0 = Date.UTC(2026, 10, 25, 9, 0, 0);
const LAT0 = 43.5;
const SPEED_MS = 2.7;
/** Seuils du profil d'enregistrement : 10 m, 10 s. */
const SETTINGS: GpsSettleSettings = DEFAULT_RECORDING;
const { settleAccuracyM: ACCURACY_M, settleMaxWaitS: MAX_WAIT_S } = SETTINGS;

/** Valeur interpolée entre les secondes 0 à 4, la dernière tenue ensuite. */
const atSecond = (values: number[], t: number): number => {
  if (t >= values.length - 1) return values[values.length - 1];
  const k = Math.floor(t);
  return values[k] + (values[k + 1] - values[k]) * (t - k);
};

/**
 * Départ mal calé : déplacement régulier vers le nord à 2,7 m/s, les positions des secondes 0 à 4 décalées vers
 * l'arrière de 22, 12,5, 6, 2 et 0 m, d'incertitude 30, 20, 12, 6 et 4 m (entre deux secondes, de l'une à l'autre),
 * puis justes, à 4 m près. Une position toutes les `stepS` secondes.
 */
const badStart = (stepS: number, withSpeed: boolean, durationS = 60): LocationFix[] => {
  const fixes: LocationFix[] = [];
  const n = Math.round(durationS / stepS);
  for (let k = 0; k <= n; k++) {
    const t = k * stepS;
    const alongM = SPEED_MS * t - atSecond([22, 12.5, 6, 2, 0], t);
    fixes.push({
      timeMs: T0 + Math.round(t * 1000), lat: LAT0 + alongM / M_PER_DEG_LAT, lon: 3.9,
      accuracyM: atSecond([30, 20, 12, 6, 4], t), speedMs: withSpeed ? SPEED_MS : undefined,
    });
  }
  return fixes;
};

/** Ce que deviennent la trace et ses chiffres, par la chaîne du direct (`computeLiveStats`) et par la cinématique. */
const measure = (fixes: LocationFix[], profile: SportProfile) => {
  const stats = computeLiveStats([fixes], profile);
  const track = computeKinematics(fixes.map((f) => ({ lat: f.lat, lon: f.lon, time: new Date(f.timeMs), rawTimeMs: f.timeMs, speedMs: f.speedMs })), {
    medianWindowSeconds: profile.medianWindowSeconds, maxSpeedMs: profile.maxPlausibleSpeedMs, maxGapS: profile.maxGapS,
  });
  const startS = (fixes[0].timeMs - T0) / 1000;
  return {
    maxSpeedMs: stats.maxSpeedMs ?? 0,
    distanceM: stats.distanceM,
    /** Distance vraie depuis la première position gardée. */
    trueDistanceM: SPEED_MS * ((fixes[fixes.length - 1].timeMs - fixes[0].timeMs) / 1000),
    topPointSpeedMs: Math.max(...track.map((p) => p.speedMs)),
    /** Écart de la première position gardée à la vraie, en mètres. */
    startOffM: SPEED_MS * startS - (fixes[0].lat - LAT0) * M_PER_DEG_LAT,
  };
};

const fix = (s: number, accuracyM?: number): LocationFix => ({ timeMs: T0 + Math.round(s * 1000), lat: LAT0, lon: 3.9, accuracyM });

describe('judgeSettle', () => {
  it('juge calée une position d’incertitude au plus le seuil du profil, ou sans incertitude (rejeu d’un fichier)', () => {
    expect(judgeSettle(null, fix(0, ACCURACY_M), SETTINGS)).toEqual({ settled: true, firstSeenMs: T0 });
    expect(judgeSettle(null, fix(0, ACCURACY_M + 0.1), SETTINGS).settled).toBe(false);
    expect(judgeSettle(null, fix(0), SETTINGS).settled).toBe(true);
    expect(judgeSettle(T0, fix(3), SETTINGS).settled).toBe(true);
  });

  it('garde l’heure de la première position vue, et démarre quand même au bout du délai', () => {
    expect(judgeSettle(null, fix(2, 30), SETTINGS)).toEqual({ settled: false, firstSeenMs: T0 + 2000 });
    expect(judgeSettle(T0, fix(MAX_WAIT_S - 0.2, 30), SETTINGS).settled).toBe(false);
    expect(judgeSettle(T0, fix(MAX_WAIT_S, 30), SETTINGS).settled).toBe(true);
  });

  it('seuils passés en paramètres : d’autres valeurs, et un délai nul qui coupe le calage', () => {
    expect(judgeSettle(T0, fix(5, 30), { settleAccuracyM: ACCURACY_M, settleMaxWaitS: 5 }).settled).toBe(true);
    expect(judgeSettle(null, fix(0, 30), { settleAccuracyM: 40, settleMaxWaitS: MAX_WAIT_S }).settled).toBe(true);
    expect(judgeSettle(null, fix(0, 300), { settleAccuracyM: ACCURACY_M, settleMaxWaitS: 0 }).settled).toBe(true);
  });
});

describe('fromSettledStart', () => {
  it('démarre au même instant à 1 Hz et à 5 Hz : au délai, sur un GPS qui ne se cale jamais', () => {
    for (const hz of [1, 5]) {
      const fixes = Array.from({ length: 20 * hz + 1 }, (_, k) => fix(k / hz, 30));
      expect(fromSettledStart(fixes, SETTINGS)[0].timeMs, `${hz} Hz`).toBe(T0 + MAX_WAIT_S * 1000);
    }
  });

  it('démarre au même instant à 1 Hz et à 5 Hz : à la première position assez précise', () => {
    for (const hz of [1, 5]) {
      const fixes = Array.from({ length: 10 * hz + 1 }, (_, k) => fix(k / hz, k / hz < 3 ? 25 : 5));
      expect(fromSettledStart(fixes, SETTINGS)[0].timeMs, `${hz} Hz`).toBe(T0 + 3000);
    }
  });

  it('long pas (règle 10) : jugé au temps, une seule position après la première peut couvrir tout le délai', () => {
    // Une position toutes les 7 s, jamais précise : la trace part de la première à 10 s au moins de la première vue.
    expect(fromSettledStart([fix(0, 30), fix(7, 30), fix(14, 30), fix(21, 30)], SETTINGS)[0].timeMs).toBe(T0 + 14_000);
    // Deux positions seulement, à 25 s l'une de l'autre : la seconde est gardée.
    expect(fromSettledStart([fix(0, 30), fix(25, 30)], SETTINGS).map((f) => f.timeMs)).toEqual([T0 + 25_000]);
  });

  it('ne retire rien d’une trace sans incertitude (rejeu d’un fichier)', () => {
    const fixes = [fix(0), fix(1), fix(2)];
    expect(fromSettledStart(fixes, SETTINGS)).toEqual(fixes);
  });

  it('ne joue plus après la première position calée : une incertitude large ensuite est gardée', () => {
    const fixes = [fix(0, 40), fix(1, 8), fix(2, 50), fix(3, 60)];
    expect(fromSettledStart(fixes, SETTINGS)).toEqual(fixes.slice(1));
  });

  it('rend une trace vide quand rien ne se cale avant la fin', () => {
    expect(fromSettledStart([fix(0, 40), fix(1, 30)], SETTINGS)).toEqual([]);
  });
});

describe('départ décalé de 22 m, trace synthétique', () => {
  const profiles = [SPORT_PROFILES.running, SPORT_PROFILES.wingfoil];
  /** 1 Hz, 5 Hz, et une position toutes les 4 s (application économique). */
  const steps: [string, number][] = [['1 Hz', 1], ['5 Hz', 0.2], ['pas de 4 s', 4]];

  it('sans calage : la vitesse du GPS ne voit pas le saut, mais sans elle la vitesse part d’un pic, à 1 Hz et à 5 Hz', () => {
    for (const profile of profiles) {
      for (const [name, stepS] of steps.slice(0, 2)) {
        const label = `${profile.id} ${name}`;
        const withSpeed = measure(badStart(stepS, true), profile);
        expect(withSpeed.maxSpeedMs, label).toBeCloseTo(SPEED_MS, 6);
        expect(withSpeed.distanceM, label).toBeCloseTo(withSpeed.trueDistanceM, 6);
        expect(withSpeed.startOffM, label).toBeCloseTo(22, 3);
        const derived = measure(badStart(stepS, false), profile);
        expect(derived.topPointSpeedMs, label).toBeGreaterThan(8);
        expect(derived.distanceM - derived.trueDistanceM, label).toBeGreaterThan(10);
      }
    }
  });

  it('avec calage : la trace part de la première position calée, sans pic, distance juste à son écart près', () => {
    for (const profile of profiles) {
      for (const [name, stepS] of steps) {
        const label = `${profile.id} ${name}`;
        const kept = fromSettledStart(badStart(stepS, false), SETTINGS);
        expect(kept[0].accuracyM, label).toBeLessThanOrEqual(ACCURACY_M);
        const derived = measure(kept, profile);
        // Le reste de l'écart, dans l'incertitude de la position calée, se rattrape en une ou deux secondes.
        expect(derived.startOffM, label).toBeLessThanOrEqual(kept[0].accuracyM ?? 0);
        expect(derived.maxSpeedMs, label).toBeLessThan(5);
        expect(derived.distanceM - derived.trueDistanceM, label).toBeLessThan(5);
        const withSpeed = measure(fromSettledStart(badStart(stepS, true), SETTINGS), profile);
        expect(withSpeed.maxSpeedMs, label).toBeCloseTo(SPEED_MS, 6);
        expect(withSpeed.distanceM, label).toBeCloseTo(withSpeed.trueDistanceM, 6);
      }
    }
  });

  it('départ à la première position annoncée à 10 m près, à la cadence près', () => {
    const start = (stepS: number) => fromSettledStart(badStart(stepS, false), SETTINGS)[0].timeMs - T0;
    // 12 m à 2 s, 6 m à 3 s : 10 m est franchi à 2 s 1/3 ; la première position à 10 m près est à 3 s à 1 Hz, 2,4 s à 5 Hz.
    expect(start(1)).toBe(3000);
    expect(start(0.2)).toBe(2400);
    expect(start(4)).toBe(4000);
  });
});
