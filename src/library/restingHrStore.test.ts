import { describe, expect, it } from 'vitest';
import { RESTING_HR_TEST, type RestingSample } from '../recording/restingHrTest';
import { restingHrResult } from '../running/restingHrResults';
import { MAX_STORED_RESTING_RESULTS, readStoredRestingResults, toStoredRestingResult } from './restingHrStore';

const P = RESTING_HR_TEST;
const START = 1_000_000;

/** Mesures à `hz`, de `fromS` à `toS` (secondes depuis le départ), la FC en fonction du temps. */
const samples = (hz: number, fn: (tS: number) => number | null, fromS = 0, toS = P.durationS): RestingSample[] => {
  const out: RestingSample[] = [];
  for (let k = 0; k < (toS - fromS) * hz; k++) {
    const tS = fromS + k / hz;
    out.push({ timeMs: START + tS * 1000, bpm: fn(tS) });
  }
  return out;
};

describe('résultats gardés', () => {
  const result = restingHrResult(samples(1, (t) => (t >= 100 && t < 140 ? 55.4 : 65)), START, P);

  it('garde le résultat avec une courbe en entiers', () => {
    const stored = toStoredRestingResult(result, START, P)!;
    expect(stored.lowestBpm).toBe(55);
    expect(stored.series).toHaveLength(P.durationS);
    expect(stored.series.every((v) => v === null || Number.isInteger(v))).toBe(true);
    expect(stored.startedAtMs).toBe(START);
  });

  it("ne garde rien d'un test sans fenêtre mesurée", () => {
    expect(toStoredRestingResult(restingHrResult([], START, P), START, P)).toBeNull();
  });

  it('relit la liste : mal formés écartés, plus récent en tête, bornée', () => {
    const base = toStoredRestingResult(result, START, P)!;
    const many = Array.from({ length: MAX_STORED_RESTING_RESULTS + 5 }, (_, i) => ({ ...base, startedAtMs: START + i }));
    const read = readStoredRestingResults([...many, { lowestBpm: 'x' }, null, 4]);
    expect(read).toHaveLength(MAX_STORED_RESTING_RESULTS);
    expect(read[0].startedAtMs).toBe(START + MAX_STORED_RESTING_RESULTS + 4);
    expect(readStoredRestingResults('pas une liste')).toEqual([]);
  });
});
