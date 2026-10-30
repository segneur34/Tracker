import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../core/kinematics';
import { knotsToMs } from '../core/units';
import { buildCumulativeTrack } from '../core/sessionStats';
import { phasesTrack } from '../test/track.fixture';
import { buildSailingSessionStats, sailingFlights } from './sailingStats';

const START_MS = Date.parse('2026-10-21T10:00:00Z');

/** Trace vers l'est à `hz` points par seconde (1 d'office), à la vitesse de chaque phase (`[durée en s, vitesse en nœuds]`). */
const buildTrack = (phases: [number, number][], hz = 1) =>
  computeKinematics(phasesTrack(phases.map(([durationS, kn]): [number, number] => [durationS, knotsToMs(kn)]), hz, { startMs: START_MS }));

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

describe('sailingFlights', () => {
  // Départ lent, un vol de 2 min, un rebond de 5 s, un vol de 1 min 30.
  const phases: [number, number][] = [[60, 3], [120, 15], [30, 3], [5, 15], [60, 3], [90, 15], [30, 3]];

  it.each([1, 5])('vols au-dessus du seuil, ceux de moins de 10 s écartés, numérotés dans l’ordre (%s Hz)', (hz) => {
    const track = buildTrack(phases, hz);
    const flights = sailingFlights(track, buildCumulativeTrack(track), 'wingfoil', 8, 10);
    expect(flights.map((f) => f.n)).toEqual([1, 2]);
    expect(Math.abs(flights[0].durationS - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(flights[1].durationS - 90)).toBeLessThanOrEqual(2);
    expect(Math.abs(flights[0].distanceM - 120 * knotsToMs(15)) / (120 * knotsToMs(15))).toBeLessThan(0.03);
    expect(sailingFlights(track, buildCumulativeTrack(track), 'wingfoil', 8, 0)).toHaveLength(3);
  });

  it('rien en bateau, sans seuil', () => {
    const track = buildTrack(phases);
    expect(sailingFlights(track, buildCumulativeTrack(track), 'bateau', 8, 10)).toEqual([]);
  });
});
