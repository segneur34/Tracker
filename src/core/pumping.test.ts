import { describe, expect, it } from 'vitest';
import { selectImuWindows, type ImuRecording } from './imuFile';
import { SYNTH_WALL_MS, synthImu } from './imuSynthetic.fixture';
import {
  flightSpans, keepsWholeCaptureForPumping, measureFlightPumping, summarizePumping, type FlightPumping, type FlightSpan, type PumpDetection,
} from './pumping';
import { activeRuns, buildCumulativeTrack } from './sessionStats';
import { SPORT_PROFILES } from './sportProfiles';
import type { TrackPoint } from './types';

const G = 9.80665;
const P = SPORT_PROFILES.surf.pump!;
const W = SYNTH_WALL_MS;

/** Chocs de la planche sur l'eau : quelques sinus de 3 à 8 Hz, 0,9 g au plus. */
const water = (t: number) => 0.4 * G * Math.sin(2 * Math.PI * 5.3 * t) + 0.3 * G * Math.sin(2 * Math.PI * 7.1 * t + 1) + 0.2 * G * Math.sin(2 * Math.PI * 3.3 * t + 2);
/** Clapot léger ressenti en vol : 2 à 4 Hz, 0,1 g au plus. */
const chop = (t: number) => 0.045 * G * Math.sin(2 * Math.PI * 2.3 * t) + 0.03 * G * Math.sin(2 * Math.PI * 3.7 * t + 1) + 0.015 * G * Math.sin(2 * Math.PI * 1.1 * t + 2);

interface Session {
  /** Fin des chocs de l'eau : le décollage, en secondes. */
  liftoffS: number;
  /** Pumping : fréquence en Hz (0 : aucun), de `pumpFromS` à `pumpToS`. */
  pumpHz: number;
  pumpFromS?: number;
  pumpToS?: number;
  durationS?: number;
}

/** Capture du téléphone sur la poitrine : sur l'eau, puis en vol, pumping vertical de 0,3 g, buste qui bascule à chaque pompe. */
const capture = (s: Session): ImuRecording => {
  const from = s.pumpFromS ?? s.liftoffS + 1;
  const to = s.pumpToS ?? 95;
  const pumping = (t: number) => (s.pumpHz > 0 && t >= from && t < to ? Math.sin(2 * Math.PI * s.pumpHz * (t - from)) : 0);
  return synthImu({
    durationS: s.durationS ?? 120,
    az: (t) => (t < s.liftoffS ? water(t) : chop(t) + 0.3 * G * pumping(t)),
    ay: (t) => 0.1 * G * pumping(t),
    tilt: (t) => Math.PI / 6 + 0.2 * Math.sin(2 * Math.PI * 0.1 * t) + 0.1 * pumping(t),
  });
};

/** Vitesse de la trace, en m/s : 2 sur l'eau, puis 5 qui ondule en vol. */
const speedAt = (t: number) => (t < 38 ? 2 : t < 42 ? 2 + (t - 38) * 0.75 : 5 + 0.5 * Math.sin((2 * Math.PI * t) / 20));

/** Trace GPS à `hz` points par seconde, vitesses tirées de `speedAt`. */
const trackAt = (hz: number, durationS = 120): TrackPoint[] =>
  Array.from({ length: durationS * hz + 1 }, (_, k) => {
    const t = k / hz;
    const timeMs = W + t * 1000;
    return { lat: 43.4, lon: 3.6, time: new Date(timeMs), timeMs, speedMs: speedAt(t), smoothedSpeedMs: speedAt(t), bearing: 0, speedSource: 'doppler' };
  });

/** Vol vu par le GPS, de `fromS` à `toS`. */
const flightSpan = (track: TrackPoint[], fromS: number, toS: number, n = 1): FlightSpan => {
  const start = track.findIndex((p) => p.timeMs >= W + fromS * 1000);
  const end = track.findIndex((p) => p.timeMs >= W + toS * 1000);
  return { n, start, end, startMs: track[start].timeMs, endMs: track[end].timeMs, durationS: toS - fromS, distanceM: 0 };
};

const measure = (rec: ImuRecording, hz = 1, fromS = 41, toS = 100, p: PumpDetection = P): FlightPumping => {
  const track = trackAt(hz);
  const result = measureFlightPumping(rec, p, track, buildCumulativeTrack(track), [flightSpan(track, fromS, toS)])[0];
  expect(result).not.toBeNull();
  return result!;
};

describe('pumping : coups', () => {
  it.each([1, 2])('compte un pumping à %s Hz, et sa fréquence', (hz) => {
    const p = measure(capture({ liftoffS: 40, pumpHz: hz, pumpFromS: 45, pumpToS: 95 }));
    expect(Math.abs(p.strokes - 50 * hz)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.strokesPerMin! - 60 * hz) / (60 * hz)).toBeLessThan(0.05);
    expect(Math.abs(p.pumpS - 50)).toBeLessThan(2);
    expect(p.covered).toBe(true);
  });

  it('donne la même distance par coup avec une trace à 1 Hz et à 5 Hz', () => {
    const rec = capture({ liftoffS: 40, pumpHz: 1.5, pumpFromS: 45, pumpToS: 95 });
    const at1 = measure(rec, 1);
    const at5 = measure(rec, 5);
    expect(at1.strokes).toBe(at5.strokes);
    expect(Math.abs(at1.perStrokeM! - at5.perStrokeM!) / at5.perStrokeM!).toBeLessThan(0.02);
    // Vers 5 m/s, 1,5 coup par seconde : un peu plus de 3 m par coup.
    expect(at5.perStrokeM!).toBeGreaterThan(2.9);
    expect(at5.perStrokeM!).toBeLessThan(3.8);
    expect(Math.abs(at5.pumpDistanceM - at5.perStrokeM! * at5.strokes)).toBeLessThan(1e-6);
  });

  it('ne compte rien sur un vol sans pumping, clapot léger compris', () => {
    const p = measure(capture({ liftoffS: 40, pumpHz: 0 }));
    expect(p.strokes).toBe(0);
    expect(p.strokesPerMin).toBeNull();
    expect(p.perStrokeM).toBeNull();
  });

  it('écarte des coups isolés, trop peu nombreux pour une série', () => {
    // Deux pompes seulement : sous les 3 coups d'une série.
    const p = measure(capture({ liftoffS: 40, pumpHz: 1, pumpFromS: 60, pumpToS: 62 }));
    expect(p.strokes).toBe(0);
  });
});

describe('pumping : décollage', () => {
  it("le trouve à la fin des chocs de l'eau, avec la vitesse GPS de cet instant", () => {
    const p = measure(capture({ liftoffS: 40, pumpHz: 1.5 }));
    expect(p.liftoffMs).not.toBeNull();
    expect(Math.abs(p.liftoffMs! - (W + 40_000))).toBeLessThan(500);
    expect(Math.abs(p.takeoffSpeedMs! - speedAt(40))).toBeLessThan(0.4);
  });

  it("ne le trouve pas quand l'eau n'a laissé aucun choc", () => {
    // Pas d'eau dans la capture : calme de bout en bout de la recherche.
    const p = measure(capture({ liftoffS: 0, pumpHz: 1.5 }));
    expect(p.liftoffMs).toBeNull();
    expect(p.takeoffSpeedMs).toBeNull();
  });
});

describe('pumping : capture partielle', () => {
  it('marque un vol que la capture élaguée ne couvre qu’en partie, et ignore celui qu’elle ne touche pas', () => {
    const rec = selectImuWindows(capture({ liftoffS: 40, pumpHz: 1, pumpFromS: 45, pumpToS: 95 }), [[30e6, 70e6]]);
    const track = trackAt(1);
    const [partial, outside] = measureFlightPumping(rec, P, track, buildCumulativeTrack(track), [flightSpan(track, 41, 100), flightSpan(track, 105, 115, 2)]);
    expect(partial?.covered).toBe(false);
    expect(Math.abs(partial!.strokes - 25)).toBeLessThanOrEqual(1);
    expect(outside).toBeNull();
    expect(summarizePumping([partial, outside]).measured).toBe(1);
  });

  it('ne cherche pas le décollage quand la capture commence au milieu du vol', () => {
    // Chocs en plein vol (un saut, du clapot) à 60 s, capture gardée de 58 à 100 s : leur fin n'est pas un décollage.
    const whole = synthImu({ durationS: 120, az: (t) => (t < 40 || (t >= 60 && t < 62) ? water(t) : chop(t)) });
    const p = measure(selectImuWindows(whole, [[58e6, 100e6]]));
    expect(p.covered).toBe(false);
    expect(p.liftoffMs).toBeNull();
    expect(p.takeoffSpeedMs).toBeNull();
  });
});

describe('pumping en voile sur foil', () => {
  const S = SPORT_PROFILES.wingfoil.pump!;

  it('a les constantes du pumping en wing, planche et kite, pas en bateau ni hors foil', () => {
    expect(SPORT_PROFILES.windsurf.pump).toBe(S);
    expect(SPORT_PROFILES.kite.pump).toBe(S);
    expect(SPORT_PROFILES.bateau.pump).toBeNull();
    expect(SPORT_PROFILES.running.pump).toBeNull();
    expect(S.minFlightS).toBeGreaterThan(0);
  });

  it("compte un pumping à 1,5 Hz en vol, pas les chocs de l'eau avant le décollage", () => {
    const p = measure(capture({ liftoffS: 40, pumpHz: 1.5, pumpFromS: 45, pumpToS: 95 }), 1, 41, 100, S);
    expect(Math.abs(p.strokes - 75)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.strokesPerMin! - 90) / 90).toBeLessThan(0.05);
  });

  it('ne fait pas une série d’un saut isolé en vol', () => {
    // Chute libre de 0,6 s, puis le choc de l'arrivée : un seul aller-retour de l'accélération.
    const jump = (t: number) => (t >= 70 && t < 70.6 ? -G : t >= 70.6 && t < 70.75 ? 3 * G : 0);
    const rec = synthImu({ durationS: 120, az: (t) => (t < 40 ? water(t) : chop(t) + jump(t)) });
    expect(measure(rec, 1, 41, 100, S).strokes).toBe(0);
  });

  it('donne les mêmes coups avec une capture à 50 Hz et à 200 Hz, une trace à 1 Hz et à 5 Hz', () => {
    const at = (rateHz: number) => {
      const from = 45;
      const pumping = (t: number) => (t >= from && t < 95 ? Math.sin(2 * Math.PI * 1.5 * (t - from)) : 0);
      return synthImu({
        durationS: 120, rateHz,
        az: (t) => (t < 40 ? water(t) : chop(t) + 0.3 * G * pumping(t)),
        ay: (t) => 0.1 * G * pumping(t),
        tilt: (t) => Math.PI / 6 + 0.1 * pumping(t),
      });
    };
    const results = [measure(at(50), 1, 41, 100, S), measure(at(200), 1, 41, 100, S), measure(at(200), 5, 41, 100, S)];
    for (const r of results) expect(Math.abs(r.strokes - results[0].strokes)).toBeLessThanOrEqual(1);
    for (const r of results) expect(Math.abs(r.perStrokeM! - results[0].perStrokeM!) / results[0].perStrokeM!).toBeLessThan(0.03);
  });
});

describe('vols d’une suite de plages actives', () => {
  /** Trace à `hz` points par seconde, en action de 10 à 40 s, de 50 à 55 s, puis de 70 à 100 s, avec un trou de 20 s à 85 s. */
  const setup = (hz: number) => {
    const points: TrackPoint[] = [];
    for (let k = 0; k <= 120 * hz; k++) {
      const t = k / hz;
      if (t > 85 && t < 105) continue;
      const timeMs = W + t * 1000;
      points.push({ lat: 43.4, lon: 3.6, time: new Date(timeMs), timeMs, speedMs: 5, smoothedSpeedMs: 5, bearing: 0, speedSource: 'doppler' });
    }
    const t = (i: number) => (points[i].timeMs - W) / 1000;
    const mask = points.map((_, i) => (t(i) > 10 && t(i) <= 40) || (t(i) > 50 && t(i) <= 55) || (t(i) > 70 && t(i) <= 120));
    return { points, runs: activeRuns(points, mask, 10) };
  };

  it.each([1, 5])('garde les vols assez longs, numérotés dans l’ordre, coupés au trou de la trace (%s Hz)', (hz) => {
    const { points, runs } = setup(hz);
    const spans = flightSpans(points, buildCumulativeTrack(points), runs, 10);
    expect(spans.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(spans.map((s) => s.durationS)).toEqual([30, 15, 15]);
    // 5 m/s le long du vol.
    expect(spans[0].distanceM).toBeCloseTo(150, 6);
    expect(spans[0].startMs).toBe(W + 10_000);
    expect(spans[2].startMs).toBe(W + 105_000);
  });

  it('les garde tous sans durée minimale', () => {
    const { points, runs } = setup(1);
    expect(flightSpans(points, buildCumulativeTrack(points), runs, 0).map((s) => s.durationS)).toEqual([30, 5, 15, 15]);
  });
});

describe('capture gardée entière pour le pumping', () => {
  it('sur foil, Pumping coché, pour un calcul qui le mesure sans l’élaguer', () => {
    const S = SPORT_PROFILES.wingfoil.pump;
    expect(keepsWholeCaptureForPumping(S, true, true)).toBe(true);
    expect(keepsWholeCaptureForPumping(S, false, true)).toBe(false);
    expect(keepsWholeCaptureForPumping(S, true, false)).toBe(false);
    expect(keepsWholeCaptureForPumping(null, true, true)).toBe(false);
    expect(keepsWholeCaptureForPumping({ ...S!, pruneCapture: true }, true, true)).toBe(false);
  });
});
