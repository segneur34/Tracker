import { pointTimeMs } from './kinematics';
import type { HeartRatePoint } from './heartRate';
import type { TimedTrackPoint } from './types';

/**
 * Points d'une session sans trace (muscu, lot I du 25/10) : la FC de la
 * ceinture, horodatée, sans position ni cinématique, et sa durée hors pauses.
 * Tout se mesure en temps (règle 2). Le résumé (`library/summary.ts`) et la
 * dépense cardio (`core/hrEnergy.ts`, voile et surf aussi) les lisent ;
 * l'analyse de la séance et ses phases du compteur sont dans
 * `land/heartRateSession.ts` (lot 187).
 */

/** Point d'une session sans trace : l'heure, la FC éventuelle, et la reprise après une pause. */
export interface HeartRateSessionPoint extends HeartRatePoint {
  segmentStart?: true;
}

/**
 * Points horodatés lus dans le GPX (`ParsedGpx.timedPoints`), en millisecondes ;
 * un point à l'heure illisible, ou qui n'est pas plus tard que le précédent, est
 * écarté (sa reprise passe au suivant gardé).
 */
export const heartRatePointsFrom = (timed: readonly TimedTrackPoint[]): HeartRateSessionPoint[] => {
  const out: HeartRateSessionPoint[] = [];
  let resume = false;
  for (const p of timed) {
    resume ||= p.segmentStart === true;
    const timeMs = pointTimeMs(p.time);
    if (!isFinite(timeMs) || (out.length > 0 && timeMs <= out[out.length - 1].timeMs)) continue;
    out.push({ timeMs, ...(p.hr !== undefined ? { hr: p.hr } : {}), ...(resume && out.length > 0 ? { segmentStart: true as const } : {}) });
    resume = false;
  }
  return out;
};

/** Durée hors pauses, en secondes : la somme des pas, sauf celui qui mène à une reprise. */
export const activeDurationS = (points: readonly HeartRateSessionPoint[]): number => {
  let totalMs = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].segmentStart) continue;
    totalMs += points[i].timeMs - points[i - 1].timeMs;
  }
  return totalMs / 1000;
};
