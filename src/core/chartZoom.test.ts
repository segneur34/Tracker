import { describe, expect, it } from 'vitest';
import { trackBounds } from './displayConfig';
import {
  axisRangePath, CHART_EXTREME_TOLERANCE, clampRange, niceTicks, pinchRange, pxSelectionRange, sampledIndices, sampledIndicesKeeping,
  visibleIndexRange, zoomAtRange,
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

  /** Vitesse à `hz` points par seconde sur `seconds` s : 3 m/s, et un pic de 3 s à 8 m/s à la 100e seconde. */
  const spiky = (seconds: number, hz: number) => {
    const values: number[] = [];
    const times: number[] = [];
    for (let k = 0; k <= seconds * hz; k++) {
      const t = k / hz;
      times.push(t);
      values.push(t >= 100 && t < 103 ? 8 : 3);
    }
    return { values, times };
  };

  it('garde un pic bref que le pas régulier sauterait, à 1 Hz comme à 5 Hz (règle 2)', () => {
    for (const hz of [1, 5]) {
      const { values, times } = spiky(3600, hz);
      const regular = sampledIndices(0, values.length - 1, 500);
      const kept = sampledIndices(0, values.length - 1, 500, values);
      expect(regular.some((i) => values[i] === 8)).toBe(false);
      const peaks = kept.filter((i) => values[i] === 8);
      expect(peaks.length).toBeGreaterThan(0);
      expect(times[peaks[0]]).toBe(100);
      // Les indices réguliers sont tous gardés, dans l'ordre, et peu d'autres s'ajoutent.
      expect(kept.filter((i) => regular.includes(i))).toEqual(regular);
      expect(kept).toEqual([...kept].sort((a, b) => a - b));
      expect(kept.length).toBeLessThanOrEqual(regular.length + 2);
    }
  });

  it("n'ajoute rien à une série constante, monotone, ou plus courte que le plafond", () => {
    const flat = new Array(3000).fill(3);
    expect(sampledIndices(0, 2999, 500, flat)).toEqual(sampledIndices(0, 2999, 500));
    const ramp = Array.from({ length: 3000 }, (_, i) => i * 0.1);
    expect(sampledIndices(0, 2999, 500, ramp)).toEqual(sampledIndices(0, 2999, 500));
    const { values } = spiky(400, 1);
    expect(sampledIndices(0, 400, 500, values)).toEqual(sampledIndices(0, 400, 500));
  });

  it('ajoute le creux comme le pic, et ignore les valeurs absentes', () => {
    const values: (number | null)[] = new Array(3000).fill(10);
    values[1001] = 2;
    values[2001] = 18;
    values[2002] = null;
    const kept = sampledIndices(0, 2999, 500, values);
    expect(kept).toContain(1001);
    expect(kept).toContain(2001);
    expect(kept).not.toContain(2002);
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

/** `sampledIndices` d'avant le lot 61, recopiée telle quelle (copie gelée) : une seule série. */
const frozenSampledIndices = (first: number, last: number, maxPoints: number, values?: ArrayLike<number | null | undefined>): number[] => {
  if (last < first) return [];
  const step = Math.max(1, Math.ceil((last - first + 1) / Math.max(1, maxPoints)));
  const out: number[] = [];
  for (let i = first; i <= last; i += step) out.push(i);
  if (out[out.length - 1] !== last) out.push(last);
  if (!values || step <= 1) return out;
  const at = (i: number): number => {
    const v = values[i];
    return typeof v === 'number' && isFinite(v) ? v : NaN;
  };
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = first; i <= last; i++) {
    const v = at(i);
    if (Number.isNaN(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const tolerance = (hi - lo) * CHART_EXTREME_TOLERANCE;
  if (!(tolerance > 0)) return out;
  const kept: number[] = [];
  for (let k = 0; k < out.length - 1; k++) {
    const a = out[k];
    const b = out[k + 1];
    kept.push(a);
    let maxI = -1;
    let minI = -1;
    let maxV = -Infinity;
    let minV = Infinity;
    for (let i = a + 1; i < b; i++) {
      const v = at(i);
      if (Number.isNaN(v)) continue;
      if (v > maxV) {
        maxV = v;
        maxI = i;
      }
      if (v < minV) {
        minV = v;
        minI = i;
      }
    }
    if (maxI < 0) continue;
    const va = at(a);
    const vb = at(b);
    const chordAt = (i: number): number => {
      if (Number.isNaN(va)) return vb;
      if (Number.isNaN(vb)) return va;
      return va + ((vb - va) * (i - a)) / (b - a);
    };
    const addMax = maxV - chordAt(maxI) > tolerance;
    const addMin = chordAt(minI) - minV > tolerance;
    if (addMax && addMin) kept.push(Math.min(maxI, minI), Math.max(maxI, minI));
    else if (addMax) kept.push(maxI);
    else if (addMin) kept.push(minI);
  }
  kept.push(out[out.length - 1]);
  return kept;
};

/** Bruit pseudo-aléatoire reproductible, entre −1 et 1. */
const noise = (k: number): number => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
};

/**
 * Sortie de `seconds` secondes à `hz` points par seconde : vitesse en sinus,
 * FC plate avec un pic de 3 points placé entre deux indices du pas régulier
 * de `maxPoints` points, cadence avec un creux de 3 points ; trous dans la FC.
 */
const sprints = (seconds: number, hz: number, maxPoints = 500) => {
  const n = seconds * hz;
  const step = Math.ceil(n / maxPoints);
  const speed: number[] = [];
  const hr: (number | null)[] = [];
  const cadence: (number | null)[] = [];
  const peakAt = Math.round((n * 0.4237) / step) * step + 1;
  const dipAt = Math.round((n * 0.7311) / step) * step + 1;
  for (let k = 0; k < n; k++) {
    const t = k / hz;
    speed.push(3 + Math.sin(t / 40));
    hr.push(k % 211 === 0 ? null : k >= peakAt && k < peakAt + 3 ? 185 : 140);
    cadence.push(k >= dipAt && k < dipAt + 3 ? 120 : 170);
  }
  return { n, speed, hr, cadence, peakAt, dipAt };
};

describe('indices tracés, plusieurs séries (pics gardés)', () => {
  for (const hz of [1, 5]) {
    it(`${hz} Hz, 3 000 s : le pic de FC et le creux de cadence restent, sur-ensemble de la vitesse seule`, () => {
      const s = sprints(3000, hz);
      const speedOnly = sampledIndices(0, s.n - 1, 500, s.speed);
      const all = sampledIndicesKeeping(0, s.n - 1, 500, [s.speed, s.hr, s.cadence]);
      // Le pic et le creux sont hors de la grille : la vitesse seule les saute.
      expect(Math.max(...speedOnly.map((i) => s.hr[i] ?? 0))).toBe(140);
      expect(Math.min(...speedOnly.map((i) => s.cadence[i] ?? Infinity))).toBe(170);
      expect(Math.max(...all.map((i) => s.hr[i] ?? 0))).toBe(185);
      expect(Math.min(...all.map((i) => s.cadence[i] ?? Infinity))).toBe(120);
      const kept = new Set(all);
      expect(speedOnly.every((i) => kept.has(i))).toBe(true);
      for (let k = 1; k < all.length; k++) expect(all[k]).toBeGreaterThan(all[k - 1]);
      expect(all[0]).toBe(0);
      expect(all[all.length - 1]).toBe(s.n - 1);
    });
  }

  it('une série seule : la copie gelée de sampledIndices', () => {
    for (const hz of [1, 5]) {
      const s = sprints(3000, hz);
      for (const values of [s.speed, s.hr, s.cadence]) {
        expect(sampledIndicesKeeping(0, s.n - 1, 500, [values])).toEqual(frozenSampledIndices(0, s.n - 1, 500, values));
        expect(sampledIndices(0, s.n - 1, 500, values)).toEqual(frozenSampledIndices(0, s.n - 1, 500, values));
        expect(sampledIndices(100, 2000, 300, values)).toEqual(frozenSampledIndices(100, 2000, 300, values));
      }
      expect(sampledIndices(0, s.n - 1, 500)).toEqual(frozenSampledIndices(0, s.n - 1, 500));
      expect(sampledIndicesKeeping(0, s.n - 1, 500, [])).toEqual(frozenSampledIndices(0, s.n - 1, 500));
    }
    expect(sampledIndicesKeeping(5, 4, 500, [[1, 2]])).toEqual([]);
  });

  it('séries bruitées : le nombre de points reste borné', () => {
    const n = 2 * 3600 * 5;
    const grid = sampledIndices(0, n - 1, 500).length;
    // Signal lent et bruit de 2 % de son étendue, comme une vitesse, une FC et une cadence lissées.
    const series = [0, 1, 2, 3].map((s) => Array.from({ length: n }, (_, k) => 10 * Math.sin(k / (900 + 300 * s)) + 0.2 * noise(k + s * n)));
    const all = sampledIndicesKeeping(0, n - 1, 500, series);
    expect(all.length).toBeLessThanOrEqual(2 * grid);
    // Bruit pur : au pire deux extrêmes par intervalle et par série.
    const raw = [0, 1, 2, 3].map((s) => Array.from({ length: n }, (_, k) => noise(k + s * n)));
    expect(sampledIndicesKeeping(0, n - 1, 500, raw).length).toBeLessThanOrEqual(grid * (1 + 2 * raw.length));
  });
});
