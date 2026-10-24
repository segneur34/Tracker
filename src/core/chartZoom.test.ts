import { describe, expect, it } from 'vitest';
import { trackBounds } from './displayConfig';
import {
  axisRangePath, clampRange, niceTicks, pinchRange, pxSelectionRange, sampledIndices, visibleIndexRange, zoomAtRange,
} from './chartZoom';

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

describe('double-clic', () => {
  it('divise la plage par le facteur, la valeur sous le doigt restant sous lui', () => {
    // Zone de 100 px sur 2–6 : toucher à 25 px, valeur 3.
    const r = zoomAtRange({ min: 2, max: 6 }, 25, 100, 2, FULL, 0.1)!;
    expect(r.max - r.min).toBeCloseTo(2, 9);
    expect(r.min + 0.25 * (r.max - r.min)).toBeCloseTo(3, 9);
  });

  it('deux fois au même endroit zoome sur le même point', () => {
    const once = zoomAtRange(FULL, 80, 100, 2, FULL, 0.1)!;
    const twice = zoomAtRange(once, 80, 100, 2, FULL, 0.1)!;
    expect(twice.max - twice.min).toBeCloseTo(2.5, 9);
    expect(twice.min + 0.8 * (twice.max - twice.min)).toBeCloseTo(8, 9);
  });

  it('reste dans l\'étendue et ne descend pas sous la plage minimale', () => {
    expect(zoomAtRange(FULL, 0, 100, 2, FULL, 0.1)).toEqual({ min: 0, max: 5 });
    const r = zoomAtRange({ min: 4, max: 4.15 }, 50, 100, 2, FULL, 0.1)!;
    expect(r.max - r.min).toBeCloseTo(0.1, 9);
  });
});

describe('tronçon de la trace d\'une plage', () => {
  // Ligne droite vers le nord-est, axe en distance : un point par unité.
  const line = (step: number) => {
    const points: { lat: number; lon: number }[] = [];
    const axis: number[] = [];
    for (let v = 0; v <= 10 + 1e-9; v += step) {
      points.push({ lat: 43 + v * 0.001, lon: 3 + v * 0.002 });
      axis.push(v);
    }
    return { points, axis };
  };

  it('les points de la plage et ses deux bouts interpolés', () => {
    const { points, axis } = line(1);
    const path = axisRangePath(points, axis, { min: 2.5, max: 5.5 });
    expect(path).toHaveLength(5);
    expect(path[0][0]).toBeCloseTo(43.0025, 9);
    expect(path[0][1]).toBeCloseTo(3.005, 9);
    expect(path[4][0]).toBeCloseTo(43.0055, 9);
  });

  it('la même emprise quelle que soit la cadence (règle 2)', () => {
    const slow = line(1);
    const fast = line(0.2);
    const a = trackBounds(axisRangePath(slow.points, slow.axis, { min: 2.3, max: 7.9 }).map(([lat, lon]) => ({ lat, lon })))!;
    const b = trackBounds(axisRangePath(fast.points, fast.axis, { min: 2.3, max: 7.9 }).map(([lat, lon]) => ({ lat, lon })))!;
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < 2; j++) expect(a[k][j]).toBeCloseTo(b[k][j], 9);
    }
  });

  it('un seul intervalle couvre la plage (règle 10) : deux points sur ce segment', () => {
    const points = [{ lat: 43, lon: 3 }, { lat: 43.01, lon: 3.02 }];
    const path = axisRangePath(points, [0, 10], { min: 4, max: 6 });
    expect(path).toHaveLength(2);
    expect(path[0][0]).toBeCloseTo(43.004, 9);
    expect(path[1][1]).toBeCloseTo(3.012, 9);
  });

  it('une pause (valeurs égales de l\'axe) ne divise pas par zéro, la plage est bornée à la trace', () => {
    const points = [{ lat: 43, lon: 3 }, { lat: 43.001, lon: 3 }, { lat: 43.0011, lon: 3 }, { lat: 43.002, lon: 3 }];
    const path = axisRangePath(points, [0, 1, 1, 2], { min: 1, max: 5 });
    expect(path.every(([lat, lon]) => isFinite(lat) && isFinite(lon))).toBe(true);
    expect(path[path.length - 1]).toEqual([43.002, 3]);
    expect(axisRangePath([], [], { min: 0, max: 1 })).toEqual([]);
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
