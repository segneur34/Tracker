/**
 * Période d'un signal régulier par autocorrélation, commune à la cadence à
 * pied (`running/cadence.ts`, `stepPeriod`) et à la validation du pumping sur
 * foil (`core/pumping.ts`, `pumpCadence`). Les décalages sont en cases de la
 * grille de l'appelant : à lui de les tirer de secondes (règle 2).
 */

/** Autocorrélation normalisée de `x` (sans trou) pour les décalages de 0 à `maxLag`. */
export const autocorrelation = (x: Float64Array, maxLag: number): Float64Array => {
  const n = x.length;
  const r = new Float64Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag && lag < n - 1; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = x[i];
      const b = x[i + lag];
      xy += a * b;
      xx += a * a;
      yy += b * b;
    }
    r[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  }
  return r;
};

/** Crête locale de l'autocorrélation. */
export const isPeak = (r: Float64Array, k: number) => k > 0 && k < r.length - 1 && r[k] >= r[k - 1] && r[k] >= r[k + 1];

/**
 * Première crête des décalages [fromLag, toLag) assez haute au regard de la
 * plus haute (`peakFraction` d'elle au moins), pas la plus haute elle-même,
 * qui peut tomber sur deux ou trois périodes d'un signal très régulier.
 * `null` sans crête, ou si la plus haute reste sous `minCorr`.
 */
export const firstStrongPeak = (r: Float64Array, fromLag: number, toLag: number, minCorr: number, peakFraction: number): number | null => {
  const peaks: number[] = [];
  for (let k = fromLag; k < toLag; k++) if (isPeak(r, k)) peaks.push(k);
  if (peaks.length === 0) return null;
  const best = Math.max(...peaks.map((k) => r[k]));
  if (best < minCorr) return null;
  return peaks.find((k) => r[k] >= peakFraction * best)!;
};

/** Crête `k` affinée par une parabole sur ses deux voisines, décalée d'une demi-case au plus (fractionnaire). */
export const refinedPeak = (r: Float64Array, k: number): number => {
  const a = r[k - 1];
  const b = r[k];
  const c = r[k + 1];
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
  return k + Math.max(-0.5, Math.min(0.5, shift));
};
