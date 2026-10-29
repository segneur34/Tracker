/**
 * Recherches dichotomiques sur des suites rangées par ordre croissant (le
 * temps d'une trace, les instants d'un fichier de capteurs, une abscisse) :
 * la seule écriture de ces bornes. Pur.
 */

/**
 * Premier rang de `[from, length]` pour lequel `before` est faux, `before` étant
 * vrai puis faux le long de la suite ; `length` si elle reste vraie jusqu'au bout.
 */
export const partitionPoint = (length: number, before: (index: number) => boolean, from = 0): number => {
  let lo = from;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (before(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Premier rang dont la valeur est au moins `target` (`values.length` s'il n'y en a pas). */
export const firstIndexAtOrAfter = (values: ArrayLike<number>, target: number): number =>
  partitionPoint(values.length, (i) => values[i] < target);

/** Premier rang dont la valeur dépasse strictement `target` (`values.length` s'il n'y en a pas). */
export const firstIndexAfter = (values: ArrayLike<number>, target: number): number =>
  partitionPoint(values.length, (i) => values[i] <= target);

/** Premier point daté de `ms` ou après (`points.length` s'il n'y en a pas). */
export const firstIndexAtOrAfterTime = (points: ArrayLike<{ timeMs: number }>, ms: number): number =>
  partitionPoint(points.length, (i) => points[i].timeMs < ms);

/** Dernier point daté de `ms` ou avant, `-1` avant le premier. */
export const lastIndexAtOrBeforeTime = (points: ArrayLike<{ timeMs: number }>, ms: number): number =>
  partitionPoint(points.length, (i) => points[i].timeMs <= ms) - 1;

/**
 * Segment `[lo, lo + 1]` qui encadre une valeur, `atOrBefore` étant vrai puis
 * faux le long de la suite : rend `lo`, dans `[0, length − 2]` (0 si la suite
 * a moins de deux rangs), `atOrBefore(lo)` vrai sauf avant le début, et
 * `atOrBefore(lo + 1)` faux sauf au-delà de la fin. L'autre bout est
 * `Math.min(lo + 1, length − 1)`.
 */
export const bracketIndex = (length: number, atOrBefore: (index: number) => boolean): number => {
  let lo = 0;
  let hi = length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (atOrBefore(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** Segment d'une suite croissante qui encadre `x` (`bracketIndex`). */
export const bracketAt = (values: ArrayLike<number>, x: number): number =>
  bracketIndex(values.length, (i) => values[i] <= x);

/** Segment d'une trace qui encadre l'instant `ms` (`bracketIndex`). */
export const bracketAtTime = (points: ArrayLike<{ timeMs: number }>, ms: number): number =>
  bracketIndex(points.length, (i) => points[i].timeMs <= ms);

/**
 * Valeur d'une grandeur de la trace à l'instant `ms`, interpolée entre les deux
 * points qui l'encadrent. Hors de la trace : `'clamp'`, la valeur du bout le
 * plus proche (aux bouts compris, la trace ne doit pas être vide) ; `'null'`,
 * `null` (les bouts eux-mêmes sont interpolés).
 */
export function valueAtTime(points: ArrayLike<{ timeMs: number }>, value: (index: number) => number, ms: number, outside: 'clamp'): number;
export function valueAtTime(points: ArrayLike<{ timeMs: number }>, value: (index: number) => number, ms: number, outside: 'null'): number | null;
export function valueAtTime(
  points: ArrayLike<{ timeMs: number }>,
  value: (index: number) => number,
  ms: number,
  outside: 'clamp' | 'null'
): number | null {
  const last = points.length - 1;
  if (outside === 'clamp') {
    if (ms <= points[0].timeMs) return value(0);
    if (ms >= points[last].timeMs) return value(last);
  } else if (points.length === 0 || ms < points[0].timeMs || ms > points[last].timeMs) {
    return null;
  }
  const lo = bracketAtTime(points, ms);
  const hi = Math.min(lo + 1, last);
  const a = points[lo].timeMs;
  const b = points[hi].timeMs;
  const w = b - a > 0 ? (ms - a) / (b - a) : 0;
  return value(lo) * (1 - w) + value(hi) * w;
}

/** Point le plus proche de l'instant `ms` (le premier des deux à égalité) ; 0 sur une suite vide. */
export const nearestIndexAtTime = (points: ArrayLike<{ timeMs: number }>, ms: number): number => {
  if (points.length === 0) return 0;
  const lo = bracketAtTime(points, ms);
  const hi = Math.min(lo + 1, points.length - 1);
  return Math.abs(points[hi].timeMs - ms) < Math.abs(points[lo].timeMs - ms) ? hi : lo;
};
