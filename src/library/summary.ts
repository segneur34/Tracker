import { roundTo } from '../core/basics';
import { computeElevationStats } from '../core/elevation';
import { heartRateHistogram, heartRateStats, smoothHeartRate, type HeartRatePoint } from '../core/heartRate';
import { activeDurationS, heartRatePointsFrom } from '../core/heartRateSession';
import { computeKinematics } from '../core/kinematics';
import { kinematicsOptionsOf, referenceSpeedMs, samplingIntervalS, scalesFiltersToSession } from '../core/sessionSpeed';
import {
  MIN_ELEVATION_COVERAGE,
  buildCumulativeTrack,
  computeActiveDistanceM,
  computeActiveTimeMs,
  thresholdActivityMask,
} from '../core/sessionStats';
import { computeGrades } from '../land/grade';
import { bestWindowSpeedMs, computeAllTopSegments, computeTopSegments } from '../core/topSegments';
import {
  SAILING_SPORTS,
  UNCLASSIFIED_PROFILE,
  defaultActiveThresholdOf,
  getSportProfile,
  hasActiveThreshold,
  sportTreatment,
  type ElevationProfile,
  type HeartRateProfile,
} from '../core/sportProfiles';
import type { CumulativeTrack, RawTrackPoint, SportType, TimedTrackPoint, TrackPoint } from '../core/types';
import type { BikeType } from '../core/domainTypes';
import { computeCyclingEnergy, cyclingEnergyParams } from '../cycling/energy';
import { applyTerrainElevation, type TerrainSamples } from '../land/terrainElevation';
import { msToKnots } from '../core/units';
import { suggestActiveThresholdKn } from '../sailing/sailingConfig';
import { runSurfSession, surfProfileOf } from '../surfing/surfSession';
import { FITNESS_TESTS, type SessionTest } from '../recording/fitnessTest';
import { fitnessTestResults, summaryOfTest } from '../running/fitnessTestResults';
import { SUMMARY_CALC_VERSION, type SessionSummary, type SummaryBests, type SummaryCadence, type SummaryHeartRate } from './record';
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
 *   la distance en action sont ceux de la glisse, le résumé compte les vagues,
 *   et sa vitesse max est celle d'une vague (Q34), 0 sans vague.
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
  /** Test guidé de la fiche, dont le résumé garde la FC max et le dernier palier tenu. */
  test?: SessionTest;
  /**
   * Vélo (lot 146) : vélo et poids du pratiquant pour la meilleure puissance estimée sur 20 min ; sans poids du
   * pratiquant (`riderKg` `null`), ou absent, elle n'est pas cherchée.
   */
  cyclingPower?: { bikeType: BikeType; bikeKg: number; riderKg: number | null };
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
  return computeKinematics(rawPoints, kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs }));
};

/**
 * Glisses d'une session de surf telles que le module d'analyse les découpe :
 * les vols sur foil, les vagues sinon. L'élagage de ses capteurs les entoure
 * (`surfing/imuPrune.ts`). `null` hors surf.
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
  /** Voile à seuil : temps en mouvement, dénominateur du ratio (`SessionSummary.inMotionS`). */
  inMotionS?: number;
  surf?: Pick<SessionSummary, 'waveCount' | 'longestWaveM' | 'longestFlightS' | 'flightS' | 'maxSpeedMs'>;
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
        maxSpeedMs: summary.maxWaveSpeedMs ?? 0,
      },
    };
  }
  // Seuil à 0 : arrêts complets ôtés d'office (`stillThreshold`) ; bateau : toute la session en navigation,
  // pauses de l'enregistrement et trous immobiles ôtés.
  const mask = thresholdActivityMask(track, profile, threshold);
  // Voile à seuil : le ratio se lit sur le temps en mouvement, comme dans l'analyse (`buildSailingSessionStats`).
  const inMotionS = isSailing && hasActiveThreshold(profile)
    ? computeActiveTimeMs(track, thresholdActivityMask(track, profile, 0)) / 1000
    : undefined;
  return {
    track,
    movingTimeS: computeActiveTimeMs(track, mask) / 1000,
    movingDistanceM: computeActiveDistanceM(track, mask),
    mask,
    ...(inMotionS !== undefined ? { inMotionS } : {}),
  };
};

/** Plus haute vitesse lissée d'une trace, 0 si elle est vide : la vitesse max quand aucune fenêtre ne tient. */
const maxSmoothedSpeedMs = (track: readonly TrackPoint[]): number => {
  let max = 0;
  for (const p of track) if (p.smoothedSpeedMs > max) max = p.smoothedSpeedMs;
  return max;
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

  const cum = buildCumulativeTrack(analyzed.track);
  const { cumDist } = cum;
  const track = options.terrainElevation ? applyTerrainElevation(analyzed.track, cumDist, options.terrainElevation).track : analyzed.track;
  // Sans calcul connu : le profil neutre (valeurs communes, cardio de référence), le même résumé qu'avec la course.
  const profile = sport === null ? UNCLASSIFIED_PROFILE : getSportProfile(sport);
  const elevationProfile = options.elevation ?? profile.elevation;
  const elevation = computeElevationStats(track, elevationProfile);
  // Vitesse max : la meilleure moyenne sur 2 s, comme partout (Q34) ; en surf, celle d'une vague, la même que sa
  // page. Aucune fenêtre ne tient (trace clairsemée, chaque pas plus long que `maxGapS` est un trou, règle 10) :
  // la plus haute vitesse lissée.
  const maxSpeedMs = analyzed.surf?.maxSpeedMs
    ?? bestWindowSpeedMs(analyzed.track, cum, profile.maxSpeedWindowS)
    ?? maxSmoothedSpeedMs(track);
  const heartRate = summaryHeartRate(track, profile.heartRate);
  const cadenceParams = sport ? getSportProfile(sport).cadence : null;
  const cadence = cadenceParams ? summaryCadence(track, analyzed.mask ?? track.map(() => true), cadenceParams) : undefined;
  const test = options.test ? summaryOfTest(fitnessTestResults(track, options.test, FITNESS_TESTS[options.test.protocol])) : null;
  const tops = summaryTops(analyzed.track, cum, sport);
  const bests = sport !== null ? summaryBests(sport, analyzed.track, cum, track, elevation, analyzed.mask, options.cyclingPower) : undefined;

  return {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: track[0].timeMs,
    endMs: track[track.length - 1].timeMs,
    distanceM: cumDist[cumDist.length - 1],
    movingTimeS,
    movingDistanceM,
    ...(analyzed.inMotionS !== undefined ? { inMotionS: analyzed.inMotionS } : {}),
    elevationGainM: elevation.coverage >= MIN_ELEVATION_COVERAGE ? elevation.gainM : null,
    maxSpeedMs,
    pointCount: track.length,
    samplingS: samplingIntervalS(rawPoints),
    ...analyzed.surf,
    ...(heartRate ? { heartRate } : {}),
    ...(cadence ? { cadence } : {}),
    ...(test ? { test } : {}),
    ...tops,
    ...(bests ? { bests } : {}),
  };
};

/** Cibles des meilleurs efforts, par la clé de leur top (`SportProfile.topTargets`). */
const BEST_DISTANCE_KEYS = { d5kmS: 'd5km', d10kmS: 'd10km' } as const;
const BEST_POWER_KEY = 't20min';

/** Meilleure moyenne d'une cible de tops, dans l'unité de `cum` (m/s sur la distance, W sur le travail) ; `null` si aucune fenêtre ne tient. */
const bestOfTarget = (sport: SportType, key: string, track: TrackPoint[], cum: CumulativeTrack): { value: number; rate: number } | null => {
  const target = getSportProfile(sport).topTargets.find((t) => t.key === key);
  if (!target) return null;
  const [top] = computeTopSegments(track, cum, target, (v) => v, { count: 1, decimals: 6 });
  return top?.speed ? { value: target.value, rate: top.speed } : null;
};

/**
 * Meilleurs efforts d'une session à pied ou à vélo (lot 146) : 5 km et 10 km par les tops sur la distance retenue
 * (règle 6, trous de trace écartés) ; à vélo, la meilleure puissance mécanique moyenne sur 20 min, par les mêmes
 * tops sur le travail cumulé du modèle du vélo (`computeCyclingEnergy`, roulement moyen, sans revêtement, pente de
 * l'altitude retenue comme l'analyse, roue libre et arrêts à 0 W). `undefined` hors de ces traitements ou sans rien.
 */
const summaryBests = (
  sport: SportType,
  analysisTrack: TrackPoint[],
  cum: CumulativeTrack,
  track: TrackPoint[],
  elevation: ReturnType<typeof computeElevationStats>,
  mask: boolean[] | undefined,
  power: SummaryOptions['cyclingPower']
): SummaryBests | undefined => {
  const treatment = sportTreatment(sport);
  if (treatment !== 'course' && treatment !== 'velo') return undefined;
  const bests: SummaryBests = {};
  for (const [field, key] of Object.entries(BEST_DISTANCE_KEYS) as [keyof typeof BEST_DISTANCE_KEYS, string][]) {
    const best = bestOfTarget(sport, key, analysisTrack, cum);
    if (best) bests[field] = roundTo(best.value / best.rate, 1);
  }
  if (treatment === 'velo' && power && power.riderKg !== null) {
    bests.powerRiderKg = power.riderKg;
    const profile = getSportProfile(sport);
    const grades = elevation.coverage >= MIN_ELEVATION_COVERAGE ? computeGrades(elevation.smoothed, cum, profile.grade.halfWindowM, track) : [];
    const params = { ...cyclingEnergyParams(power.bikeType, power.bikeKg, power.riderKg), gradeZones: profile.grade };
    const { mechanicalPowerW } = computeCyclingEnergy(track, grades, mask ?? track.map(() => true), params, 0);
    // Travail cumulé : ses meilleures 20 min, sur le temps, sont la meilleure puissance moyenne.
    const cumWork = [0];
    for (let i = 1; i < track.length; i++) {
      const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
      const w = mechanicalPowerW[i];
      cumWork.push(cumWork[i - 1] + (Number.isFinite(w) && dt > 0 ? w * dt : 0));
    }
    const best = bestOfTarget(sport, BEST_POWER_KEY, track, { cumDist: cumWork, cumTime: cum.cumTime });
    if (best) bests.p20minW = Math.round(best.rate);
  }
  return Object.keys(bests).length > 0 ? bests : undefined;
};

/**
 * Meilleur kilomètre en temps (à pied) et meilleures 5 min en vitesse (à vélo)
 * du résumé, les tops de « général » de l'analyse (`computeAllTopSegments`, sur
 * la distance retenue, règle 6), pour l'image de partage (version 17) ; rien
 * ailleurs, ni s'ils ne sont pas atteints.
 */
const summaryTops = (
  track: TrackPoint[],
  cum: ReturnType<typeof buildCumulativeTrack>,
  sport: SportType | null
): Pick<SessionSummary, 'best1kmS' | 'best5minMs'> => {
  const treatment = sport ? sportTreatment(sport) : null;
  const key = treatment === 'course' ? 'd1km' : treatment === 'velo' ? 't5min' : null;
  const target = key && sport ? getSportProfile(sport).topTargets.find((t) => t.key === key) : undefined;
  if (!key || !target) return {};
  const speed = computeAllTopSegments(track, cum, [target], (ms) => ms, { count: 1, decimals: 3 })[key]?.[0]?.speed ?? null;
  if (speed === null || !(speed > 0)) return {};
  return key === 'd1km' ? { best1kmS: target.value / speed } : { best5minMs: speed };
};

/**
 * Résumé d'une session sans trace (muscu, lot I du 25/10), ou `null` à moins
 * de deux points horodatés : ni distance, ni vitesse, ni dénivelé ; la durée
 * hors pauses en temps en action, et la FC comme l'onglet « cardio » la mesure.
 */
export const summarizeHeartRateSession = (timedPoints: readonly TimedTrackPoint[], sport: SportType): SessionSummary | null => {
  const points = heartRatePointsFrom(timedPoints);
  if (points.length < 2) return null;
  const heartRate = summaryHeartRate(points, getSportProfile(sport).heartRate);
  return {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: points[0].timeMs,
    endMs: points[points.length - 1].timeMs,
    distanceM: 0,
    movingTimeS: activeDurationS(points),
    movingDistanceM: null,
    elevationGainM: null,
    maxSpeedMs: 0,
    pointCount: points.length,
    samplingS: samplingIntervalS(timedPoints),
    ...(heartRate ? { heartRate } : {}),
  };
};

/** Cadence du résumé, comme l'onglet « cadence » la mesure ; rien sous `minCoverageS`. */
const summaryCadence = (track: TrackPoint[], mask: boolean[], params: CadenceDetection): SummaryCadence | undefined => {
  const cadence = sessionCadence(track, params);
  if (!cadence.present) return undefined;
  const analysis = analyzeCadence(track, cadence.spm, mask, null, params);
  return analysis ? { avgSpm: roundTo(analysis.averageSpm, 1), steps: Math.round(analysis.steps) } : undefined;
};

/** FC du résumé, comme l'onglet « cardio » la mesure ; rien sous `minCoverageS`. */
const summaryHeartRate = (track: readonly HeartRatePoint[], params: HeartRateProfile): SummaryHeartRate | undefined => {
  const smoothed = smoothHeartRate(track, params.smoothS, params.gapS);
  const stats = heartRateStats(track, smoothed, params.gapS);
  const histogram = heartRateHistogram(track, smoothed, params.gapS);
  if (!stats || !histogram || stats.coveredS < params.minCoverageS) return undefined;
  return { avgBpm: Math.round(stats.avgBpm), maxBpm: stats.maxBpm, coveredS: Math.round(stats.coveredS), histogram };
};
