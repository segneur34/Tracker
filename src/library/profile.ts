/**
 * Profil : l'année civile en un coup d'œil (totaux, répartition du temps par
 * activité), tiré des mêmes sessions et des mêmes totaux que les statistiques
 * (`stats.ts`). Logique pure ; l'heure est celle de l'appareil, comme le graphe
 * d'activités et les statistiques.
 */

import { groupTotals, type StatSession, type StatsBounds, type StatsTotals } from './stats';

/** Bornes d'une année civile : du 1er janvier à minuit au 1er janvier suivant, exclu. */
export const calendarYearBounds = (year: number): StatsBounds => ({
  fromMs: new Date(year, 0, 1).getTime(),
  toMs: new Date(year + 1, 0, 1).getTime(),
});

/**
 * Années que le profil peut montrer : de celle de la plus vieille session à
 * l'année en cours, même vides ; l'année en cours seule sans session.
 */
export const profileYears = (sessions: readonly StatSession[], nowMs: number): number[] => {
  const current = new Date(nowMs).getFullYear();
  const oldest = sessions.reduce((y, s) => Math.min(y, new Date(s.startMs).getFullYear()), current);
  const years: number[] = [];
  for (let y = oldest; y <= current; y++) years.push(y);
  return years;
};

/** Part d'une activité dans le temps total de l'année. */
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
