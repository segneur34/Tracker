import { useMemo } from 'react';
import type { StatSession } from '../library/stats';
import { rootGrowth, type RootGrowth } from '../library/rootGrowth';
import { runnerRootGoalMin } from '../library/profilePrompt';
import type { RunnerProfile } from '../library/athleteProfile';
import { rootSessionTimeS } from '../library/profile';

/**
 * Racine du Profil : son niveau, rejoué sur les sessions du Profil (classées,
 * visibles), toutes périodes confondues, avec l'objectif par semaine du
 * pratiquant. Le temps d'une session est celui de `rootSessionTimeS`.
 */
export const useProfileRoot = (sessions: readonly StatSession[], profile: RunnerProfile, nowMs: number): { growth: RootGrowth; goalMin: number } => {
  const goalMin = runnerRootGoalMin(profile);
  const growth = useMemo(
    () => rootGrowth(sessions.map((s) => ({ startMs: s.startMs, durationS: rootSessionTimeS(s) })), goalMin, nowMs),
    [sessions, goalMin, nowMs]
  );
  return { growth, goalMin };
};
