import { useMemo } from 'react';
import type { StatSession } from '../library/stats';
import { rootGrowth, type RootGrowth, type RootSettings } from '../library/rootGrowth';
import { runnerRootSettings, type RunnerProfile } from './useRunnerProfile';

/**
 * Racine du Profil : son niveau, rejoué sur les sessions du Profil (classées,
 * visibles), toutes périodes confondues, avec les réglages du pratiquant. Le
 * temps d'une session est son temps en mouvement, sinon sa durée.
 */
export const useProfileRoot = (sessions: readonly StatSession[], profile: RunnerProfile, nowMs: number): { growth: RootGrowth; settings: RootSettings } => {
  const { rootGoalMin, rootPeriodDays, rootGrowthPeriods, rootLossPeriods } = profile;
  const settings = useMemo(
    () => runnerRootSettings({ rootGoalMin, rootPeriodDays, rootGrowthPeriods, rootLossPeriods }),
    [rootGoalMin, rootPeriodDays, rootGrowthPeriods, rootLossPeriods]
  );
  const growth = useMemo(
    () => rootGrowth(sessions.map((s) => ({ startMs: s.startMs, durationS: s.movingTimeS ?? (s.endMs - s.startMs) / 1000 })), settings, nowMs),
    [sessions, settings, nowMs]
  );
  return { growth, settings };
};
