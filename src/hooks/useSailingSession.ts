import { useMemo } from 'react';
import { buildCumulativeTrack } from '../core/sessionStats';
import { hasActiveThreshold } from '../core/sportProfiles';
import { msToKnots } from '../core/units';
import {
  sessionManeuverThresholds,
  suggestActiveThresholdKn,
  suggestSpeedRangeMs,
} from '../sailing/sailingConfig';
import { WIND_LOCAL_MAX_GAP_MIN, analyzeManeuvers, estimateWind, windSamplesFrom } from '../sailing/maneuvers';
import { buildWindTimeline, normalizeAngle, speedPolar } from '../sailing/wind';
import { calculateVmgStats, calculateWindStats, summarizeManeuvers } from '../sailing/sailingAnalytics';
import { buildSailingSessionStats, computeSailingTops } from '../sailing/sailingStats';
import { trackToPointData } from '../utils/kinematics';
import { useGpxSession } from './useGpxSession';
import { useSportSettings } from './useSportSettings';

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
 * modification du seuil recalcule les statistiques sans relire le fichier.
 *
 * Le vent saisi, le seuil et l'allure propres à la session viennent du
 * module (son brouillon, `useSessionDraft`), qui les garde dans la fiche de
 * la session.
 */
export interface SailingSessionInput {
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null;
  /** Seuil d'activité de la session, en nœuds ; `null` : celui du support, ou la suggestion. */
  activeThresholdKn: number | null;
  /** Allure de la session imposée, en m/s ; `null` : déduite de la trace. */
  referenceSpeedMs: number | null;
}

export const useSailingSession = ({
  windDeg,
  activeThresholdKn: sessionThresholdKn,
  referenceSpeedMs: sessionReferenceMs,
}: SailingSessionInput) => {
  const {
    activity,
    activityOptions,
    setActivity,
    sport,
    profile,
    activeThreshold: rawActiveThresholdKn,
    isThresholdOverridden,
    speedRange,
    speedUnit,
    distanceUnit,
    foil: activityFoil,
    gearGroups,
  } = useSportSettings('voile');

  // Les seuils de filtrage suivent l'allure de la session, pas seulement le
  // support : sur une trace lente, l'accélération et le plafond du wingfoil
  // laissent passer des pics d'enregistrement qui fabriquent des manœuvres.
  const gpx = useGpxSession({
    medianWindowSeconds: profile.medianWindowSeconds,
    maxDetourRatio: profile.maxDetourRatio,
    maxSpeedMs: profile.maxPlausibleSpeedMs,
    maxGapS: profile.maxGapS,
    scaleFiltersToSession: true,
    referenceSpeedOverrideMs: sessionReferenceMs ?? undefined,
  });

  // Vue en nœuds de la trace, attendue par les analyses voile.
  const trackData = useMemo(() => trackToPointData(gpx.track), [gpx.track]);

  const referenceSpeedKn = msToKnots(gpx.referenceSpeedMs);
  const cumulative = useMemo(() => buildCumulativeTrack(gpx.track), [gpx.track]);

  /**
   * Seuil d'activité suggéré à partir de l'allure de la session, et seuil
   * effectif : celui de la session s'il y en a un, sinon la surcharge du
   * support, sinon la suggestion, jamais le défaut fixe du profil (§10,
   * point 29 ; une trace lente au seuil wingfoil n'affichait aucune
   * manœuvre, cf. point 27). Sans seuil (bateau, 21/10), le seuil fixe de
   * réussite des manœuvres, qui ne se règle ni dans Réglages ni par session.
   */
  const withThreshold = hasActiveThreshold(profile);
  const fixedThresholdKn = profile.withoutActiveThreshold?.maneuverSuccess ?? null;
  const suggestedActiveThresholdKn = suggestActiveThresholdKn(sport, referenceSpeedKn);
  const defaultActiveThresholdKn = fixedThresholdKn ?? (isThresholdOverridden ? rawActiveThresholdKn : suggestedActiveThresholdKn);
  const activeThresholdKn = fixedThresholdKn ?? sessionThresholdKn ?? defaultActiveThresholdKn;

  const suggestedSpeedRangeMs = useMemo(
    () => suggestSpeedRangeMs(sport, referenceSpeedKn, gpx.track, cumulative),
    [sport, referenceSpeedKn, gpx.track, cumulative]
  );

  // Les tops ne dépendent que de la trace : calculés une fois, pas à chaque mouvement du seuil.
  const tops = useMemo(() => computeSailingTops(gpx.track, cumulative), [gpx.track, cumulative]);
  const stats = useMemo(
    () => buildSailingSessionStats(gpx.track, { sport, activeThresholdKn, cumulative, tops }),
    [gpx.track, sport, activeThresholdKn, cumulative, tops]
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

  // Les seuils viennent du profil du support et de la surcharge de
  // l'utilisateur : changer de support, ou bouger le seuil d'activité,
  // recalcule le vent. C'est le prix d'une seule notion de « réussite » dans
  // toute l'application, la même ici que pour les manœuvres affichées.
  const windEstimate = useMemo(
    () =>
      trackData.length > 0
        ? estimateWind(trackData, {
            minSpeedKn: maneuverThresholds.polarMinSpeedKn,
            successThresholdKn: activeThresholdKn,
            minEntrySpeedKn: maneuverThresholds.minEntrySpeedKn,
          })
        : null,
    [trackData, maneuverThresholds, activeThresholdKn]
  );
  const autoWind = windEstimate?.direction ?? null;

  const manualWindValue = windDeg === null ? null : normalizeAngle(windDeg);

  /** Vent global retenu, ou `null` si rien de fiable n'est disponible. */
  const currentWindValue = useMemo<number | null>(() => {
    if (manualWindValue !== null) return manualWindValue;
    if (windEstimate && windEstimate.reliable) return windEstimate.direction;
    return null;
  }, [manualWindValue, windEstimate]);

  /** Vrai quand l'utilisateur doit saisir le vent pour débloquer les analyses. */
  const windInputRequired = trackData.length > 0 && currentWindValue === null;

  const maneuverStats = useMemo(() => {
    if (trackData.length === 0 || currentWindValue === null) return null;
    const options = {
      successThresholdKn: activeThresholdKn,
      minEntrySpeedKn: maneuverThresholds.minEntrySpeedKn,
    };

    // Deux passes : la première classe avec le vent global, la seconde avec
    // le vent local interpolé entre les manœuvres de la première, pour rester
    // juste quand le vent a tourné au cours de la session.
    const firstPass = analyzeManeuvers(trackData, currentWindValue, options);
    const timeline = buildWindTimeline(
      windSamplesFrom(firstPass).map((m) => ({ timeMs: m.timeMs, direction: m.localWind })),
      currentWindValue,
      WIND_LOCAL_MAX_GAP_MIN * 60 * 1000
    );
    return analyzeManeuvers(trackData, timeline, options);
  }, [trackData, currentWindValue, activeThresholdKn, maneuverThresholds]);

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
    return calculateVmgStats(trackData, windAt, activeThresholdKn);
  }, [trackData, windAt, activeThresholdKn]);

  // Polaire au seuil accordé à l'allure de la session (règle 4), le même que
  // celui de l'estimation du vent : sur une trace lente, le seuil fixe du
  // profil laissait le radar presque vide.
  const polarMinSpeedKn = maneuverThresholds.polarMinSpeedKn;
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
    currentWindValue,
    autoWind,
    windEstimate,
    windInputRequired,
    loadGpxContent: gpx.loadGpxContent,
    fileName: gpx.fileName,
    trackName: gpx.trackName,
    sessionKey: gpx.sessionKey,
    hasDeviceSpeed: gpx.hasDeviceSpeed,
    loadError: gpx.error,
    maneuverStats,
    maneuverSummary,
    vmgStats,
    windStats,
    polarGraphData,
    // Réglages de l'activité
    activity,
    /** Activités voile proposées, plus l'activité de base de la session si elle n'en a pas. */
    activityOptions,
    setActivity,
    sport,
    profile,
    /** Support sur foil de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
    activityFoil,
    /** Matériel enregistré de l'activité, choisi par groupe dans « matos et conditions » ; `null` : option coupée. */
    gearGroups,
    /** Unités d'affichage, choisies dans Réglages pour l'activité. */
    speedUnit,
    distanceUnit,
    activeThresholdKn,
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
