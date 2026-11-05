/**
 * VO2max estimée d'après une course (lot 146) : le VDOT de Daniels et Gilbert (Oxygen Power, 1979), celui des
 * tables de Jack Daniels. Deux régressions, sur le temps de course t en minutes et la vitesse v en m/min :
 * - part de la VO2max tenue sur la durée : 0,8 + 0,1894393·e^(−0,012778·t) + 0,2989558·e^(−0,1932605·t) ;
 * - coût en oxygène de la vitesse : −4,60 + 0,182258·v + 0,000104·v², en ml/kg/min ;
 * VDOT = coût ÷ part tenue. Une estimation : elle suppose une course menée à fond sur un parcours plat.
 */

/** Coefficients de Daniels et Gilbert. */
export const DANIELS_GILBERT = {
  sustained: { base: 0.8, a: 0.1894393, ka: 0.012778, b: 0.2989558, kb: 0.1932605 },
  cost: { c0: -4.6, c1: 0.182258, c2: 0.000104 },
} as const;

/** VDOT d'une course de `distanceM` mètres en `timeS` secondes, en ml/kg/min ; `null` pour une course vide. */
export const vdotFromRace = (distanceM: number, timeS: number): number | null => {
  if (!Number.isFinite(distanceM) || !Number.isFinite(timeS) || distanceM <= 0 || timeS <= 0) return null;
  const t = timeS / 60;
  const v = distanceM / t;
  const { sustained: s, cost: c } = DANIELS_GILBERT;
  const fraction = s.base + s.a * Math.exp(-s.ka * t) + s.b * Math.exp(-s.kb * t);
  const vo2 = c.c0 + c.c1 * v + c.c2 * v * v;
  return vo2 > 0 ? vo2 / fraction : null;
};
