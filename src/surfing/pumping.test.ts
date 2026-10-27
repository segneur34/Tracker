import { describe, expect, it } from 'vitest';
import { decodeImu, encodeImu, selectImuWindows, type ImuRecording } from '../core/imuFile';
import { SYNTH_WALL_MS, synthImu } from '../core/imuSynthetic.fixture';
import { buildCumulativeTrack } from '../core/sessionStats';
import { SPORT_PROFILES } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { measureFlightPumping, pruneSurfImu, summarizePumping, surfPruneWindows, type FlightPumping } from './pumping';
import type { SurfSpan } from './surfAnalysis';

const G = 9.80665;
const P = SPORT_PROFILES.surf.surf!.pump;
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
const flightSpan = (track: TrackPoint[], fromS: number, toS: number, n = 1): SurfSpan => {
  const start = track.findIndex((p) => p.timeMs >= W + fromS * 1000);
  const end = track.findIndex((p) => p.timeMs >= W + toS * 1000);
  return {
    n, start, end, startMs: track[start].timeMs, endMs: track[end].timeMs, durationS: toS - fromS,
    distanceM: 0, maxSpeedMs: 0, avgSpeedMs: 0,
  };
};

const measure = (rec: ImuRecording, hz = 1, fromS = 41, toS = 100): FlightPumping => {
  const track = trackAt(hz);
  const result = measureFlightPumping(rec, P, track, buildCumulativeTrack(track), [flightSpan(track, fromS, toS)])[0];
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

describe('pumping : capture partielle et élagage', () => {
  it('marque un vol que la capture élaguée ne couvre qu’en partie, et ignore celui qu’elle ne touche pas', () => {
    const rec = selectImuWindows(capture({ liftoffS: 40, pumpHz: 1, pumpFromS: 45, pumpToS: 95 }), [[30e6, 70e6]]);
    const track = trackAt(1);
    const [partial, outside] = measureFlightPumping(rec, P, track, buildCumulativeTrack(track), [flightSpan(track, 41, 100), flightSpan(track, 105, 115, 2)]);
    expect(partial?.covered).toBe(false);
    expect(Math.abs(partial!.strokes - 25)).toBeLessThanOrEqual(1);
    expect(outside).toBeNull();
    expect(summarizePumping([partial, outside]).measured).toBe(1);
  });

  it('garde une marge autour de chaque glisse, fusionne et rogne à la capture', () => {
    const rec = capture({ liftoffS: 40, pumpHz: 0 });
    const ride = (fromS: number, toS: number) => ({ startMs: W + fromS * 1000, endMs: W + toS * 1000 });
    expect(surfPruneWindows(rec, [ride(20, 30), ride(70, 80)], 10)).toEqual([[10e6, 40e6], [60e6, 90e6]]);
    expect(surfPruneWindows(rec, [ride(20, 30), ride(45, 50)], 10)).toEqual([[10e6, 60e6]]);
    const last = rec.series[0].t[rec.series[0].t.length - 1];
    expect(surfPruneWindows(rec, [ride(5, 115)], 10)).toEqual([[0, last]]);
  });

  it("élague le fichier d'un enregistrement, et rend tel quel un fichier déjà élagué", async () => {
    const rec = capture({ liftoffS: 40, pumpHz: 1, durationS: 60 });
    const bytes = await encodeImu(rec.header, rec.series);
    const pruned = await pruneSurfImu(bytes, [{ startMs: W + 30_000, endMs: W + 40_000 }], 5);
    const back = await decodeImu(pruned);
    expect(back?.header.windows).toEqual([[25e6, 45e6]]);
    expect(back!.series[0].t[0]).toBeGreaterThanOrEqual(25e6);
    expect(await pruneSurfImu(pruned, [{ startMs: W, endMs: W + 1000 }], 5)).toBe(pruned);
  });
});
