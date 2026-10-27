import { useMemo } from 'react';
import { activityFamily, sessionActivity, type Activity } from '../core/activities';
import type { SportFamily } from '../core/sportProfiles';
import type { LibrarySession } from '../library/record';
import { statSessionOf, type StatSession } from '../library/stats';
import { useLibrarySelector } from './useSessionLibrary';
import { effectiveFoil, useVisibility } from './useSportSettings';

/**
 * Sessions des statistiques, du Profil, du graphe d'activités et du fond des
 * pages : classées et visibles, une seule règle. Une session peut tenir d'une
 * activité de base, hors de la liste (son calcul sans activité créée, activité
 * supprimée) : elle est gardée, et son activité ajoutée à `activityById` pour
 * son nom et sa couleur. `foil` : celui de la session, sinon de son activité.
 */
export interface VisibleStatSessions {
  all: StatSession[];
  /** Toutes les activités de la liste, plus celles de base qu'une session emploie. */
  activityById: Map<string, Activity>;
}

/**
 * La conversion, hors composant. `openFamily` : une famille cachée ouverte par
 * son adresse (Statistiques), dont les sessions sont gardées.
 */
export const visibleStatSessions = (
  sessions: LibrarySession[],
  activities: Activity[],
  isShown: (activity: Activity) => boolean,
  openFamily: SportFamily | null = null
): VisibleStatSessions => {
  const all: StatSession[] = [];
  const activityById = new Map(activities.map((a) => [a.id, a]));
  for (const s of sessions) {
    const a = sessionActivity(activities, s.record.activityId, s.record.sport);
    if (!a) continue;
    if (!isShown(a) && !(openFamily !== null && activityFamily(a) === openFamily)) continue;
    if (!activityById.has(a.id)) activityById.set(a.id, a);
    all.push(statSessionOf(s.file, s.record, a, s.record.analysis?.foil ?? effectiveFoil(a) ?? false));
  }
  return { all, activityById };
};

/** Dernière conversion, partagée par les appelants d'une même page (Profil : la page, son fond et son graphe). */
let cache: {
  sessions: LibrarySession[];
  activities: Activity[];
  isShown: (activity: Activity) => boolean;
  value: VisibleStatSessions;
} | null = null;

const cachedVisibleStatSessions = (
  sessions: LibrarySession[],
  activities: Activity[],
  isShown: (activity: Activity) => boolean
): VisibleStatSessions => {
  if (cache?.sessions !== sessions || cache.activities !== activities || cache.isShown !== isShown) {
    cache = { sessions, activities, isShown, value: visibleStatSessions(sessions, activities, isShown) };
  }
  return cache.value;
};

/** Les sessions classées et visibles, refaites seulement quand la bibliothèque ou la visibilité change. */
export function useVisibleStatSessions(): VisibleStatSessions {
  const sessions = useLibrarySelector((s) => s.sessions);
  const { activities, isShown } = useVisibility();
  return useMemo(() => cachedVisibleStatSessions(sessions, activities, isShown), [sessions, activities, isShown]);
}
