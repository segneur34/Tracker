import { describe, expect, it } from 'vitest';
import type { HeartRateSample } from '../platform/heartRate';
import { heartRateAt } from './heartRate';

const sample = (timeMs: number, bpm: number, contact: boolean | null = true): HeartRateSample => ({ timeMs, bpm, contact });

/** Positions de `fromMs` à `toMs` tous les `stepMs`, chacune avec la dernière mesure reçue d'une ceinture à 1 Hz. */
const joined = (stepMs: number, samples: HeartRateSample[], toMs: number): Map<number, number | undefined> => {
  const out = new Map<number, number | undefined>();
  for (let t = 0; t <= toMs; t += stepMs) {
    const last = samples.filter((s) => s.timeMs <= t).at(-1) ?? null;
    out.set(t, heartRateAt(last, t, 3));
  }
  return out;
};

describe('heartRateAt', () => {
  it('joint une mesure récente, arrondie', () => {
    expect(heartRateAt(sample(10_000, 131.6), 11_000, 3)).toBe(132);
  });

  it('écarte une mesure trop ancienne ou trop en avance', () => {
    expect(heartRateAt(sample(10_000, 130), 13_000, 3)).toBe(130);
    expect(heartRateAt(sample(10_000, 130), 13_001, 3)).toBeUndefined();
    expect(heartRateAt(sample(10_000, 130), 6_000, 3)).toBeUndefined();
  });

  it('écarte une ceinture sans contact, une mesure nulle ou absente', () => {
    expect(heartRateAt(sample(10_000, 130, false), 10_000, 3)).toBeUndefined();
    expect(heartRateAt(sample(10_000, 130, null), 10_000, 3)).toBe(130);
    expect(heartRateAt(sample(10_000, 0), 10_000, 3)).toBeUndefined();
    expect(heartRateAt(null, 10_000, 3)).toBeUndefined();
  });

  it('donne la même fréquence aux mêmes instants à 1 Hz et à 5 Hz, trou compris', () => {
    // Ceinture à 1 Hz pendant 10 s, muette de 10 à 20 s, puis de retour.
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => sample(i * 1000, 120 + i)),
      ...Array.from({ length: 10 }, (_, i) => sample(20_000 + i * 1000, 140 + i)),
    ];
    const slow = joined(1000, samples, 29_000);
    const fast = joined(200, samples, 29_000);
    for (const [t, bpm] of slow) expect(fast.get(t)).toBe(bpm);
    // Trou de plus de 3 s : pas de fréquence.
    expect(slow.get(15_000)).toBeUndefined();
    expect(slow.get(12_000)).toBe(129);
  });
});
