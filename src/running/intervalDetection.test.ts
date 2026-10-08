import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { detectIntervals, otsuThreshold } from './intervalDetection';

const START = Date.parse('2026-10-08T18:00:00Z');

/** Les réglages du profil, ceux de l'application. */
const PARAMS = SPORT_PROFILES['run-intervals'].intervals!.detection;

const LAT = 43.6;
const METERS_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);

const point = (meters: number, timeMs: number, speedMs: number): TrackPoint => ({
  lat: LAT, lon: 3.8 + meters / METERS_PER_DEG_LON, time: new Date(timeMs).toISOString(), timeMs,
  speedMs, smoothedSpeedMs: speedMs, bearing: 90, speedSource: 'doppler',
});

/** Trace vers l'est, un point toutes les `stepS` secondes ; `speedAtS(k)` : vitesse de la seconde k. */
const buildTrack = (speedAtS: (s: number) => number, durationS: number, stepS = 1): TrackPoint[] => {
  const points: TrackPoint[] = [];
  let meters = 0;
  for (let t = 0; t <= durationS + 1e-9; t += stepS) {
    // Vitesse du segment qui mène au point : celle de la seconde où il tombe.
    const speedMs = speedAtS(Math.max(0, Math.ceil(t - 1e-9) - 1));
    meters += t > 0 ? speedMs * stepS : 0;
    points.push(point(meters, START + Math.round(t * 1000), speedMs));
  }
  return points;
};

/**
 * Trace d'une application qui ne pose un point qu'à chaque `everyM` mètres
 * parcourus (Komoot) : un toutes les 2 s en effort, un toutes les 25 s en
 * récupération. La vitesse d'un point est celle de son segment.
 */
const buildSparseTrack = (speedAtS: (s: number) => number, durationS: number, everyM = 10): TrackPoint[] => {
  const points = [point(0, START, speedAtS(0))];
  let meters = 0;
  let lastM = 0;
  let lastT = 0;
  for (let t = 0.1; t <= durationS + 1e-9; t += 0.1) {
    meters += speedAtS(Math.floor(t - 0.1 + 1e-9)) * 0.1;
    if (meters - lastM >= everyM || t >= durationS - 1e-9) {
      points.push(point(meters, START + Math.round(t * 1000), (meters - lastM) / (t - lastT)));
      lastM = meters;
      lastT = t;
    }
  }
  return points;
};

const allMoving = (track: TrackPoint[]) => track.map(() => true);
const detect = (track: TrackPoint[], override: number | null = null, mask = allMoving(track)) =>
  detectIntervals(track, buildCumulativeTrack(track), mask, PARAMS, override);
const works = (found: ReturnType<typeof detect>, series = 0) =>
  found.series[series]?.phases.filter((p) => p.kind === 'travail') ?? [];

/**
 * Échauffement de 5 min à 2,8 m/s, 8 × (1 min à 5 m/s, 1 min à 1,5 m/s),
 * sans repos après la dernière, retour au calme de 5 min à 2,5 m/s. Trois
 * accélérations de 3 s pendant l'échauffement.
 */
const WARMUP_S = 300;
const session = (s: number): number => {
  if (s < WARMUP_S) return s >= 200 && s % 30 < 3 ? 5 : 2.8;
  const t = s - WARMUP_S;
  if (t < 8 * 120 - 60) return t % 120 < 60 ? 5 : 1.5;
  return 2.5;
};
const SESSION_S = WARMUP_S + 8 * 120 - 60 + 300;

/**
 * Comme la séance réelle du 21/07 : 7 min de footing à 2,6 m/s, 12 × 10/10,
 * 3 min de marche, 14 × 20/20, 5 min de footing ; récupérations presque à
 * l'arrêt (0,4 m/s).
 */
const blocks = (s: number): number => {
  if (s < 420) return 2.6;
  let t = s - 420;
  if (t < 12 * 20) return t % 20 < 10 ? 5.3 : 0.4;
  t -= 12 * 20;
  if (t < 180) return 0.4;
  t -= 180;
  if (t < 14 * 40) return t % 40 < 20 ? 5 : 0.4;
  return 2.6;
};
const BLOCKS_S = 420 + 12 * 20 + 180 + 14 * 40 + 300;

describe('otsuThreshold', () => {
  it('sépare deux groupes pondérés au milieu de leurs valeurs voisines', () => {
    const result = otsuThreshold([1, 1.2, 5, 5.2, 1.1], [10, 10, 5, 5, 10]);
    expect(result?.threshold).toBeCloseTo(3.1, 9);
    expect(result?.lowMean).toBeCloseTo(1.1, 9);
    expect(result?.highMean).toBeCloseTo(5.1, 9);
    expect(result?.highWeight).toBe(10);
  });

  it('rend `null` sans deux valeurs distinctes', () => {
    expect(otsuThreshold([3, 3, 3], [1, 1, 1])).toBeNull();
  });
});

describe('detectIntervals', () => {
  it("retrouve les huit répétitions d'une séance, échauffement et retour au calme écartés", () => {
    const found = detect(buildTrack(session, SESSION_S));
    expect(found.miss).toBeNull();
    expect(found.series).toHaveLength(1);
    expect(found.series[0].phases.filter((p) => p.kind === 'repos')).toHaveLength(7);
    works(found).forEach((work, i) => {
      // Départ au creux qui précède l'effort, fin au passage sous la détente de sortie.
      expect(work.startMs).toBe(START + (WARMUP_S + i * 120) * 1000);
      expect((work.endMs - work.startMs) / 1000).toBe(60);
    });
    expect(works(found)).toHaveLength(8);
    expect(found.series[0].workout).toEqual({ reps: 8, workS: 60, restS: 60 });
  });

  it('écarte une accélération de 3 s', () => {
    const found = detect(buildTrack(session, SESSION_S));
    expect(works(found)[0].startMs).toBe(START + WARMUP_S * 1000);
  });

  it('donne les mêmes répétitions à 1 Hz et à 5 Hz', () => {
    const a = detect(buildTrack(session, SESSION_S, 1));
    const b = detect(buildTrack(session, SESSION_S, 0.2));
    expect(b.series.map((s) => s.phases)).toEqual(a.series.map((s) => s.phases));
  });

  it('suit une trace clairsemée, un point toutes les 5 s', () => {
    const found = detect(buildTrack(session, SESSION_S, 5));
    expect(works(found)).toHaveLength(8);
    expect(found.series[0].workout).toEqual({ reps: 8, workS: 60, restS: 60 });
  });

  it("fond un creux de 3 s dans l'effort qui l'entoure", () => {
    const withDip = (s: number) => (s >= WARMUP_S + 20 && s < WARMUP_S + 23 ? 1.5 : session(s));
    expect(works(detect(buildTrack(withDip, SESSION_S)))).toHaveLength(8);
  });

  it('range en deux séances un 10/10 et un 20/20 séparés par 3 min de marche, footing écarté', () => {
    const found = detect(buildTrack(blocks, BLOCKS_S));
    expect(found.series.map((s) => s.workout)).toEqual([
      { reps: 12, workS: 10, restS: 10 },
      { reps: 14, workS: 20, restS: 20 },
    ]);
    expect(works(found, 1)[0].startMs).toBe(START + (420 + 12 * 20 + 180) * 1000);
  });

  it("retrouve les deux séances sur une trace d'un point tous les 10 m (Komoot)", () => {
    const sparse = buildSparseTrack(blocks, BLOCKS_S);
    // Bien moins de points en récupération qu'en effort.
    expect(sparse.length).toBeLessThan(BLOCKS_S / 2);
    const found = detect(sparse);
    expect(found.series.map((s) => s.workout)).toEqual([
      { reps: 12, workS: 10, restS: 10 },
      { reps: 14, workS: 20, restS: 20 },
    ]);
  });

  it('ne voit pas de fractionné dans une course régulière, sauf seuil imposé', () => {
    const steady = (s: number) => 3 + 0.2 * Math.sin(s / 7);
    const track = buildTrack(steady, 1800);
    const found = detect(track);
    expect(found.miss).toBe('sans-contraste');
    expect(found.series).toEqual([]);
    expect(found.suggestedThresholdMs).not.toBeNull();
    const imposed = detect(track, 3.15);
    expect(imposed.thresholdMs).toBe(3.15);
    expect(imposed.series.length).toBeGreaterThan(0);
  });

  it('applique un seuil imposé au-dessus de tout effort', () => {
    const found = detect(buildTrack(session, SESSION_S), 6);
    expect(found.miss).toBe('aucun-effort');
    expect(found.suggestedThresholdMs).not.toBeNull();
  });

  it('écarte les arrêts du calcul du seuil', () => {
    // Une longue halte à l'arrêt, hors du masque d'activité, ne déplace pas le seuil.
    const withStop = (s: number) => (s < 600 ? 0 : session(s - 600));
    const track = buildTrack(withStop, SESSION_S + 600);
    const a = detect(track, null, track.map((p) => p.timeMs > START + 600_000));
    const b = detect(buildTrack(session, SESSION_S));
    expect(a.suggestedThresholdMs).toBeCloseTo(b.suggestedThresholdMs!, 6);
    expect(a.series.map((s) => s.workout)).toEqual(b.series.map((s) => s.workout));
  });
});
