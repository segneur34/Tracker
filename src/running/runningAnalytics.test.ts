import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SLOW_COLOR, gradientColor, speedGradientColor } from '../core/speedGradient';
import { GRADE_ANALYSIS as G, SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { computeZoneStats, gradeZonePaths, ungradedMovingS } from './runningAnalytics';
import { haversineDistance } from '../core/geo';
import { eastwardTrack } from '../test/track.fixture';
import { DEFAULT_GRADE_RANGE, classifyGrade, computeGrades, gradeColorPaths, gradeGradientColor, gradeGradientStops, gradeStepColor, isValidGradeRange } from '../core/grade';

/** Trace d'un point par seconde (ou toutes les `intervalS`), vitesse et altitude imposées ; plate à 100 m par défaut. */
const buildTrack = (speedsMs: number[], altitudeAt: (distanceM: number) => number = () => 100, intervalS = 1): TrackPoint[] =>
  eastwardTrack(speedsMs, intervalS, { altitudeAt });

describe('classifyGrade', () => {
  it('range chaque pente dans sa zone', () => {
    expect(classifyGrade(0, G)).toBe('flat');
    expect(classifyGrade(0.02, G)).toBe('flat');
    expect(classifyGrade(0.05, G)).toBe('up');
    expect(classifyGrade(0.15, G)).toBe('steepUp');
    expect(classifyGrade(-0.05, G)).toBe('down');
    expect(classifyGrade(-0.2, G)).toBe('steepDown');
    expect(classifyGrade(NaN, G)).toBeNull();
  });
});

describe('computeGrades', () => {
  it('mesure une pente constante de 8 %', () => {
    // 3 m/s pendant 200 s = 600 m, altitude qui monte de 8 m tous les 100 m.
    const track = buildTrack(new Array(200).fill(3), (d) => 100 + 0.08 * d);
    const cum = buildCumulativeTrack(track);
    const grades = computeGrades(track.map((p) => p.ele as number), cum, G.halfWindowM);

    // Loin des bords, la pente doit être exacte.
    expect(grades[100]).toBeCloseTo(0.08, 3);
    expect(grades[50]).toBeCloseTo(0.08, 3);
  });

  it('lit une pente nulle sur du plat', () => {
    const track = buildTrack(new Array(100).fill(3));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM);
    expect(grades[50]).toBeCloseTo(0, 6);
  });

  it('résiste au bruit d\'altitude grâce à la fenêtre de 50 m', () => {
    // Plat avec ±0,5 m de bruit d'un point à l'autre : entre deux points
    // consécutifs, la pente naïve atteindrait 15 %.
    const track = buildTrack(new Array(100).fill(3), (d) => 100 + (Math.round(d / 3) % 2 === 0 ? 0.5 : -0.5));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM);
    expect(Math.abs(grades[50])).toBeLessThan(0.03);
  });

  it('laisse NaN là où l\'altitude manque', () => {
    const track = buildTrack(new Array(100).fill(3));
    const eles = track.map((p) => p.ele as number);
    for (let i = 40; i < 60; i++) eles[i] = NaN;
    const grades = computeGrades(eles, buildCumulativeTrack(track), G.halfWindowM);
    expect(Number.isNaN(grades[50])).toBe(true);
    expect(Number.isNaN(grades[10])).toBe(false);
  });

  /** Montée régulière à 5 % sur 2 400 m, à `speedMs`, un point tous les `intervalS`. */
  const climb = (speedMs: number, intervalS: number) => {
    const track = buildTrack(new Array(Math.round(2400 / speedMs / intervalS)).fill(speedMs), (d) => 100 + 0.05 * d, intervalS);
    return { track, grades: computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM) };
  };

  it('même pente de 5 % à 1 Hz, à 5 Hz et à un point toutes les 4 s à 8 m/s (règles 2 et 10)', () => {
    for (const { track, grades } of [climb(3, 1), climb(3, 0.2), climb(8, 4)]) {
      const interior = grades.filter((_, i) => i > 0 && i < track.length - 1);
      // Points espacés de 32 m : aucun voisin dans ±25 m, la pente vient de l'altitude interpolée.
      expect(interior.every((g) => Math.abs(g - 0.05) < 1e-9)).toBe(true);
    }
  });

  it('un point tous les 30 m : la pente partout, sauf là où la fenêtre déborde de la trace', () => {
    const { track, grades } = climb(3, 10);
    expect(grades[0]).toBeCloseTo(0.05, 9);
    expect(grades[track.length - 1]).toBeCloseTo(0.05, 9);
    expect(grades.every((g) => Math.abs(g - 0.05) < 1e-9)).toBe(true);
  });

  it('une trace plus courte que la demi-fenêtre n\'a pas de pente', () => {
    const track = buildTrack(new Array(6).fill(3), (d) => 100 + 0.05 * d);
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM);
    expect(grades.every((g) => Number.isNaN(g))).toBe(true);
  });

  it('ne mesure pas un saut d\'altitude pendant une pause : la fenêtre s\'arrête à la reprise', () => {
    // Plat à 100 m, 20 min de pause, plat à 115 m (altitude du GPS qui a dérivé sur place).
    const before = buildTrack(new Array(200).fill(3));
    const after = buildTrack(new Array(200).fill(3), () => 115).map((p, k) => ({
      ...p,
      timeMs: p.timeMs + 1400_000,
      time: new Date(p.timeMs + 1400_000).toISOString(),
      ...(k === 0 ? { segmentStart: true as const } : {}),
    }));
    const track = [...before, ...after];
    const cum = buildCumulativeTrack(track);
    const eles = track.map((p) => p.ele as number);
    const cut = computeGrades(eles, cum, G.halfWindowM, track);
    expect(cut.every((g) => Number.isNaN(g) || Math.abs(g) < 0.01)).toBe(true);
    expect(cut.filter((g) => Number.isNaN(g))).toHaveLength(0);
    // Sans les points, la fenêtre enjambe la pause : c'est le défaut corrigé.
    const uncut = computeGrades(eles, cum, G.halfWindowM);
    expect(Math.max(...uncut.filter((g) => !Number.isNaN(g)))).toBeGreaterThan(0.25);
  });
});

describe('computeZoneStats', () => {
  it('répartit distance et temps par zone et calcule l\'allure de chacune', () => {
    // 300 m de plat à 4 m/s, puis 300 m à 12 % à 2 m/s.
    const flat = new Array(75).fill(4);
    const climb = new Array(150).fill(2);
    const track = buildTrack([...flat, ...climb], (d) => (d <= 300 ? 100 : 100 + 0.12 * (d - 300)));
    const cum = buildCumulativeTrack(track);
    const grades = computeGrades(track.map((p) => p.ele as number), cum, G.halfWindowM);
    const zones = computeZoneStats(track, grades, new Array(track.length).fill(true), G);

    const flatZone = zones.find((z) => z.zone.key === 'flat')!;
    const steepZone = zones.find((z) => z.zone.key === 'steepUp')!;

    expect(flatZone.distanceM).toBeGreaterThan(200);
    expect(flatZone.avgSpeedMs).toBeCloseTo(4, 0);
    expect(steepZone.distanceM).toBeGreaterThan(200);
    expect(steepZone.avgSpeedMs).toBeCloseTo(2, 0);
  });

  it('exclut les segments à l\'arrêt de l\'allure de la zone', () => {
    const track = buildTrack(new Array(100).fill(3));
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM);
    const mask = new Array(100).fill(true);
    for (let i = 50; i < 100; i++) mask[i] = false;
    const zones = computeZoneStats(track, grades, mask, G);
    const flatZone = zones.find((z) => z.zone.key === 'flat')!;
    expect(flatZone.timeMs).toBeLessThanOrEqual(50 * 1000);
  });
});

describe('ungradedMovingS : passages sans altitude, hors des zones (Q42, lot 81)', () => {
  for (const stepS of [1, 0.2]) {
    it(`à ${1 / stepS} Hz : le temps en mouvement sans pente, pauses exclues`, () => {
      // 100 s à 3 m/s : pente connue sur les 40 premières secondes, inconnue ensuite ; arrêt de 80 à 100 s.
      const n = Math.round(100 / stepS);
      const track = eastwardTrack(new Array(n + 1).fill(3), stepS);
      const grades = track.map((_, k) => (k * stepS <= 40 + 1e-9 ? 0 : NaN));
      const mask = track.map((_, k) => k * stepS <= 80 + 1e-9);
      expect(ungradedMovingS(track, grades, mask, G)).toBeCloseTo(40, 6);
      const zonesS = computeZoneStats(track, grades, mask, G).reduce((s, z) => s + z.timeMs / 1000, 0);
      expect(zonesS + ungradedMovingS(track, grades, mask, G)).toBeCloseTo(80, 6);
    });
  }

  it('rien sans altitude manquante', () => {
    const track = eastwardTrack(new Array(30).fill(3));
    expect(ungradedMovingS(track, track.map(() => 0), track.map(() => true), G)).toBe(0);
  });
});

describe('gradeZonePaths', () => {
  /** 300 m de plat, 300 m à 12 %, 300 m de plat, à 3 m/s : `intervalS` entre deux points. */
  const hillTrack = (intervalS: number) => {
    const altitudeAt = (d: number) => (d <= 300 ? 100 : d <= 600 ? 100 + 0.12 * (d - 300) : 136);
    const track = buildTrack(new Array(Math.round(300 / intervalS)).fill(3), altitudeAt, intervalS);
    const grades = computeGrades(track.map((p) => p.ele as number), buildCumulativeTrack(track), G.halfWindowM);
    return { track, grades };
  };
  const lengthM = (paths: [number, number][][]) =>
    paths.reduce((sum, path) => sum + path.slice(1).reduce((s, [lat, lon], k) => s + haversineDistance(path[k][0], path[k][1], lat, lon), 0), 0);

  it('rend un tracé par passage dans la zone, bout à bout avec la trace', () => {
    const { track, grades } = hillTrack(1);
    const all = new Array(track.length).fill(true);
    const steep = gradeZonePaths(track, grades, all, 'steepUp', G);
    const flat = gradeZonePaths(track, grades, all, 'flat', G);
    expect(steep).toHaveLength(1);
    expect(flat).toHaveLength(2);
    // La montée suit la côte, aux bords près, que la fenêtre de 50 m arrondit.
    expect(lengthM(steep)).toBeGreaterThan(250);
    expect(lengthM(steep)).toBeLessThan(330);
    // Entre le plat et la côte, la pente passe par « Montée » ; chaque tracé reprend là où le précédent finit.
    const up = gradeZonePaths(track, grades, all, 'up', G);
    expect(up[0][0]).toEqual(flat[0][flat[0].length - 1]);
    expect(steep[0][0]).toEqual(up[0][up[0].length - 1]);
  });

  it('les longueurs, comptées comme le tableau, sont celles de computeZoneStats', () => {
    const { track, grades } = hillTrack(1);
    const all = new Array(track.length).fill(true);
    const zones = computeZoneStats(track, grades, all, G);
    for (const key of ['flat', 'up', 'steepUp'] as const) {
      const expected = zones.find((z) => z.zone.key === key)!.distanceM;
      expect(lengthM(gradeZonePaths(track, grades, all, key, G))).toBeCloseTo(expected, -1);
    }
  });

  it('coupe le tracé à une pause et là où la pente manque', () => {
    const { track, grades } = hillTrack(1);
    const mask = new Array(track.length).fill(true);
    for (let i = 40; i < 45; i++) mask[i] = false;
    expect(gradeZonePaths(track, grades, mask, 'flat', G)).toHaveLength(3);
    const holed = [...grades];
    holed[260] = NaN;
    expect(gradeZonePaths(track, holed, new Array(track.length).fill(true), 'flat', G)).toHaveLength(3);
  });

  it('donne la même montée à 1 Hz et à 5 Hz', () => {
    const at = (intervalS: number) => {
      const { track, grades } = hillTrack(intervalS);
      return lengthM(gradeZonePaths(track, grades, new Array(track.length).fill(true), 'steepUp', G));
    };
    expect(Math.abs(at(1) - at(0.2))).toBeLessThan(5);
  });
});

describe('dégradé de vitesse', () => {
  const { minMs, maxMs } = SPORT_PROFILES.running.speedRange;
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

describe('gradeColorPaths', () => {
  const positions: [number, number][] = [0, 1, 2, 3, 4, 5].map((i) => [43.6, 3.8 + i * 0.001]);

  it('fond en un trait les segments voisins de même couleur, le suivant reprenant la dernière position', () => {
    const paths = gradeColorPaths(positions, [null, 0.05, 0.05, 0.05, 0.2, 0.2], DEFAULT_GRADE_RANGE);
    expect(paths).toHaveLength(2);
    expect(paths[0].positions).toEqual(positions.slice(0, 4));
    expect(paths[1].positions).toEqual(positions.slice(3));
    expect(paths[1].color).toBe(gradeStepColor(0.2, DEFAULT_GRADE_RANGE));
  });

  it('donne la même couleur à une montée et à une descente de même raideur, et à deux pentes du même palier', () => {
    expect(gradeColorPaths(positions.slice(0, 4), [null, 0.1, -0.1, 0.101], DEFAULT_GRADE_RANGE)).toHaveLength(1);
  });

  it('met en gris une pente manquante ou sous la borne basse', () => {
    const paths = gradeColorPaths(positions.slice(0, 3), [null, NaN, 0.01], { min: 0.03, max: 0.25 });
    expect(paths).toEqual([{ color: SLOW_COLOR, positions: positions.slice(0, 3) }]);
  });

  it('ramène la raideur au palier le plus proche, saturé au-delà de la borne haute', () => {
    expect(gradeStepColor(0.4, DEFAULT_GRADE_RANGE)).toBe(gradientColor(1));
    expect(gradeStepColor(0.1, DEFAULT_GRADE_RANGE, 4)).toBe(gradientColor(0.5));
  });

  it('ne rend rien pour moins de deux positions', () => {
    expect(gradeColorPaths(positions.slice(0, 1), [0.1], DEFAULT_GRADE_RANGE)).toEqual([]);
  });
});
