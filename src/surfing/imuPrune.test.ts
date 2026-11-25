import { describe, expect, it } from 'vitest';
import { decodeImu, encodeImu } from '../core/imuFile';
import { SYNTH_WALL_MS, synthImu } from '../core/imuSynthetic.fixture';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { pruneSurfImu, surfPruneWindows } from './imuPrune';

const G = 9.80665;
const W = SYNTH_WALL_MS;
const BREAK_S = SPORT_PROFILES.surf.pump!.captureBreakS;

/** Capture du téléphone sur la poitrine : pumping vertical de 0,3 g à 1 Hz. */
const capture = (durationS = 120) => synthImu({ durationS, az: (t) => 0.3 * G * Math.sin(2 * Math.PI * t) });

describe('pumping du surf : élagage', () => {
  it('garde une marge autour de chaque glisse, fusionne et rogne à la capture', () => {
    const rec = capture();
    const ride = (fromS: number, toS: number) => ({ startMs: W + fromS * 1000, endMs: W + toS * 1000 });
    expect(surfPruneWindows(rec, [ride(20, 30), ride(70, 80)], 10, BREAK_S)).toEqual([[10e6, 40e6], [60e6, 90e6]]);
    expect(surfPruneWindows(rec, [ride(20, 30), ride(45, 50)], 10, BREAK_S)).toEqual([[10e6, 60e6]]);
    const last = rec.series[0].t[rec.series[0].t.length - 1];
    expect(surfPruneWindows(rec, [ride(5, 115)], 10, BREAK_S)).toEqual([[0, last]]);
    // Sans trou, la coupure ne change rien.
    expect(surfPruneWindows(rec, [ride(20, 30), ride(70, 80)], 10, Infinity)).toEqual(surfPruneWindows(rec, [ride(20, 30), ride(70, 80)], 10, BREAK_S));
  });

  it.each([1, 5])('trace à %i Hz : une glisse à cheval sur le trou d\'une capture reprise donne une fenêtre de chaque côté, aucune à travers', async (hz) => {
    // Capture coupée de 120 s à 720 s, reprise dans le même fichier (lot 232) ; la trace GPS continue.
    const rec = synthImu({ durationS: 840, az: (t) => 0.3 * G * Math.sin(2 * Math.PI * t), gaps: [[120, 720]] });
    const trackMs = Array.from({ length: 840 * hz + 1 }, (_, k) => W + (k * 1000) / hz);
    const ride = { startMs: trackMs.find((ms) => ms >= W + 110_000)!, endMs: trackMs.find((ms) => ms >= W + 730_000)! };
    const t = rec.series[0].t;
    const lastBefore = t[t.findIndex((x) => x >= 720e6) - 1];
    expect(surfPruneWindows(rec, [ride], 10, BREAK_S)).toEqual([[100e6, lastBefore], [720e6, 740e6]]);
    // Sans la coupure, la fenêtre franchissait le trou.
    expect(surfPruneWindows(rec, [ride], 10, Infinity)).toEqual([[100e6, 740e6]]);
    const back = await decodeImu(await pruneSurfImu(await encodeImu(rec.header, rec.series), [ride], 10, BREAK_S));
    expect(back?.header.windows).toEqual([[100e6, lastBefore], [720e6, 740e6]]);
  });

  it("élague le fichier d'un enregistrement, et rend tel quel un fichier déjà élagué", async () => {
    const rec = capture(60);
    const bytes = await encodeImu(rec.header, rec.series);
    const pruned = await pruneSurfImu(bytes, [{ startMs: W + 30_000, endMs: W + 40_000 }], 5, BREAK_S);
    const back = await decodeImu(pruned);
    expect(back?.header.windows).toEqual([[25e6, 45e6]]);
    expect(back!.series[0].t[0]).toBeGreaterThanOrEqual(25e6);
    expect(await pruneSurfImu(pruned, [{ startMs: W, endMs: W + 1000 }], 5, BREAK_S)).toBe(pruned);
  });
});
