import { describe, expect, it } from 'vitest';
import {
  edwardsLoad, efficiencyBlocks, estimateHrMax, heartRateDrift, heartRateHistogram, heartRateStats, heartRateZonePaths, heartRateZones, histogramZoneTimes,
  isValidZoneBounds, smoothHeartRate, spanHeartRate, timeInZones, timeSpanHeartRate, zoneOf, type HeartRatePoint,
} from './heartRate';
import { SPORT_PROFILES } from './sportProfiles';

const P = SPORT_PROFILES.running.heartRate;
const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);

/** Points à `hz` par seconde, de `startS` à `endS` exclu, FC `hrAt(t)` (`undefined` : sans mesure). */
const series = (startS: number, endS: number, hz: number, hrAt: (t: number) => number | undefined): HeartRatePoint[] => {
  const out: HeartRatePoint[] = [];
  for (let k = Math.round(startS * hz); k < Math.round(endS * hz); k++) {
    const t = k / hz;
    out.push({ timeMs: T0 + t * 1000, hr: hrAt(t) });
  }
  return out;
};

const analyze = (points: HeartRatePoint[]) => smoothHeartRate(points, P.smoothS, P.gapS);

describe('smoothHeartRate', () => {
  it('laisse vides les points sans FC ou à FC impossible', () => {
    const points = series(0, 5, 1, (t) => (t === 2 ? undefined : t === 3 ? 300 : 120));
    const smoothed = analyze(points);
    expect(smoothed[2]).toBeNull();
    expect(smoothed[3]).toBeNull();
    expect(smoothed[0]).toBe(120);
  });

  it('écarte un pic isolé du maximum', () => {
    const points = series(0, 120, 1, (t) => (t === 60 ? 200 : 130));
    const stats = heartRateStats(points, analyze(points), P.gapS)!;
    expect(stats.maxBpm).toBeLessThan(150);
  });
});

describe('heartRateStats', () => {
  it('pondère par le temps et ne compte pas les trous', () => {
    // 100 s à 120, trou de 60 s, 100 s à 160.
    const points = [...series(0, 100, 1, () => 120), ...series(160, 260, 1, () => 160)];
    const stats = heartRateStats(points, analyze(points), P.gapS)!;
    expect(stats.coveredS).toBe(198);
    expect(stats.avgBpm).toBeCloseTo(140, 0);
    expect(stats.maxBpm).toBe(160);
  });

  it('rend null sans FC', () => {
    const points = series(0, 100, 1, () => undefined);
    expect(heartRateStats(points, analyze(points), P.gapS)).toBeNull();
  });

  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const hrAt = (t: number) => 120 + 40 * Math.sin(t / 60);
    const a = series(0, 1200, 1, hrAt);
    const b = series(0, 1200, 5, hrAt);
    const sa = heartRateStats(a, analyze(a), P.gapS)!;
    const sb = heartRateStats(b, analyze(b), P.gapS)!;
    expect(sb.avgBpm).toBeCloseTo(sa.avgBpm, 0);
    expect(Math.abs(sb.maxBpm - sa.maxBpm)).toBeLessThanOrEqual(1);
    expect(Math.abs(sb.coveredS - sa.coveredS)).toBeLessThanOrEqual(1);
  });
});

describe('heartRateZones', () => {
  const fractions = P.zoneFractions;

  it('prend la réserve cardiaque quand FC max et FC de repos sont connues', () => {
    const zones = heartRateZones({ hrMax: 190, hrRest: 50, hrZones: null }, 40, fractions)!;
    expect(zones.method).toBe('reserve');
    expect(zones.bounds).toEqual([120, 134, 148, 162, 176]);
    expect(zones.estimated).toBe(false);
  });

  it('prend la FC max seule sans FC de repos', () => {
    const zones = heartRateZones({ hrMax: 200, hrRest: null, hrZones: null }, null, fractions)!;
    expect(zones.method).toBe('max');
    expect(zones.bounds).toEqual([100, 120, 140, 160, 180]);
  });

  it("estime la FC max par l'âge et le dit", () => {
    const zones = heartRateZones({ hrMax: null, hrRest: null, hrZones: null }, 40, fractions)!;
    expect(zones.hrMax).toBe(estimateHrMax(40));
    expect(zones.hrMax).toBe(180);
    expect(zones.estimated).toBe(true);
  });

  it('préfère des zones personnalisées valides, ignore les autres', () => {
    const custom = [110, 130, 145, 160, 172];
    expect(heartRateZones({ hrMax: 190, hrRest: 50, hrZones: custom }, null, fractions)!).toMatchObject({ method: 'perso', bounds: custom });
    expect(heartRateZones({ hrMax: 190, hrRest: 50, hrZones: [110, 100, 145, 160, 172] }, null, fractions)!.method).toBe('reserve');
    expect(isValidZoneBounds([110, 130, 145, 160])).toBe(false);
  });

  it('rend null sans FC max ni âge', () => {
    expect(heartRateZones({ hrMax: null, hrRest: 50, hrZones: null }, null, fractions)).toBeNull();
  });
});

describe('zones et charge', () => {
  const bounds = [100, 120, 140, 160, 180];

  it('classe une FC par zone', () => {
    expect(zoneOf(90, bounds)).toBe(0);
    expect(zoneOf(100, bounds)).toBe(1);
    expect(zoneOf(150, bounds)).toBe(3);
    expect(zoneOf(195, bounds)).toBe(5);
  });

  it('compte le temps par zone et la charge d\'Edwards', () => {
    // 10 min à 130 (Z2) puis 10 min à 170 (Z4).
    const points = series(0, 1200, 1, (t) => (t < 600 ? 130 : 170));
    const times = timeInZones(points, analyze(points), bounds, P.gapS);
    expect(times[2]).toBeCloseTo(600, -1);
    expect(times[4]).toBeCloseTo(600, -1);
    expect(edwardsLoad(times)).toBeCloseTo(10 * 2 + 10 * 4, 0);
  });

  it("retrouve les mêmes temps par zone depuis l'histogramme", () => {
    const points = series(0, 1800, 1, (t) => 110 + (t / 1800) * 80);
    const smoothed = analyze(points);
    const direct = timeInZones(points, smoothed, bounds, P.gapS);
    const histogram = heartRateHistogram(points, smoothed, P.gapS)!;
    const fromHistogram = histogramZoneTimes(histogram, bounds);
    direct.forEach((s, z) => expect(Math.abs(fromHistogram[z] - s)).toBeLessThanOrEqual(1));
    expect(histogram.fromBpm).toBe(110);
  });
});

describe('heartRateDrift', () => {
  it('mesure la montée de la FC à vitesse égale', () => {
    // 40 min à 3 m/s, FC de 140 à 160 : la seconde moitié coûte plus de battements.
    const points = series(0, 2400, 1, (t) => 140 + (t / 2400) * 20);
    const speeds = points.map(() => 3);
    const active = points.map(() => true);
    const drift = heartRateDrift(points, analyze(points), speeds, active, P.gapS, P.driftMinS)!;
    expect(drift.driftPct).toBeGreaterThan(4);
    expect(drift.driftPct).toBeLessThan(10);
  });

  it('ne dit rien sous la durée minimale', () => {
    const points = series(0, 600, 1, () => 150);
    expect(heartRateDrift(points, analyze(points), points.map(() => 3), points.map(() => true), P.gapS, P.driftMinS)).toBeNull();
  });
});

describe('efficiencyBlocks', () => {
  it('fait des blocs de durée fixe, rangés par moitié', () => {
    const points = series(0, 300, 1, () => 150);
    const blocks = efficiencyBlocks(points, analyze(points), points.map(() => 3), points.map(() => true), P.gapS, P.scatterBlockS);
    expect(blocks.length).toBe(9);
    expect(blocks[0]).toMatchObject({ speedMs: 3, bpm: 150, half: 0 });
    expect(blocks[blocks.length - 1].half).toBe(1);
  });

  it('abandonne un bloc coupé par une pause', () => {
    const points = series(0, 100, 1, () => 150);
    const active = points.map((_, i) => i % 20 !== 0);
    expect(efficiencyBlocks(points, analyze(points), points.map(() => 3), active, P.gapS, P.scatterBlockS)).toHaveLength(0);
  });
});

describe('spanHeartRate', () => {
  it('donne moyenne, max et récupération', () => {
    // Effort de 0 à 120 s à 170, puis récupération à 130.
    const points = series(0, 300, 1, (t) => (t <= 120 ? 170 : 130));
    const span = spanHeartRate(points, analyze(points), 0, 120, P.gapS, P.recoveryS)!;
    expect(span.avgBpm).toBe(170);
    expect(span.maxBpm).toBe(170);
    // La FC de fin d'effort est lissée sur 5 s : la baisse de 40 bpm en paraît un peu moins.
    expect(span.recoveryBpm).toBeGreaterThan(20);
    expect(span.recoveryBpm).toBeLessThanOrEqual(40);
  });

  it('laisse la récupération vide après la fin de la trace', () => {
    const points = series(0, 130, 1, () => 160);
    expect(spanHeartRate(points, analyze(points), 0, 120, P.gapS, P.recoveryS)!.recoveryBpm).toBeNull();
  });
});

describe('heartRateZonePaths', () => {
  it('coupe les passages aux changements de zone et aux trous', () => {
    const bounds = [100, 120, 140, 160, 180];
    // Z2, Z4, Z2, puis trou, puis Z2 encore.
    const hrAt = (t: number) => (t < 100 ? 130 : t < 200 ? 170 : t < 300 ? 130 : t < 330 ? undefined : 130);
    const points = series(0, 400, 1, hrAt).map((p, i) => ({ ...p, lat: 43.5 + i * 1e-5, lon: 3.9 }));
    const smoothed = analyze(points);
    expect(heartRateZonePaths(points, smoothed, bounds, 2, P.gapS)).toHaveLength(3);
    expect(heartRateZonePaths(points, smoothed, bounds, 4, P.gapS)).toHaveLength(1);
    expect(heartRateZonePaths(points, smoothed, bounds, 5, P.gapS)).toHaveLength(0);
  });
});

describe('timeSpanHeartRate', () => {
  it('retrouve la répétition par ses instants, à 1 Hz comme à 5 Hz', () => {
    const hrAt = (t: number) => (t >= 100 && t <= 220 ? 170 : 125);
    for (const hz of [1, 5]) {
      const points = series(0, 400, hz, hrAt);
      const span = timeSpanHeartRate(points, analyze(points), T0 + 100_000, T0 + 220_000, P.gapS, P.recoveryS)!;
      expect(Math.abs(span.avgBpm - 168)).toBeLessThanOrEqual(2);
      expect(span.maxBpm).toBe(170);
      expect(span.recoveryBpm).toBeGreaterThan(15);
    }
  });

  it('rend null hors de la trace', () => {
    const points = series(0, 100, 1, () => 150);
    expect(timeSpanHeartRate(points, analyze(points), T0 + 500_000, T0 + 600_000, P.gapS, P.recoveryS)).toBeNull();
  });
});
