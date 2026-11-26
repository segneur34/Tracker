import { useMemo } from 'react';
import type { Activity } from '../core/activities';
import { runnerAge, zonesFor, type RunnerProfile } from '../library/athleteProfile';
import { LEVEL_RULES, levelSessionOf, restingHrForme, sportLevel, type LevelSession, type SportLevel } from '../library/sportLevel';
import type { StatSession } from '../library/stats';
import { formeForAge, levelProfileOf } from '../library/statsLevel';
import { useRestingHrResults } from './useRestingHrResults';
import { effectiveEnergyModel, effectiveHrOffset } from './useSportSettings';

/**
 * Note de niveau sportif du Profil (lot 230, `library/sportLevel.ts`) : les
 * sessions du Profil (classées, visibles, toutes périodes confondues), chacune
 * avec le calcul et les zones cardiaques de son activité ; la forme pour l'âge
 * d'après la course (sans la marche) et le vélo (`formeForAge`) et le dernier
 * test de FC de repos. `null` sans année de naissance ou sans sexe : la ligne
 * porte alors l'invite vers Réglages › Pratiquant.
 */
export const useSportLevel = (
  sessions: readonly StatSession[],
  activityById: ReadonlyMap<string, Activity>,
  runner: RunnerProfile,
  nowMs: number
): SportLevel | null => {
  const { results } = useRestingHrResults();
  const profile = useMemo(() => levelProfileOf(runner), [runner]);

  const levelSessions = useMemo(() => {
    // Zones par activité, calculées une fois chacune.
    const boundsOf = new Map<string, readonly number[] | null>();
    const out: LevelSession[] = [];
    for (const s of sessions) {
      const activity = activityById.get(s.activityId);
      if (!activity) continue;
      if (!boundsOf.has(activity.id)) boundsOf.set(activity.id, zonesFor(runner, activity, effectiveHrOffset)?.bounds ?? null);
      out.push(levelSessionOf(s, activity.base, boundsOf.get(activity.id) ?? null));
    }
    return out;
  }, [sessions, activityById, runner]);

  return useMemo(() => {
    if (!profile) return null;
    const isRun = (s: StatSession) => {
      const activity = activityById.get(s.activityId);
      return !activity || effectiveEnergyModel(activity) !== 'marche';
    };
    const forme = formeForAge(sessions, profile, nowMs, LEVEL_RULES, isRun);
    const heart = restingHrForme(results.map((r) => ({ atMs: r.startedAtMs, bpm: r.lowestBpm })), profile.sex, profile.birthYear, nowMs);
    if (heart) forme.push(heart);
    return sportLevel(levelSessions, runnerAge(runner, nowMs), forme, nowMs);
  }, [profile, sessions, activityById, levelSessions, results, runner, nowMs]);
};
