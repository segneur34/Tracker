import { describe, expect, it } from 'vitest';
import { accumulateElevation, computeElevationStats, smoothElevation } from './elevation';
import { ELEVATION_PRESETS } from './sportProfiles';
import type { TrackPoint } from './types';

/** Trace immobile, un point par seconde, altitude imposée. */
const buildTrack = (altitudes: (number | undefined)[]): TrackPoint[] => {
  const start = Date.parse('2026-01-01T10:00:00Z');
  return altitudes.map((ele, i) => ({
    lat: 43.6,
    lon: 3.8,
    time: new Date(start + i * 1000).toISOString(),
    timeMs: start + i * 1000,
    ele,
    speedMs: 3,
    smoothedSpeedMs: 3,
    bearing: 0,
    speedSource: 'derived' as const,
  }));
};

/** Rampe linéaire de `from` à `to` en `steps` pas. */
const ramp = (from: number, to: number, steps: number): number[] =>
  Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);

describe('accumulateElevation', () => {
  it('ignore le bruit sous le seuil sur un terrain plat', () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + 2 * Math.sin(i));
    const { gainM, lossM } = accumulateElevation(noisy, 3);
    expect(gainM).toBe(0);
    expect(lossM).toBe(0);
  });

  it('compte en entier une montée lente et continue', () => {
    // Un mètre par pas : chaque pas est sous le seuil, la montée non.
    const { gainM, lossM } = accumulateElevation(ramp(100, 200, 100), 3);
    expect(gainM).toBeCloseTo(100, 6);
    expect(lossM).toBe(0);
  });

  it('sépare montée et descente', () => {
    const { gainM, lossM } = accumulateElevation([...ramp(100, 150, 50), ...ramp(150, 120, 30)], 3);
    expect(gainM).toBeCloseTo(50, 6);
    expect(lossM).toBeCloseTo(30, 6);
  });

  it('n\'additionne pas le bruit superposé à une montée', () => {
    // Montée de 50 m avec un bruit d'un mètre : sans seuil, chaque
    // oscillation ajouterait un mètre de faux dénivelé.
    const noisyClimb = ramp(100, 150, 100).map((a, i) => a + (i % 2 === 0 ? 1 : -1));
    const naive = noisyClimb.reduce((acc, a, i) => (i > 0 && a > noisyClimb[i - 1] ? acc + a - noisyClimb[i - 1] : acc), 0);
    const { gainM } = accumulateElevation(noisyClimb, 3);

    expect(naive).toBeGreaterThan(100);
    expect(gainM).toBeGreaterThan(48);
    expect(gainM).toBeLessThan(53);
  });

  it('ignore une bosse plus petite que le seuil', () => {
    expect(accumulateElevation([100, 102, 100, 102, 100], 3)).toEqual({ gainM: 0, lossM: 0 });
  });

  it('compte une bosse plus grande que le seuil, à la montée et à la descente', () => {
    const { gainM, lossM } = accumulateElevation([100, 105, 110, 105, 100], 3);
    expect(gainM).toBe(10);
    expect(lossM).toBe(10);
  });

  it('applique un seuil plus exigeant en trail', () => {
    // Bosses de 4 m : comptées sur route (seuil 3), ignorées en trail (seuil 5).
    const bumps = [100, 104, 100, 104, 100, 104, 100];
    expect(accumulateElevation(bumps, ELEVATION_PRESETS.route.minGainM).gainM).toBe(12);
    expect(accumulateElevation(bumps, ELEVATION_PRESETS.trail.minGainM).gainM).toBe(0);
  });

  it('renvoie zéro en dessous de deux altitudes valides', () => {
    expect(accumulateElevation([], 3)).toEqual({ gainM: 0, lossM: 0 });
    expect(accumulateElevation([100, NaN], 3)).toEqual({ gainM: 0, lossM: 0 });
  });
});

describe('smoothElevation', () => {
  it('laisse une altitude constante inchangée', () => {
    const out = smoothElevation(buildTrack([100, 100, 100, 100]), 20);
    expect(out).toEqual([100, 100, 100, 100]);
  });

  it('atténue un pic isolé', () => {
    const altitudes = new Array(41).fill(100);
    altitudes[20] = 130;
    const out = smoothElevation(buildTrack(altitudes), 20);
    expect(out[20]).toBeLessThan(105);
  });

  it('marque NaN les points sans altitude et lisse les autres', () => {
    const out = smoothElevation(buildTrack([100, undefined, 100, 100]), 20);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[0]).toBe(100);
  });
});

describe('computeElevationStats', () => {
  it('signale l\'absence d\'altitude', () => {
    const stats = computeElevationStats(buildTrack([undefined, undefined, undefined]), ELEVATION_PRESETS.route);
    expect(stats.coverage).toBe(0);
    expect(stats.gainM).toBe(0);
  });

  it('mesure la couverture en altitude', () => {
    const stats = computeElevationStats(buildTrack([100, undefined, 100, 100]), ELEVATION_PRESETS.route);
    expect(stats.coverage).toBe(0.75);
  });

  it('restitue une montée en entier, y compris aux extrémités de la trace', () => {
    // L'ajustement linéaire local suit la pente en bord de trace : rien n'est
    // raboté au départ ni à l'arrivée.
    const stats = computeElevationStats(buildTrack(ramp(100, 200, 100)), ELEVATION_PRESETS.route);
    expect(stats.gainM).toBeCloseTo(100, 6);
    expect(stats.lossM).toBe(0);
    expect(stats.minEleM).toBeCloseTo(100, 6);
    expect(stats.maxEleM).toBeCloseTo(200, 6);
  });

  it('restitue aussi une montée courte et raide', () => {
    // 30 m en 30 s, plus court que la fenêtre de lissage elle-même.
    const stats = computeElevationStats(buildTrack(ramp(100, 130, 30)), ELEVATION_PRESETS.route);
    expect(stats.gainM).toBeCloseTo(30, 6);
  });

  it('réduit le dénivelé d\'une trace bruitée par rapport au cumul naïf', () => {
    // Plat avec bruit GPS de ±4 m : naïvement, plusieurs centaines de mètres.
    const noisy = Array.from({ length: 600 }, (_, i) => 100 + 4 * Math.sin(i * 1.7));
    const naive = noisy.reduce((acc, a, i) => (i > 0 && a > noisy[i - 1] ? acc + a - noisy[i - 1] : acc), 0);
    const stats = computeElevationStats(buildTrack(noisy), ELEVATION_PRESETS.route);

    expect(naive).toBeGreaterThan(200);
    expect(stats.gainM).toBeLessThan(20);
  });
});
