import { describe, expect, it } from 'vitest';
import { IMU_FORMAT, IMU_VERSION, PHONE_STREAMS, type ImuRecording, type ImuSeries } from './imuFile';
import { synthImu } from './imuSynthetic.fixture';
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

  /**
   * Téléphone à plat, force verticale ; à partir de `calmUntilS`, il tourne sur
   * lui-même, autour de sa verticale, assez vite pour couper le recalage ; la
   * dernière seconde, une force horizontale de g·tan 60° fausse de 60° la
   * direction de départ de la passe retour.
   */
  const leaningEnd = (calmUntilS: number, rateHz = 100, calmStepAtS = -1) =>
    recording(
      stream('accel', rateHz, 30, (t, a) => (a === 2 ? STANDARD_G : a === 0 && t >= 29 ? STANDARD_G * Math.tan(Math.PI / 3) : 0)),
      stream('gyro', rateHz, 30, (t, a) => (a === 2 && t >= calmUntilS && Math.abs(t - calmStepAtS) > 1e-3 ? 3 : 0))
    );

  it.each([50, 100, 200])('à %i Hz : une passe jamais recalée ne fausse pas celle qui l\'a été', (hz) => {
    const v = verticalAcceleration(leaningEnd(20, hz), P, 0, 30e6)!;
    const i = Math.round((25e6 - v.startUs) / v.stepUs);
    const dot = v.upF[0][i] * v.upB[0][i] + v.upF[1][i] * v.upB[1][i] + v.upF[2][i] * v.upB[2][i];
    // Les deux passes restent en désaccord de 60° (le doute « verticale » le lit), mais la verticale est juste.
    expect((Math.acos(dot) * 180) / Math.PI).toBeGreaterThan(50);
    expect(Math.abs(v.aUp[i])).toBeLessThan(0.05);
  });

  it('aller à 0,003, retour à 0 : le poids ne saute pas, presque la moyenne simple', () => {
    // Un seul pas calme à 5 s : à 25 s, seul l'aller en a profité, d'une part de pas / τ ≈ 0,003.
    const aUpAt25 = (rec: ImuRecording) => {
      const v = verticalAcceleration(rec, P, 0, 30e6)!;
      return v.aUp[Math.round((25e6 - v.startUs) / v.stepUs)];
    };
    const none = aUpAt25(leaningEnd(0));
    expect(none).toBeLessThan(-1);
    expect(Math.abs(aUpAt25(leaningEnd(0, 100, 5)) - none)).toBeLessThan(0.02);
  });

  it('sans aucun recalage, les deux passes pèsent autant', () => {
    const v = verticalAcceleration(leaningEnd(30), { ...P, attitudeMaxRotationRadS: 0 }, 0, 30e6)!;
    const i = Math.round((25e6 - v.startUs) / v.stepUs);
    expect(v.aUp[i]).toBeCloseTo(STANDARD_G * (Math.cos(Math.PI / 6) - 1), 1);
  });

  it('le calcul d\'une fenêtre ne lit aucune mesure en dehors', () => {
    const rec = flat(100, 5);
    const v = verticalAcceleration(rec, P, 2e6, 4e6)!;
    expect(v.startUs).toBeGreaterThanOrEqual(2e6);
    expect(v.startUs + (v.n - 1) * v.stepUs).toBeLessThanOrEqual(4e6);
  });

  it.each([0, 30, 60])('vitesse de rotation autour de la verticale juste, téléphone penché de %i°', (deg) => {
    // Le buste tourne à 1 rad/s, puis à −0,5 rad/s : la projection sur le « haut » le retrouve.
    const rec = synthImu({ durationS: 10, az: () => 0, tilt: () => (deg * Math.PI) / 180, yaw: (t) => (t < 5 ? t : 5 - 0.5 * (t - 5)) });
    const v = verticalAcceleration(rec, P, 0, 10e6)!;
    const at = (s: number) => v.yawRate[Math.round((s * 1e6 - v.startUs) / v.stepUs)];
    expect(at(2.5)).toBeCloseTo(1, 1);
    expect(at(7.5)).toBeCloseTo(-0.5, 1);
  });
});
