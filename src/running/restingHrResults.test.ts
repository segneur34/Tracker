import { describe, expect, it } from 'vitest';
import { RESTING_HR_TEST, type RestingSample } from '../recording/restingHrTest';
import {
  MAX_STORED_RESTING_RESULTS, readStoredRestingResults, restingHrResult, restingHrSeries, toStoredRestingResult,
} from './restingHrResults';

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

describe('restingHrSeries', () => {
  it('rend une valeur par seconde de la durée', () => {
    const series = restingHrSeries(samples(1, () => 60), START, P);
    expect(series).toHaveLength(P.durationS);
    expect(series.every((v) => v === 60)).toBe(true);
  });

  it("laisse une seconde sans mesure à null une fois la tenue d'une mesure passée", () => {
    const series = restingHrSeries(samples(1, () => 60, 0, 50), START, P);
    expect(series[49]).toBe(60);
    // La dernière mesure vaut `holdS` secondes, pas plus.
    expect(series[49 + P.holdS]).toBeNull();
    expect(series[120]).toBeNull();
  });

  it('prolonge sur le départ une mesure reçue pendant la préparation', () => {
    const series = restingHrSeries([{ timeMs: START - 4000, bpm: 64 }, ...samples(1, () => 64, 3)], START, P);
    expect(series[0]).toBe(64);
    expect(series[1]).toBeNull();
    expect(series[3]).toBe(64);
  });

  it('ignore une ceinture sans contact et les valeurs aberrantes', () => {
    const series = restingHrSeries(samples(1, (t) => (t >= 20 && t < 40 ? null : t >= 60 && t < 63 ? 12 : 60)), START, P);
    expect(series.slice(20, 40).every((v) => v === null)).toBe(true);
    expect(series.slice(60, 63).every((v) => v === null)).toBe(true);
    expect(series[10]).toBe(60);
  });
});

describe('restingHrResult', () => {
  it('une FC constante donne cette FC, test complet', () => {
    const r = restingHrResult(samples(1, () => 58), START, P);
    expect(r.lowestBpm).toBe(58);
    expect(r.fromS).toBe(60);
    expect(r.toS).toBe(90);
    expect(r.meanBpm).toBe(58);
    expect(r.maxBpm).toBe(58);
    expect(r.coverage).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('trouve la fenêtre de 30 s la plus basse, la première en cas d\'égalité', () => {
    const r = restingHrResult(samples(1, (t) => (t >= 100 && t < 140 ? 52 : 66)), START, P);
    expect(r.lowestBpm).toBe(52);
    expect(r.fromS).toBe(100);
    expect(r.toS).toBe(130);
  });

  it('écarte la première minute, le temps que le cœur se pose', () => {
    const r = restingHrResult(samples(1, (t) => (t < 60 ? 45 : 66)), START, P);
    expect(r.lowestBpm).toBe(66);
    expect(r.fromS).toBe(60);
  });

  it('une baisse plus courte que la fenêtre est moyennée avec ses voisines', () => {
    // 10 s à 50 dans du 70 : la meilleure fenêtre de 30 s en contient 10 : (10 × 50 + 20 × 70) / 30 = 63,3.
    const r = restingHrResult(samples(1, (t) => (t >= 100 && t < 110 ? 50 : 70)), START, P);
    expect(r.lowestBpm).toBe(63);
  });

  it('1 Hz et 5 Hz donnent le même résultat (règle 2)', () => {
    const fn = (t: number) => (t >= 100 && t < 115 ? 54 : 64 - Math.floor(t / 60));
    const slow = restingHrResult(samples(1, fn), START, P);
    const fast = restingHrResult(samples(5, fn), START, P);
    expect(fast.lowestBpm).toBe(slow.lowestBpm);
    expect(fast.fromS).toBe(slow.fromS);
    expect(fast.meanBpm).toBe(slow.meanBpm);
    expect(fast.coverage).toBe(slow.coverage);
  });

  it('une ceinture perdue une minute : couverture partielle, test incomplet, mais une fenêtre est lue', () => {
    const r = restingHrResult(samples(1, (t) => (t >= 60 && t < 120 ? null : 62)), START, P);
    expect(r.coverage).toBeCloseTo(120 / 180, 5);
    expect(r.complete).toBe(false);
    expect(r.lowestBpm).toBe(62);
  });

  it('une fenêtre trop peu couverte ne compte pas', () => {
    // Dix secondes à 40 bpm, entre deux trous : aucune fenêtre de 30 s qui les touche n'en a 21 de mesurées.
    const fn = (t: number) => (t >= 100 && t < 110 ? 40 : (t >= 80 && t < 100) || (t >= 110 && t < 130) ? null : 70);
    const r = restingHrResult(samples(1, fn), START, P);
    expect(r.lowestBpm).toBe(70);
  });

  it('sans aucune mesure : pas de résultat', () => {
    const r = restingHrResult([], START, P);
    expect(r.lowestBpm).toBeNull();
    expect(r.fromS).toBeNull();
    expect(r.meanBpm).toBeNull();
    expect(r.coverage).toBe(0);
    expect(r.complete).toBe(false);
  });

  it("les mesures d'après la fin ne comptent pas", () => {
    const r = restingHrResult([...samples(1, () => 70), ...samples(1, () => 40, P.durationS, P.durationS + 20)], START, P);
    expect(r.lowestBpm).toBe(70);
  });
});

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
