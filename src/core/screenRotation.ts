import { angleDiff, toRad } from './angles';

/**
 * Géométrie d'une carte tournée à l'écran (carte du direct orientée selon le
 * téléphone, `components/map/rotation.ts`) : un point de l'écran ramené dans le
 * repère de la carte droite, et ce qu'il faut charger et dessiner pour qu'aucun
 * coin ne reste vide quel que soit l'angle. Repère de l'écran : x vers la
 * droite, y vers le bas, en pixels ; un angle positif tourne dans le sens
 * horaire, comme `rotate()` en CSS. Pur.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** `p` tourné de `deg` degrés (sens horaire à l'écran) autour de `c`. */
export const rotateAround = (p: ScreenPoint, c: ScreenPoint, deg: number): ScreenPoint => {
  if (deg % 360 === 0) return { x: p.x, y: p.y };
  const rad = toRad(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

/**
 * Côté du carré, centré sur le cadre `w` × `h`, qui en couvre l'image tournée
 * à tout angle : la diagonale du cadre, arrondie au pixel au-dessus.
 */
export const coverSquareSide = (w: number, h: number): number => Math.ceil(Math.hypot(Math.max(0, w), Math.max(0, h)));

/**
 * Marge d'un moteur de dessin de Leaflet (`padding`, en part du cadre de
 * chaque côté) qui couvre le carré de `coverSquareSide` : le cadre agrandi de
 * `1 + 2 × marge` doit atteindre le carré sur son côté le plus court. Jamais
 * moins que `minPadding` (la marge d'origine du moteur) ; elle seule pour un
 * cadre sans taille.
 */
export const svgPaddingFor = (w: number, h: number, minPadding: number): number => {
  const short = Math.min(w, h);
  if (!(short > 0)) return minPadding;
  return Math.max(minPadding, (coverSquareSide(w, h) / short - 1) / 2);
};

/**
 * Angle « déroulé » : `next` (en degrés, modulo 360) rendu au plus près de
 * `prev`, pour qu'une transition CSS passe de 350° à 10° par 360°, sans faire
 * le tour par 180°.
 */
export const unwrapDeg = (prev: number, next: number): number => prev + angleDiff(next, prev);

/**
 * Écart de zoom (en niveaux, négatif pour reculer) qui fait tenir une emprise
 * de `bw` × `bh` pixels dans un cadre de `w` × `h` à tout angle de la carte :
 * l'emprise tournée reste dans le cercle de sa diagonale, qui doit tenir dans
 * le côté le plus court du cadre. Zéro pour une emprise ou un cadre sans taille.
 */
export const zoomDeltaForAnyBearing = (bw: number, bh: number, w: number, h: number): number => {
  const diagonal = Math.hypot(bw, bh);
  const short = Math.min(w, h);
  if (!(diagonal > 0) || !(short > 0)) return 0;
  return Math.log2(short / diagonal);
};
