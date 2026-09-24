import { buildCumulativeTrack, buildBaseSessionStats, computeActivityMask } from '../core/sessionStats';
import { getActiveThresholds, getSportProfile } from '../core/sportProfiles';
import { computeAllTopSegments } from '../core/topSegments';
import type { SportType, TrackPoint } from '../core/types';
import { knotsToMs, msToKnots } from '../core/units';
import type { SessionStats } from '../types/sailing';
import { DEFAULT_SAILING_SPORT, SAILING_TOP_TARGETS, getDefaultThresholdKn } from './sailingConfig';

export interface SailingStatsOptions {
  /** Support analysé, qui fixe les défauts d'hystérésis. */
  sport?: SportType;
  /**
   * Seuil d'activité en nœuds. Paramètre injecté : il vaut 8 en wingfoil mais
   * change selon le support, et l'utilisateur peut le régler.
   */
  activeThresholdKn?: number;
}

/**
 * Statistiques d'une session à voile : la base générique, plus les tops de
 * vitesse.
 */
export const buildSailingSessionStats = (
  track: TrackPoint[],
  options: SailingStatsOptions = {}
): SessionStats | null => {
  if (track.length === 0) return null;

  const sport = options.sport ?? DEFAULT_SAILING_SPORT;
  const profile = getSportProfile(sport);
  const activeThresholdKn = options.activeThresholdKn ?? getDefaultThresholdKn(sport);
  const thresholds = getActiveThresholds(profile, activeThresholdKn);

  const cumulative = buildCumulativeTrack(track);
  const activityMask = computeActivityMask(track, {
    enterThresholdMs: knotsToMs(thresholds.enter),
    exitThresholdMs: knotsToMs(thresholds.exit),
    minStateDurationS: profile.minStateDurationS,
  });

  const base = buildBaseSessionStats(track, {
    enterThresholdMs: knotsToMs(thresholds.enter),
    exitThresholdMs: knotsToMs(thresholds.exit),
    minStateDurationS: profile.minStateDurationS,
    cumulative,
    activityMask,
  });

  const tops = computeAllTopSegments(track, cumulative, SAILING_TOP_TARGETS, msToKnots);

  return {
    ...base,
    tops: {
      t2s: tops.t2s,
      t5s: tops.t5s,
      t10s: tops.t10s,
      d100m: tops.d100m,
      d500m: tops.d500m,
      d1000m: tops.d1000m,
      d1NM: tops.d1NM,
    },
  };
};
