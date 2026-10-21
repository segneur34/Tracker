import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import type { RawTrackPoint } from '../core/types';
import { SUMMARY_CALC_VERSION } from './record';
import { analysisTrack, summarizeSession } from './summary';

const START_MS = Date.parse('2026-09-20T10:00:00Z');
const LAT = 43.6;
const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);

/**
 * Trace vers l'est, `hz` points par seconde, à la vitesse de chaque phase
 * (`[durée en s, vitesse en m/s]`). `climbPerS`, facultatif, fait monter
 * l'altitude d'autant de mètres par seconde.
 */
const buildTrack = (phases: [number, number][], hz = 1, climbPerS?: number): RawTrackPoint[] => {
  const step = 1 / hz;
  const points: RawTrackPoint[] = [];
  let meters = 0;
  let t = 0;
  const push = () =>
    points.push({
      lat: LAT,
      lon: 3.8 + meters / M_PER_DEG_LON,
      time: new Date(START_MS + Math.round(t * 1000)).toISOString(),
      ele: climbPerS === undefined ? undefined : 10 + climbPerS * t,
    });
  push();
  for (const [durationS, speedMs] of phases) {
    for (let i = 0; i < Math.round(durationS * hz); i++) {
      meters += speedMs * step;
      t += step;
      push();
    }
  }
  return points;
};

describe('summarizeSession', () => {
  it('range la FC de la session, rien sans FC', () => {
    const points = buildTrack([[600, 3]]).map((p, i) => ({ ...p, hr: 140 + (i % 20) }));
    const hr = summarizeSession(points, 'running')!.heartRate!;
    expect(hr.avgBpm).toBeGreaterThan(140);
    expect(hr.avgBpm).toBeLessThan(160);
    expect(hr.coveredS).toBe(600);
    expect(hr.histogram.seconds.reduce((a, b) => a + b, 0)).toBeCloseTo(600, -1);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.heartRate).toBeUndefined();
  });

  it('range la cadence à pied (cad du GPX, en foulées), rien sans elle ni à vélo', () => {
    const points = buildTrack([[600, 3]]).map((p) => ({ ...p, cadence: 85 }));
    const cad = summarizeSession(points, 'running')!.cadence!;
    expect(cad.avgSpm).toBeCloseTo(170, 0);
    expect(cad.steps).toBeCloseTo(1700, -1);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.cadence).toBeUndefined();
    expect(summarizeSession(points, 'cycling')!.cadence).toBeUndefined();
  });

  it('rend la distance intégrée, les bornes et la cadence', () => {
    const summary = summarizeSession(buildTrack([[600, 3]]), 'running')!;
    expect(summary.calcVersion).toBe(SUMMARY_CALC_VERSION);
    expect(summary.startMs).toBe(START_MS);
    expect(summary.endMs).toBe(START_MS + 600_000);
    expect(summary.distanceM).toBeCloseTo(1800, -1);
    expect(summary.pointCount).toBe(601);
    expect(summary.samplingS).toBeCloseTo(1, 5);
    expect(summary.maxSpeedMs).toBeCloseTo(3, 1);
  });

  it('part de la trace d\'analyse, celle que la vignette colore', () => {
    // Pic de 1 s à 60 m/s : au-delà de la vitesse plausible d'une course, il est écrêté.
    const raw = buildTrack([[300, 3], [1, 60], [300, 3]]);
    for (const sport of ['running', 'wingfoil'] as const) {
      const track = analysisTrack(raw, sport);
      const summary = summarizeSession(raw, sport)!;
      expect(summary.pointCount).toBe(track.length);
      expect(summary.maxSpeedMs).toBe(Math.max(...track.map((p) => p.smoothedSpeedMs)));
    }
    expect(Math.max(...analysisTrack(raw, 'running').map((p) => p.smoothedSpeedMs))).toBeLessThan(20);
    // Sans support, aucun filtre : la trace brute enrichie.
    expect(analysisTrack(raw, null)).toEqual(computeKinematics(raw));
  });

  it('ne compte en mouvement que le temps passé au-dessus du seuil du support', () => {
    // Course : 10 min à 10,8 km/h, puis 5 min à l'arrêt.
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0]]), 'running')!;
    expect(summary.movingTimeS).toBeGreaterThan(590);
    expect(summary.movingTimeS).toBeLessThan(610);
  });

  it('accorde le seuil de la voile à l\'allure de la session, comme le module', () => {
    // Wingfoil à 20 nœuds pendant 10 min, puis 5 min à 2 nœuds : seul le vol compte.
    const summary = summarizeSession(buildTrack([[600, 10.3], [300, 1]]), 'wingfoil')!;
    expect(summary.movingTimeS).toBeGreaterThan(590);
    expect(summary.movingTimeS).toBeLessThan(610);
  });

  it('mesure la distance parcourue en action, avec le même masque que le temps', () => {
    // 10 min à 3 m/s, 5 min à 0,5 m/s (sous le seuil de la course) : seuls les 1 800 m courus comptent.
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0.5]]), 'running')!;
    expect(summary.distanceM).toBeCloseTo(1950, -1);
    expect(summary.movingDistanceM!).toBeGreaterThan(1750);
    expect(summary.movingDistanceM!).toBeLessThan(1850);
    expect(summary.movingDistanceM! / summary.movingTimeS!).toBeCloseTo(3, 1);
    // Toute en action : la distance entière.
    const all = summarizeSession(buildTrack([[600, 3]]), 'running')!;
    expect(all.movingDistanceM!).toBeGreaterThan(all.distanceM - 20);
    // Voile : seul le vol.
    const wing = summarizeSession(buildTrack([[600, 10.3], [300, 1]]), 'wingfoil')!;
    expect(wing.movingDistanceM! / wing.movingTimeS!).toBeCloseTo(10.3, 0);
  });

  it('compte toute une session bateau en navigation, sans seuil, bords lents compris', () => {
    // 10 min à 4 nœuds, 5 min à 0,5 nœud : rien n'est écarté, même un seuil imposé.
    const raw = buildTrack([[600, 2.06], [300, 0.26]]);
    for (const summary of [summarizeSession(raw, 'bateau')!, summarizeSession(raw, 'bateau', { activeThreshold: 3 })!]) {
      expect(summary.movingTimeS).toBeCloseTo((summary.endMs - summary.startMs) / 1000, 5);
      expect(summary.movingDistanceM).toBeCloseTo(summary.distanceM, 5);
    }
  });

  it('suit un seuil imposé', () => {
    // À 10,8 km/h, un seuil de 12 km/h ne voit jamais la session en mouvement.
    const summary = summarizeSession(buildTrack([[600, 3]]), 'running', { activeThreshold: 12 })!;
    expect(summary.movingTimeS).toBe(0);
  });

  it('sans seuil (réglé à 0), compte toute la session en mouvement', () => {
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0]]), 'running', { activeThreshold: 0 })!;
    expect(summary.movingTimeS).toBeCloseTo(900, 5);
    expect(summary.movingDistanceM).toBeCloseTo(summary.distanceM, 5);
  });

  it("ne compte ni la distance ni le temps en mouvement d'une pause de l'enregistrement, à 1 Hz comme à 5 Hz", () => {
    // 5 min à 3 m/s, pause de 10 min (un second `<trkseg>`), 5 min à 3 m/s ; vitesse Doppler sur chaque point,
    // celle de la reprise comprise : intégrée sur la pause, elle ajoutait 1 800 m (bug du 17/10).
    const paused = (hz: number): RawTrackPoint[] => {
      const pauseStart = START_MS + 300_000;
      const pauseEnd = START_MS + 900_000;
      return buildTrack([[300, 3], [600, 0], [300, 3]], hz)
        .filter((p) => Date.parse(p.time as string) <= pauseStart || Date.parse(p.time as string) >= pauseEnd)
        .map((p) => ({ ...p, speedMs: 3, ...(Date.parse(p.time as string) === pauseEnd ? { segmentStart: true as const } : {}) }));
    };
    for (const hz of [1, 5]) {
      for (const activeThreshold of [0, undefined]) {
        const summary = summarizeSession(paused(hz), 'running', { activeThreshold })!;
        expect(summary.distanceM).toBeCloseTo(1800, -1);
        expect(summary.movingTimeS!).toBeGreaterThan(590);
        expect(summary.movingTimeS!).toBeLessThan(601);
        expect(summary.endMs - summary.startMs).toBe(1_200_000);
      }
    }
  });

  it('donne le même résumé à 1 Hz et à 5 Hz', () => {
    const phases: [number, number][] = [[300, 3], [120, 0], [300, 3.5]];
    const at1 = summarizeSession(buildTrack(phases, 1), 'running')!;
    const at5 = summarizeSession(buildTrack(phases, 5), 'running')!;
    expect(at5.distanceM).toBeCloseTo(at1.distanceM, -1);
    expect(Math.abs(at5.movingTimeS! - at1.movingTimeS!)).toBeLessThan(3);
    expect(Math.abs(at5.movingDistanceM! - at1.movingDistanceM!)).toBeLessThan(10);
    expect(at5.endMs - at5.startMs).toBe(at1.endMs - at1.startMs);
  });

  it('rend le dénivelé positif si la trace a des altitudes, `null` sinon', () => {
    // 100 m de montée régulière en 10 min.
    const withEle = summarizeSession(buildTrack([[600, 3]], 1, 100 / 600), 'running')!;
    expect(withEle.elevationGainM).toBeGreaterThan(90);
    expect(withEle.elevationGainM).toBeLessThan(105);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.elevationGainM).toBeNull();
  });

  it("prend le dénivelé sur l'altitude du terrain quand la fiche en porte une", () => {
    // GPS : 100 m de montée ; terrain : 50 m, un échantillon toutes les 10 s, même sans altitude GPS.
    const t = Array.from({ length: 61 }, (_, i) => i * 10_000);
    const terrainElevation = { startMs: START_MS, t, z: t.map((ms) => 50 + (50 * ms) / 600_000) };
    for (const raw of [buildTrack([[600, 3]], 1, 100 / 600), buildTrack([[600, 3]])]) {
      const summary = summarizeSession(raw, 'running', { terrainElevation })!;
      expect(summary.elevationGainM).toBeGreaterThan(45);
      expect(summary.elevationGainM).toBeLessThan(52);
    }
  });

  it('résume une trace sans support, sauf le temps en mouvement', () => {
    const summary = summarizeSession(buildTrack([[600, 3]]), null)!;
    expect(summary.distanceM).toBeCloseTo(1800, -1);
    expect(summary.movingTimeS).toBeNull();
    expect(summary.movingDistanceM).toBeNull();
  });

  it('rend `null` pour une trace de moins de deux points', () => {
    expect(summarizeSession([], 'running')).toBeNull();
    expect(summarizeSession(buildTrack([]), 'running')).toBeNull();
  });
});
