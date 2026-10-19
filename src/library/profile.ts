/**
 * Profil : une période en un coup d'œil (totaux, répartition du temps par
 * activité), tiré des mêmes sessions et des mêmes totaux que les statistiques
 * (`stats.ts`). Logique pure ; l'heure est celle de l'appareil, comme le graphe
 * d'activités et les statistiques.
 */

import { groupTotals, type StatSession, type StatsTotals } from './stats';

/** Part d'une activité dans le temps total de la période. */
export interface ActivityShare {
  activityId: string;
  totals: StatsTotals;
  /** Fraction de la durée totale, de 0 à 1. */
  share: number;
}

/**
 * Répartition du temps par activité, de la plus longue à la plus courte ; à
 * durée égale, dans l'ordre des activités. Une activité sans session n'y est pas.
 */
export const activityShares = (sessions: readonly StatSession[], activityOrder: readonly string[]): ActivityShare[] => {
  const groups = groupTotals(sessions, (s) => s.activityId, activityOrder);
  const totalS = groups.reduce((n, g) => n + g.totals.durationS, 0);
  return groups
    .map((g) => ({ activityId: g.key, totals: g.totals, share: totalS > 0 ? g.totals.durationS / totalS : 0 }))
    .sort((a, b) => b.totals.durationS - a.totals.durationS);
};
