import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SLOW_COLOR, gradientColor, speedGradientColor } from '../core/speedGradient';
import type { TrackPoint } from '../core/types';
import {
  DEFAULT_GRADE_RANGE,
  DEFAULT_SPEED_RANGE_MS,
  averagePace,
  classifyGrade,
  computeGrades,
  computeZoneStats,
  gradeGradientColor,
  gradeGradientStops,
  isValidGradeRange,
} from './runningAnalytics';

/**
 * Trace synthétique : un point par seconde, vitesse et altitude imposées.
 * Les positions sont cohérentes avec la vitesse.
 */
const buildTrack = (
  speedsMs: number[],
  altitudeAt: (distanceM: number) => number = () => 100
): TrackPoint[] => {
  const start = Date.parse('2026-01-01T10:00:00Z');
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  let meters = 0;
  return speedsMs.map((speedMs, i) => {
    if (i > 0) meters += speedMs;
    return {
      lat,
      lon: 3.8 + meters / metersPerDegLon,
      time: new Date(start + i * 1000).toISOString(),
      timeMs: start + i * 1000,
      ele: altitudeAt(meters),
      speedMs,
      smoothedSpeedMs: speedMs,
      bearing: 90,
      speedSource: 'derived' as const,
    };
  });
};

describe('classifyGrade', () => {
  it('range chaque pente dans sa zone', () => {
    expect(classifyGrade(0)).toBe('flat');
    expect(classifyGrade(0.02)).toBe('flat');
    expect(classifyGrade(0.05)).toBe('up');
    expect(classifyGrade(0.15)).toBe('steepUp');
    expect(classifyGrade(-0.05)).toBe('down');
    expect(classifyGrade(-0.2)).toBe('steepDown');
    expect(classifyGrade(NaN)).toBeNull();
  });
});

describe('computeGrades', () => {
  it('mesure une pente constante de 8 %', () => {
    // 3 m/s pendant 200 s = 600 m, altitude qui monte de 8 m tous les 100 m.
    const track = buildTrack(new Array(200).fill(3), (d) => 100 + 0.08 * d);
    const cum = buildCumulativeTrack(track);
    const grades = computeGrades(track.map((p) => p.ele as number), cum);

    // Loin des bords, la pente doit être exacte.
    expect(grades[100]).toBeCloseTo(0.08, 3);
    expect(grades[50]).toBeCloseTo(0.08, 3);
  });

  it('lit une pente nulle sur du plat', () => {
    const track = buildTrack(new Array(100).fill(3));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track));
    expect(grades[50]).toBeCloseTo(0, 6);
  });

  it('résiste au bruit d\'altitude grâce à la fenêtre de 50 m', () => {
    // Plat avec ±0,5 m de bruit d'un point à l'autre : entre deux points
    // consécutifs, la pente naïve atteindrait 15 %.
    const track = buildTrack(new Array(100).fill(3), (d) => 100 + (Math.round(d / 3) % 2 === 0 ? 0.5 : -0.5));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track));
    expect(Math.abs(grades[50])).toBeLessThan(0.03);
  });

  it('laisse NaN là où l\'altitude manque', () => {
    const track = buildTrack(new Array(100).fill(3));
    const eles = track.map((p) => p.ele as number);
    for (let i = 40; i < 60; i++) eles[i] = NaN;
    const grades = computeGrades(eles, buildCumulativeTrack(track));
    expect(Number.isNaN(grades[50])).toBe(true);
    expect(Number.isNaN(grades[10])).toBe(false);
  });
});

describe('computeZoneStats', () => {
  it('répartit distance et temps par zone et calcule l\'allure de chacune', () => {
    // 300 m de plat à 4 m/s, puis 300 m à 12 % à 2 m/s.
    const flat = new Array(75).fill(4);
    const climb = new Array(150).fill(2);
    const track = buildTrack([...flat, ...climb], (d) => (d <= 300 ? 100 : 100 + 0.12 * (d - 300)));
    const cum = buildCumulativeTrack(track);
    const grades = computeGrades(track.map((p) => p.ele as number), cum);
    const zones = computeZoneStats(track, grades, new Array(track.length).fill(true));

    const flatZone = zones.find((z) => z.zone.key === 'flat')!;
    const steepZone = zones.find((z) => z.zone.key === 'steepUp')!;

    expect(flatZone.distanceM).toBeGreaterThan(200);
    expect(flatZone.avgSpeedMs).toBeCloseTo(4, 0);
    expect(steepZone.distanceM).toBeGreaterThan(200);
    expect(steepZone.avgSpeedMs).toBeCloseTo(2, 0);
    expect(steepZone.pace).toBe('8:20 /km');
  });

  it('exclut les segments à l\'arrêt de l\'allure de la zone', () => {
    const track = buildTrack(new Array(100).fill(3));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track));
    const mask = new Array(100).fill(true);
    for (let i = 50; i < 100; i++) mask[i] = false;
    const zones = computeZoneStats(track, grades, mask);
    const flatZone = zones.find((z) => z.zone.key === 'flat')!;
    expect(flatZone.timeMs).toBeLessThanOrEqual(50 * 1000);
  });
});

describe('averagePace', () => {
  it('convertit une distance et un temps en allure', () => {
    // 10 km en 50 min : 5:00 /km, 12 km/h.
    const result = averagePace(10_000, 50 * 60 * 1000);
    expect(result.pace).toBe('5:00 /km');
    expect(result.speedKmh).toBe('12.0 km/h');
  });

  it('reste vide sans distance ou sans temps', () => {
    expect(averagePace(0, 1000).pace).toBe('-');
    expect(averagePace(1000, 0).pace).toBe('-');
  });
});

describe('dégradé de vitesse', () => {
  const { minMs, maxMs } = DEFAULT_SPEED_RANGE_MS;
  const kmh = (v: number) => v / 3.6;

  it('met la marche en gris', () => {
    expect(speedGradientColor(kmh(3), minMs, maxMs)).toBe(SLOW_COLOR);
    expect(speedGradientColor(kmh(4.5), minMs, maxMs)).not.toBe(SLOW_COLOR);
  });

  it('atteint le rouge à la borne haute, 15 km/h par défaut, et pas avant', () => {
    const red = gradientColor(1);
    expect(speedGradientColor(kmh(15), minMs, maxMs)).toBe(red);
    expect(speedGradientColor(kmh(20), minMs, maxMs)).toBe(red);
    expect(speedGradientColor(kmh(9.4), minMs, maxMs)).not.toBe(red);
    expect(speedGradientColor(kmh(12), minMs, maxMs)).not.toBe(red);
  });

  it('varie continûment entre les bornes', () => {
    const a = speedGradientColor(kmh(8), minMs, maxMs);
    const b = speedGradientColor(kmh(8.5), minMs, maxMs);
    const c = speedGradientColor(kmh(11), minMs, maxMs);
    expect(a).not.toBe(c);
    expect(a).not.toBe(b);
  });

  it('suit des bornes personnalisées', () => {
    const red = gradientColor(1);
    expect(speedGradientColor(kmh(12), kmh(5), kmh(12))).toBe(red);
    expect(speedGradientColor(kmh(12), kmh(5), kmh(18))).not.toBe(red);
  });
});

describe('gradeGradientColor', () => {
  it('colore la raideur, montée ou descente', () => {
    expect(gradeGradientColor(0.2, DEFAULT_GRADE_RANGE)).toBe(gradeGradientColor(-0.2, DEFAULT_GRADE_RANGE));
    expect(gradeGradientColor(0.2, DEFAULT_GRADE_RANGE)).toBe(gradientColor(0.8));
  });

  it('sature au-delà de la borne haute et grise sous la borne basse ou sans pente', () => {
    expect(gradeGradientColor(0.4, DEFAULT_GRADE_RANGE)).toBe(gradientColor(1));
    expect(gradeGradientColor(0.02, { min: 0.05, max: 0.25 })).toBe(SLOW_COLOR);
    expect(gradeGradientColor(NaN, DEFAULT_GRADE_RANGE)).toBe(SLOW_COLOR);
  });

  it('refuse des bornes inversées ou négatives', () => {
    expect(isValidGradeRange({ min: 0, max: 0.25 })).toBe(true);
    expect(isValidGradeRange({ min: 0.3, max: 0.2 })).toBe(false);
    expect(isValidGradeRange({ min: -0.1, max: 0.2 })).toBe(false);
  });
});

describe('gradeGradientStops', () => {
  it('place les arrêts de 0 à 1 selon la distance, dans l\'ordre', () => {
    const rows = [0, 0.5, 1, 1.5, 2].map((dist, i) => ({ dist, grade: i * 0.05 }));
    const stops = gradeGradientStops(rows, DEFAULT_GRADE_RANGE);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(stops[4].color).toBe(gradientColor(0.8));
  });

  it('ne garde que les bords d\'une suite de couleurs identiques', () => {
    const rows = [0, 1, 2, 3, 4, 5].map((dist) => ({ dist, grade: dist < 5 ? 0.1 : null }));
    const stops = gradeGradientStops(rows, DEFAULT_GRADE_RANGE);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.8, 1]);
    expect(stops[2].color).toBe(SLOW_COLOR);
  });
});
