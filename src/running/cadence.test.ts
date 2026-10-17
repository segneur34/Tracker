import { describe, expect, it } from 'vitest';
import { SYNTH_WALL_MS, noiseSource, synthImu } from '../core/imuSynthetic';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import {
  analyzeCadence, cadenceAt, cadenceBandPaths, cadenceSeries, gpxStrideCadence, joinCadence, sessionCadence, stepCadenceSpm, timeSpanCadence,
  type CadenceDetection,
} from './cadence';

const P: CadenceDetection = SPORT_PROFILES.running.cadence!;

/** Choc d'un appui : une bosse de `widthS` centrée dans chaque pas, d'amplitude alternée (jambe du téléphone, l'autre). */
const impacts = (spm: number, strong: number, weak = strong, widthS = 0.06) => (t: number) => {
  const period = 60 / spm;
  const k = Math.floor(t / period);
  const phase = t - k * period - period / 2;
  const amp = k % 2 === 0 ? strong : weak;
  return amp * Math.exp(-((phase / widthS) ** 2)) - (amp * widthS * Math.sqrt(Math.PI)) / period;
};

/** Médiane des cadences mesurées entre deux instants (secondes depuis le début). */
const medianBetween = (spm: (number | null)[], from: number, to: number): number | null => {
  const v = spm.slice(from, to).filter((x): x is number => x !== null).sort((a, b) => a - b);
  return v.length > 0 ? v[Math.floor(v.length / 2)] : null;
};
const shareMeasured = (spm: (number | null)[], from: number, to: number) => spm.slice(from, to).filter((x) => x !== null).length / (to - from);

describe('cadenceSeries : pas par minute sur la capture', () => {
  it('course à 168 pas/min, appuis égaux', () => {
    const s = cadenceSeries(synthImu({ durationS: 60, az: impacts(168, 18) }), P)!;
    expect(s.stepS).toBe(1);
    expect(medianBetween(s.spm, 5, 55)).toBeCloseTo(168, 0);
    expect(shareMeasured(s.spm, 5, 55)).toBeGreaterThan(0.95);
  });

  it('course à 180 pas/min : même résultat à 50 et à 100 Hz (règle 2)', () => {
    const at100 = cadenceSeries(synthImu({ durationS: 40, az: impacts(180, 20), rateHz: 100 }), P)!;
    const at50 = cadenceSeries(synthImu({ durationS: 40, az: impacts(180, 20), rateHz: 50 }), P)!;
    expect(medianBetween(at100.spm, 5, 35)).toBeCloseTo(180, 0);
    expect(Math.abs(medianBetween(at50.spm, 5, 35)! - medianBetween(at100.spm, 5, 35)!)).toBeLessThan(1);
  });

  it('marche à 108 pas/min : un balancement doux', () => {
    const f = 108 / 60;
    const az = (t: number) => 2.5 * Math.sin(2 * Math.PI * f * t) + 0.8 * Math.sin(4 * Math.PI * f * t + 0.5);
    const s = cadenceSeries(synthImu({ durationS: 60, az }), P)!;
    expect(medianBetween(s.spm, 5, 55)).toBeCloseTo(108, 0);
  });

  it('téléphone en poche : un appui fort, un faible, c\'est le pas qui ressort, pas la foulée', () => {
    const s = cadenceSeries(synthImu({ durationS: 60, az: impacts(170, 20, 7) }), P)!;
    expect(medianBetween(s.spm, 5, 55)).toBeCloseTo(170, 0);
  });

  it('un balancement à la foulée en plus des appuis (bras, poche) ne divise pas la cadence', () => {
    const steps = impacts(164, 12);
    const az = (t: number) => steps(t) + 3 * Math.sin(Math.PI * (164 / 60) * t);
    const s = cadenceSeries(synthImu({ durationS: 60, az }), P)!;
    expect(medianBetween(s.spm, 5, 55)).toBeCloseTo(164, 0);
  });

  it('à l\'arrêt, ou sur un bruit sans régularité : pas de cadence', () => {
    const still = cadenceSeries(synthImu({ durationS: 30, az: () => 0, noise: 0.05 }), P)!;
    expect(still.spm.every((x) => x === null)).toBe(true);
    const rand = noiseSource(7);
    const values = Array.from({ length: 3001 }, () => 4 * rand());
    const noisy = cadenceSeries(synthImu({ durationS: 30, az: (t) => values[Math.round(t * 100)] }), P)!;
    expect(shareMeasured(noisy.spm, 3, 27)).toBeLessThan(0.3);
  });

  it('un trou de la capture : rien dedans, la cadence de part et d\'autre', () => {
    const s = cadenceSeries(synthImu({ durationS: 80, az: impacts(172, 18), gaps: [[30, 45]] }), P)!;
    expect(s.spm.slice(34, 42).every((x) => x === null)).toBe(true);
    expect(medianBetween(s.spm, 5, 25)).toBeCloseTo(172, 0);
    expect(medianBetween(s.spm, 50, 75)).toBeCloseTo(172, 0);
  });

  it('une marche puis une course : chaque allure à sa cadence', () => {
    const walk = impacts(112, 6);
    const run = impacts(176, 18);
    const s = cadenceSeries(synthImu({ durationS: 90, az: (t) => (t < 45 ? walk(t) : run(t)) }), P)!;
    expect(medianBetween(s.spm, 5, 40)).toBeCloseTo(112, 0);
    expect(medianBetween(s.spm, 50, 85)).toBeCloseTo(176, 0);
  });

  it('cadenceAt : l\'heure de la capture, à la seconde près', () => {
    const s = cadenceSeries(synthImu({ durationS: 30, az: impacts(168, 18) }), P)!;
    expect(s.startMs).toBe(SYNTH_WALL_MS);
    expect(cadenceAt(s, SYNTH_WALL_MS + 15_200)).toBe(s.spm[15]);
    expect(cadenceAt(s, SYNTH_WALL_MS - 5000)).toBeNull();
    expect(cadenceAt(s, SYNTH_WALL_MS + 90_000)).toBeNull();
  });

  it('joinCadence : chaque position reçoit la cadence de son instant', () => {
    const s = cadenceSeries(synthImu({ durationS: 30, az: impacts(168, 18) }), P)!;
    const fixes = [{ timeMs: SYNTH_WALL_MS + 10_000, lat: 0, lon: 0 }, { timeMs: SYNTH_WALL_MS + 99_000, lat: 0, lon: 0 }];
    const joined = joinCadence(fixes, s);
    expect(joined[0].cadenceSpm).toBeCloseTo(168, 0);
    expect(joined[1].cadenceSpm).toBeUndefined();
  });
});

describe('cadence du GPX', () => {
  it('écrite en foulées par minute, entières', () => {
    expect(gpxStrideCadence(171)).toBe(86);
    expect(gpxStrideCadence(108.4)).toBe(54);
  });

  it('relue en pas par minute : doublée (Garmin, Strava, Tracker), sauf un fichier déjà en pas', () => {
    expect(stepCadenceSpm([85, 86, undefined, 0, 88])).toEqual([170, 172, null, null, 176]);
    expect(stepCadenceSpm([54, 55, 56])).toEqual([108, 110, 112]);
    expect(stepCadenceSpm([168, 170, 172])).toEqual([168, 170, 172]);
    expect(stepCadenceSpm([undefined, undefined])).toEqual([null, null]);
  });
});

/** Trace synthétique à 1 Hz : vitesse et cadence imposées seconde par seconde. */
const trackOf = (seconds: number, speedAt: (k: number) => number, spmAt: (k: number) => number | null, hz = 1) => {
  const t0 = Date.UTC(2026, 9, 16, 7, 0, 0);
  const n = Math.round(seconds * hz);
  const track: TrackPoint[] = [];
  const spm: (number | null)[] = [];
  for (let j = 0; j <= n; j++) {
    const k = j / hz;
    const v = speedAt(k);
    track.push({
      lat: 43.6, lon: 3.8 + j * 1e-5, time: new Date(t0 + k * 1000), timeMs: t0 + k * 1000,
      speedMs: v, smoothedSpeedMs: v, bearing: 90, speedSource: 'doppler',
    } as TrackPoint);
    spm.push(spmAt(k));
  }
  return { track, spm };
};

describe('analyzeCadence : onglet « cadence »', () => {
  it('chiffres : moyenne, pas, longueur de pas, tranches de la course', () => {
    // 20 min à 3 m/s et 170 pas/min : 1,06 m par pas, 3 400 pas.
    const { track, spm } = trackOf(1200, () => 3, () => 170);
    const a = analyzeCadence(track, spm, track.map(() => true), null, P)!;
    expect(a.averageSpm).toBeCloseTo(170, 6);
    expect(a.steps).toBeCloseTo(3400, 0);
    expect(a.stepLengthM).toBeCloseTo(3 / (170 / 60), 6);
    expect(a.maxSpm).toBeCloseTo(170, 6);
    expect(a.measuredShare).toBeCloseTo(1, 6);
    expect(a.bands.running).toBe(true);
    expect(a.bands.timesS[3]).toBeCloseTo(1200, 0);
    expect(a.byGrade).toBeNull();
  });

  it('marche : les tranches de la marche ; arrêt et pas mesuré exclus des moyennes', () => {
    // 5 min de marche à 110 pas/min, 2 min d'arrêt sans cadence, 5 min à 100.
    const { track, spm } = trackOf(720, (k) => (k > 300 && k <= 420 ? 0 : 1.4), (k) => (k > 300 && k <= 420 ? null : k <= 300 ? 110 : 100));
    const active = track.map((p) => p.smoothedSpeedMs > 0.5);
    const a = analyzeCadence(track, spm, active, null, P)!;
    expect(a.bands.running).toBe(false);
    expect(a.averageSpm).toBeGreaterThan(104);
    expect(a.averageSpm).toBeLessThan(106);
    expect(a.bands.timesS[2]).toBeGreaterThan(290);
    expect(a.bands.timesS[3]).toBeGreaterThan(290);
  });

  it('maximum sur 30 s : une accélération courte', () => {
    const { track, spm } = trackOf(600, () => 3, (k) => (k >= 200 && k < 240 ? 190 : 165));
    const a = analyzeCadence(track, spm, track.map(() => true), null, P)!;
    expect(a.maxSpm).toBeCloseTo(190, 0);
  });

  it('selon la vitesse : plus vite, la cadence et le pas montent', () => {
    // 10 min à 2,5 m/s et 160 pas/min, 10 min à 4 m/s et 180 pas/min.
    const { track, spm } = trackOf(1200, (k) => (k < 600 ? 2.5 : 4), (k) => (k < 600 ? 160 : 180));
    const a = analyzeCadence(track, spm, track.map(() => true), null, P)!;
    expect(a.bySpeed).toHaveLength(2);
    expect(a.bySpeed[0].spm).toBeCloseTo(160, 0);
    expect(a.bySpeed[1].spm).toBeCloseTo(180, 0);
    expect(a.bySpeed[1].stepLengthM!).toBeGreaterThan(a.bySpeed[0].stepLengthM!);
    expect(a.bySpeed[0].fromMs).toBeLessThanOrEqual(2.5);
    expect(a.bySpeed[0].toMs).toBeGreaterThan(2.5);
  });

  it("selon la pente : les zones de l'onglet des pentes", () => {
    const { track, spm } = trackOf(1200, () => 3, (k) => (k < 600 ? 175 : 160));
    const grades = track.map((_, i) => (i < 600 ? 0 : 0.06));
    const a = analyzeCadence(track, spm, track.map(() => true), grades, P)!;
    const zone = (key: string) => a.byGrade!.find((z) => z.zone === key)!;
    expect(zone('flat').spm).toBeCloseTo(175, 0);
    expect(zone('up').spm).toBeCloseTo(160, 0);
    expect(zone('steepUp').timeS).toBe(0);
  });

  it('dérive : premier et dernier tiers ; rien sous dix minutes', () => {
    const { track, spm } = trackOf(1800, () => 3, (k) => 175 - (k / 1800) * 10);
    const a = analyzeCadence(track, spm, track.map(() => true), null, P)!;
    expect(a.drift!.first.spm).toBeGreaterThan(a.drift!.last.spm + 5);
    const short = trackOf(300, () => 3, () => 170);
    expect(analyzeCadence(short.track, short.spm, short.track.map(() => true), null, P)!.drift).toBeNull();
  });

  it('même résultat à 1 Hz et à 5 Hz (règle 2)', () => {
    const at1 = trackOf(1200, (k) => (k < 600 ? 2.5 : 4), (k) => (k < 600 ? 160 : 180));
    const at5 = trackOf(1200, (k) => (k < 600 ? 2.5 : 4), (k) => (k < 600 ? 160 : 180), 5);
    const a1 = analyzeCadence(at1.track, at1.spm, at1.track.map(() => true), null, P)!;
    const a5 = analyzeCadence(at5.track, at5.spm, at5.track.map(() => true), null, P)!;
    expect(a5.averageSpm).toBeCloseTo(a1.averageSpm, 0);
    expect(a5.steps).toBeCloseTo(a1.steps, -1);
    expect(a5.maxSpm!).toBeCloseTo(a1.maxSpm!, 0);
  });

  it('sans cadence en mouvement : rien', () => {
    const { track, spm } = trackOf(300, () => 3, () => null);
    expect(analyzeCadence(track, spm, track.map(() => true), null, P)).toBeNull();
  });
});

describe('timeSpanCadence et cadenceBandPaths', () => {
  it("cadence et pas d'une répétition", () => {
    const { track, spm } = trackOf(600, (k) => (k >= 100 && k < 160 ? 5 : 2.5), (k) => (k >= 100 && k < 160 ? 190 : 160));
    const rep = timeSpanCadence(track, spm, track[100].timeMs, track[159].timeMs, P.gapS)!;
    expect(rep.spm).toBeCloseTo(190, 0);
    expect(rep.stepLengthM!).toBeCloseTo(5 / (190 / 60), 1);
    expect(timeSpanCadence(track, spm.map(() => null), track[100].timeMs, track[159].timeMs, P.gapS)).toBeNull();
  });

  it("passages d'une tranche, coupés à chaque sortie", () => {
    const { track, spm } = trackOf(300, () => 3, (k) => (k < 100 || k >= 200 ? 175 : 155));
    const paths = cadenceBandPaths(track, spm, track.map(() => true), P.runBands, 3, P.gapS);
    expect(paths).toHaveLength(2);
    expect(cadenceBandPaths(track, spm, track.map(() => true), P.runBands, 1, P.gapS)).toHaveLength(1);
  });
});

describe('sessionCadence : la cadence du GPX', () => {
  it('foulées doublées, couverture et lissage', () => {
    const { track } = trackOf(120, () => 3, () => null);
    const withCad = track.map((p, i) => ({ ...p, cadence: i < 100 ? 85 : undefined }));
    const s = sessionCadence(withCad, P);
    expect(s.spm[0]).toBe(170);
    expect(s.spm[110]).toBeNull();
    expect(s.coveredS).toBeCloseTo(99, 0);
    expect(s.present).toBe(true);
    expect(s.smoothed[50]).toBeCloseTo(170, 6);
    expect(sessionCadence(track, P).present).toBe(false);
  });
});
