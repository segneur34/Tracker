import { describe, expect, it } from 'vitest';
import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, type ImuRecording, type ImuSeries } from './imuFile';
import { captureBounds, mergeWindows, rangeOf, verticalAcceleration, type AttitudeParams } from './imuVertical';
import { STANDARD_G } from './units';

const P: AttitudeParams = {
  gridStepS: 0.01, maxGapS: 0.05, calmForceFraction: 0.1, calmRotationRadS: 0.5, minCalmS: 1, attitudeTauS: 3, attitudeMaxRotationRadS: 1.5, attitudeInitS: 1,
};

const stream = (kind: 'accel' | 'gyro', rateHz: number, durationS: number, value: (t: number, axis: number) => number, startUs = 0): ImuSeries => {
  const info = PHONE_STREAMS.find((s) => s.kind === kind)!;
  const n = Math.round(durationS * rateHz);
  const t = Float64Array.from({ length: n }, (_, i) => startUs + Math.round((i * 1e6) / rateHz));
  return { info, t, values: Array.from({ length: 3 }, (_, a) => Float32Array.from(t, (ti) => value((ti - startUs) / 1e6, a))) };
};

const recording = (...series: ImuSeries[]): ImuRecording => ({
  header: { format: IMU_FORMAT, version: IMU_VERSION, startedAtMs: 0, clock: { elapsedUs: 0, wallMs: 0 }, device: { manufacturer: 'x', model: 'y', android: 36 }, setup: { placement: 'poitrine', foil: true }, streams: [...PHONE_STREAMS] },
  series, chunks: 0, truncated: false, skippedChunks: 0,
});

/** Téléphone posé à plat, immobile, avec une poussée verticale d'une seconde au milieu. */
const flat = (rateHz: number, boost = 0) =>
  recording(
    stream('accel', rateHz, 6, (t, a) => (a === 2 ? STANDARD_G + (t >= 2.5 && t < 3.5 ? boost : 0) : 0)),
    stream('gyro', rateHz, 6, () => 0)
  );

describe('rangeOf', () => {
  it('rend les indices [from, to) des mesures entre deux instants, bornes comprises', () => {
    const s = stream('accel', 100, 1, () => 0);
    expect(rangeOf(s, 100_000, 200_000)).toEqual([10, 21]);
    expect(rangeOf(s, 5_000_000, 6_000_000)).toEqual([100, 100]);
  });
});

describe('mergeWindows', () => {
  it('trie et fusionne celles qui se touchent ou se recouvrent', () => {
    expect(mergeWindows([[50, 60], [0, 10], [10, 20], [15, 18]])).toEqual([[0, 20], [50, 60]]);
  });
  it('ne modifie pas l\'entrée, et accepte une liste vide', () => {
    const input: [number, number][] = [[5, 6], [1, 2]];
    mergeWindows(input);
    expect(input).toEqual([[5, 6], [1, 2]]);
    expect(mergeWindows([])).toEqual([]);
  });
});

describe('captureBounds', () => {
  it('prend le premier et le dernier instant de tous les flux, null sans mesure', () => {
    const rec = recording(stream('accel', 10, 1, () => 0, 1_000_000), stream('gyro', 10, 2, () => 0, 0));
    expect(captureBounds(rec)).toEqual([0, 1_900_000]);
    expect(captureBounds(recording())).toBeNull();
  });
});

describe('verticalAcceleration', () => {
  it('rend null sans gyroscope ou avec trop peu de mesures', () => {
    expect(verticalAcceleration(recording(stream('accel', 100, 2, () => 0)), P, 0, 2e6)).toBeNull();
    expect(verticalAcceleration(flat(100), P, 0, 1)).toBeNull();
  });

  it('à plat et immobile : pesanteur retrouvée, accélération verticale nulle', () => {
    const v = verticalAcceleration(flat(100), P, 0, 6e6)!;
    expect(v).not.toBeNull();
    expect(v.gLocal).toBeCloseTo(STANDARD_G, 2);
    expect(Math.max(...Array.from(v.aUp, Math.abs))).toBeLessThan(0.05);
    expect(Math.max(...v.horizontal)).toBeLessThan(0.05);
  });

  it('retrouve une poussée verticale de 5 m/s², sans dépendre de la cadence du capteur (50, 100, 200 Hz)', () => {
    for (const hz of [50, 100, 200]) {
      const v = verticalAcceleration(flat(hz, 5), P, 0, 6e6)!;
      const at = (s: number) => v.aUp[Math.round(((s * 1e6) - v.startUs) / v.stepUs)];
      expect(at(3)).toBeCloseTo(5, 0);
      expect(Math.abs(at(1))).toBeLessThan(0.3);
    }
  });

  it('retrouve la même poussée quand le téléphone est posé sur la tranche', () => {
    const rec = recording(
      stream('accel', 100, 6, (t, a) => (a === 0 ? STANDARD_G + (t >= 2.5 && t < 3.5 ? 5 : 0) : 0)),
      stream('gyro', 100, 6, () => 0)
    );
    const v = verticalAcceleration(rec, P, 0, 6e6)!;
    expect(v.aUp[Math.round((3e6 - v.startUs) / v.stepUs)]).toBeCloseTo(5, 0);
  });

  it('marque un trou entre deux mesures trop espacées', () => {
    const acc = stream('accel', 100, 6, (_t, a) => (a === 2 ? STANDARD_G : 0));
    const keep = Array.from(acc.t, (ti) => ti < 2.5e6 || ti >= 2.8e6);
    const holed: ImuSeries = { info: acc.info, t: acc.t.filter((_, i) => keep[i]), values: acc.values.map((x) => x.filter((_, i) => keep[i])) };
    const v = verticalAcceleration(recording(holed, stream('gyro', 100, 6, () => 0)), P, 0, 6e6)!;
    expect(v.gap.some((g) => g === 1)).toBe(true);
    expect(v.gap[0]).toBe(0);
  });

  it('le calcul d\'une fenêtre ne lit aucune mesure en dehors', () => {
    const rec = flat(100, 5);
    const v = verticalAcceleration(rec, P, 2e6, 4e6)!;
    expect(v.startUs).toBeGreaterThanOrEqual(2e6);
    expect(v.startUs + (v.n - 1) * v.stepUs).toBeLessThanOrEqual(4e6);
  });
});
