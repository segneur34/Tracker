import { describe, expect, it } from 'vitest';
import { RESTING_HR_TEST, type RestingSample } from '../recording/restingHrTest';
import { restingHrResult } from '../running/restingHrResults';
import {
  MAX_STORED_RESTING_RESULTS, mergeRestingResults, parseRestingHrFile, readStoredRestingResults, restingHrFileText,
  sameRestingResults, toStoredRestingResult, type StoredRestingResult,
} from './restingHrStore';

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

describe('fichier fc-repos.json et fusion entre appareils', () => {
  const base = toStoredRestingResult(restingHrResult(samples(1, () => 60), START, P), START, P)!;
  const at = (startedAtMs: number, lowestBpm = base.lowestBpm): StoredRestingResult => ({ ...base, startedAtMs, lowestBpm });

  it("fait l'union par départ, le test de l'appareil l'emportant, du plus récent au plus ancien", () => {
    const merged = mergeRestingResults([at(2, 50), at(1)], [at(3), at(2, 70)]);
    expect(merged.map((r) => r.startedAtMs)).toEqual([3, 2, 1]);
    expect(merged[1].lowestBpm).toBe(50);
  });

  it('borne la fusion aux plus récents', () => {
    const a = Array.from({ length: MAX_STORED_RESTING_RESULTS }, (_, i) => at(i));
    const merged = mergeRestingResults(a, [at(1000), at(1001)]);
    expect(merged).toHaveLength(MAX_STORED_RESTING_RESULTS);
    expect(merged[0].startedAtMs).toBe(1001);
    expect(merged.some((r) => r.startedAtMs === 0)).toBe(false);
  });

  it('est stable : fusionner deux fois ne change rien', () => {
    const once = mergeRestingResults([at(1)], [at(2)]);
    expect(sameRestingResults(mergeRestingResults(once, [at(1)]), once)).toBe(true);
  });

  it("relit ce qu'il a écrit", () => {
    const list = [at(2), at(1)];
    expect(parseRestingHrFile(restingHrFileText(list))).toEqual(list);
  });

  it("fichier absent : liste vide ; illisible ou d'un autre format : null", () => {
    expect(parseRestingHrFile(null)).toEqual([]);
    expect(parseRestingHrFile('{ cassé')).toBeNull();
    expect(parseRestingHrFile(JSON.stringify({ format: 'autre', results: [] }))).toBeNull();
    expect(parseRestingHrFile(JSON.stringify({ format: 'tracker-fc-repos' }))).toBeNull();
  });

  it('écarte les tests mal formés du fichier', () => {
    const text = JSON.stringify({ format: 'tracker-fc-repos', version: 1, results: [at(1), { lowestBpm: 'x' }, null] });
    expect(parseRestingHrFile(text)).toEqual([at(1)]);
  });
});
