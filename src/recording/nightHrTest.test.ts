import { describe, expect, it } from 'vitest';
import { EXAMPLE_NIGHT, NIGHT_HR_TEST, exampleNightHr, nightHrPlace } from './nightHrTest';

/** Moyenne de la FC d'exemple sur `[fromS, toS[`, à 1 Hz. */
const meanBpm = (fromS: number, toS: number): number => {
  let sum = 0;
  for (let t = fromS; t < toS; t++) sum += exampleNightHr(t);
  return sum / (toS - fromS);
};

describe('protocole de la FC de nuit', () => {
  it('porte les valeurs de la version 1, en secondes', () => {
    expect(NIGHT_HR_TEST).toMatchObject({
      id: 'fc-nuit', version: 1, lowWindowS: 300, lowCoverage: 0.7, smoothS: 300, gapS: 10, holdS: 5,
      surge: { baselineS: 300, riseBpm: 8, holdS: 10, refractoryS: 60 },
      stable: { aboveLowBpm: 3, holdS: 1800 }, nearLowBpm: 5, shortNightS: 10_800, minBpm: 25, maxBpm: 250, curveStepS: 30,
    });
  });

  it('dit la place du creux en début, au milieu ou en fin de nuit', () => {
    expect(nightHrPlace(0.1)).toBe('debut');
    expect(nightHrPlace(0.5)).toBe('milieu');
    expect(nightHrPlace(0.9)).toBe('fin');
  });
});

describe("nuit d'exemple", () => {
  it('est déterministe', () => {
    for (const t of [0, 1, 1234, 12_600, 28_799]) expect(exampleNightHr(t)).toBe(exampleNightHr(t));
  });

  it('reste entre des bornes plausibles sur 10 h', () => {
    for (let t = 0; t <= 10 * 3600; t += 7) {
      const bpm = exampleNightHr(t);
      expect(bpm).toBeGreaterThanOrEqual(40);
      expect(bpm).toBeLessThanOrEqual(110);
    }
  });

  it('porte un creux au milieu de la nuit, bien sous le coucher et le réveil', () => {
    const low = meanBpm(EXAMPLE_NIGHT.lowAtS - 150, EXAMPLE_NIGHT.lowAtS + 150);
    expect(low).toBeLessThan(53);
    expect(meanBpm(0, 300) - low).toBeGreaterThan(10);
    expect(meanBpm(EXAMPLE_NIGHT.durationS - 300, EXAMPLE_NIGHT.durationS) - low).toBeGreaterThan(5);
    expect(nightHrPlace(EXAMPLE_NIGHT.lowAtS / EXAMPLE_NIGHT.durationS)).toBe('milieu');
  });

  it('porte des sursauts au-dessus de la FC qui les entoure', () => {
    for (const { atS } of EXAMPLE_NIGHT.surges) {
      const around = meanBpm(atS - 400, atS - 100);
      expect(meanBpm(atS - 5, atS + 5) - around).toBeGreaterThanOrEqual(NIGHT_HR_TEST.surge.riseBpm);
    }
  });
});
