import { describe, expect, it } from 'vitest';
import {
  bracketAt,
  bracketAtTime,
  bracketIndex,
  firstIndexAfter,
  firstIndexAtOrAfter,
  firstIndexAtOrAfterTime,
  lastIndexAtOrBeforeTime,
  nearestIndexAtTime,
  partitionPoint,
  valueAtTime,
} from './search';

describe('recherches dichotomiques', () => {
  const values = [1, 3, 3, 3, 7, 9];
  const points = values.map((timeMs) => ({ timeMs }));

  it('trouve la frontière d\'une suite vrai puis faux', () => {
    expect(partitionPoint(0, () => true)).toBe(0);
    expect(partitionPoint(5, () => true)).toBe(5);
    expect(partitionPoint(5, () => false)).toBe(0);
    expect(partitionPoint(10, (i) => i < 4)).toBe(4);
  });

  it('donne le premier rang à la valeur ou après, doublons compris', () => {
    expect(firstIndexAtOrAfter(values, 0)).toBe(0);
    expect(firstIndexAtOrAfter(values, 3)).toBe(1);
    expect(firstIndexAtOrAfter(values, 4)).toBe(4);
    expect(firstIndexAtOrAfter(values, 9)).toBe(5);
    expect(firstIndexAtOrAfter(values, 10)).toBe(6);
    expect(firstIndexAtOrAfter([], 1)).toBe(0);
  });

  it('donne le premier rang strictement après', () => {
    expect(firstIndexAfter(values, 3)).toBe(4);
    expect(firstIndexAfter(values, 0)).toBe(0);
    expect(firstIndexAfter(values, 9)).toBe(6);
  });

  it('cherche par l\'instant d\'une trace', () => {
    expect(firstIndexAtOrAfterTime(points, 3)).toBe(1);
    expect(firstIndexAtOrAfterTime(points, 10)).toBe(6);
    expect(lastIndexAtOrBeforeTime(points, 0)).toBe(-1);
    expect(lastIndexAtOrBeforeTime(points, 3)).toBe(3);
    expect(lastIndexAtOrBeforeTime(points, 8)).toBe(4);
    expect(lastIndexAtOrBeforeTime(points, 100)).toBe(5);
    expect(lastIndexAtOrBeforeTime([], 1)).toBe(-1);
  });

  it('marche sur un tableau typé, comme les instants d\'un fichier de capteurs', () => {
    expect(firstIndexAtOrAfter(new Float64Array([0, 10, 20]), 15)).toBe(2);
  });
});

// Copies gelées des dichotomies remplacées au lot 57 : chaque appelant garde sa sémantique aux bords, au bit près.
const frozenBracket = (t: ArrayLike<number>, n: number, x: number): [number, number] => {
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  return [lo, hi];
};
/** `trackValueAt` de `core/pumping.ts`. */
const frozenClamp = (t: number[], v: number[], ms: number): number => {
  if (ms <= t[0]) return v[0];
  const last = t.length - 1;
  if (ms >= t[last]) return v[last];
  const [lo, hi] = frozenBracket(t, t.length, ms);
  const span = t[hi] - t[lo];
  const w = span > 0 ? (ms - t[lo]) / span : 0;
  return v[lo] * (1 - w) + v[hi] * w;
};
/** `speedAt` de `core/jumps.ts`. */
const frozenNull = (t: number[], v: number[], ms: number): number | null => {
  if (t.length === 0 || ms < t[0] || ms > t[t.length - 1]) return null;
  const [lo, hi] = frozenBracket(t, t.length, ms);
  const w = t[hi] > t[lo] ? (ms - t[lo]) / (t[hi] - t[lo]) : 0;
  return v[lo] * (1 - w) + v[hi] * w;
};
/** `trackIndexAtTime` de `core/jumps.ts`. */
const frozenNearest = (t: number[], ms: number): number => {
  if (t.length === 0) return 0;
  const [lo, hi] = frozenBracket(t, t.length, ms);
  return Math.abs(t[hi] - ms) < Math.abs(t[lo] - ms) ? hi : lo;
};
/** `firstFrom` de `running/energy.ts`. */
const frozenFirstFrom = (t: number[], x: number, lo: number, hi: number, strict: boolean): number => {
  let a = lo;
  let b = hi + 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (t[mid] < x || (strict && t[mid] === x)) a = mid + 1;
    else b = mid;
  }
  return a;
};
/** `firstSegmentReaching` de `recording/followedTrace.ts`. */
const frozenReaching = (cum: number[], x: number): number => {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

describe('recherches dans le temps : mêmes bords que les copies remplacées', () => {
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const series: number[][] = [[], [5], [5, 5], [1, 2], [0, 0, 1, 1, 1, 4]];
  for (let k = 0; k < 40; k++) {
    let t = 1000 * rnd();
    // Doublons et quelques retours en arrière (trace mal rangée) : la dichotomie doit rester celle d'avant.
    series.push(Array.from({ length: 1 + Math.floor(rnd() * 30) }, () => (t += rnd() < 0.3 ? 0 : rnd() < 0.05 ? -50 : 100 * rnd())));
  }
  const probes = (t: number[]) => [NaN, -Infinity, Infinity, ...t, ...t.map((x) => x + 0.5), ...t.map((x) => x - 0.5), -1e9, 1e9];

  it('valeur interpolée, bornée ou nulle hors de la trace, et point le plus proche', () => {
    for (const t of series) {
      const pts = t.map((timeMs) => ({ timeMs }));
      const v = t.map(() => rnd() * 10 - 5);
      for (const ms of probes(t)) {
        if (t.length > 0) expect(valueAtTime(pts, (i) => v[i], ms, 'clamp')).toBe(frozenClamp(t, v, ms));
        expect(valueAtTime(pts, (i) => v[i], ms, 'null')).toBe(frozenNull(t, v, ms));
        expect(nearestIndexAtTime(pts, ms)).toBe(frozenNearest(t, ms));
        expect(bracketAtTime(pts, ms)).toBe(frozenBracket(t, t.length, ms)[0]);
        expect(bracketAt(t, ms)).toBe(frozenBracket(t, t.length, ms)[0]);
        for (let n = 0; n <= t.length; n++) expect(bracketIndex(n, (i) => t[i] <= ms)).toBe(frozenBracket(t, n, ms)[0]);
      }
    }
  });

  it("premier rang d'une plage et premier tronçon atteint", () => {
    for (const t of series) {
      for (const x of probes(t)) {
        if (t.length >= 2) expect(partitionPoint(t.length - 2, (i) => t[i + 1] < x)).toBe(frozenReaching(t, x));
        for (let lo = 0; lo < t.length; lo++) {
          for (const hi of [lo, t.length - 1]) {
            for (const strict of [false, true]) {
              expect(partitionPoint(hi + 1, (mid) => t[mid] < x || (strict && t[mid] === x), lo)).toBe(frozenFirstFrom(t, x, lo, hi, strict));
            }
          }
        }
      }
    }
  });
});
