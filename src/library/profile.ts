/**
 * Profil : une période en un coup d'œil (totaux, répartition du temps par
 * activité), tiré des mêmes sessions et des mêmes totaux que les statistiques
 * (`stats.ts`). Logique pure ; l'heure est celle de l'appareil, comme le graphe
 * d'activités et les statistiques.
 */

import type { SportFamily } from '../core/sportProfiles';
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

/**
 * Sport préféré : l'activité qui a le plus de temps ; à durée égale, celle
 * pratiquée le plus récemment. `null` sans temps sur la période.
 */
export const favoriteActivity = (sessions: readonly StatSession[], activityOrder: readonly string[]): string | null => {
  const shares = activityShares(sessions, activityOrder);
  const top = shares[0];
  if (!top || top.totals.durationS <= 0) return null;
  const lastStart = (id: string): number => sessions.reduce((n, s) => (s.activityId === id ? Math.max(n, s.startMs) : n), -Infinity);
  return shares
    .filter((s) => s.totals.durationS === top.totals.durationS)
    .reduce((best, s) => (lastStart(s.activityId) > lastStart(best.activityId) ? s : best)).activityId;
};

/** Famille du sport préféré, qui choisit le fond des pages (`useFavoriteBackdrop`) ; `null` sans temps. */
export const favoriteFamily = (sessions: readonly StatSession[], activityOrder: readonly string[]): SportFamily | null => {
  const id = favoriteActivity(sessions, activityOrder);
  return id === null ? null : sessions.find((s) => s.activityId === id)?.family ?? null;
};
