import { computeElevationStats } from '../core/elevation';
import { heartRateHistogram, heartRateStats, smoothHeartRate } from '../core/heartRate';
import { computeKinematics } from '../core/kinematics';
import { referenceSpeedMs, samplingIntervalS, sessionFilterThresholds } from '../core/sessionSpeed';
import {
  MIN_ELEVATION_COVERAGE,
  buildCumulativeTrack,
  computeActivityMask,
  computeActiveDistanceM,
  computeActiveTimeMs,
} from '../core/sessionStats';
import { SAILING_SPORTS, defaultActiveThresholdOf, getActiveThresholds, getSportProfile, type ElevationProfile, type HeartRateProfile } from '../core/sportProfiles';
import type { RawTrackPoint, SportType, TrackPoint } from '../core/types';
import { applyTerrainElevation, type TerrainSamples } from '../core/terrainElevation';
import { fromDisplaySpeed, msToKnots } from '../core/units';
import { suggestActiveThresholdKn } from '../sailing/sailingConfig';
import { runSurfSession, surfProfileOf } from '../surfing/surfSession';
import { SUMMARY_CALC_VERSION, type SessionSummary, type SummaryCadence, type SummaryHeartRate } from './record';
import { analyzeCadence, sessionCadence, type CadenceDetection } from '../running/cadence';

/**
 * Résumé d'une session pour la bibliothèque : ce que la liste affiche sans
 * relire la trace.
 *
 * Le calcul reprend celui du module qui analysera la session, pour que la
 * liste et l'analyse donnent les mêmes chiffres :
 * - en voile, filtres et seuil d'activité accordés à l'allure de la session
 *   (`useSailingSession`, règle 4), sauf surcharge de l'utilisateur ;
 * - en course, filtres et seuil du profil, sauf surcharge ;
 * - en surf, les vagues de la page d'analyse (`runSurfSession`) : le temps et
 *   la distance en action sont ceux de la glisse, et le résumé compte les vagues.
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
  /** Support sur foil de la session (surf : il change le seuil par défaut et l'analyse). */
  foil?: boolean;
  /** Seuil de vague en foil de la session, dans l'unité du profil (surf). */
  waveThreshold?: number;
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
    maxDetourRatio: profile.maxDetourRatio,
    maxAcceleration: filters.maxAcceleration,
    maxSpeedMs: filters.maxSpeedMs,
  });
};

/**
 * Glisses d'une session de surf telles que le module d'analyse les découpe :
 * les vols sur foil, les vagues sinon. L'élagage de ses capteurs les entoure
 * (`surfing/pumping.ts`). `null` hors surf.
 */
export const surfRides = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  options: SummaryOptions
): { startMs: number; endMs: number }[] | null => {
  if (sport === null) return null;
  const profile = getSportProfile(sport);
  const surfProfile = surfProfileOf(profile);
  if (!surfProfile) return null;
  const track = analysisTrack(rawPoints, sport);
  const foil = options.foil ?? false;
  const { analysis } = runSurfSession(track, buildCumulativeTrack(track), surfProfile, {
    threshold: options.activeThreshold ?? defaultActiveThresholdOf(profile, foil), foil, waveThreshold: options.waveThreshold ?? null,
  });
  return (foil ? analysis.flights : analysis.waves).map((r) => ({ startMs: r.startMs, endMs: r.endMs }));
};

/** Trace enrichie, temps et distance en action, selon le support. */
const analyze = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  options: SummaryOptions
): {
  track: TrackPoint[];
  movingTimeS: number | null;
  movingDistanceM: number | null;
  /** Masque d'activité (hors surf), pour la cadence en mouvement. */
  mask?: boolean[];
  surf?: Pick<SessionSummary, 'waveCount' | 'longestWaveM' | 'longestFlightS' | 'flightS'>;
} => {
  if (sport === null) return { track: computeKinematics(rawPoints), movingTimeS: null, movingDistanceM: null };

  const profile = getSportProfile(sport);
  const isSailing = SAILING_SPORTS.includes(sport);
  const referenceMs = options.referenceSpeedOverrideMs ?? referenceSpeedMs(rawPoints);
  const track = analysisTrack(rawPoints, sport, referenceMs);

  const threshold =
    options.activeThreshold ??
    (isSailing ? suggestActiveThresholdKn(sport, msToKnots(referenceMs)) : defaultActiveThresholdOf(profile, options.foil ?? false));
  const surfProfile = surfProfileOf(profile);
  if (surfProfile) {
    const foil = options.foil ?? false;
    const { summary } = runSurfSession(track, buildCumulativeTrack(track), surfProfile, {
      threshold, foil, waveThreshold: options.waveThreshold ?? null,
    });
    return {
      track,
      movingTimeS: summary.glisseS,
      movingDistanceM: summary.glisseDistanceM,
      surf: {
        waveCount: summary.waveCount, longestWaveM: summary.longestWaveM,
        longestFlightS: foil ? summary.longestFlightS : null, flightS: foil ? summary.flightS : null,
      },
    };
  }
  const { enter, exit } = getActiveThresholds(profile, threshold);
  const mask = computeActivityMask(track, {
    enterThresholdMs: fromDisplaySpeed(enter, profile.thresholdUnit),
    exitThresholdMs: fromDisplaySpeed(exit, profile.thresholdUnit),
    minStateDurationS: profile.minStateDurationS,
  });
  return { track, movingTimeS: computeActiveTimeMs(track, mask) / 1000, movingDistanceM: computeActiveDistanceM(track, mask), mask };
};

/** Résumé d'une trace, ou `null` si elle a moins de deux points horodatés. */
export const summarizeSession = (
  rawPoints: RawTrackPoint[],
  sport: SportType | null,
  options: SummaryOptions = {}
): SessionSummary | null => {
  const analyzed = analyze(rawPoints, sport, options);
  const { movingTimeS, movingDistanceM } = analyzed;
  if (analyzed.track.length < 2) return null;

  const { cumDist } = buildCumulativeTrack(analyzed.track);
  const track = options.terrainElevation ? applyTerrainElevation(analyzed.track, cumDist, options.terrainElevation).track : analyzed.track;
  const elevationProfile = options.elevation ?? getSportProfile(sport ?? 'running').elevation;
  const elevation = computeElevationStats(track, elevationProfile);
  let maxSpeedMs = 0;
  for (const p of track) if (p.smoothedSpeedMs > maxSpeedMs) maxSpeedMs = p.smoothedSpeedMs;
  const heartRate = summaryHeartRate(track, getSportProfile(sport ?? 'running').heartRate);
  const cadenceParams = sport ? getSportProfile(sport).cadence : null;
  const cadence = cadenceParams ? summaryCadence(track, analyzed.mask ?? track.map(() => true), cadenceParams) : undefined;

  return {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: track[0].timeMs,
    endMs: track[track.length - 1].timeMs,
    distanceM: cumDist[cumDist.length - 1],
    movingTimeS,
    movingDistanceM,
    elevationGainM: elevation.coverage >= MIN_ELEVATION_COVERAGE ? elevation.gainM : null,
    maxSpeedMs,
    pointCount: track.length,
    samplingS: samplingIntervalS(rawPoints),
    ...analyzed.surf,
    ...(heartRate ? { heartRate } : {}),
    ...(cadence ? { cadence } : {}),
  };
};

/** Cadence du résumé, comme l'onglet « cadence » la mesure ; rien sous `minCoverageS`. */
const summaryCadence = (track: TrackPoint[], mask: boolean[], params: CadenceDetection): SummaryCadence | undefined => {
  const cadence = sessionCadence(track, params);
  if (!cadence.present) return undefined;
  const analysis = analyzeCadence(track, cadence.spm, mask, null, params);
  return analysis ? { avgSpm: Math.round(analysis.averageSpm * 10) / 10, steps: Math.round(analysis.steps) } : undefined;
};

/** FC du résumé, comme l'onglet « cardio » la mesure ; rien sous `minCoverageS`. */
const summaryHeartRate = (track: TrackPoint[], params: HeartRateProfile): SummaryHeartRate | undefined => {
  const smoothed = smoothHeartRate(track, params.smoothS, params.gapS);
  const stats = heartRateStats(track, smoothed, params.gapS);
  const histogram = heartRateHistogram(track, smoothed, params.gapS);
  if (!stats || !histogram || stats.coveredS < params.minCoverageS) return undefined;
  return { avgBpm: Math.round(stats.avgBpm), maxBpm: stats.maxBpm, coveredS: Math.round(stats.coveredS), histogram };
};
