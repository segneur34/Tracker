import { normalizeDeg } from '../core/angles';
import type { FlightSpan } from '../core/pumping';
import { buildCumulativeTrack } from '../core/sessionStats';
import type { SpeedRangeMs } from '../core/speedGradient';
import { getSportProfile, hasActiveThreshold, type SportProfile } from '../core/sportProfiles';
import type { CumulativeTrack, SportType, TrackPoint } from '../core/types';
import { msToKnots } from '../core/units';
import {
  WIND_LOCAL_MAX_GAP_MIN,
  classifyManeuvers,
  estimateWind,
  prepareManeuverDetection,
  windSamplesFrom,
  type ManeuverDetection,
  type ManeuverStats,
} from './maneuvers';
import { trackToPointData, type PointData } from './pointData';
import {
  calculateVmgStats,
  calculateWindStats,
  summarizeManeuvers,
  vmgManeuverSpans,
  vmgSeries,
  withWindAt,
  withoutWindAt,
  type ManeuverSummary,
  type VmgStats,
  type WindStats,
  type WindStatsData,
} from './sailingAnalytics';
import {
  resolveSailingThresholds,
  sessionManeuverThresholds,
  suggestSpeedRangeMs,
  type SailingThresholds,
} from './sailingConfig';
import { buildSailingSessionStats, computeSailingTops, sailingActivityMask, sailingFlights, sailingRatioMask } from './sailingStats';
import type { SessionStats } from './types';
import { buildWindTimeline, polarExcludedPoints, prepareWindPolar, speedPolar, type PolarBin, type PolarManeuver, type WindEstimate, type WindPolarStage } from './wind';

/**
 * Analyse d'une session à voile, hors React : la chaîne de `useSailingSession`
 * (seuils, statistiques, vols, vent, manœuvres, VMG, polaire), en fonction
 * pure. Le hook l'appelle par ses trois étapes, chacune sous son `useMemo`,
 * pour que bouger le seuil ne refasse pas ce qui n'en dépend pas, et changer
 * le vent saisi ne refasse ni les statistiques ni l'estimation :
 *
 * 1. `prepareSailingTrack` : ce qui ne dépend que de la trace et de son allure
 *    (vue en nœuds, tops, masque du ratio, bornes de couleur suggérées, seuils
 *    de manœuvre accordés à l'allure, détection des virages, étage polaire du
 *    vent) ;
 * 2. `analyzeSailingAtThreshold` : ce qui dépend du seuil d'activité (masque
 *    d'activité, statistiques, vols, estimation du vent) ;
 * 3. `analyzeSailingWind` : ce qui dépend du vent retenu et du seuil
 *    (manœuvres en deux passes, résumé, variations du vent, VMG) ; et à part,
 *    `sailingPolarGraph`, la polaire, qui ne dépend que du vent retenu : le
 *    seuil qui bouge ne la refait pas.
 *
 * `analyzeSailingSession` enchaîne les trois, après avoir résolu les seuils
 * (`resolveSailingThresholds`). La lecture de la fiche (seuil de l'activité
 * qu'elle porte, `library/`) reste au hook, qui passe un seuil déjà résolu.
 *
 * Depuis le lot 235, le calcul en arrière-plan les enchaîne par
 * `runSailingAnalysis` (`library/analysisStore.ts`), chaque étape gardée à
 * part ; il rend à la page `sailingAnalysisResult`, qu'elle relit par
 * `sailingAnalysisShown`.
 */

/** Ce dont dépend la préparation d'une trace : son calcul et son allure. */
export interface SailingTrackInput {
  sport: SportType;
  /** Profil du calcul ; celui de `sport` par défaut. */
  profile?: SportProfile;
  /** Allure de la session, en m/s (`core/sessionSpeed.ts`), déduite ou imposée. */
  referenceSpeedMs: number;
  /** Distance et temps cumulés de la trace ; `buildCumulativeTrack` par défaut. */
  cumulative?: CumulativeTrack;
}

export interface PreparedSailingTrack {
  /** Trace en unités SI, après `computeKinematics`. */
  track: TrackPoint[];
  cumulative: CumulativeTrack;
  sport: SportType;
  profile: SportProfile;
  /** Allure de la session, en nœuds. */
  referenceSpeedKn: number;
  /** Vue en nœuds de la trace, attendue par les analyses voile (règle 5). */
  trackData: PointData[];
  tops: SessionStats['tops'];
  /** Masque du dénominateur du ratio de vol ; aucun en bateau. */
  ratioMask: boolean[] | undefined;
  /** Bornes de couleur suggérées à partir de l'allure de la session et du pic de vitesse. */
  suggestedSpeedRangeMs: SpeedRangeMs;
  /** Seuils de manœuvre accordés à l'allure de la session (règle 4). */
  maneuverThresholds: { minEntrySpeedKn: number; polarMinSpeedKn: number };
  /** Détection des virages, une fois par trace ; `null` sur une trace vide. */
  detection: ManeuverDetection | null;
  /** Étage polaire du vent, une fois par trace ; `null` sur une trace vide. */
  polarStage: WindPolarStage | null;
}

/**
 * Étape 1 : ce qui ne dépend pas du seuil d'activité. Une vitesse d'entrée de
 * 4 nœuds est une valeur de wingfoil : sur une session de planche qui navigue
 * à 4,4 nœuds, elle écarterait tous les demi-tours, d'où les seuils de
 * manœuvre accordés à l'allure. Les virages qui orientent l'axe du vent sont
 * lus à la vitesse d'entrée de la détection (HISTORIQUE, point 267).
 */
export const prepareSailingTrack = (track: TrackPoint[], input: SailingTrackInput): PreparedSailingTrack => {
  const { sport } = input;
  const profile = input.profile ?? getSportProfile(sport);
  const cumulative = input.cumulative ?? buildCumulativeTrack(track);
  const referenceSpeedKn = msToKnots(input.referenceSpeedMs);
  const trackData = trackToPointData(track);
  const maneuverThresholds = sessionManeuverThresholds(sport, referenceSpeedKn);
  const { minEntrySpeedKn, polarMinSpeedKn } = maneuverThresholds;
  /** Plancher d'arrêt du support : un cap lu plus lentement n'est que du bruit. */
  const stillSpeedKn = profile.stillThreshold;
  return {
    track,
    cumulative,
    sport,
    profile,
    referenceSpeedKn,
    trackData,
    tops: computeSailingTops(track, cumulative),
    ratioMask: sailingRatioMask(track, sport),
    suggestedSpeedRangeMs: suggestSpeedRangeMs(sport, referenceSpeedKn, track, cumulative),
    maneuverThresholds,
    detection: trackData.length > 0 ? prepareManeuverDetection(trackData, { minEntrySpeedKn, stillSpeedKn }) : null,
    polarStage: trackData.length > 0 ? prepareWindPolar(trackData, polarMinSpeedKn, minEntrySpeedKn) : null,
  };
};

export interface SailingThresholdAnalysis {
  /** Seuil d'activité des calculs, en nœuds. */
  computeThresholdKn: number;
  /** Seuil de vol des manœuvres : le même, `undefined` sans seuil (bateau). */
  flightThresholdKn: number | undefined;
  activityMask: boolean[];
  /** `null` sur une trace vide. */
  stats: SessionStats | null;
  /** Vols au seuil d'activité (pumping sur foil) ; vide si le calcul ne mesure pas le pumping. */
  flights: FlightSpan[];
  /** `null` sur une trace vide. */
  windEstimate: WindEstimate | null;
}

/**
 * Étape 2 : ce qui dépend du seuil d'activité. Le seuil reclasse les
 * manœuvres candidates du vent : c'est le prix d'une seule notion de
 * « réussite » dans toute l'application, la même pour l'estimation que pour
 * les manœuvres affichées.
 */
export const analyzeSailingAtThreshold = (prepared: PreparedSailingTrack, computeThresholdKn: number): SailingThresholdAnalysis => {
  const { track, cumulative, sport, profile, tops, ratioMask, trackData, detection, polarStage, maneuverThresholds } = prepared;
  const flightThresholdKn = hasActiveThreshold(profile) ? computeThresholdKn : undefined;
  const activityMask = sailingActivityMask(track, sport, computeThresholdKn);
  const stats = buildSailingSessionStats(track, { sport, activeThresholdKn: computeThresholdKn, cumulative, tops, activityMask, ratioMask });
  const minFlightS = profile.pump?.minFlightS ?? null;
  const flights = minFlightS === null ? [] : sailingFlights(track, cumulative, sport, activityMask, minFlightS);
  const windEstimate =
    detection && polarStage
      ? estimateWind(trackData, {
          minSpeedKn: maneuverThresholds.polarMinSpeedKn,
          successThresholdKn: computeThresholdKn,
          minEntrySpeedKn: maneuverThresholds.minEntrySpeedKn,
          flightThresholdKn,
          stillSpeedKn: profile.stillThreshold,
          detection,
          polarStage,
        })
      : null;
  return { computeThresholdKn, flightThresholdKn, activityMask, stats, flights, windEstimate };
};

export interface SailingWindAnalysis {
  /** Direction estimée, fiable ou non ; `null` sur une trace vide. */
  autoWind: number | null;
  /** Vent global retenu : saisi, sinon l'estimation fiable, sinon `null`. */
  currentWindValue: number | null;
  /** Vrai quand l'utilisateur doit saisir le vent pour débloquer les analyses. */
  windInputRequired: boolean;
  maneuverStats: ManeuverStats | null;
  maneuverSummary: ManeuverSummary;
  windStats: WindStats | null;
  vmgStats: VmgStats | null;
  /** Courbe de la VMG, en nœuds par point de la trace (`vmgSeries` de `sailingAnalytics`) ; vide sans vent. */
  vmgSeries: (number | null)[];
}

/**
 * Vent global retenu : le vent saisi s'il y en a un (ramené dans [0 ; 360[),
 * sinon l'estimation si elle est fiable, sinon `null`. La page le lit aussi
 * pour montrer le vent tout de suite (`useSailingSession`, `shownWind`), sans
 * attendre le calcul en arrière-plan : un vent saisi ne dépend pas de
 * l'analyse, et l'estimation ne dépend que du seuil.
 */
export const retainedWind = (
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null,
  windEstimate: WindEstimate | null
): number | null => (windDeg === null ? null : normalizeDeg(windDeg)) ?? (windEstimate && windEstimate.reliable ? windEstimate.direction : null);

/**
 * Étape 3 : ce qui dépend du vent retenu. Sans vent saisi ni estimation
 * fiable, les analyses qui en dépendent sont suspendues plutôt que calculées
 * sur une direction fausse.
 */
export const analyzeSailingWind = (
  prepared: PreparedSailingTrack,
  atThreshold: SailingThresholdAnalysis,
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null
): SailingWindAnalysis => {
  const { trackData, detection } = prepared;
  const { windEstimate, computeThresholdKn, flightThresholdKn } = atThreshold;
  const currentWindValue = retainedWind(windDeg, windEstimate);

  let maneuverStats: ManeuverStats | null = null;
  if (detection && currentWindValue !== null) {
    const options = { successThresholdKn: computeThresholdKn, flightThresholdKn };
    // Deux passes : la première classe avec le vent global, la seconde avec
    // le vent local interpolé entre les manœuvres de la première, pour rester
    // juste quand le vent a tourné au cours de la session.
    const firstPass = classifyManeuvers(detection, currentWindValue, options);
    const timeline = buildWindTimeline(
      windSamplesFrom(firstPass).map((m) => ({ timeMs: m.timeMs, direction: m.localWind })),
      currentWindValue,
      WIND_LOCAL_MAX_GAP_MIN * 60 * 1000
    );
    maneuverStats = classifyManeuvers(detection, timeline, options);
  }

  // Variations du vent, mesurées aux manœuvres : la source retenue, la plus juste pour les angles.
  const windStats = calculateWindStats(trackData, maneuverStats, currentWindValue);
  // Vent de référence de la VMG : le vent local interpolé entre manœuvres quand il existe, le vent global sinon.
  const windAt =
    currentWindValue === null ? null : windStats ? (timeMs: number) => windStats.windAt(timeMs) ?? currentWindValue : currentWindValue;
  // Les manœuvres, tous types confondus, sont écartées des chiffres et de la courbe de la VMG.
  const maneuvers = vmgManeuverSpans(maneuverStats?.locations ?? []);

  return {
    autoWind: windEstimate?.direction ?? null,
    currentWindValue,
    windInputRequired: trackData.length > 0 && currentWindValue === null,
    maneuverStats,
    maneuverSummary: summarizeManeuvers(maneuverStats),
    windStats,
    vmgStats: calculateVmgStats(trackData, windAt, computeThresholdKn, undefined, undefined, maneuvers),
    vmgSeries: vmgSeries(trackData, windAt, computeThresholdKn, maneuvers),
  };
};

/**
 * Polaire des vitesses par angle au vent retenu, vide sans vent. Au seuil
 * accordé à l'allure de la session (règle 4), le même que celui de
 * l'estimation du vent : sur une trace lente, le seuil fixe du profil laissait
 * le radar presque vide. Le seuil d'activité ne la touche que par les manœuvres
 * classées, dont les virements éclairs sont écartés (`polarExcludedPoints`).
 */
export const sailingPolarGraph = (
  prepared: PreparedSailingTrack,
  currentWindValue: number | null,
  maneuvers: readonly PolarManeuver[] = []
): PolarBin[] =>
  prepared.trackData.length > 0 && currentWindValue !== null
    ? speedPolar(prepared.trackData, currentWindValue, prepared.maneuverThresholds.polarMinSpeedKn, polarExcludedPoints(prepared.trackData, maneuvers, currentWindValue))
    : [];

/** Réglages d'une analyse de session à voile, seuils déjà lus (fiche, appareil) par l'appelant. */
export interface SailingSessionSettings extends SailingTrackInput {
  /** Seuil de l'activité (porté par la fiche, sinon réglé sur l'appareil), en nœuds ; `null` : la suggestion. */
  activityThresholdKn: number | null;
  /** Seuil propre de la session, en nœuds ; `null` : celui de l'activité. */
  sessionThresholdKn: number | null;
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null;
  /**
   * Seuil des calculs, en nœuds, quand il diffère du seuil effectif : celui du
   * champ, différé dans le hook (HISTORIQUE, point 220). Par défaut, `thresholds.activeKn`.
   */
  computeThresholdKn?: number;
}

export type SailingSessionAnalysis = PreparedSailingTrack &
  SailingThresholdAnalysis &
  SailingWindAnalysis & {
    polarGraphData: PolarBin[];
    /** Seuils de la session (`resolveSailingThresholds`) : session, puis activité, puis suggestion ; fixe en bateau. */
    thresholds: SailingThresholds;
  };

/** Seuils d'une session de voile, à partir de ses réglages et de son allure. */
export const sailingSessionThresholds = (settings: SailingSessionSettings): SailingThresholds =>
  resolveSailingThresholds(
    settings.profile ?? getSportProfile(settings.sport),
    settings.activityThresholdKn,
    settings.sessionThresholdKn,
    msToKnots(settings.referenceSpeedMs)
  );

/** Analyse complète d'une session à voile : les trois étapes et la polaire enchaînées, au seuil résolu. */
export const analyzeSailingSession = (track: TrackPoint[], settings: SailingSessionSettings): SailingSessionAnalysis => {
  const thresholds = sailingSessionThresholds(settings);
  const prepared = prepareSailingTrack(track, settings);
  const atThreshold = analyzeSailingAtThreshold(prepared, settings.computeThresholdKn ?? thresholds.activeKn);
  const wind = analyzeSailingWind(prepared, atThreshold, settings.windDeg);
  return { ...prepared, ...atThreshold, ...wind, polarGraphData: sailingPolarGraph(prepared, wind.currentWindValue, wind.maneuverStats?.locations), thresholds };
};

/** Les étapes d'une analyse de session à voile, dans l'ordre où elles s'enchaînent. */
export interface SailingAnalysisStages {
  prepared: PreparedSailingTrack;
  atThreshold: SailingThresholdAnalysis;
  wind: SailingWindAnalysis;
  /** Polaire au vent retenu (`sailingPolarGraph`), refaite avec le vent. */
  polarGraphData: PolarBin[];
}

/**
 * Analyse d'une session à voile, étapes enchaînées comme `analyzeSailingSession`
 * et le hook avant le lot 235 : mêmes fonctions, mêmes arguments, au seuil des
 * calculs déjà résolu (règle 4 : la mise à l'échelle du seuil reste à
 * l'appelant). Une étape donnée dans `reuse` est reprise telle quelle : c'est à
 * l'appelant de ne la donner que si ses entrées n'ont pas changé, avec les
 * étapes dont elle découle (l'étape au seuil avec sa préparation, le vent et la
 * polaire avec les deux).
 */
export const runSailingAnalysis = (
  track: TrackPoint[],
  input: SailingTrackInput,
  computeThresholdKn: number,
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null,
  reuse: Partial<SailingAnalysisStages> = {}
): SailingAnalysisStages => {
  const prepared = reuse.prepared ?? prepareSailingTrack(track, input);
  const atThreshold = reuse.atThreshold ?? analyzeSailingAtThreshold(prepared, computeThresholdKn);
  const wind = reuse.wind ?? analyzeSailingWind(prepared, atThreshold, windDeg);
  const polarGraphData = reuse.polarGraphData ?? sailingPolarGraph(prepared, wind.currentWindValue, wind.maneuverStats?.locations);
  return { prepared, atThreshold, wind, polarGraphData };
};

/**
 * Ce qu'une analyse de session à voile rend à la page (lot 235) : sans
 * fonction, et sans grand tableau par point qu'elle a déjà ou ne lit pas.
 * Restent dans le calcul : la trace (la page l'a reçue de `prepare`), sa vue
 * en nœuds (`trackToPointData`, refaite par la page), les tops à part (ils
 * sont dans les statistiques), les masques d'activité et du ratio, la
 * détection des virages et l'étage polaire du vent, qui portent des
 * fonctions. Les variations du vent viennent sans leur `windAt`, et le résumé
 * des manœuvres n'en vient pas : la page les rebâtit (`sailingAnalysisShown`).
 */
export interface SailingAnalysisResult {
  /** Bornes de couleur suggérées à partir de l'allure de la session et du pic de vitesse. */
  suggestedSpeedRangeMs: SpeedRangeMs;
  /** Seuils de manœuvre accordés à l'allure de la session (règle 4). */
  maneuverThresholds: { minEntrySpeedKn: number; polarMinSpeedKn: number };
  computeThresholdKn: number;
  flightThresholdKn: number | undefined;
  stats: SessionStats | null;
  flights: FlightSpan[];
  windEstimate: WindEstimate | null;
  autoWind: number | null;
  currentWindValue: number | null;
  windInputRequired: boolean;
  maneuverStats: ManeuverStats | null;
  windStats: WindStatsData | null;
  vmgStats: VmgStats | null;
  vmgSeries: (number | null)[];
  polarGraphData: PolarBin[];
}

/** Ce qui, des étapes d'une analyse, revient à la page (`SailingAnalysisResult`) : les mêmes objets, rien de recalculé. */
export const sailingAnalysisResult = ({ prepared, atThreshold, wind, polarGraphData }: SailingAnalysisStages): SailingAnalysisResult => ({
  suggestedSpeedRangeMs: prepared.suggestedSpeedRangeMs,
  maneuverThresholds: prepared.maneuverThresholds,
  computeThresholdKn: atThreshold.computeThresholdKn,
  flightThresholdKn: atThreshold.flightThresholdKn,
  stats: atThreshold.stats,
  flights: atThreshold.flights,
  windEstimate: atThreshold.windEstimate,
  autoWind: wind.autoWind,
  currentWindValue: wind.currentWindValue,
  windInputRequired: wind.windInputRequired,
  maneuverStats: wind.maneuverStats,
  windStats: wind.windStats ? withoutWindAt(wind.windStats) : null,
  vmgStats: wind.vmgStats,
  vmgSeries: wind.vmgSeries,
  polarGraphData,
});

/** L'analyse telle que la page la lit : le résultat du calcul, avec ce qui en a été ôté rebâti. */
export type SailingAnalysisShown = Omit<SailingAnalysisResult, 'windStats'> & {
  windStats: WindStats | null;
  maneuverSummary: ManeuverSummary;
};

/**
 * Rebâtit, côté page, ce que le calcul en arrière-plan n'a pas rendu : la
 * fonction du vent (`withWindAt`) et le résumé des manœuvres
 * (`summarizeManeuvers` sur les manœuvres rendues). Mêmes fonctions et mêmes
 * entrées que la chaîne en ligne : mêmes valeurs.
 */
export const sailingAnalysisShown = (result: SailingAnalysisResult): SailingAnalysisShown => ({
  ...result,
  windStats: result.windStats ? withWindAt(result.windStats) : null,
  maneuverSummary: summarizeManeuvers(result.maneuverStats),
});
