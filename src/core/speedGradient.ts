/**
 * Couleur de la trace : dégradé continu entre une vitesse basse et une
 * vitesse haute, réglables et propres à chaque support. En dessous de la
 * borne basse, gris (marche en course, déplacement lent ou non-vol en voile).
 * Au-dessus de la borne haute, rouge franc. Entre les deux, du bleu au rouge
 * en passant par le cyan, le vert, le jaune et l'orange.
 *
 * Tout est en m/s, comme le reste du noyau ; la conversion vers l'unité
 * d'affichage n'intervient que dans la légende.
 */

/** Bornes du dégradé, en m/s. */
export interface SpeedRangeMs {
  minMs: number;
  maxMs: number;
}

/** Couleur sous la borne basse. */
export const SLOW_COLOR = '#9e9e9e';

/** Paliers du dégradé, position de 0 à 1 et couleur en composantes RVB. */
const GRADIENT_STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [30, 136, 229] },
  { at: 0.25, rgb: [0, 172, 193] },
  { at: 0.5, rgb: [67, 160, 71] },
  { at: 0.7, rgb: [192, 202, 51] },
  { at: 0.85, rgb: [251, 140, 0] },
  { at: 1, rgb: [229, 57, 53] },
];

/** Couleur du dégradé à une position de 0 à 1. */
export const gradientColor = (t: number): string => {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const a = GRADIENT_STOPS[i - 1];
    const b = GRADIENT_STOPS[i];
    if (x <= b.at) {
      const ratio = (x - a.at) / (b.at - a.at);
      const c = a.rgb.map((v, k) => Math.round(v + (b.rgb[k] - v) * ratio));
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
  }
  const last = GRADIENT_STOPS[GRADIENT_STOPS.length - 1].rgb;
  return `rgb(${last[0]}, ${last[1]}, ${last[2]})`;
};

/** Couleur d'une vitesse en m/s pour des bornes données. */
export const speedGradientColor = (speedMs: number, minMs: number, maxMs: number): string => {
  if (!isFinite(speedMs) || speedMs < minMs) return SLOW_COLOR;
  if (maxMs <= minMs) return gradientColor(1);
  return gradientColor((speedMs - minMs) / (maxMs - minMs));
};

/** Dégradé CSS de la légende, du bleu au rouge. */
export const gradientCss = (): string =>
  `linear-gradient(to right, ${GRADIENT_STOPS.map((s) => `rgb(${s.rgb.join(', ')}) ${Math.round(s.at * 100)}%`).join(', ')})`;
