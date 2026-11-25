import { describe, expect, it } from 'vitest';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { LocationFix } from '../platform/location';
import { computeLiveStats } from './liveStats';
import { resumeLiveLegs, splitLiveLegs, type LiveLegSplit, type LiveLegsMemory } from './liveLegs';
import { computeKinematics } from '../core/kinematics';
import { angleDiff } from '../core/angles';
import { M_PER_DEG_LAT, mPerDegLon } from '../test/geo.fixture';

const T0 = Date.UTC(2026, 8, 25, 14, 0, 0);
const LAT = 43.5;
const M_PER_DEG_LON = mPerDegLon(LAT);

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

describe('bords du direct', () => {
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

describe('resumeLiveLegs', () => {
  const trackOf = (fixes: LocationFix[]) =>
    computeKinematics(
      fixes.map((f) => ({ lat: f.lat, lon: f.lon, time: new Date(f.timeMs), rawTimeMs: f.timeMs, speedMs: f.speedMs })),
      { medianWindowSeconds: wing.medianWindowSeconds, maxSpeedMs: wing.maxPlausibleSpeedMs, maxGapS: wing.maxGapS }
    );
  /** Virements, bord ouvert de 20 min, manœuvre lente, clapot. */
  const course = (hz: number) => sail(
    [
      { durationS: 120, fromDeg: 45, speedMs: 8 },
      { durationS: 6, fromDeg: 45, toDeg: 315, speedMs: 4 },
      { durationS: 90, fromDeg: 315, speedMs: 7 },
      { durationS: 24, fromDeg: 315, toDeg: 135, speedMs: 5 },
      { durationS: 1200, fromDeg: 135, speedMs: 7.5 },
      { durationS: 8, fromDeg: 135, toDeg: 45, speedMs: 4 },
      { durationS: 60, fromDeg: 45, speedMs: 6 },
    ],
    hz, 0, (t) => 6 * Math.sin(t / 4)
  );

  for (const hz of [1, 5]) {
    it(`repris sur une trace qui s'allonge, donne les bords du calcul entier, à ${hz} Hz`, () => {
      const fixes = course(hz);
      const track = trackOf(fixes);
      // Le virage compressé dans un seul pas : un enregistreur économique qui se tait 22 s.
      const compressed = trackOf([...sail([{ durationS: 120, fromDeg: 45, speedMs: 5 }]), ...sail([{ durationS: 22, fromDeg: 180, speedMs: 3 }, { durationS: 120, fromDeg: 315, speedMs: 5 }], 1, 120).slice(22)]);
      for (const whole of [track, compressed]) {
        let memory: LiveLegsMemory | null = null;
        let frozen = 0;
        let sawLongOpen = false;
        for (let n = 2; n <= whole.length; n += 1 + ((n * 13) % 9)) {
          const prefix = whole.slice(0, n);
          // Points figés : jamais moins qu'à l'appel précédent, de 0 à 16 points avant la fin.
          frozen = Math.max(frozen, n - ((n * 7) % 17));
          const resumed: { split: LiveLegSplit; memory: LiveLegsMemory | null } = resumeLiveLegs(prefix, frozen, memory);
          memory = resumed.memory;
          const open = resumed.split.open;
          if (open && open.endMs - open.startMs > 19 * 60_000) sawLongOpen = true;
          if (n % 3 !== 0 && n !== whole.length) continue;
          expect(resumed.split).toEqual(splitLiveLegs(prefix));
        }
        expect(sawLongOpen).toBe(whole === track);
      }
    });
  }
});
