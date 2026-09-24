import { describe, expect, it } from 'vitest';
import type { RawTrackPoint } from '../core/types';
import { SUMMARY_CALC_VERSION } from './record';
import { summarizeSession } from './summary';

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

  it('suit un seuil imposé', () => {
    // À 10,8 km/h, un seuil de 12 km/h ne voit jamais la session en mouvement.
    const summary = summarizeSession(buildTrack([[600, 3]]), 'running', { activeThreshold: 12 })!;
    expect(summary.movingTimeS).toBe(0);
  });

  it('donne le même résumé à 1 Hz et à 5 Hz', () => {
    const phases: [number, number][] = [[300, 3], [120, 0], [300, 3.5]];
    const at1 = summarizeSession(buildTrack(phases, 1), 'running')!;
    const at5 = summarizeSession(buildTrack(phases, 5), 'running')!;
    expect(at5.distanceM).toBeCloseTo(at1.distanceM, -1);
    expect(Math.abs(at5.movingTimeS! - at1.movingTimeS!)).toBeLessThan(3);
    expect(at5.endMs - at5.startMs).toBe(at1.endMs - at1.startMs);
  });

  it('rend le dénivelé positif si la trace a des altitudes, `null` sinon', () => {
    // 100 m de montée régulière en 10 min.
    const withEle = summarizeSession(buildTrack([[600, 3]], 1, 100 / 600), 'running')!;
    expect(withEle.elevationGainM).toBeGreaterThan(90);
    expect(withEle.elevationGainM).toBeLessThan(105);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.elevationGainM).toBeNull();
  });

  it('résume une trace sans support, sauf le temps en mouvement', () => {
    const summary = summarizeSession(buildTrack([[600, 3]]), null)!;
    expect(summary.distanceM).toBeCloseTo(1800, -1);
    expect(summary.movingTimeS).toBeNull();
  });

  it('rend `null` pour une trace de moins de deux points', () => {
    expect(summarizeSession([], 'running')).toBeNull();
    expect(summarizeSession(buildTrack([]), 'running')).toBeNull();
  });
});
