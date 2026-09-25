import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { angleDiff } from '../sailing/wind';
import { computeLiveStats } from './liveStats';

const T0 = Date.UTC(2026, 8, 25, 14, 0, 0);
const M_PER_DEG_LAT = (6371e3 * Math.PI) / 180;
const LAT = 43.5;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT * Math.PI) / 180);

/** Morceau de trace : cap tenu, ou virage régulier de `fromDeg` à `toDeg`, à vitesse constante. */
interface Piece {
  durationS: number;
  fromDeg: number;
  toDeg?: number;
  speedMs: number;
}

/**
 * Trace à `hz` positions par seconde, enchaînant les morceaux ; `wobble(t)`
 * ajoute un écart de cap (clapot). Positions et vitesse Doppler cohérentes.
 */
const sail = (pieces: Piece[], hz = 1, startS = 0, wobble: (t: number) => number = () => 0): LocationFix[] => {
  const fixes: LocationFix[] = [];
  let lat = LAT;
  let lon = 3.9;
  let t = startS;
  const step = 1 / hz;
  fixes.push({ timeMs: T0 + t * 1000, lat, lon, speedMs: pieces[0].speedMs });
  for (const piece of pieces) {
    const n = Math.round(piece.durationS * hz);
    for (let k = 1; k <= n; k++) {
      const turn = piece.toDeg === undefined ? 0 : angleDiff(piece.toDeg, piece.fromDeg);
      const heading = piece.fromDeg + (turn * k) / n + wobble(t);
      const rad = (heading * Math.PI) / 180;
      t += step;
      lat += (piece.speedMs * step * Math.cos(rad)) / M_PER_DEG_LAT;
      lon += (piece.speedMs * step * Math.sin(rad)) / M_PER_DEG_LON;
      fixes.push({ timeMs: T0 + t * 1000, lat, lon, speedMs: piece.speedMs });
    }
  }
  return fixes;
};

const wing = SPORT_PROFILES.wingfoil;
const legsOf = (segments: LocationFix[][]) => computeLiveStats(segments, wing).legs;
const tack = (hz = 1): LocationFix[] =>
  sail(
    [
      { durationS: 120, fromDeg: 45, speedMs: 8 },
      { durationS: 6, fromDeg: 45, toDeg: 315, speedMs: 4 },
      { durationS: 90, fromDeg: 315, speedMs: 7 },
    ],
    hz
  );

describe('computeLiveLegs', () => {
  it('rend un seul bord en ligne droite, au cap de la route', () => {
    const { current, previous } = legsOf([sail([{ durationS: 180, fromDeg: 80, speedMs: 8 }])]);
    expect(previous).toBeNull();
    expect(current?.headingDeg).toBeCloseTo(80, 0);
    expect(current?.averageSpeedMs).toBeCloseTo(8, 1);
    expect(current?.maxSpeedMs).toBeCloseTo(8, 1);
  });

  it('ferme le bord au virement et ouvre le suivant après le virage', () => {
    const { current, previous } = legsOf([tack()]);
    expect(previous?.headingDeg).toBeCloseTo(45, 0);
    expect(previous?.averageSpeedMs).toBeCloseTo(8, 1);
    expect(Math.abs(angleDiff(current!.headingDeg!, 315))).toBeLessThan(2);
    expect(current?.averageSpeedMs).toBeCloseTo(7, 1);
    // Le virage (120 à 126 s, dernier pas déjà au cap de sortie) n'appartient à aucun des deux bords.
    expect((previous!.endMs - T0) / 1000).toBeLessThanOrEqual(120);
    expect((current!.startMs - T0) / 1000).toBeGreaterThanOrEqual(125);
  });

  it('donne les mêmes bords à 1 Hz et à 5 Hz', () => {
    const a = legsOf([tack(1)]);
    const b = legsOf([tack(5)]);
    expect(b.previous?.headingDeg).toBeCloseTo(a.previous!.headingDeg!, 0);
    expect(b.current?.headingDeg).toBeCloseTo(a.current!.headingDeg!, 0);
    expect(Math.abs(b.current!.startMs - a.current!.startMs)).toBeLessThanOrEqual(2000);
  });

  it('ne coupe pas le bord pour le clapot', () => {
    const wobble = (t: number) => 20 * Math.sin(t / 3);
    const { current, previous } = legsOf([sail([{ durationS: 300, fromDeg: 200, speedMs: 8 }], 1, 0, wobble)]);
    expect(previous).toBeNull();
    expect(Math.abs(angleDiff(current!.headingDeg!, 200))).toBeLessThan(5);
  });

  it("lit un virage compressé dans un seul pas d'enregistreur économique", () => {
    const before = sail([{ durationS: 120, fromDeg: 45, speedMs: 5 }]);
    const after = sail([{ durationS: 22, fromDeg: 180, speedMs: 3 }, { durationS: 120, fromDeg: 315, speedMs: 5 }], 1, 120);
    // L'enregistreur se tait pendant le virage : un seul pas de 22 s.
    const fixes = [...before, ...after.slice(22).map((f, k) => (k === 0 ? { ...f, speedMs: 3 } : f))];
    const { current, previous } = legsOf([fixes]);
    expect(previous?.headingDeg).toBeCloseTo(45, 0);
    expect(current?.headingDeg).toBeCloseTo(315, 0);
  });

  it("n'a pas de bord en cours pendant une manœuvre lente", () => {
    // Abattée de 180° en 24 s, trace arrêtée au milieu : le cap tourne encore.
    const fixes = sail([
      { durationS: 120, fromDeg: 45, speedMs: 8 },
      { durationS: 20, fromDeg: 45, toDeg: 195, speedMs: 6 },
    ]);
    const { current, previous } = legsOf([fixes]);
    expect(current).toBeNull();
    expect(previous?.headingDeg).toBeCloseTo(45, 0);
  });

  it('ferme le bord à la pause', () => {
    const first = sail([{ durationS: 100, fromDeg: 90, speedMs: 8 }]);
    const second = sail([{ durationS: 60, fromDeg: 90, speedMs: 6 }], 1, 400);
    const { current, previous } = legsOf([first, second]);
    expect(previous?.averageSpeedMs).toBeCloseTo(8, 1);
    expect(current?.averageSpeedMs).toBeCloseTo(6, 1);
  });

  it("laisse le cap vide à l'arrêt", () => {
    const { current } = legsOf([sail([{ durationS: 60, fromDeg: 0, speedMs: 0.05 }])]);
    expect(current?.headingDeg).toBeNull();
  });

  it('ne calcule pas de bords en course à pied', () => {
    const stats = computeLiveStats([tack()], SPORT_PROFILES.running);
    expect(stats.legs).toEqual({ current: null, previous: null });
  });
});
