import { useMemo } from 'react';
import { heartRateStats, smoothHeartRate, type HeartRatePoint, type HeartRateStats } from '../core/heartRate';
import type { HeartRateProfile } from '../core/sportProfiles';

/** FC d'une session affichée, commune aux trois modules. */
export interface SessionHeartRate {
  /** FC lissée, point par point ; `null` là où le point n'en a pas. */
  smoothed: (number | null)[];
  stats: HeartRateStats | null;
  /** Assez de FC pour l'onglet « cardio » et sa courbe dans les graphes (`minCoverageS`). */
  present: boolean;
}

export const useSessionHeartRate = (track: readonly HeartRatePoint[], params: HeartRateProfile): SessionHeartRate =>
  useMemo(() => {
    const smoothed = smoothHeartRate(track, params.smoothS, params.gapS);
    const stats = heartRateStats(track, smoothed, params.gapS);
    return { smoothed, stats, present: stats !== null && stats.coveredS >= params.minCoverageS };
  }, [track, params]);
