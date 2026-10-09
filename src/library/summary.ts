import { computeElevationStats } from '../core/elevation';
import { computeKinematics } from '../core/kinematics';
import { referenceSpeedMs, samplingIntervalS, sessionFilterThresholds } from '../core/sessionSpeed';
import {
  MIN_ELEVATION_COVERAGE,
  buildCumulativeTrack,
  computeActivityMask,
  computeActiveTimeMs,
} from '../core/sessionStats';
import { SAILING_SPORTS, getActiveThresholds, getSportProfile, type ElevationProfile } from '../core/sportProfiles';
import type { RawTrackPoint, SportType, TrackPoint } from '../core/types';
import { applyTerrainElevation, type TerrainSamples } from '../core/terrainElevation';
import { fromDisplaySpeed, msToKnots } from '../core/units';
import { suggestActiveThresholdKn } from '../sailing/sailingConfig';
import { SUMMARY_CALC_VERSION, type SessionSummary } from './record';

/**
 * Résumé d'une session pour la bibliothèque : ce que la liste affiche sans
 * relire la trace.
 *
 * Le calcul reprend celui du module qui analysera la session, pour que la
 * liste et l'analyse donnent les mêmes chiffres :
 * - en voile, filtres et seuil d'activité accordés à l'allure de la session
 *   (`useSailingSession`, règle 4), sauf surcharge de l'utilisateur ;
 * - en course, filtres et seuil du profil, sauf surcharge.
 *
 * Sans support connu, ni filtre de support ni seuil d'activité : distance et
 * durée restent justes, le temps en action attend que la session soit classée.
 */

export interface SummaryOptions {
  /** Seuil d'activité imposé, dans l'unité du profil. Absent : celui du module. */
  activeThreshold?: number;
  /** Allure de session imposée, en m/s (voile). */
  referenceSpeedOverrideMs?: number;
  /** Réglage du dénivelé. Absent : celui du profil. */
  elevation?: ElevationProfile;
  /**
   * Altitude du terrain de la fiche, substituée à celle du GPS avant le
   * dénivelé (course, vélo, source IGN : l'appelant en décide).
   */
  terrainElevation?: TerrainSamples;
}

/**
 * Trace enrichie telle que le module d'analyse la calcule : filtres du
 * profil, accordés en voile à l'allure de la session (imposée, sinon mesurée
 * sur les points bruts, `referenceMs`). Sans support connu, aucun filtre.
 * Le résumé et la vignette de la bibliothèque en partent.
 */
export const analysisTrack = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  referenceMs: number = referenceSpeedMs(rawPoints)
): TrackPoint[] => {
  if (sport === null) return computeKinematics(rawPoints);
  const profile = getSportProfile(sport);
  const filters = SAILING_SPORTS.includes(sport)
    ? sessionFilterThresholds(referenceMs, profile.maxPlausibleSpeedMs)
    : { maxAcceleration: undefined, maxSpeedMs: profile.maxPlausibleSpeedMs };
  return computeKinematics(rawPoints, {
    medianWindowSeconds: profile.medianWindowSeconds,
    maxAcceleration: filters.maxAcceleration,
    maxSpeedMs: filters.maxSpeedMs,
  });
};

/** Trace enrichie et temps en action, selon le support. */
const analyze = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  options: SummaryOptions
): { track: TrackPoint[]; movingTimeS: number | null } => {
  if (sport === null) return { track: computeKinematics(rawPoints), movingTimeS: null };

  const profile = getSportProfile(sport);
  const isSailing = SAILING_SPORTS.includes(sport);
  const referenceMs = options.referenceSpeedOverrideMs ?? referenceSpeedMs(rawPoints);
  const track = analysisTrack(rawPoints, sport, referenceMs);

  const threshold =
    options.activeThreshold ??
    (isSailing ? suggestActiveThresholdKn(sport, msToKnots(referenceMs)) : profile.defaultActiveThreshold);
  const { enter, exit } = getActiveThresholds(profile, threshold);
  const mask = computeActivityMask(track, {
    enterThresholdMs: fromDisplaySpeed(enter, profile.thresholdUnit),
    exitThresholdMs: fromDisplaySpeed(exit, profile.thresholdUnit),
    minStateDurationS: profile.minStateDurationS,
  });
  return { track, movingTimeS: computeActiveTimeMs(track, mask) / 1000 };
};

/** Résumé d'une trace, ou `null` si elle a moins de deux points horodatés. */
export const summarizeSession = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  options: SummaryOptions = {}
): SessionSummary | null => {
  const analyzed = analyze(rawPoints, sport, options);
  const { movingTimeS } = analyzed;
  if (analyzed.track.length < 2) return null;

  const { cumDist } = buildCumulativeTrack(analyzed.track);
  const track = options.terrainElevation ? applyTerrainElevation(analyzed.track, cumDist, options.terrainElevation).track : analyzed.track;
  const elevationProfile = options.elevation ?? getSportProfile(sport ?? 'running').elevation;
  const elevation = computeElevationStats(track, elevationProfile);
  let maxSpeedMs = 0;
  for (const p of track) if (p.smoothedSpeedMs > maxSpeedMs) maxSpeedMs = p.smoothedSpeedMs;

  return {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: track[0].timeMs,
    endMs: track[track.length - 1].timeMs,
    distanceM: cumDist[cumDist.length - 1],
    movingTimeS,
    elevationGainM: elevation.coverage >= MIN_ELEVATION_COVERAGE ? elevation.gainM : null,
    maxSpeedMs,
    pointCount: track.length,
    samplingS: samplingIntervalS(rawPoints),
  };
};
