/**
 * Réglages communs des graphes Recharts : couleurs de données (en dur, à un
 * seul endroit, comme `heartRateColors.ts` et `highlightColors.ts`), grille,
 * graduations et libellé d'axe vertical. Les couleurs de thème restent des
 * variables (`--chart-grid`, `--chart-axis`, `--chart-mark`).
 */

/** Vitesse à pied, à vélo, en surf, dans le test guidé et le fractionné. */
export const SPEED_COLOR = '#1e88e5';

/** Vitesse de la voile : un autre bleu, voulu (Q36, 29/10). */
export const SAILING_SPEED_COLOR = '#1976d2';

/** Altitude. */
export const ALTITUDE_COLOR = '#e64a19';

/** Énergie dépensée et puissance : l'orange de l'altitude. */
export const ENERGY_COLOR = '#e64a19';

/** Moyenne et tendance (fractionné), trait « lancé ». */
export const TREND_COLOR = '#757575';

/** Fond des phases d'un test guidé, en bandes alternées. */
export const PHASE_FILL = '#90a4ae';

/** Repères en pointillés d'un graphe (signaux d'un test, FC la plus basse). */
export const CHART_MARK_COLOR = 'var(--chart-mark)';

/** « Autres » dans les répartitions (Profil, Statistiques). */
export const OTHERS_COLOR = '#9aa0a6';

/** Grille en pointillés derrière une courbe : `<CartesianGrid {...CHART_GRID_PROPS} />`. */
export const CHART_GRID_PROPS = { strokeDasharray: '3 3', stroke: 'var(--chart-grid)' } as const;

/** Graduations d'un axe sans couleur de série. */
export const CHART_TICK = { fill: 'var(--chart-axis)', fontSize: 11 } as const;

/** Graduations d'un axe à la couleur de sa série. */
export const chartTick = (color: string) => ({ fill: color, fontSize: 11 });

/** Libellé (unité) d'un axe vertical, couché le long de l'axe, à la couleur de sa série. */
export const yAxisLabel = (value: string, color: string, position: 'insideLeft' | 'insideRight' = 'insideLeft') => (
  { value, angle: -90, position, fill: color, fontSize: 11 }
);
