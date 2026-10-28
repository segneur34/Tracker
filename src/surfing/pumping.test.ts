import { describe, expect, it } from 'vitest';
import { decodeImu, encodeImu } from '../core/imuFile';
import { SYNTH_WALL_MS, synthImu } from '../core/imuSynthetic.fixture';
import { pruneSurfImu, surfPruneWindows } from './pumping';

const G = 9.80665;
const W = SYNTH_WALL_MS;

/** Capture du téléphone sur la poitrine : pumping vertical de 0,3 g à 1 Hz. */
const capture = (durationS = 120) => synthImu({ durationS, az: (t) => 0.3 * G * Math.sin(2 * Math.PI * t) });

describe('pumping du surf : élagage', () => {
  it('garde une marge autour de chaque glisse, fusionne et rogne à la capture', () => {
    const rec = capture();
    const ride = (fromS: number, toS: number) => ({ startMs: W + fromS * 1000, endMs: W + toS * 1000 });
    expect(surfPruneWindows(rec, [ride(20, 30), ride(70, 80)], 10)).toEqual([[10e6, 40e6], [60e6, 90e6]]);
    expect(surfPruneWindows(rec, [ride(20, 30), ride(45, 50)], 10)).toEqual([[10e6, 60e6]]);
    const last = rec.series[0].t[rec.series[0].t.length - 1];
    expect(surfPruneWindows(rec, [ride(5, 115)], 10)).toEqual([[0, last]]);
  });

  it("élague le fichier d'un enregistrement, et rend tel quel un fichier déjà élagué", async () => {
    const rec = capture(60);
    const bytes = await encodeImu(rec.header, rec.series);
    const pruned = await pruneSurfImu(bytes, [{ startMs: W + 30_000, endMs: W + 40_000 }], 5);
    const back = await decodeImu(pruned);
    expect(back?.header.windows).toEqual([[25e6, 45e6]]);
    expect(back!.series[0].t[0]).toBeGreaterThanOrEqual(25e6);
    expect(await pruneSurfImu(pruned, [{ startMs: W, endMs: W + 1000 }], 5)).toBe(pruned);
  });
});
