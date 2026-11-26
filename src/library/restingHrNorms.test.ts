import { describe, expect, it } from 'vitest';
import { RESTING_HR_NORMS, RESTING_HR_PERCENTILES, restingHrBand, restingHrRank } from './restingHrNorms';

describe('FC de repos de la population (NHANES 1999-2008)', () => {
  it('tables recopiées : une valeur ou une case vide par percentile, croissantes, contrôles du relevé', () => {
    for (const sex of ['h', 'f'] as const) {
      for (const band of RESTING_HR_NORMS[sex]) {
        expect(band.values).toHaveLength(RESTING_HR_PERCENTILES.length);
        const published = band.values.filter((v): v is number => v !== null);
        expect(published.every((v, k) => k === 0 || v > published[k - 1])).toBe(true);
      }
    }
    // Hommes de 20 à 39 ans : 25e = 61, médiane = 69 ; femmes de 60 à 79 ans : 64 et 70.
    expect(restingHrBand('h', 30).values.slice(4, 6)).toEqual([61, 69]);
    expect(restingHrBand('f', 70).values.slice(4, 6)).toEqual([64, 70]);
  });

  it('tranche de l\'âge, bornes comprises ; 80 ans et plus sans fin ; moins de 16 ans : les tranches de l\'enfant', () => {
    expect(restingHrBand('h', 39).fromAge).toBe(20);
    expect(restingHrBand('h', 40).fromAge).toBe(40);
    expect(restingHrBand('f', 95).fromAge).toBe(80);
    expect(restingHrBand('h', 14)).toMatchObject({ fromAge: 12, toAge: 15 });
    expect(restingHrBand('h', -1).fromAge).toBe(0);
  });

  it('rang sur un percentile publié, puis interpolé entre deux colonnes', () => {
    expect(restingHrRank('h', 30, 61)).toMatchObject({ kind: 'within', percentile: 25 });
    expect(restingHrRank('h', 30, 69)).toMatchObject({ kind: 'within', percentile: 50 });
    expect(restingHrRank('h', 30, 65).percentile).toBeCloseTo(37.5, 9);
    // Femmes de 60 à 79 ans : 59 au 10e, 64 au 25e.
    expect(restingHrRank('f', 62, 62).percentile).toBeCloseTo(19, 9);
    expect(restingHrRank('h', 30, 47)).toMatchObject({ kind: 'within', percentile: 1 });
    expect(restingHrRank('h', 30, 101)).toMatchObject({ kind: 'within', percentile: 99 });
  });

  it('hors des tables : au premier ou au dernier percentile publié, sans extrapoler', () => {
    expect(restingHrRank('h', 30, 40)).toMatchObject({ kind: 'below', percentile: 1 });
    expect(restingHrRank('h', 30, 120)).toMatchObject({ kind: 'above', percentile: 99 });
  });

  it('cases vides sautées : hommes de 80 ans et plus, sans 1er ni 99e percentile', () => {
    expect(restingHrRank('h', 85, 47)).toMatchObject({ kind: 'below', percentile: 2.5 });
    expect(restingHrRank('h', 85, 98)).toMatchObject({ kind: 'above', percentile: 97.5 });
    expect(restingHrRank('h', 85, 97)).toMatchObject({ kind: 'within', percentile: 97.5 });
    // Hommes d'un an : 1er percentile vide, 91 est le 2,5e.
    expect(restingHrRank('h', 1, 91)).toMatchObject({ kind: 'within', percentile: 2.5 });
  });

  it('l\'écart est ajouté à la mesure avant de la situer', () => {
    expect(restingHrRank('h', 30, 61, 8).percentile).toBe(50);
  });
});
