import { useMemo } from 'react';
import { sessionActivity } from '../core/activities';
import type { BackdropVariant } from '../core/patternTiles';
import { favoriteFamily } from '../library/profile';
import { statSessionOf, type StatSession } from '../library/stats';
import { useLibrarySelector } from './useSessionLibrary';
import { useVisibility } from './useSportSettings';

/**
 * Fond des pages hors sport (accueil, Profil, Réglages, Statistiques dans
 * « Tout ») : le motif de la famille du sport préféré de toutes les sessions
 * classées et visibles, comme la photo par défaut du Profil ; les courbes de
 * niveau tant qu'il n'y en a pas (demande du 22/10, choix du 23/10). Les fiches
 * sont déjà en mémoire : rien n'est lu en plus.
 */
export function useFavoriteBackdrop(): BackdropVariant {
  const sessions = useLibrarySelector((s) => s.sessions);
  const { activities, isShown } = useVisibility();
  return useMemo(() => {
    const list: StatSession[] = [];
    for (const s of sessions) {
      const a = sessionActivity(activities, s.record.activityId, s.record.sport);
      if (a && isShown(a)) list.push(statSessionOf(s.file, s.record, a));
    }
    return favoriteFamily(list, activities.map((a) => a.id)) ?? 'contours';
  }, [sessions, activities, isShown]);
}
