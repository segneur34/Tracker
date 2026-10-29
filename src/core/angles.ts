/**
 * Angles en degrés : la seule écriture des normalisations, écarts, moyennes
 * vectorielles et conversions, pour la voile comme pour le reste. Pur.
 */

export const toRad = (value: number): number => (value * Math.PI) / 180;
export const toDeg = (value: number): number => (value * 180) / Math.PI;

/** Direction ramenée dans [0, 360[. */
export const normalizeDeg = (angle: number): number => ((angle % 360) + 360) % 360;

/** Écart signé de `b` à `a`, dans [−180 ; 180[, en degrés. */
export const angleDiff = (a: number, b: number): number => {
  let diff = a - b;
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return diff;
};

/**
 * Écart signé de `from` à `to`, dans ]−180 ; 180], en degrés : un demi-tour
 * pile compte +180 (convention des virages du surf, `surfing/gpsTurns.ts`).
 */
export const signedDeltaHalfOpen = (from: number, to: number): number => {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
};

/**
 * Moyenne vectorielle de directions, éventuellement pondérées. C'est la seule
 * moyenne valide pour des angles : dérouler puis moyenner arithmétiquement
 * diverge dès qu'une inversion apparaît dans la série.
 */
export const circularMean = (angles: number[], weights?: number[]): { mean: number; R: number } => {
  let x = 0;
  let y = 0;
  let total = 0;
  for (let i = 0; i < angles.length; i++) {
    const w = weights ? weights[i] : 1;
    const rad = toRad(angles[i]);
    x += w * Math.cos(rad);
    y += w * Math.sin(rad);
    total += w;
  }
  if (total === 0) return { mean: 0, R: 0 };
  x /= total;
  y /= total;
  return {
    mean: normalizeDeg(toDeg(Math.atan2(y, x))),
    R: Math.sqrt(x * x + y * y),
  };
};

/** Cap affiché au degré, de 0 à 359 (un cap de 359,6° s'arrondit à 0). */
export const roundBearingDeg = (deg: number): number => Math.round(deg) % 360;
