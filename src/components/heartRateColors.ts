/**
 * Couleurs des zones cardiaques, de « sous Z1 » (indice 0) à Z5 : couleurs de
 * données des graphes et des tableaux, en dur comme les autres (CLAUDE.md).
 */
export const HEART_ZONE_COLORS = ['#b0bec5', '#78909c', '#42a5f5', '#66bb6a', '#ffa726', '#ef5350'] as const;

/** Couleur de la courbe de FC. */
export const HEART_RATE_COLOR = '#d32f2f';

/** Nom d'une zone : « sous Z1 », puis « Z1 » à « Z5 ». */
export const zoneLabel = (zone: number): string => (zone === 0 ? 'sous Z1' : `Z${zone}`);
