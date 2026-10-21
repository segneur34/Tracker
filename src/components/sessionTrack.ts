import { FAMILY_BASE, type Activity } from '../core/activities';
import { trackBounds, type TrackBounds } from '../core/displayConfig';
import { parseGpx } from '../core/gpxParser';
import { referenceSpeedMs as sessionReferenceSpeedMs } from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import { sportTreatment, type SportFamily } from '../core/sportProfiles';
import { trackColorSpeedsMs } from '../core/trackColor';
import type { SportType } from '../core/types';
import { msToKnots } from '../core/units';
import { TREATMENT_SPEED_RANGE_MS, defaultSpeedRangeOf, readStoredSettings } from '../hooks/useSportSettings';
import type { SessionRecord } from '../library/record';
import { analysisTrack } from '../library/summary';
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
 * Bornes de couleur d'une session hors de son analyse, dans cet ordre, comme le module d'analyse :
 * 0. celles enregistrées dans la fiche de la session (`analysis.speedRange`) ;
 * 1. celles réglées pour son activité dans Réglages (`tracker.sportSettings`) ;
 * 2. en voile, les bornes suggérées par l'allure de la session (`suggestSpeedRangeMs`,
 *    mesurées sur la trace entière comme dans l'analyse) ;
 * 3. à défaut, celui de son activité (`defaultSpeedRangeOf`), sinon celui du traitement de
 *    son calcul (celui du calcul par défaut de la famille pour une session à classer).
 */
export const sessionSpeedRange = (
  record: Pick<SessionRecord, 'analysis' | 'sport'>,
  activity: Activity | null,
  family: SportFamily,
  suggested: SpeedRangeMs | null
): SpeedRangeMs => {
  if (record.analysis?.speedRange) return record.analysis.speedRange;
  if (activity) {
    const override = readStoredSettings().speedRanges?.[activity.id];
    if (override && isValidSpeedRange(override)) return override;
  }
  if (suggested) return suggested;
  if (activity) return defaultSpeedRangeOf(activity);
  return TREATMENT_SPEED_RANGE_MS[sportTreatment(record.sport ?? FAMILY_BASE[family])];
};
