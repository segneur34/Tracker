/**
 * Recherches dichotomiques sur des suites rangées par ordre croissant (le
 * temps d'une trace, les instants d'un fichier de capteurs, une abscisse) :
 * la seule écriture de ces bornes. Pur.
 */

/**
 * Premier rang de `[0, length]` pour lequel `before` est faux, `before` étant
 * vrai puis faux le long de la suite ; `length` si elle reste vraie jusqu'au bout.
 */
export const partitionPoint = (length: number, before: (index: number) => boolean): number => {
  let lo = 0;
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
