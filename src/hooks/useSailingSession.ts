import { normalizeDeg } from '../core/angles';
import { useDeferredValue, useMemo } from 'react';
import { msToKnots } from '../core/units';
import {
  resolveSailingThresholds,
  sessionManeuverThresholds,
  suggestSpeedRangeMs,
} from '../sailing/sailingConfig';
import {
  WIND_LOCAL_MAX_GAP_MIN,
  classifyManeuvers,
  estimateWind,
  prepareManeuverDetection,
  windSamplesFrom,
} from '../sailing/maneuvers';
import { buildWindTimeline, prepareWindPolar, speedPolar } from '../sailing/wind';
import { calculateVmgStats, calculateWindStats, summarizeManeuvers } from '../sailing/sailingAnalytics';
import { buildSailingSessionStats, computeSailingTops, sailingActivityMask, sailingFlights, sailingRatioMask } from '../sailing/sailingStats';
import { trackToPointData } from '../sailing/pointData';
import { useGpxSession } from './useGpxSession';
import type { useSportSettings } from './useSportSettings';

/**
 * Orchestration d'une session à voile : ingestion générique d'un côté,
 * analyses vent, manœuvres et VMG de l'autre.
 *
 * Chaîne du vent : estimation automatique avec indice de confiance, ou saisie
 * manuelle. Si l'estimation n'est pas fiable et qu'aucune valeur n'a été
 * saisie, les analyses qui dépendent du vent sont suspendues plutôt que
 * calculées sur une direction fausse.
 *
 * Le seuil d'activité est propagé à tous les calculs qui en dépendent, et une
 * modification du seuil recalcule les statistiques sans relire le fichier :
 * seulement ce qui dépend du seuil (masque d'activité, classement des
 * manœuvres), la polaire, la détection des virages et le masque du ratio étant
 * préparés une fois par trace. Ces calculs suivent le seuil avec un très léger
 * retard (`useDeferredValue`) : le champ du seuil reste fluide, les chiffres le
 * rejoignent juste après, sur la même valeur.
 *
 * Le vent saisi, le seuil et l'allure propres à la session viennent du
 * module (son brouillon, `useSessionDraft`), qui les garde dans la fiche de
 * la session ; les réglages de l'activité aussi (`useSportSettings('voile')`,
 * lu une seule fois, par le module).
 */
export interface SailingSessionInput {
  /** Réglages de l'activité de voile, lus par le module. */
  settings: ReturnType<typeof useSportSettings>;
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null;
  /** Seuil d'activité de la session, en nœuds ; `null` : celui du support, ou la suggestion. */
  activeThresholdKn: number | null;
  /** Allure de la session imposée, en m/s ; `null` : déduite de la trace. */
  referenceSpeedMs: number | null;
}

export const useSailingSession = ({
  settings,
  windDeg,
  activeThresholdKn: sessionThresholdKn,
  referenceSpeedMs: sessionReferenceMs,
}: SailingSessionInput) => {
  const {
    sport,
    profile,
    activeThreshold: rawActiveThresholdKn,
    isThresholdOverridden,
    speedRange,
    speedUnit,
    distanceUnit,
    foil: activityFoil,
    pumping: activityPumping,
    gearGroups,
  } = settings;

  // Les seuils de filtrage suivent l'allure de la session, pas seulement le
  // support : sur une trace lente, l'accélération et le plafond du wingfoil
  // laissent passer des pics d'enregistrement qui fabriquent des manœuvres.
  const gpx = useGpxSession({ profile, referenceSpeedOverrideMs: sessionReferenceMs ?? undefined });

  // Vue en nœuds de la trace, attendue par les analyses voile.
  const trackData = useMemo(() => trackToPointData(gpx.track), [gpx.track]);

  const referenceSpeedKn = msToKnots(gpx.referenceSpeedMs);
  const { cumulative } = gpx;

  /**
   * Seuil d'activité effectif : celui de la session, sinon celui de l'activité
   * (réglé ou pré-réglé), sinon la suggestion selon l'allure ; le bateau, sans
   * seuil, garde son seuil fixe de réussite (`resolveSailingThresholds`).
   */
  const thresholds = resolveSailingThresholds(profile, isThresholdOverridden ? rawActiveThresholdKn : null, sessionThresholdKn, referenceSpeedKn);
  const { withThreshold, defaultKn: defaultActiveThresholdKn, activeKn: activeThresholdKn } = thresholds;
  /**
   * Seuil des calculs : celui du champ, différé (Q40). Le champ et ses libellés
   * lisent `activeThresholdKn`, immédiat ; le seuil de vol le suit comme dans
   * `resolveSailingThresholds`. Pas de retard quand la trace change avec lui
   * (autre session, autre support) : la nouvelle trace serait sinon calculée une
   * première fois au seuil de l'ancienne.
   */
  const deferredThresholdKn = useDeferredValue(activeThresholdKn);
  const deferredTrackData = useDeferredValue(trackData);
  const computeThresholdKn = deferredTrackData === trackData ? deferredThresholdKn : activeThresholdKn;
  const flightThresholdKn = withThreshold ? computeThresholdKn : undefined;

  const suggestedSpeedRangeMs = useMemo(
    () => suggestSpeedRangeMs(sport, referenceSpeedKn, gpx.track, cumulative),
    [sport, referenceSpeedKn, gpx.track, cumulative]
  );

  // Les tops ne dépendent que de la trace : calculés une fois, pas à chaque mouvement du seuil.
  const tops = useMemo(() => computeSailingTops(gpx.track, cumulative), [gpx.track, cumulative]);
  // Le masque du ratio non plus ; celui d'activité, au seuil, sert aux statistiques et aux vols.
  const ratioMask = useMemo(() => sailingRatioMask(gpx.track, sport), [gpx.track, sport]);
  const activityMask = useMemo(
    () => sailingActivityMask(gpx.track, sport, computeThresholdKn),
    [gpx.track, sport, computeThresholdKn]
  );
  const stats = useMemo(
    () => buildSailingSessionStats(gpx.track, { sport, activeThresholdKn: computeThresholdKn, cumulative, tops, activityMask, ratioMask }),
    [gpx.track, sport, computeThresholdKn, cumulative, tops, activityMask, ratioMask]
  );
  /** Vols, pour le pumping sur foil (lot 22) : suites au-dessus du seuil d'activité, les plus courtes non listées. */
  const minFlightS = profile.pump?.minFlightS ?? null;
  const flights = useMemo(
    () => (minFlightS === null ? [] : sailingFlights(gpx.track, cumulative, sport, activityMask, minFlightS)),
    [gpx.track, cumulative, sport, activityMask, minFlightS]
  );

  /**
   * Seuils de manœuvre accordés à l'allure de la session. Une vitesse d'entrée
   * de 4 nœuds est une valeur de wingfoil : sur une session de planche qui
   * navigue à 4,4 nœuds, elle écarte tous les demi-tours.
   */
  const maneuverThresholds = useMemo(
    () => sessionManeuverThresholds(sport, referenceSpeedKn),
    [sport, referenceSpeedKn]
  );
  /** Plancher d'arrêt du support : un cap lu plus lentement n'est que du bruit. */
  const stillSpeedKn = profile.stillThreshold;
  const minEntrySpeedKn = maneuverThresholds.minEntrySpeedKn;

  /**
   * Détection des virages, préparée une fois par trace et par seuils de
   * détection : l'estimation du vent (ses candidats et ses deux passes) et les
   * deux passes des manœuvres affichées la classent sans la refaire. Bouger le
   * seuil d'activité ne refait donc plus le balayage de la trace.
   */
  const detection = useMemo(
    () => (trackData.length > 0 ? prepareManeuverDetection(trackData, { minEntrySpeedKn, stillSpeedKn }) : null),
    [trackData, minEntrySpeedKn, stillSpeedKn]
  );

  /**
   * Étage polaire du vent (polaire, candidats, orientation par les virages,
   * soutien de la trace), préparé une fois par trace : il ne dépend pas du
   * seuil d'activité.
   */
  const polarMinSpeedKn = maneuverThresholds.polarMinSpeedKn;
  const polarStage = useMemo(
    () => (trackData.length > 0 ? prepareWindPolar(trackData, polarMinSpeedKn) : null),
    [trackData, polarMinSpeedKn]
  );

  // Les seuils viennent du profil du support et de la surcharge de
  // l'utilisateur : changer de support, ou bouger le seuil d'activité,
  // reclasse les manœuvres candidates du vent. C'est le prix d'une seule
  // notion de « réussite » dans toute l'application, la même ici que pour les
  // manœuvres affichées.
  const windEstimate = useMemo(
    () =>
      detection && polarStage
        ? estimateWind(trackData, {
            minSpeedKn: polarMinSpeedKn,
            successThresholdKn: computeThresholdKn,
            minEntrySpeedKn,
            flightThresholdKn,
            stillSpeedKn,
            detection,
            polarStage,
          })
        : null,
    [trackData, detection, polarStage, polarMinSpeedKn, computeThresholdKn, minEntrySpeedKn, flightThresholdKn, stillSpeedKn]
  );
  const autoWind = windEstimate?.direction ?? null;

  const manualWindValue = windDeg === null ? null : normalizeDeg(windDeg);

  /** Vent global retenu, ou `null` si rien de fiable n'est disponible. */
  const currentWindValue = useMemo<number | null>(() => {
    if (manualWindValue !== null) return manualWindValue;
    if (windEstimate && windEstimate.reliable) return windEstimate.direction;
    return null;
  }, [manualWindValue, windEstimate]);

  /** Vrai quand l'utilisateur doit saisir le vent pour débloquer les analyses. */
  const windInputRequired = trackData.length > 0 && currentWindValue === null;

  const maneuverStats = useMemo(() => {
    if (!detection || currentWindValue === null) return null;
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
    return classifyManeuvers(detection, timeline, options);
  }, [detection, currentWindValue, computeThresholdKn, flightThresholdKn]);

  const maneuverSummary = useMemo(() => summarizeManeuvers(maneuverStats), [maneuverStats]);

  // Variations du vent, mesurées aux manœuvres : c'est la source retenue,
  // la plus juste pour les angles.
  const windStats = useMemo(() => {
    return calculateWindStats(trackData, maneuverStats, currentWindValue);
  }, [trackData, maneuverStats, currentWindValue]);

  // Vent de référence de la VMG : le vent local interpolé entre manœuvres
  // quand il existe, le vent global sinon.
  const windAt = useMemo(() => {
    if (currentWindValue === null) return null;
    const fallback = currentWindValue;
    if (!windStats) return fallback;
    return (timeMs: number) => windStats.windAt(timeMs) ?? fallback;
  }, [windStats, currentWindValue]);

  const vmgStats = useMemo(() => {
    return calculateVmgStats(trackData, windAt, computeThresholdKn);
  }, [trackData, windAt, computeThresholdKn]);

  // Polaire au seuil accordé à l'allure de la session (règle 4), le même que
  // celui de l'estimation du vent : sur une trace lente, le seuil fixe du
  // profil laissait le radar presque vide.
  const polarGraphData = useMemo(
    () => (trackData.length > 0 && currentWindValue !== null ? speedPolar(trackData, currentWindValue, polarMinSpeedKn) : []),
    [trackData, currentWindValue, polarMinSpeedKn]
  );

  return {
    trackData,
    /** Trace en unités SI, pour les calculs du noyau (sauts). */
    track: gpx.track,
    /** Distance et temps cumulés le long de la trace, calculés une fois pour le hook et le module. */
    cumulative,
    stats,
    /** Vols de la session au seuil d'activité (pumping sur foil) ; vide si le calcul ne mesure pas le pumping. */
    flights,
    currentWindValue,
    autoWind,
    windEstimate,
    windInputRequired,
    loadGpxContent: gpx.loadGpxContent,
    fileName: gpx.fileName,
    sessionKey: gpx.sessionKey,
    hasDeviceSpeed: gpx.hasDeviceSpeed,
    loadError: gpx.error,
    maneuverStats,
    maneuverSummary,
    vmgStats,
    windStats,
    polarGraphData,
    // Réglages de l'activité
    sport,
    profile,
    /** Support sur foil de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
    activityFoil,
    /** Pumping de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
    activityPumping,
    /** Matériel enregistré de l'activité, choisi par groupe dans « matos et conditions » ; `null` : option coupée. */
    gearGroups,
    /** Unités d'affichage, choisies dans Réglages pour l'activité. */
    speedUnit,
    distanceUnit,
    activeThresholdKn,
    /** Vrai tant que les chiffres n'ont pas rejoint le seuil du champ (Q40) : rien n'en est recopié dans la fiche entre-temps. */
    thresholdPending: computeThresholdKn !== activeThresholdKn,
    /** Seuil d'activité réglable : faux en bateau, où toute la session compte en navigation. */
    hasActiveThreshold: withThreshold,
    /** Seuil hors réglage de la session : celui du support s'il est surchargé, sinon la suggestion. */
    defaultActiveThresholdKn,
    /** Bornes du dégradé réglées pour le support dans Réglages, ou `null` pour la suggestion accordée à la session. */
    speedRange,
    /** Bornes de couleur suggérées à partir de l'allure de la session et du pic de vitesse sur 2 s. */
    suggestedSpeedRangeMs,
    /** Allure de la session, en m/s : déduite de la trace, ou imposée. */
    referenceSpeedMs: gpx.referenceSpeedMs,
    /** Intervalle médian entre deux points, en secondes. */
    samplingS: gpx.samplingS,
    /** Seuils de manœuvre effectivement retenus, accordés à l'allure de la session. */
    maneuverThresholds,
    /** Nombre de points du fichier, avant tout filtrage. */
    pointCount: gpx.rawPoints.length,
  };
};
