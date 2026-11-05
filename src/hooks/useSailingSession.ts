import { useDeferredValue, useMemo } from 'react';
import { msToKnots } from '../core/units';
import { analyzeSailingAtThreshold, analyzeSailingWind, prepareSailingTrack, sailingPolarGraph } from '../sailing/sailingSession';
import { resolveSailingThresholds } from '../sailing/sailingConfig';
import type { SessionRecord } from '../library/record';
import { sessionActivitySettings } from '../library/summaryOptions';
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
  /** Fiche de la session, `null` hors de la mémoire : le seuil de l'activité qu'elle porte (HISTORIQUE, point 265). */
  record: SessionRecord | null;
}

/**
 * Seuil d'activité de l'appareil et celui de l'activité pour la session : le
 * seuil réglé ou pré-réglé sur l'appareil (`null` sans l'un ni l'autre), et
 * celui que la fiche de la session porte, qui prime sur lui (HISTORIQUE, point 265). Le seuil
 * propre de la session prime encore sur le second (`resolveSailingThresholds`).
 */
export const sailingActivityThresholds = (
  record: SessionRecord | null,
  device: { isThresholdOverridden: boolean; activeThresholdKn: number; foil: boolean | null }
): { deviceThresholdKn: number | null; activityThresholdKn: number | null } => {
  const deviceThresholdKn = device.isThresholdOverridden ? device.activeThresholdKn : null;
  const activityThresholdKn =
    sessionActivitySettings(record, { thresholdOverride: deviceThresholdKn ?? undefined, foil: device.foil }).thresholdOverride ?? null;
  return { deviceThresholdKn, activityThresholdKn };
};

export const useSailingSession = ({
  settings,
  windDeg,
  activeThresholdKn: sessionThresholdKn,
  referenceSpeedMs: sessionReferenceMs,
  record,
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
  const { cumulative } = gpx;

  /**
   * Ce qui ne dépend que de la trace (vue en nœuds, tops, masque du ratio,
   * seuils de manœuvre accordés à l'allure, détection des virages, étage
   * polaire du vent) : préparé une fois par trace, pas à chaque mouvement du
   * seuil. La trace change avec le support et l'allure (`useGpxSession`).
   */
  const prepared = useMemo(
    () => prepareSailingTrack(gpx.track, { sport, profile, referenceSpeedMs: gpx.referenceSpeedMs, cumulative }),
    [gpx.track, sport, profile, gpx.referenceSpeedMs, cumulative]
  );
  const { trackData } = prepared;
  const referenceSpeedKn = msToKnots(gpx.referenceSpeedMs);

  /**
   * Seuil d'activité effectif : celui de la session, sinon celui de l'activité
   * que sa fiche porte, sinon celui de l'appareil (réglé ou pré-réglé), sinon la
   * suggestion selon l'allure ; le bateau, sans seuil, garde son seuil fixe de
   * réussite (`resolveSailingThresholds`).
   */
  const { deviceThresholdKn, activityThresholdKn } = sailingActivityThresholds(record, {
    isThresholdOverridden,
    activeThresholdKn: rawActiveThresholdKn,
    foil: activityFoil,
  });
  const thresholds = resolveSailingThresholds(profile, activityThresholdKn, sessionThresholdKn, referenceSpeedKn);
  const { withThreshold, defaultKn: defaultActiveThresholdKn, activeKn: activeThresholdKn } = thresholds;
  /**
   * Seuil des calculs : celui du champ, différé (HISTORIQUE, point 220). Le champ et ses libellés
   * lisent `activeThresholdKn`, immédiat ; le seuil de vol le suit comme dans
   * `resolveSailingThresholds`. Pas de retard quand la trace change avec lui
   * (autre session, autre support) : la nouvelle trace serait sinon calculée une
   * première fois au seuil de l'ancienne.
   */
  const deferredThresholdKn = useDeferredValue(activeThresholdKn);
  const deferredTrackData = useDeferredValue(trackData);
  const computeThresholdKn = deferredTrackData === trackData ? deferredThresholdKn : activeThresholdKn;

  // Ce qui dépend du seuil : masque d'activité, statistiques, vols, estimation du vent.
  const atThreshold = useMemo(() => analyzeSailingAtThreshold(prepared, computeThresholdKn), [prepared, computeThresholdKn]);
  const { stats, flights, windEstimate } = atThreshold;

  // Ce qui dépend du vent retenu et du seuil : manœuvres en deux passes, variations du vent, VMG.
  const wind = useMemo(() => analyzeSailingWind(prepared, atThreshold, windDeg), [prepared, atThreshold, windDeg]);
  const { autoWind, currentWindValue, windInputRequired, maneuverStats, maneuverSummary, windStats, vmgStats, vmgSeries } = wind;
  // La polaire suit le vent retenu et les manœuvres classées, dont elle écarte les virements éclairs.
  const polarGraphData = useMemo(() => sailingPolarGraph(prepared, currentWindValue, maneuverStats?.locations), [prepared, currentWindValue, maneuverStats]);
  const { suggestedSpeedRangeMs, maneuverThresholds } = prepared;

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
    /** Trace remise encore en préparation, hors du fil de l'affichage : « Lecture de la session… ». */
    reading: gpx.reading,
    maneuverStats,
    maneuverSummary,
    vmgStats,
    /** Courbe de la VMG, en nœuds par point de la trace ; vide sans vent. */
    vmgSeries,
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
    /** Seuil de l'activité réglé sur cet appareil, `null` sans réglage : pour dire s'il diffère de celui que la session garde. */
    deviceThresholdKn,
    /** Vrai tant que les chiffres n'ont pas rejoint le seuil du champ (HISTORIQUE, point 220) : rien n'en est recopié dans la fiche entre-temps. */
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
