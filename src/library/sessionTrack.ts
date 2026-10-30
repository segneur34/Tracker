import { FAMILY_BASE } from '../core/activities';
import { trackBounds, type TrackBounds } from '../core/displayConfig';
import { parseGpx } from '../core/gpxParser';
import { referenceSpeedMs as sessionReferenceSpeedMs } from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import type { SpeedRangeMs } from '../core/speedGradient';
import { getSportProfile, sportTreatment, type SportFamily } from '../core/sportProfiles';
import { effectiveSpeedRange, trackColorSpeedsMs } from '../core/trackColor';
import type { SportType } from '../core/types';
import { msToKnots } from '../core/units';
import type { SessionRecord } from './record';
import { analysisTrack } from './summary';
import { suggestSpeedRangeMs } from '../sailing/sailingConfig';

/**
 * Trace colorée d'une session de la mémoire hors de son analyse (vignette de
 * la bibliothèque, image partagée à la fin d'un enregistrement), calculée
 * comme l'analyse : filtres du support, allure de la session, mêmes bornes.
 */

/** Trace d'une session, chaque point avec sa vitesse de couleur, son emprise et, en voile, les bornes suggérées par l'allure. */
export interface SessionColorTrack {
  points: { lat: number; lon: number; colorMs: number }[];
  bounds: TrackBounds;
  suggested: SpeedRangeMs | null;
}

/**
 * Trace colorée tirée du GPX, pour le support de la session et l'allure imposée
 * de sa fiche (`analysis.referenceSpeedMs`, sinon mesurée) ; `null` si elle a
 * moins de deux points. Lève si le GPX est illisible.
 */
export const sessionColorTrack = (
  gpx: string,
  sport: SportType | null,
  referenceOverrideMs: number | null,
  family: SportFamily
): SessionColorTrack | null => {
  const { rawPoints } = parseGpx(gpx);
  const referenceMs = referenceOverrideMs ?? sessionReferenceSpeedMs(rawPoints);
  const points = analysisTrack(rawPoints, sport, referenceMs);
  const bounds = trackBounds(points);
  if (points.length < 2 || bounds === null) return null;
  const treatment = sportTreatment(sport ?? FAMILY_BASE[family]);
  const colorMs = trackColorSpeedsMs(points, treatment);
  return {
    points: points.map((p, i) => ({ lat: p.lat, lon: p.lon, colorMs: colorMs[i] })),
    bounds,
    suggested: sport !== null && treatment === 'voile'
      ? suggestSpeedRangeMs(sport, msToKnots(referenceMs), points, buildCumulativeTrack(points))
      : null,
  };
};

/**
 * Bornes de couleur de l'activité d'une session, lues dans ses réglages par
 * l'appelant (`activitySpeedRanges`, `hooks/useSportSettings.ts`) : celles
 * réglées ou pré-réglées (`fixed`, `null` sans l'un ni l'autre) et celles
 * par défaut (`fallback`).
 */
export interface ActivitySpeedRanges {
  fixed: SpeedRangeMs | null;
  fallback: SpeedRangeMs;
}

/**
 * Bornes de couleur d'une session hors de son analyse, dans l'ordre de
 * l'analyse (`effectiveSpeedRange`) : celles de sa fiche (`analysis.speedRange`),
 * sinon celles de son activité, sinon en voile celles suggérées par l'allure
 * (mesurées sur la trace entière comme dans l'analyse), sinon celles par défaut
 * de l'activité, ou du calcul de la session (celui par défaut de la famille
 * pour une session à classer) quand elle n'a pas d'activité.
 */
export const sessionSpeedRange = (
  record: Pick<SessionRecord, 'analysis' | 'sport'>,
  activity: ActivitySpeedRanges | null,
  family: SportFamily,
  suggested: SpeedRangeMs | null
): SpeedRangeMs =>
  effectiveSpeedRange({
    sessionRange: record.analysis?.speedRange ?? null,
    activityRange: activity?.fixed ?? null,
    suggested,
    fallback: activity?.fallback ?? getSportProfile(record.sport ?? FAMILY_BASE[family]).speedRange,
  });
