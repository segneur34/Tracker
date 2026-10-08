import { describe, expect, it } from 'vitest';
import { buildCumulativeTrack } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import { analyzeIntervals, holdRatioOf, intervalPhaseStats, launchOf, repSpeedProfile, type IntervalPhaseSpan } from './intervalStats';

const START = Date.parse('2026-10-07T18:00:00Z');

/** Trace vers l'est, un point toutes les `stepS` secondes, à la vitesse donnée pour chaque seconde. */
const buildTrack = (speedAtS: (s: number) => number, durationS: number, stepS = 1): TrackPoint[] => {
  const lat = 43.6;
  const metersPerDegLon = (Math.PI / 180) * 6371e3 * Math.cos((lat * Math.PI) / 180);
  const points: TrackPoint[] = [];
  let meters = 0;
  for (let s = 0; s <= durationS; s += stepS) {
    // Vitesse retenue du segment qui mène au point : la moyenne sur le pas.
    let segment = 0;
    for (let k = s - stepS; k < s; k++) segment += s > 0 ? speedAtS(k) : 0;
    const speedMs = s > 0 ? segment / stepS : speedAtS(0);
    meters += s > 0 ? segment : 0;
    points.push({
      lat, lon: 3.8 + meters / metersPerDegLon, time: new Date(START + s * 1000).toISOString(), timeMs: START + s * 1000,
      speedMs, smoothedSpeedMs: speedMs, bearing: 90, speedSource: 'doppler',
    });
  }
  return points;
};

/** 2 × (1 min à 5 m/s, 30 s à 1 m/s). */
const speed = (s: number) => (s % 90 < 60 ? 5 : 1);
const phases: IntervalPhaseSpan[] = [
  { kind: 'travail', rep: 1, startMs: START, endMs: START + 60_000 },
  { kind: 'repos', rep: 1, startMs: START + 60_000, endMs: START + 90_000 },
  { kind: 'travail', rep: 2, startMs: START + 90_000, endMs: START + 150_000 },
];

describe('intervalPhaseStats', () => {
  it('mesure chaque phase sur la trace : durée, distance, vitesse moyenne', () => {
    const track = buildTrack(speed, 200);
    const stats = intervalPhaseStats(track, buildCumulativeTrack(track), phases);
    expect(stats.map((s) => [s.kind, s.durationS, Math.round(s.distanceM!), s.speedMs!.toFixed(2)])).toEqual([
      ['travail', 60, 300, '5.00'], ['repos', 30, 30, '1.00'], ['travail', 60, 300, '5.00'],
    ]);
    expect(stats[0].path.length).toBeGreaterThan(50);
  });

  it('interpole aux bornes : une phase qui tombe entre deux points garde sa distance (cadence lâche)', () => {
    const track = buildTrack(() => 4, 200, 20);
    const [one] = intervalPhaseStats(track, buildCumulativeTrack(track), [{ kind: 'travail', rep: 1, startMs: START + 25_000, endMs: START + 35_000 }]);
    expect(one.distanceM).toBeCloseTo(40, 6);
    expect(one.path).toHaveLength(2);
  });

  it('donne le même résultat à 1 Hz et à 5 Hz', () => {
    const at1 = buildTrack(speed, 200, 1);
    const at5: TrackPoint[] = [];
    // 5 Hz : les points à 1 Hz, et quatre points intermédiaires à la même vitesse.
    for (let i = 0; i < at1.length; i++) {
      if (i > 0) {
        const a = at1[i - 1];
        const b = at1[i];
        for (let k = 1; k < 5; k++) {
          const f = k / 5;
          at5.push({ ...b, lat: a.lat + f * (b.lat - a.lat), lon: a.lon + f * (b.lon - a.lon), timeMs: a.timeMs + f * 1000 });
        }
      }
      at5.push(at1[i]);
    }
    const s1 = intervalPhaseStats(at1, buildCumulativeTrack(at1), phases);
    const s5 = intervalPhaseStats(at5, buildCumulativeTrack(at5), phases);
    s1.forEach((s, i) => expect(s5[i].distanceM).toBeCloseTo(s.distanceM!, 6));
  });

  it('rend une phase hors de la trace sans distance', () => {
    const track = buildTrack(speed, 100);
    const [late] = intervalPhaseStats(track, buildCumulativeTrack(track), [{ kind: 'repos', rep: 1, startMs: START + 200_000, endMs: START + 230_000 }]);
    expect(late).toMatchObject({ distanceM: null, speedMs: null, path: [], durationS: 30 });
  });
});

const PARAMS = { profileStepS: 1, launchFraction: 0.9 };

/** Accélération de 1 m/s² jusqu'à 6 m/s : vitesse moyenne de chaque seconde. */
const launchSpeed = (s: number) => Math.min(s + 0.5, 6);

describe('repSpeedProfile', () => {
  it('donne la vitesse de chaque pas, tirée de la distance', () => {
    const track = buildTrack(() => 5, 100);
    const profile = repSpeedProfile(track, buildCumulativeTrack(track), START + 10_000, START + 40_000, 1);
    expect(profile).toHaveLength(30);
    profile.forEach((v) => expect(v).toBeCloseTo(5, 9));
  });

  it('comble une trace clairsemée par la vitesse moyenne du trou (cadence lâche)', () => {
    const track = buildTrack(() => 4, 200, 10);
    const profile = repSpeedProfile(track, buildCumulativeTrack(track), START + 25_000, START + 85_000, 1);
    expect(profile).toHaveLength(60);
    profile.forEach((v) => expect(v).toBeCloseTo(4, 9));
  });

  it('rend `null` pour les pas hors de la trace', () => {
    const track = buildTrack(() => 4, 30);
    const profile = repSpeedProfile(track, buildCumulativeTrack(track), START + 25_000, START + 35_000, 1);
    expect(profile.filter((v) => v === null)).toHaveLength(5);
  });
});

describe('launchOf et holdRatioOf', () => {
  it("trouve la mise en vitesse et l'accélération d'un départ à 1 m/s²", () => {
    const track = buildTrack(launchSpeed, 80);
    const cum = buildCumulativeTrack(track);
    const profile = repSpeedProfile(track, cum, START, START + 60_000, 1);
    // 18 m d'accélération puis 54 s à 6 m/s : 342 m en 60 s, 5,7 m/s ; 90 % font 5,13 m/s, atteints à 5,13 s.
    const launch = launchOf(profile, 342 / 60, PARAMS);
    expect(launch?.launchS).toBeCloseTo(5.13, 6);
    expect(launch?.accelMs2).toBeCloseTo(1, 6);
  });

  it('compte un départ lancé pour nul, sans accélération', () => {
    expect(launchOf([5, 5, 5], 5, PARAMS)).toEqual({ launchS: 0, accelMs2: null });
  });

  it("mesure le maintien d'un effort qui faiblit, après la mise en vitesse", () => {
    const speedAt = (s: number) => (s < 2 ? 3 : s < 31 ? 6 : 5.7);
    const track = buildTrack(speedAt, 80);
    const profile = repSpeedProfile(track, buildCumulativeTrack(track), START, START + 60_000, 1);
    const launch = launchOf(profile, 345.3 / 60, PARAMS);
    expect(holdRatioOf(profile, launch!.launchS, 1)).toBeCloseTo(0.95, 9);
  });

  it('donne les mêmes profil, mise en vitesse et maintien à 1 Hz et à 5 Hz', () => {
    const at1 = buildTrack(launchSpeed, 80, 1);
    const at5: TrackPoint[] = [];
    for (let i = 0; i < at1.length; i++) {
      if (i > 0) {
        const a = at1[i - 1];
        const b = at1[i];
        for (let k = 1; k < 5; k++) at5.push({ ...b, timeMs: a.timeMs + (k / 5) * 1000 });
      }
      at5.push(at1[i]);
    }
    const p1 = repSpeedProfile(at1, buildCumulativeTrack(at1), START, START + 60_000, 1);
    const p5 = repSpeedProfile(at5, buildCumulativeTrack(at5), START, START + 60_000, 1);
    p1.forEach((v, k) => expect(p5[k]).toBeCloseTo(v!, 9));
    expect(launchOf(p5, 5.7, PARAMS)?.launchS).toBeCloseTo(launchOf(p1, 5.7, PARAMS)!.launchS, 9);
  });
});

describe('analyzeIntervals', () => {
  // Quatre répétitions de 30 s à 5,0, 4,9, 4,8 puis 4,7 m/s, 30 s de repos à 1 m/s entre elles.
  const repSpeeds = [5, 4.9, 4.8, 4.7];
  const speedAt = (s: number) => {
    const rep = Math.floor(s / 60);
    return s % 60 < 30 && rep < repSpeeds.length ? repSpeeds[rep] : 1;
  };
  const sessionPhases: IntervalPhaseSpan[] = repSpeeds.flatMap((_, i): IntervalPhaseSpan[] => [
    { kind: 'travail', rep: i + 1, startMs: START + i * 60_000, endMs: START + i * 60_000 + 30_000 },
    ...(i < repSpeeds.length - 1 ? [{ kind: 'repos' as const, rep: i + 1, startMs: START + i * 60_000 + 30_000, endMs: START + (i + 1) * 60_000 }] : []),
  ]);

  it('associe à chaque répétition le repos qui la suit, et en fait la synthèse', () => {
    const track = buildTrack(speedAt, 300);
    const { reps, summary } = analyzeIntervals(track, buildCumulativeTrack(track), sessionPhases, PARAMS);
    expect(reps.map((r) => [r.rep, r.work.speedMs!.toFixed(2), r.rest?.durationS ?? null])).toEqual([
      [1, '5.00', 30], [2, '4.90', 30], [3, '4.80', 30], [4, '4.70', null],
    ]);
    expect(summary.count).toBe(4);
    expect(summary.meanSpeedMs).toBeCloseTo(4.85, 9);
    expect(summary.best).toEqual({ rep: 1, speedMs: expect.closeTo(5, 9) });
    expect(summary.worst).toEqual({ rep: 4, speedMs: expect.closeTo(4.7, 9) });
    expect(summary.regularity).toBeCloseTo(Math.sqrt(0.0125) / 4.85, 9);
    // Pente de −0,1 m/s par répétition, rapportée à la moyenne.
    expect(summary.trend?.perRep).toBeCloseTo(-0.1 / 4.85, 9);
    expect(summary.trend?.firstMs).toBeCloseTo(5, 9);
    expect(summary.trend?.lastMs).toBeCloseTo(4.7, 9);
    expect(summary.meanProfile).toHaveLength(30);
    expect(summary.meanProfile[10]).toBeCloseTo(4.85, 9);
    // Vitesse constante dès le premier pas : départ lancé, maintien parfait.
    expect(summary.launchS).toBe(0);
    expect(summary.holdRatio).toBeCloseTo(1, 9);
  });

  it('ne trace pas de tendance sous trois répétitions', () => {
    const track = buildTrack(speedAt, 300);
    const { summary } = analyzeIntervals(track, buildCumulativeTrack(track), sessionPhases.slice(0, 3), PARAMS);
    expect(summary.count).toBe(2);
    expect(summary.trend).toBeNull();
  });
});
