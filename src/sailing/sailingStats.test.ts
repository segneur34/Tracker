import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import type { RawTrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';
import { buildSailingSessionStats } from './sailingStats';

const START_MS = Date.parse('2026-10-21T10:00:00Z');
const LAT = 43.6;
const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);

/** Trace vers l'est à 1 Hz, à la vitesse de chaque phase (`[durée en s, vitesse en nœuds]`). */
const buildTrack = (phases: [number, number][]) => {
  const points: RawTrackPoint[] = [];
  let meters = 0;
  let t = 0;
  const push = () => points.push({ lat: LAT, lon: 3.8 + meters / M_PER_DEG_LON, time: new Date(START_MS + t * 1000).toISOString() });
  push();
  for (const [durationS, kn] of phases) {
    for (let i = 0; i < durationS; i++) {
      meters += knotsToMs(kn);
      t += 1;
      push();
    }
  }
  return computeKinematics(points);
};

describe('buildSailingSessionStats', () => {
  // 10 min à 4 nœuds, puis un bord de 5 min à 0,5 nœud.
  const track = buildTrack([[600, 4], [300, 0.5]]);

  it('bateau : toute la session en navigation, bord lent compris, seuil ignoré', () => {
    for (const stats of [buildSailingSessionStats(track, { sport: 'bateau' })!, buildSailingSessionStats(track, { sport: 'bateau', activeThresholdKn: 3 })!]) {
      expect(stats.activeRatio).toBe('100.0');
      expect(stats.activeAvgSpeedMs!).toBeCloseTo(stats.avgSpeedMs!, 6);
    }
  });

  it('wingfoil : le seuil écarte le bord lent', () => {
    const stats = buildSailingSessionStats(track, { sport: 'wingfoil', activeThresholdKn: 2 })!;
    expect(parseFloat(stats.activeRatio)).toBeLessThan(80);
  });
});
