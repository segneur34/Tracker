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
    // Bord lent à 1,5 nœud : sous le seuil (3 nœuds, sortie à 2), mais en mouvement (au-dessus du
    // plancher d'arrêt, 1 nœud), donc au dénominateur du ratio depuis le 28/10.
    const stats = buildSailingSessionStats(buildTrack([[600, 4], [300, 1.5]]), { sport: 'wingfoil', activeThresholdKn: 3 })!;
    expect(parseFloat(stats.activeRatio)).toBeLessThan(80);
  });

  it('wingfoil : ratio de vol sur le temps en mouvement, 10 min d\'arrêt avant et après n\'y changent rien (28/10)', () => {
    // 10 min de vol à 15 nœuds, 5 min en archimédien à 3 nœuds : 2/3 de vol.
    const sailed = buildSailingSessionStats(buildTrack([[600, 15], [300, 3]]), { sport: 'wingfoil', activeThresholdKn: 7 })!;
    const withStops = buildSailingSessionStats(buildTrack([[600, 0], [600, 15], [300, 3], [600, 0]]), { sport: 'wingfoil', activeThresholdKn: 7 })!;
    expect(parseFloat(sailed.activeRatio)).toBeCloseTo(66.7, 0);
    expect(Math.abs(parseFloat(withStops.activeRatio) - parseFloat(sailed.activeRatio))).toBeLessThanOrEqual(0.5);
    expect(withStops.inMotionTimeS).toBeGreaterThan(890);
    expect(withStops.inMotionTimeS).toBeLessThan(910);
  });

  it('bateau : pas de temps en mouvement à part, sans seuil ni ratio', () => {
    expect(buildSailingSessionStats(track, { sport: 'bateau' })!.inMotionTimeS).toBe(0);
  });
});
