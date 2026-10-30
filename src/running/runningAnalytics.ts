import { classifyGrade, gradeZones, type GradeZone, type GradeZoneKey } from '../core/grade';
import { segmentDistanceM } from '../core/sessionStats';
import { consecutiveSteps, pathsWhere } from '../core/trackPaths';
import type { GradeProfile } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { formatDuration } from '../core/units';

/**
 * Analyse propre à la course à pied : zones de terrain et allures par zone.
 * La pente et ses zones sont au noyau (`core/grade.ts`) ; la fenêtre et les
 * seuils des zones viennent du profil (`SportProfile.grade`).
 */

export interface ZoneStats {
  zone: GradeZone;
  distanceM: number;
  timeMs: number;
  /** Vitesse moyenne en mouvement dans la zone, en m/s, ou `null` si aucune donnée. */
  avgSpeedMs: number | null;
  /** Part de la distance totale en mouvement. */
  distanceShare: number;
  /** Durée formatée (la distance et la vitesse le sont à l'affichage, dans l'unité de l'activité). */
  time: string;
}

/**
 * Distance, temps et allure moyenne par zone de pente, sur les seuls segments
 * en mouvement : une pause en haut d'une côte ne doit pas peser sur l'allure
 * de la montée.
 */
export const computeZoneStats = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  p: GradeProfile
): ZoneStats[] => {
  const acc: Record<GradeZoneKey, { distanceM: number; timeMs: number }> = {
    steepDown: { distanceM: 0, timeMs: 0 },
    down: { distanceM: 0, timeMs: 0 },
    flat: { distanceM: 0, timeMs: 0 },
    up: { distanceM: 0, timeMs: 0 },
    steepUp: { distanceM: 0, timeMs: 0 },
  };
  let movingDistanceM = 0;

  for (let i = 1; i < track.length; i++) {
    if (!activityMask[i]) continue;
    const zone = classifyGrade(grades[i], p);
    if (zone === null) continue;
    const d = segmentDistanceM(track, i);
    acc[zone].distanceM += d;
    acc[zone].timeMs += track[i].timeMs - track[i - 1].timeMs;
    movingDistanceM += d;
  }

  return gradeZones(p).map((zone) => {
    const { distanceM, timeMs } = acc[zone.key];
    const avgSpeedMs = timeMs > 0 ? distanceM / (timeMs / 1000) : null;
    return {
      zone,
      distanceM,
      timeMs,
      avgSpeedMs,
      distanceShare: movingDistanceM > 0 ? distanceM / movingDistanceM : 0,
      time: formatDuration(timeMs),
    };
  });
};

/**
 * Tracés d'une zone de pente, à montrer sur la carte : les suites de segments
 * en mouvement dont la pente tombe dans la zone, retenus comme par
 * `computeZoneStats` (le segment qui arrive au point `i` porte la pente de
 * `i`). Chaque tracé est une suite de positions `[lat, lon]`, coupée à chaque
 * changement de zone, à chaque pause et là où la pente manque.
 */
export const gradeZonePaths = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  zone: GradeZoneKey,
  p: GradeProfile
): [number, number][][] =>
  pathsWhere(track, consecutiveSteps(track.length), ({ to }) => activityMask[to] && classifyGrade(grades[to], p) === zone);

