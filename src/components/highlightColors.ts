import type { PathOptions } from 'leaflet';

/**
 * Couleurs des surbrillances sur la carte, communes aux analyses : tops,
 * podiums de manœuvres et de sauts, zone de pente, répétition, saut montré.
 * Couleurs de données, en dur comme celles de la trace.
 */

/** Podium sur la carte et dans les tableaux : premier, deuxième, troisième. */
export const HIGHLIGHT_PODIUM_COLORS = ['#d32f2f', '#f57c00', '#388e3c'];

/** Rang du podium dans les en-têtes de tableau, dans l'ordre des couleurs. */
export const PODIUM_RANKS = ['1er', '2e', '3e'] as const;

/** Couleur de la marche `rank` (0 pour la première) ; au-delà de la troisième, celle de la troisième. */
export const podiumColor = (rank: number): string => HIGHLIGHT_PODIUM_COLORS[rank] ?? HIGHLIGHT_PODIUM_COLORS[2];

/** Passage seul montré sur la carte (zone de pente, répétition, saut) : un violet, absent du dégradé de la trace. */
export const HIGHLIGHT_SHOWN_COLOR = '#7b1fa2';

/** Repère du bouton « Note » au repos, sur la carte et les graphes (`SessionMarks.tsx`) ; montré, il prend le violet. */
export const MARK_FLAG_COLOR = '#37474f';

/** Épaisseur du trait d'une surbrillance sur la carte, en pixels : bien plus que la trace (5). */
export const HIGHLIGHT_WEIGHT = 10;

/** Opacité d'un tronçon montré : top, zone cardiaque, pente, cadence, revêtement, répétition, partie vue d'un graphe. */
export const HIGHLIGHT_OPACITY = 0.8;

/** Opacité d'un passage avec son point de départ : saut, vague, vol, podium de manœuvres (un peu plus appuyée). */
export const HIGHLIGHT_SPAN_OPACITY = 0.85;

const pathOptionsCache = new Map<string, PathOptions>();

/**
 * Style Leaflet d'un trait de surbrillance, le même objet d'un rendu à l'autre
 * pour une couleur, une opacité et une interactivité données (react-leaflet
 * réapplique le style dès que l'objet change). Toujours par `pathOptions`.
 */
export const highlightPathOptions = (color: string, opacity: number = HIGHLIGHT_OPACITY, interactive = true): PathOptions => {
  const key = `${color}|${opacity}|${interactive}`;
  let options = pathOptionsCache.get(key);
  if (!options) {
    options = { color, weight: HIGHLIGHT_WEIGHT, opacity, ...(interactive ? {} : { interactive: false }) };
    pathOptionsCache.set(key, options);
  }
  return options;
};

const dotOptionsCache = new Map<string, PathOptions>();

/** Style du point de départ d'un passage montré : plein, de la couleur du trait. */
export const highlightDotOptions = (color: string): PathOptions => {
  let options = dotOptionsCache.get(color);
  if (!options) {
    options = { color, fillColor: color, fillOpacity: 1, weight: 2 };
    dotOptionsCache.set(color, options);
  }
  return options;
};
