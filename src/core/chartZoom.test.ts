import { describe, expect, it } from 'vitest';
import { clampRange, niceTicks, pinchRange, pxSelectionRange, sampledIndices, visibleIndexRange } from './chartZoom';

const FULL = { min: 0, max: 10 };

describe('plage bornée', () => {
  it('rend null quand la plage couvre tout', () => {
    expect(clampRange({ min: -1, max: 12 }, FULL, 0.1)).toBeNull();
    expect(clampRange({ min: 0, max: 10 }, FULL, 0.1)).toBeNull();
  });

  it('ramène la plage dans l\'étendue sans changer sa largeur', () => {
    expect(clampRange({ min: -2, max: 1 }, FULL, 0.1)).toEqual({ min: 0, max: 3 });
    expect(clampRange({ min: 9, max: 12 }, FULL, 0.1)).toEqual({ min: 7, max: 10 });
  });

  it('élargit une plage trop étroite autour de son centre', () => {
    const r = clampRange({ min: 5, max: 5.02 }, FULL, 1)!;
    expect(r.min).toBeCloseTo(4.51, 9);
    expect(r.max).toBeCloseTo(5.51, 9);
  });
});

describe('geste à deux doigts', () => {
  it('écarter les doigts zoome en gardant les valeurs sous les doigts', () => {
    // Zone de 100 px sur 0–10 : doigts à 40 et 60 px (valeurs 4 et 6), écartés à 20 et 80 px.
    const r = pinchRange(FULL, [40, 60], [20, 80], 100, FULL, 0.1)!;
    expect(r.min + (20 / 100) * (r.max - r.min)).toBeCloseTo(4, 9);
    expect(r.min + (80 / 100) * (r.max - r.min)).toBeCloseTo(6, 9);
    expect(r.max - r.min).toBeCloseTo(10 / 3, 9);
  });

  it('glisser les deux doigts déplace la plage', () => {
    const start = { min: 2, max: 4 };
    const r = pinchRange(start, [20, 60], [40, 80], 100, FULL, 0.1)!;
    expect(r.min).toBeCloseTo(1.6, 9);
    expect(r.max).toBeCloseTo(3.6, 9);
  });

  it('pincer jusqu\'à tout couvrir revient à tout voir, doigts croisés : plage inchangée', () => {
    expect(pinchRange({ min: 4, max: 6 }, [20, 80], [45, 55], 100, FULL, 0.1)).toBeNull();
    expect(pinchRange({ min: 4, max: 6 }, [20, 80], [80, 20], 100, FULL, 0.1)).toEqual({ min: 4, max: 6 });
  });
});

describe('sélection à la souris', () => {
  it('convertit deux positions en plage, dans n\'importe quel sens, bornée à la zone', () => {
    expect(pxSelectionRange(75, 25, { min: 2, max: 6 }, 100)).toEqual({ min: 3, max: 5 });
    expect(pxSelectionRange(-10, 50, { min: 2, max: 6 }, 100)).toEqual({ min: 2, max: 4 });
  });
});

describe('indices visibles', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('toute la série sans plage', () => {
    expect(visibleIndexRange(values, null)).toEqual([0, 10]);
    expect(visibleIndexRange([], null)).toEqual([0, -1]);
  });

  it('les valeurs de la plage et un voisin de chaque côté', () => {
    expect(visibleIndexRange(values, { min: 2.5, max: 5.5 })).toEqual([2, 6]);
    expect(visibleIndexRange(values, { min: 3, max: 5 })).toEqual([2, 6]);
    expect(visibleIndexRange(values, { min: 0, max: 0.5 })).toEqual([0, 1]);
    expect(visibleIndexRange(values, { min: 9.5, max: 10 })).toEqual([9, 10]);
  });
});

describe('indices tracés', () => {
  it('pas régulier, dernier compris', () => {
    expect(sampledIndices(0, 9, 5)).toEqual([0, 2, 4, 6, 8, 9]);
    expect(sampledIndices(3, 5, 500)).toEqual([3, 4, 5]);
    expect(sampledIndices(4, 3, 500)).toEqual([]);
  });
});

describe('graduations rondes', () => {
  it('pas de 1, 2, 2,5 ou 5 × 10ⁿ, bornes comprises', () => {
    expect(niceTicks({ min: 0, max: 6.07 })).toEqual([0, 2, 4, 6]);
    expect(niceTicks({ min: 2.31, max: 2.47 })).toEqual([2.35, 2.4, 2.45]);
    expect(niceTicks({ min: 0, max: 10 })).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('rien sur une plage vide', () => {
    expect(niceTicks({ min: 3, max: 3 })).toEqual([]);
  });
});
