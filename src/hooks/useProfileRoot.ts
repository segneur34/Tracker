import { useMemo } from 'react';
import type { StatSession } from '../library/stats';
import { rootGrowth, type RootGrowth } from '../library/rootGrowth';
import { runnerRootGoalMin } from '../library/profilePrompt';
import type { RunnerProfile } from '../library/athleteProfile';

/**
 * Racine du Profil : son niveau, rejoué sur les sessions du Profil (classées,
 * visibles), toutes périodes confondues, avec l'objectif par semaine du
 * pratiquant. Le temps d'une session est son temps en mouvement, sinon sa durée ;
 * en surf, tout son temps à l'eau, pauses déduites (rame, attente et vagues : le
 * temps en mouvement du surf n'est que la glisse), sinon sa durée.
 */
export const rootSessionTimeS = (s: Pick<StatSession, 'family' | 'movingTimeS' | 'waterTimeS' | 'startMs' | 'endMs'>): number => {
  const duration = (s.endMs - s.startMs) / 1000;
  if (s.family === 'surf') return s.waterTimeS ?? duration;
  return s.movingTimeS ?? duration;
};

export const useProfileRoot = (sessions: readonly StatSession[], profile: RunnerProfile, nowMs: number): { growth: RootGrowth; goalMin: number } => {
  const goalMin = runnerRootGoalMin(profile);
  const growth = useMemo(
    () => rootGrowth(sessions.map((s) => ({ startMs: s.startMs, durationS: rootSessionTimeS(s) })), goalMin, nowMs),
    [sessions, goalMin, nowMs]
  );
  return { growth, goalMin };
};
