import { normalizeDeg } from '../core/angles';
import { roundTo } from '../core/basics';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Popup from '../components/map/Popup';
import { CircleMarker } from '../components/map/paths';
import AnalysisBaseLayers from '../components/AnalysisBaseLayers';
import './analysisMobile.css';
import { useAnalysisSession } from '../hooks/useAnalysisSession';
import { useAnalysisTabs } from '../hooks/useAnalysisTabs';
import { useSailingSession } from '../hooks/useSailingSession';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import { shareExtraStats } from '../library/shareStats';
import { effectiveHrOffset, useSportSettings } from '../hooks/useSportSettings';
import { useShownJumps } from '../hooks/useSessionJumps';
import { useFlightPumping, useSessionPumping } from '../hooks/useSessionPumping';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { useAnalysisHeart, useHeartRateZoneHighlight } from '../hooks/useAnalysisHeart';
import { useOpenSections } from '../hooks/useOpenSections';
import { useZoomOnMap } from '../hooks/useZoomOnMap';
import { trackBounds } from '../core/displayConfig';
import { SAILING_TABS, tabDefaults } from '../core/analysisTabs';
import { nearestIndexAtTime } from '../core/search';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import { useSailingChartRows } from '../hooks/useSailingChartRows';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { FAMILY_ACCENT } from '../core/activities';
import { activeRatioLabel } from '../core/sportProfiles';
import { effectiveSpeedRange, trackColorSegments } from '../core/trackColor';
import type { TopSegment } from '../core/types';
import {
  SPEED_UNIT_LABEL, SPEED_UNIT_SYMBOL, formatDistance, formatKnots, formatSpeed, formatSpeedValue, formatTimeOfDay,
  knotsToChartValue, knotsToMs, toDisplaySpeed, formatDecimal, commaDecimal
} from '../core/units';
import { polarExcludedPoints, speedPolar, type PolarBin } from '../sailing/wind';
import { MANEUVER_LABELS, TACK_LABELS, oppositeTack, windInputWarning, type ManeuverMetric, type ManeuverTop } from '../sailing/sailingAnalytics';
import type { ManeuverLocation } from '../sailing/maneuvers';
import CardioTab from '../components/CardioTab';
import NotesTab from '../components/NotesTab';
import JumpsPanel from '../components/JumpsPanel';
import JumpMapLayer from '../components/JumpMapLayer';
import { FlightsPanel, PumpingPanel } from '../components/FlightPumpingPanel';
import TrackSpanLayer from '../components/TrackSpanLayer';
import { pumpingHighlightSpans } from '../components/pumpingHighlight';
import { HIGHLIGHT_SPAN_OPACITY, podiumColor } from '../components/highlightColors';
import { ANALYSIS_MAP_ANCHOR } from '../components/AnalysisMap';
import { zoomHint } from '../components/zoomHint';
import EmptyTabPanel from '../components/EmptyTabPanel';
import ResizablePanel from '../components/ResizablePanel';
import TopsPanel, { TopsHighlight } from '../components/TopsPanel';
import HighlightPath from '../components/HighlightPath';
import type { GearField } from '../components/gearFields';
import { ANALYSIS_PANEL_STYLE, PANEL_BLOCK_STYLE } from '../components/styles';
import { PanelHeading, SessionDate } from '../components/PanelTitle';
import GeneralStats from '../components/GeneralStats';
import WindCompass from '../components/WindCompass';
import WindAdjustOverlay from '../components/WindAdjustOverlay';
import type { ShareStat } from '../core/shareImage';
import { SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import TrackArrows from '../components/TrackArrows';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import Button from '../components/ui/Button';
import AnalysisShell from '../components/AnalysisShell';
import { SAILING_GRAPH_FOLDS_DEFAULT, sailingChartReaders } from '../components/sailing/sailingChartParts';
import ManeuversPanel, { type ManeuversOnMap, type ManeuversView } from '../components/sailing/ManeuversPanel';
import SailingSettingsPanel from '../components/sailing/SailingSettingsPanel';
import SailingGraphsPanel from '../components/sailing/SailingGraphsPanel';
import WindPanel from '../components/sailing/WindPanel';
import VmgPanel from '../components/sailing/VmgPanel';
import { SailingCompanionCharts } from '../components/sailing/SailingCharts';

/** Champs du matériel en voile : l'aile ou la voile, plus le foil et le mât sur foil. */
const SAILING_GEAR_FIELDS: GearField[] = [{ field: 'wing', label: 'Aile / voile', placeholder: 'ex. 5 m²' }];
const SAILING_GEAR_FIELDS_FOIL: GearField[] = [
  { field: 'foil', label: 'Foil', placeholder: 'ex. 1100 cm²' },
  { field: 'mast', label: 'Mât', placeholder: 'ex. 85 cm' },
  ...SAILING_GEAR_FIELDS,
];

/**
 * Onglets du module, tous sous la carte, dans l'ordre
 * voulu par l'utilisateur. Le premier, « général », porte les chiffres globaux
 * et le vent : seul ouvert par défaut, il se replie pour comparer tableaux et
 * carte. Les réglages de la session sont dans le dernier. Leur liste est `SAILING_TABS`
 * (`core/analysisTabs.ts`), où chaque activité choisit dans Réglages ceux qu'elle montre. Pour en ajouter un :
 * une entrée là (ouvert par défaut s'il est `primary`, `tabDefaults`), et un bloc `{open.maCle && (...)}` dans la colonne.
 */

const SAILING_PANEL_DEFAULTS = tabDefaults(SAILING_TABS);

function SailingModule() {
  /** Réglages de l'activité de voile, lus une fois ici et passés à `useSailingSession`. */
  const settings = useSportSettings('voile');
  const { activity, setActivity } = settings;
  /**
   * Fichier de la trace affichée, posé en même temps qu'elle (`load`). Le brouillon ne vaut que
   * pour sa propre trace, comme dans les autres modules : passer de A à B n'applique pas un instant le vent,
   * le seuil ou les repères de B à la trace de A.
   */
  const [shownFile, setShownFile] = useState<string | null>(null);
  /**
   * Lecture du GPX par `useSailingSession`, appelé après le brouillon dont il lit le vent, le seuil et
   * l'allure : un relais stable, rempli dès que la trace est là (la lecture vient toujours après le rendu).
   */
  const loadTrack = useRef<(content: string, file: string) => void>(() => undefined);
  const load = useCallback((content: string, file: string) => {
    setShownFile(file);
    loadTrack.current(content, file);
  }, []);
  // Session de la mémoire désignée par l'URL : son activité devient celle du module. Son brouillon (vent saisi,
  // seuil d'activité, allure imposée, couleurs et notes, écrits dans sa fiche par « Enregistrer la session »)
  // reste rattaché à la session demandée, comme avant le lot 62. Toutes les activités sont proposées pour une
  // session de la mémoire, celles de la voile seules sinon ; vers une activité de course, la session part
  // dans le module course (`useChangeSessionActivity`).
  const {
    requested: requestedFile, sessionFile, error: sessionError, reading, draft, record: draftRecord, allActivities, changeActivity: changeSessionActivity,
  } = useAnalysisSession({ family: 'voile', activity, setActivity, load, loadedFile: shownFile, draftFor: 'requested' });
  const { edits } = draft;

  const {
    trackData,
    track,
    stats,
    currentWindValue,
    autoWind,
    loadGpxContent,
    fileName,
    maneuverStats,
    maneuverSummary,
    vmgStats,
    vmgSeries,
    windStats,
    polarGraphData,
    windEstimate,
    windInputRequired,
    hasDeviceSpeed,
    loadError,
    reading: trackReading,
    sessionKey,
    cumulative,
    flights,
    profile,
    activityFoil,
    activityPumping,
    gearGroups,
    speedUnit,
    distanceUnit,
    activeThresholdKn,
    deviceThresholdKn,
    thresholdPending,
    hasActiveThreshold,
    defaultActiveThresholdKn,
    speedRange,
    suggestedSpeedRangeMs,
    referenceSpeedMs,
    samplingS,
    pointCount,
    maneuverThresholds,
  } = useSailingSession({
    settings,
    windDeg: edits.windDeg,
    activeThresholdKn: edits.activeThreshold,
    referenceSpeedMs: edits.referenceSpeedMs,
    record: draftRecord,
  });

  // Affichage dans l'unité de l'activité ; les analyses voile restent en nœuds (règle 5).
  const speedSymbol = SPEED_UNIT_SYMBOL[speedUnit];
  const showKn = (kn: number | string) => formatKnots(kn, speedUnit);
  /** Seuil saisi en nœuds, montré tel quel en nœuds, sinon converti. */
  // Arrondi au dixième : un seuil mis à l'échelle de l'allure sort en 7,999999… nœuds.
  const showThreshold = (kn: number) => (speedUnit === 'kn' ? String(roundTo(kn, 1)) : showKn(kn));

  useEffect(() => {
    loadTrack.current = loadGpxContent;
  }, [loadGpxContent]);

  // Nombre et réussite des manœuvres recopiés dans la fiche, pour la liste des sessions et les
  // statistiques. Seulement quand un vent est connu (sinon l'analyse des manœuvres est suspendue),
  // et pour la trace de ce fichier.
  const tackSuccess = maneuverStats?.tackSuccess ?? null;
  const tackFail = maneuverStats?.tackFail ?? null;
  const jibeSuccess = maneuverStats?.jibeSuccess ?? null;
  const jibeFail = maneuverStats?.jibeFail ?? null;
  // Les manœuvres de sens incertain comptent dans le total, pas dans la réussite des virements et empannages.
  const undecided = maneuverStats?.undecided ?? null;
  // Pas pendant un brouillon : la liste doit refléter l'état enregistré ; ni avant que les
  // manœuvres n'aient rejoint le seuil (Q40), qui les classe.
  const loadedFromMemory = sessionFile !== null && fileName === sessionFile && trackData.length > 0;
  const { dirty } = draft;
  useEffect(() => {
    if (!loadedFromMemory || !sessionFile || dirty || thresholdPending || currentWindValue === null) return;
    if (tackSuccess === null || tackFail === null || jibeSuccess === null || jibeFail === null || undecided === null) return;
    updateSessionRecord(sessionFile, {
      maneuverCount: tackSuccess + tackFail + jibeSuccess + jibeFail + undecided,
      maneuverResults: { tackSuccess, tackFail, jibeSuccess, jibeFail },
    });
  }, [loadedFromMemory, sessionFile, dirty, thresholdPending, currentWindValue, tackSuccess, tackFail, jibeSuccess, jibeFail, undecided]);

  /** Support sur foil de la session : le sien s'il est réglé, sinon celui de l'activité. */
  const foil = edits.foil ?? activityFoil;
  /** Mentions d'une manœuvre, les mêmes dans la bulle de la carte et la liste des détails : amures, vol perdu, décollage. */
  const maneuverNotes = useCallback((loc: ManeuverLocation): string[] => {
    const notes: string[] = [];
    if (loc.tack) notes.push(`${TACK_LABELS[loc.tack].toLowerCase()} → ${TACK_LABELS[oppositeTack(loc.tack)].toLowerCase()}`);
    if (loc.lostFlightS > 0) notes.push(`${foil ? 'vol perdu' : 'sous le seuil'} ${formatDecimal(loc.lostFlightS, 1)} s`);
    if (loc.takeoff) notes.push('au décollage');
    return notes;
  }, [foil]);
  /** Pumping de la session (brouillon, puis fiche), sinon celui de l'activité ; sur foil seulement (lot 22). */
  const pumping = foil && profile.pump !== null && (edits.pumping ?? activityPumping);
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe dans « graphiques ». */
  const { runner, retainHr, heart, hrZones } = useAnalysisHeart(track, profile.heartRate, effectiveHrOffset(activity));
  // Onglets de l'activité, rangée « avancé », point survolé effacé à chaque session ; une seule surbrillance
  // sur la carte, effacée quand son onglet se ferme (`useMapHighlight`).
  const { open, toggle, toggleOf, closeAll, advanced, shown, highlight } = useAnalysisTabs({
    tabs: SAILING_TABS, defaults: SAILING_PANEL_DEFAULTS, activity, sessionKey,
  });
  // Sauts mesurés par les capteurs du téléphone : ceux de la fiche, sinon calculés depuis le `.imu`.
  const jumps = useShownJumps({
    file: loadedFromMemory ? sessionFile : null, track, profile, activity, thresholdMs: knotsToMs(activeThresholdKn), highlight,
  });
  const jumpsVisible = jumps.visible;

  /**
   * Graphes de l'onglet « graphiques » dépliés, chacun replié à part par son
   * titre pour ne comparer que ceux qui restent ouverts (16/10). Replié, un
   * graphe se réduit à son titre ; sa taille mémorisée l'attend.
   */
  const graphFolds = useOpenSections('sailing-graphes', SAILING_GRAPH_FOLDS_DEFAULT);
  // Pumping des vols, par les capteurs de la session : il suit les vols, donc le seuil du brouillon.
  // Capteurs lus à l'ouverture de l'onglet « vols » ou « pumping », Pumping coché : une capture entière pèse plusieurs Mo.
  const pumpSensors = useSessionPumping(loadedFromMemory ? sessionFile : null, pumping && (open.vols || open.pumping));
  /** Onglet « vols » : sur foil, pour un calcul qui mesure le pumping ; les vols viennent du GPS. */
  const flightsVisible = foil && profile.pump !== null;
  const flightsOpen = open.vols && flightsVisible;
  /** Onglet « pumping » : de même, si la session a ses capteurs ; Pumping décoché, il le dit. */
  const pumpingVisible = flightsVisible && pumpSensors.hasMotion;
  const pumpingOpen = open.pumping && pumpingVisible;
  const sailingPanels = useMemo(
    () => shown((p) => (p.key !== 'sauts' || jumpsVisible) && (p.key !== 'vols' || flightsVisible) && (p.key !== 'pumping' || pumpingVisible)
      && (p.key !== 'cardio' || heart.present)),
    [shown, jumpsVisible, flightsVisible, pumpingVisible, heart.present]
  );
  /** Top montré : de vitesse (onglet tops, `t2s`…) ou de VMG (onglet VMG, `vmgUpwind`, `vmgDownwind`), ou `none`. */
  const selectedTopMap = highlight.shownIn('tops') ?? highlight.shownIn('vmg') ?? 'none';
  /** Podium de manœuvres montré : `tack:conservation`, `jibe:distance`, ou `none`. */
  const selectedManeuverTop = highlight.shownIn('manoeuvres') ?? 'none';
  const pumpDetection = profile.pump;
  const {
    byFlight: flightPumping, summary: pumpSummary, podium: podiumFlights, series: pumpSeriesList, seriesPodium,
  } = useFlightPumping(pumpSensors.recording, pumpDetection, track, cumulative, flights, jumps.allJumps);
  /** Part du vol pompée (capteurs du `.imu`), sur foil avec le pumping mesuré : image de partage et résumé de la fiche (lot 145). */
  const sharedPumpingShare = foil && pumpSummary ? pumpSummary.pumpShare : null;
  // Part du vol pompée et vent retenu recopiés dans le résumé, pour le partage d'une session dont l'analyse n'est pas
  // ouverte ; mêmes conditions que les manœuvres (fiche de ce fichier, pas de brouillon, seuil rejoint).
  useEffect(() => {
    if (!loadedFromMemory || !sessionFile || dirty || thresholdPending) return;
    updateSessionRecord(sessionFile, {
      pumpingShare: sharedPumpingShare === null ? null : Math.round(sharedPumpingShare * 1000) / 1000,
      windDirDeg: currentWindValue === null ? null : Math.round(normalizeDeg(currentWindValue)),
    });
  }, [loadedFromMemory, sessionFile, dirty, thresholdPending, sharedPumpingShare, currentWindValue]);
  /** Vol ou série montrés sur la carte (onglets « vols » et « pumping »), ou l'un des deux podiums (`PumpingHighlightKey`). */
  const flightShown = highlight.shownIn('vols');
  const pumpingShown = highlight.shownIn('pumping');
  const shownFlightSpans = useMemo(
    () => pumpingHighlightSpans(flightShown ?? pumpingShown, flights, podiumFlights, pumpSeriesList, seriesPodium),
    [flightShown, pumpingShown, flights, podiumFlights, pumpSeriesList, seriesPodium]
  );
  /** Zone cardiaque montrée sur la carte (onglet « cardio »). */
  const hrZone = useHeartRateZoneHighlight(highlight, open.cardio, heart, hrZones, track, profile.heartRate.gapS);
  // Repères du bouton « Note » : fanions, liste de « Général », traits des graphes.
  const marks = useSessionMarks(draft, track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);

  /** Bornes du dégradé de couleur de la trace, en m/s : celles de la session, sinon de Réglages, sinon la suggestion. */
  const colorRange = effectiveSpeedRange({
    sessionRange: edits.speedRange, activityRange: speedRange, suggested: suggestedSpeedRangeMs, fallback: settings.defaultSpeedRange,
  });

  const [showTacksOnMap, setShowTacksOnMap] = useState<boolean>(false);
  const [showJibesOnMap, setShowJibesOnMap] = useState<boolean>(false);
  const [showUndecidedOnMap, setShowUndecidedOnMap] = useState<boolean>(false);
  const [showManeuverDetails, setShowManeuverDetails] = useState<boolean>(false);
  /** Liste de toutes les manœuvres d'un type, sous « Détails » : repliée d'office, non mémorisée (05/11). */
  const [allManeuversOpen, setAllManeuversOpen] = useState<Record<'tack' | 'jibe', boolean>>({ tack: false, jibe: false });
  /** Genre montré dans le tableau par amure (note 135) : virements ou empannages. */
  const [tackTableType, setTackTableType] = useState<'tack' | 'jibe'>('tack');
  /** Vues et cases de la carte de l'onglet « manœuvres », tenues ici : la carte les lit, et l'onglet rouvert les retrouve. */
  const maneuversView: ManeuversView = {
    details: showManeuverDetails, setDetails: setShowManeuverDetails, tackType: tackTableType, setTackType: setTackTableType,
    listOpen: allManeuversOpen, setListOpen: setAllManeuversOpen,
  };
  const maneuversOnMap: ManeuversOnMap = {
    tack: showTacksOnMap, jibe: showJibesOnMap, undecided: showUndecidedOnMap,
    toggle: (type) => {
      if (type === 'tack') setShowTacksOnMap(!showTacksOnMap);
      else if (type === 'jibe') setShowJibesOnMap(!showJibesOnMap);
      else setShowUndecidedOnMap(!showUndecidedOnMap);
    },
  };
  /** Réglage du vent sur la carte, ouvert par « Régler » ; sur téléphone, dans la carte en plein écran. */
  const [windAdjust, setWindAdjust] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

  /** Vent saisi loin du vent calculé fiable, qui écarte les manœuvres (C1-3) : une phrase sous le tableau. */
  const windWarning = useMemo(
    () => windInputWarning({ manualDeg: edits.windDeg === null ? null : normalizeDeg(edits.windDeg), autoWind: windEstimate, stats: maneuverStats }),
    [edits.windDeg, windEstimate, maneuverStats]
  );

  /** Podium de manœuvres sélectionné pour la carte. */
  const maneuverTopArray = useMemo((): ManeuverTop[] => {
    if (selectedManeuverTop === 'none') return [];
    const [type, metric] = selectedManeuverTop.split(':') as ['tack' | 'jibe', ManeuverMetric];
    return maneuverSummary[type]?.tops[metric] ?? [];
  }, [selectedManeuverTop, maneuverSummary]);

  /**
   * Trace colorée par la vitesse, et ses flèches de cap, chacune mémorisée à
   * part : montrer un top ou les manœuvres ne les redessine pas.
   */
  const mapSegments = useMemo(
    (): TrackSegment[] => trackColorSegments(track, 'voile', { minMs: colorRange.minMs, maxMs: colorRange.maxMs }),
    [track, colorRange.minMs, colorRange.maxMs]
  );
  /** « Temps en vol » sur foil, « Temps actif » sinon : le libellé dit ce qu'il mesure. */
  const activeTimeWord = foil ? 'Temps en vol' : 'Temps actif';
  /**
   * Chiffres de l'onglet « général », proposés aussi pour l'image de partage. Sans seuil (bateau),
   * toute la session compte en navigation : ni distance, temps, ratio ni moyenne actifs.
   */
  /** FC moyenne, en fin des chiffres de « général » et du partage, si la session a de la FC (comme à pied). */
  const heartRateStat: ShareStat[] = heart.present && heart.stats
    ? [{ key: 'heartRate', label: 'FC moyenne', value: `${Math.round(heart.stats.avgBpm)} bpm` }]
    : [];
  const generalStats: ShareStat[] = stats ? [
    { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
    ...(hasActiveThreshold ? [{ key: 'activeDistance', label: 'Distance active', value: formatDistance(stats.activeDistanceM, distanceUnit) }] : []),
    { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
    ...(hasActiveThreshold ? [
      { key: 'activeTime', label: `${activeTimeWord} (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: stats.activeTime },
      { key: 'activeRatio', label: activeRatioLabel(profile, foil), value: `${commaDecimal(stats.activeRatio)}%` },
    ] : []),
    { key: 'averageSpeed', label: 'Vitesse moyenne', value: formatSpeed(stats.avgSpeedMs, speedUnit) },
    ...(hasActiveThreshold ? [
      { key: 'activeAverage', label: `Moyenne active (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: formatSpeed(stats.activeAvgSpeedMs, speedUnit) },
    ] : []),
    ...heartRateStat,
    // Lignes ajoutées le 05/11 (lot 145), les mêmes que celles du résumé d'une fiche (`summaryShareStats`).
    ...shareExtraStats('voile', {
      maneuvers: maneuverStats
        ? { success: maneuverStats.tackSuccess + maneuverStats.jibeSuccess, total: maneuverStats.tackSuccess + maneuverStats.tackFail + maneuverStats.jibeSuccess + maneuverStats.jibeFail }
        : null,
      pumpingShare: sharedPumpingShare,
      windDeg: currentWindValue,
      windLevel: edits.notes.windLevel,
      rating: edits.notes.rating,
    }, { foil, units: { speed: speedUnit, distance: distanceUnit } }),
  ] : [];
  /** Virements ou empannages réussis sur le total, et leur part ; « — » sans vent connu. */
  const maneuverRate = (summary: { success: number; fail: number } | null): string => {
    if (!maneuverStats) return '—';
    const total = (summary?.success ?? 0) + (summary?.fail ?? 0);
    return total > 0 ? `${summary!.success} / ${total} (${Math.round((summary!.success / total) * 100)} %)` : '0';
  };
  const topValue = (top: TopSegment | undefined): string => (top && top.val !== '-' ? `${showKn(top.val)} ${speedSymbol}` : '—');
  /**
   * Chiffres de l'onglet « général » (22/10) : l'essentiel de la session, le détail restant dans
   * « avancé ». Sur foil, la distance, le ratio et la moyenne sont ceux du vol ; sans seuil (bateau),
   * toute la session compte. L'image de partage garde la liste entière (`generalStats`).
   */
  const activeWord = foil ? 'en vol' : 'active';
  const overviewStats: ShareStat[] = stats ? [
    ...(hasActiveThreshold ? [
      { key: 'activeDistance', label: foil ? 'Distance en vol' : 'Distance active', value: formatDistance(stats.activeDistanceM, distanceUnit) },
      { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
      { key: 'activeTime', label: `${activeTimeWord} (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: stats.activeTime },
      { key: 'activeRatio', label: activeRatioLabel(profile, foil), value: `${commaDecimal(stats.activeRatio)}%` },
      { key: 'activeAverage', label: `Moyenne ${activeWord}`, value: formatSpeed(stats.activeAvgSpeedMs, speedUnit) },
    ] : [
      { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
      { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
      { key: 'averageSpeed', label: 'Vitesse moyenne', value: formatSpeed(stats.avgSpeedMs, speedUnit) },
    ]),
    // Top 2 s en face de la moyenne ; le top 100 m reste dans « avancé › tops » (31/10).
    { key: 'top2s', label: 'Top 2 s', value: topValue(stats.tops.t2s[0]) },
    { key: 'tacks', label: 'Virements réussis', value: maneuverRate(maneuverSummary.tack) },
    { key: 'jibes', label: 'Empannages réussis', value: maneuverRate(maneuverSummary.jibe) },
    ...heartRateStat,
  ] : [];
  /** Podiums montrables sur la carte : les tops de vitesse, puis ceux de VMG (près, portant), par clé de cible. */
  const mapTops = useMemo(
    () => ({ ...stats?.tops, ...(vmgStats ? { vmgUpwind: vmgStats.topsUpwind, vmgDownwind: vmgStats.topsDownwind } : {}) }),
    [stats, vmgStats]
  );
  const staticMapLayers = useMemo(() => {
    if (trackData.length === 0) return null;

    return (
      <>
        {maneuverStats?.locations.map((loc, idx) => {
          const shown = loc.type === 'tack' ? showTacksOnMap : loc.type === 'jibe' ? showJibesOnMap : showUndecidedOnMap;
          if (!shown) return null;
          return (
            <CircleMarker
              key={`maneuver-${idx}`}
              center={[loc.lat, loc.lon]}
              radius={6}
              pathOptions={{
                color: loc.success ? '#2e7d32' : '#c62828',
                // Blanc au virement, noir à l'empannage, gris quand le sens est incertain.
                fillColor: loc.type === 'tack' ? '#fff' : loc.type === 'jibe' ? '#000' : '#9e9e9e',
                fillOpacity: 1,
                weight: 3
              }}>
              <Popup>
                {MANEUVER_LABELS[loc.type]} {loc.success ? 'Réussi' : 'Raté'} - Vmin: {formatKnots(loc.vmin, speedUnit)} {SPEED_UNIT_SYMBOL[speedUnit]}
                {maneuverNotes(loc).map((note) => <span key={note}><br />{note}</span>)}
              </Popup>
            </CircleMarker>
          );
        })}

        <TopsHighlight tops={mapTops} selected={selectedTopMap} />

        {maneuverTopArray.map((top, idx) => {
          if (top.path.length < 2) return null;
          return (
            <HighlightPath key={`maneuver-top-${selectedManeuverTop}-${idx}`} positions={top.path} color={podiumColor(idx)} opacity={HIGHLIGHT_SPAN_OPACITY}>
              <Popup>{idx + 1}{idx === 0 ? 'er' : 'e'} · {formatTimeOfDay(top.timeMs)} · {top.label}</Popup>
            </HighlightPath>
          );
        })}
      </>
    );
  }, [trackData, maneuverStats, showTacksOnMap, showJibesOnMap, showUndecidedOnMap, selectedTopMap, mapTops, maneuverTopArray, selectedManeuverTop, speedUnit, maneuverNotes]);

  const mapBounds = useMemo(() => trackBounds(trackData), [trackData]);

  const narrow = useNarrowScreen();
  /**
   * Temps écoulé de chaque point, en minutes : l'axe des graphes de vitesse et du vent. `chartZoom` est
   * commun à ces graphes, qui partagent leur axe ; `cardioZoom` est celui de la courbe de l'onglet « cardio » ;
   * « tout voir » à chaque session.
   */
  const timeChart = useTimeChartAxis(trackData, sessionKey);
  const { minutes: trackMinutes, zoom: chartZoom, cardioZoom } = timeChart;
  const { timeX } = timeChart;
  /** Lignes des graphes à la plage du zoom (`useSailingChartRows`), et lectures du point survolé. */
  const chartRows = useSailingChartRows({ trackData, timeChart, heart, windStats, vmgSeries, maneuverStats, speedUnit });
  const { vmgChartShown } = chartRows;
  const chartReaders = sailingChartReaders({ trackData, timeChart, heart, windStats, vmgSeries, speedUnit });
  /**
   * La courbe de FC a des lignes, quelle que soit la plage : avec la FC et au moins deux points, la plage zoomée en
   * garde toujours deux (`visibleIndexRange` prend un voisin de chaque côté). Lu hors des blocs du zoom.
   */
  const heartChartShown = heart.present && trackData.length > 1;
  /** Traits des repères sur les graphes, en minutes depuis le premier point. */
  const markLines = markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark);
  /** Les mêmes, sur l'axe de la FC. */
  const hrMarkLines = markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark, 'hr');
  /** « +carte » des graphes zoomés : tronçon en violet, cadrage, plein écran carte + graphes au téléphone. */
  const zoomOnMap = useZoomOnMap({
    highlight,
    points: trackData,
    charts: {
      graphiques: { zoom: chartZoom, axis: trackMinutes },
      vent: { zoom: chartZoom, axis: trackMinutes },
      vmg: { zoom: chartZoom, axis: trackMinutes },
      cardio: { zoom: cardioZoom, axis: trackMinutes },
    },
    narrow,
    mapAnchorId: ANALYSIS_MAP_ANCHOR,
    mapExpanded,
    openMap: () => setMapExpanded(true),
  });
  /** Rappels de l'onglet « cardio », stables : le panneau, mémoïsé, ne se redessine pas au zoom d'un autre graphe. */
  const firstMs = track[0]?.timeMs ?? null;
  const retainSessionHrMax = useCallback((bpm: number) => retainHr('hrMax', bpm, { kind: 'seance', atMs: firstMs }), [retainHr, firstMs]);
  const { show: showZoomOnMap } = zoomOnMap;
  const showCardioOnMap = useCallback(() => showZoomOnMap('cardio'), [showZoomOnMap]);
  const zoomText = zoomHint(narrow);
  /** Graphes de l'onglet d'où vient « +carte », sous la carte en plein écran (téléphone), si l'onglet en a. */
  const companionPanel = zoomOnMap.companionPanel;
  const companionShown = companionPanel === 'graphiques' || companionPanel === 'cardio'
    || (companionPanel === 'vent' && windStats !== null) || (companionPanel === 'vmg' && vmgChartShown);

  /** Ouvre le réglage du vent sur la carte : en plein écran sur téléphone, la carte ramenée à l'écran sinon. */
  const startWindAdjust = () => {
    setWindAdjust(true);
    if (narrow) setMapExpanded(true);
    else zoomOnMap.scrollToMap();
  };
  const endWindAdjust = () => {
    setWindAdjust(false);
    setMapExpanded(false);
    // Le plein écran se ferme ici sans passer par `onExpandedChange` : le tronçon violet part avec lui.
    zoomOnMap.closeCompanion();
  };
  /** Polaire à un vent donné, dans l'unité : elle suit la flèche pendant qu'on règle le vent. */
  const polarMinSpeedKn = maneuverThresholds.polarMinSpeedKn;
  const polarAt = useCallback((deg: number): PolarBin[] => {
    const bins = speedPolar(trackData, deg, polarMinSpeedKn, polarExcludedPoints(trackData, maneuverStats?.locations ?? [], deg));
    return speedUnit === 'kn' ? bins : bins.map((p) => ({ ...p, vitesse: knotsToChartValue(p.vitesse, speedUnit) }));
  }, [trackData, polarMinSpeedKn, speedUnit, maneuverStats]);

  /**
   * Onglet ouvert sans rien à montrer : sans vent, les manœuvres, la VMG et le vent ne se calculent pas ;
   * l'onglet le dit, avec de quoi ouvrir « général » où on le saisit (demande du 19/10).
   */
  const renderEmptyPanel = (key: 'manoeuvres' | 'vmg' | 'vent', label: string, what: string, otherwise: string) => (
    <EmptyTabPanel id={`sailing.carte.${key}.vide`} label={label} open={open[key]} onToggle={toggleOf(key)}
      action={windInputRequired && !windAdjust
        ? <Button size="s" onClick={startWindAdjust}>Régler le vent</Button>
        : undefined}>
      {windInputRequired ? `Vent inconnu : ${what} par rapport à lui. Réglez-le sur la carte.` : otherwise}
    </EmptyTabPanel>
  );

  /** Point de trace le plus proche d'un instant : relie la courbe d'un saut à la carte. */
  const trackIndexAt = useCallback((ms: number): number => nearestIndexAtTime(trackData, ms), [trackData]);

  /** Contenu partagé par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <AnalysisBaseLayers family="voile" file={sessionFile} track={trackData} zonePaths={hrZone.paths} zonePathsKey={hrZone.selectedZone}
      zoomPath={zoomOnMap.path} marks={marks.located} shownMark={shownMark}>
      {trackData.length > 0 && <TrackSegmentsLayer segments={mapSegments} weight={5} family={'voile'} />}
      {trackData.length > 0 && <TrackArrows track={trackData} />}
      {staticMapLayers}
      <JumpMapLayer track={trackData} jumps={jumps.jumps} shownJump={jumps.shownJump} podiumShown={jumps.podiumShown} />
      <TrackSpanLayer track={track} spans={shownFlightSpans} />
    </AnalysisBaseLayers>
  );

  return (
    <AnalysisShell title="Analyse voile" family="voile" backLabel="Sessions voile" file={requestedFile}
      share={{ segments: mapSegments, stats: generalStats }} error={sessionError}
      // Barre visible pendant un brouillon seulement : rien ne s'affiche quand tout est enregistré.
      draft={loadedFromMemory ? draft : null}
      // Erreur de lecture sans largeur bornée, puis le vent non fiable.
      alerts={(
        <>
          {loadError && (
            <div className="ui-alert ui-alert--danger" style={{ marginBottom: '10px' }}>
              {loadError}
            </div>
          )}

          {windInputRequired && (
            <div className="ui-alert ui-alert--warning" style={{ marginBottom: '10px' }}>
              <strong>Vent non fiable.</strong> L'estimation automatique donne {autoWind}° avec un indice de confiance
              de {windEstimate ? Math.round(windEstimate.confidence * 100) : 0}%, trop faible pour être utilisée.
              C'est typique d'un aller simple ou d'un plan d'eau à courant. Réglez le vent sur la carte pour
              débloquer les manœuvres, la VMG et la polaire.
              {!windAdjust && (
                <Button size="s" onClick={startWindAdjust} style={{ marginLeft: '6px' }}>Régler le vent</Button>
              )}
            </div>
          )}
        </>
      )}
      empty={trackData.length === 0 && requestedFile === null}
      reading={reading || trackReading}
      map={{
        panelId: 'sailing.carte',
        rowZIndex: 0,
        sessionKey,
        bounds: mapBounds,
        layers: mapLayers,
        defaultHeight: 480,
        expanded: mapExpanded,
        focus: zoomOnMap.focus,
        companion: companionShown ? (
          <SailingCompanionCharts panel={companionPanel} rows={chartRows} readers={chartReaders} chartZoom={chartZoom} timeX={timeX}
            markLines={markLines} hrMarkLines={hrMarkLines} folds={graphFolds.open} heartChartShown={heartChartShown} windShown={windStats !== null}
            zones={hrZones} minutes={trackMinutes} heart={heart} cardioZoom={cardioZoom} onShowOnMap={zoomOnMap.show} />
        ) : null,
        onExpandedChange: (next) => {
          setMapExpanded(next);
          if (!next) zoomOnMap.closeCompanion();
          // Fermer la carte agrandie termine le réglage commencé dedans.
          if (!next) setWindAdjust(false);
        },
        overlay: windAdjust && trackData.length > 0 ? (
          <WindAdjustOverlay windDeg={currentWindValue} autoWind={autoWind} confidence={windEstimate?.confidence ?? null}
            manual={edits.windDeg !== null} onChange={(deg) => draft.update({ windDeg: deg })} onClose={endWindAdjust}
            polarAt={polarAt} unitSymbol={speedSymbol} />
        ) : undefined,
        legend: trackData.length > 0 ? (
          <SpeedGradientLegend unit={speedUnit} range={colorRange}
            slowLabel={`sous ${Math.round(toDisplaySpeed(colorRange.minMs, speedUnit))} ${speedSymbol}`} />
        ) : null,
      }}
      // Onglets sous la carte, et leurs panneaux deux par ligne sur ordinateur (`docs/MISE_EN_PAGE.md`).
      tabs={stats ? {
        sections: sailingPanels, open, onToggle: toggle, onCloseAll: closeAll, advanced, panels: (
          <>
            {open.general && (
              <ResizablePanel id="sailing.general" style={PANEL_BLOCK_STYLE}>
                <PanelHeading label="Général" extra={<SessionDate track={trackData} />} open={open.general} onToggle={toggleOf('general')} />
                <GeneralStats stats={overviewStats} pairs={[['tacks', 'jibes']]} />
                {/* Mini-boussole du vent ; « Régler » ouvre la grande sur la carte (22/10). */}
                <div className="an-sheet__wind" style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  <WindCompass windAngle={currentWindValue ?? autoWind ?? 0} size={64} />
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: 'var(--text-m)' }}>
                      {currentWindValue !== null ? `Vent ${Math.round(currentWindValue)}°` : 'Vent inconnu'}
                    </strong>
                    <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
                      {edits.windDeg !== null
                        ? `saisi${autoWind !== null ? ` · calculé ${autoWind}°` : ''}`
                        : windEstimate
                          ? `calculé · confiance ${Math.round(windEstimate.confidence * 100)} %`
                          : 'à régler sur la carte'}
                    </span>
                  </div>
                  <Button size="s" onClick={startWindAdjust} disabled={windAdjust}>Régler</Button>
                </div>
                <SessionMarksList view={marks} distanceUnit={distanceUnit} shownMs={shownMark} accent={FAMILY_ACCENT.voile}
                  onShow={(ms) => highlight.show('general', ms === null ? null : String(ms))} />
              </ResizablePanel>
            )}

            {open.tops && (
              <ResizablePanel id="sailing.tops" style={PANEL_BLOCK_STYLE}>
                <TopsPanel targets={profile.topTargets} tops={stats.tops} unit={speedUnit} selected={highlight.shownIn('tops')}
                  onSelect={(key) => highlight.show('tops', key)} accent={FAMILY_ACCENT.voile} open={open.tops} onToggle={toggleOf('tops')} />
              </ResizablePanel>
            )}

            {open.manoeuvres && trackData.length > 0 && (maneuverStats
              ? (
                <ManeuversPanel stats={maneuverStats} summary={maneuverSummary} open={open.manoeuvres} onToggle={toggleOf('manoeuvres')}
                  showKn={showKn} showThreshold={showThreshold} speedSymbol={speedSymbol} activeThresholdKn={activeThresholdKn} foil={foil}
                  windWarning={windWarning} samplingS={samplingS} pointCount={pointCount} minEntrySpeedKn={maneuverThresholds.minEntrySpeedKn}
                  notesOf={maneuverNotes} onMap={maneuversOnMap} selectedTop={highlight.shownIn('manoeuvres')}
                  onSelectTop={(key) => highlight.show('manoeuvres', key)} view={maneuversView} />
              )
              : renderEmptyPanel('manoeuvres', 'Manœuvres', 'virements et empannages se reconnaissent', 'Aucune manœuvre reconnue sur cette session.'))}

            {open.graphiques && (
              <SailingGraphsPanel open={open.graphiques} onToggle={toggleOf('graphiques')} folds={graphFolds} heartChartShown={heartChartShown}
                chartZoom={chartZoom} rows={chartRows} readers={chartReaders} timeX={timeX} markLines={markLines} hrMarkLines={hrMarkLines} zones={hrZones}
                onShowOnMap={() => zoomOnMap.show('graphiques')} polar={polarGraphData} speedUnit={speedUnit} zoomText={zoomText} />
            )}

            {open.cardio && heart.present && (
              <CardioTab id="sailing.cardio" track={track} minutes={trackMinutes} heart={heart} params={profile.heartRate} hrEnergy={profile.hrEnergy} zones={hrZones} runner={runner}
                onRetainHrMax={retainSessionHrMax} zone={hrZone}
                zoom={cardioZoom} onShowOnMap={showCardioOnMap}
                open={open.cardio} onToggle={toggleOf('cardio')} />
            )}

            {open.vmg && trackData.length > 0 && (vmgStats
              ? (
                <VmgPanel vmg={vmgStats} open={open.vmg} onToggle={toggleOf('vmg')} showKn={showKn} chartShown={vmgChartShown} chartZoom={chartZoom}
                  rows={chartRows} readers={chartReaders} timeX={timeX} markLines={markLines} onShowOnMap={() => zoomOnMap.show('vmg')} zoomText={zoomText}
                  selected={highlight.shownIn('vmg')} onSelect={(key) => highlight.show('vmg', key)} />
              )
              : renderEmptyPanel('vmg', 'Analyse VMG', 'la VMG se mesure', 'Pas de VMG mesurable sur cette session.'))}

            {open.sauts && jumpsVisible && (
              <JumpsPanel
                status={jumps.status}
                error={jumps.error}
                jumps={jumps.jumps}
                hiddenCount={jumps.hiddenCount}
                minHeightM={jumps.minHeightM}
                thresholdLabel={`${showThreshold(activeThresholdKn)} ${speedSymbol}`}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                open={open.sauts}
                onToggle={toggleOf('sauts')}
                shownJump={jumps.shownJump}
                onShowJump={jumps.showJump}
                podiumShown={jumps.podiumShown}
                onTogglePodium={jumps.togglePodium}
                trackIndexAt={trackIndexAt}
              />
            )}

            {flightsOpen && (
              <ResizablePanel id="sailing.vols" style={ANALYSIS_PANEL_STYLE}>
                <FlightsPanel
                  helpKey="voile:vols"
                  open={open.vols} onToggle={toggleOf('vols')}
                  help={<>
                    Vol : au-dessus du seuil d'activité ({showThreshold(activeThresholdKn)} {speedSymbol}), d'une traite, d'au moins {pumpDetection?.minFlightS ?? 0} s.
                    {flightPumping
                      ? " Décollage : vitesse GPS quand les chocs de la planche sur l'eau cessent (expérimental) ; séries et temps pompé : ceux de l'onglet pumping."
                      : ''}
                  </>}
                  flights={flights} podium={podiumFlights}
                  pumping={flightPumping} pumpSummary={pumpSummary}
                  shown={flightShown} onShow={(key) => highlight.show('vols', key)} accent={FAMILY_ACCENT.voile}
                  speedCell={(ms) => (ms === null ? '—' : formatSpeedValue(toDisplaySpeed(ms, speedUnit), speedUnit))}
                  unitLabel={SPEED_UNIT_LABEL[speedUnit]}
                  sensors={pumpSensors} />
              </ResizablePanel>
            )}

            {pumpingOpen && (
              <ResizablePanel id="sailing.pumping" style={ANALYSIS_PANEL_STYLE}>
                <PumpingPanel
                  helpKey="voile:pumping"
                  open={open.pumping} onToggle={toggleOf('pumping')}
                  help={<>
                    Pumping : en vol seulement (onglet vols), compté par séries de coups mesurées par les capteurs du téléphone fixé sur la poitrine ;
                    {pumpDetection
                      ? <> une série ne compte que si ses coups suivent une cadence régulière, de {pumpDetection.cadenceMinPerMin} à {pumpDetection.cadenceMaxPerMin} coups
                        par minute.</>
                      : null}
                    {' '}Cadence : coups par minute de la série ; vitesse : au début, puis à la fin de la série.
                  </>}
                  pumping={flightPumping} pumpSummary={pumpSummary} series={pumpSeriesList} seriesPodium={seriesPodium}
                  shown={pumpingShown} onShow={(key) => highlight.show('pumping', key)} accent={FAMILY_ACCENT.voile}
                  speedCell={(ms) => (ms === null ? '—' : formatSpeedValue(toDisplaySpeed(ms, speedUnit), speedUnit))}
                  unitLabel={SPEED_UNIT_LABEL[speedUnit]}
                  pumpingOn={pumping} sensors={pumpSensors} flightTimeS={flights.reduce((sum, f) => sum + f.durationS, 0)}
                  offNote="Cochez « Pumping » dans l'onglet réglages pour compter les séries de coups en vol, téléphone fixé sur la poitrine." />
              </ResizablePanel>
            )}

            {open.vent && trackData.length > 0 && !windStats && renderEmptyPanel('vent', 'Variations du Vent', 'ses variations se lisent aux manœuvres, qui se classent',
              'Il faut au moins deux manœuvres pour suivre le vent au fil de la session.')}
            {open.vent && windStats && (
              <WindPanel windStats={windStats} open={open.vent} onToggle={toggleOf('vent')} chartZoom={chartZoom} rows={chartRows} readers={chartReaders}
                timeX={timeX} markLines={markLines} onShowOnMap={() => zoomOnMap.show('vent')} zoomText={zoomText} />
            )}

            {open.matos && (
              /* Foil et mât sur foil seulement ; ce qui est saisi reste dans la fiche, et revient si l'on recoche. */
              <NotesTab id="sailing.matos" draft={draft} family="voile" conditions="voile"
                gearFields={foil ? SAILING_GEAR_FIELDS_FOIL : SAILING_GEAR_FIELDS} gearGroups={gearGroups} activityId={activity.id}
                open={open.matos} onToggle={toggleOf('matos')} />
            )}

            {open.reglages && (
              <SailingSettingsPanel open={open.reglages} onToggle={toggleOf('reglages')} draft={draft} draftRecord={draftRecord} hasDeviceSpeed={hasDeviceSpeed}
                activities={allActivities} activity={activity} sessionFile={sessionFile} onChangeActivity={(next) => changeSessionActivity(sessionFile, next)}
                hasActiveThreshold={hasActiveThreshold} activeThresholdKn={activeThresholdKn} defaultActiveThresholdKn={defaultActiveThresholdKn}
                deviceThresholdKn={deviceThresholdKn} foil={foil} activityPumping={activityPumping} pumping={pumping} showPumping={foil && profile.pump !== null}
                hasTrack={trackData.length > 0} referenceSpeedMs={referenceSpeedMs} speedUnit={speedUnit} colorRange={colorRange}
                showThreshold={showThreshold} speedSymbol={speedSymbol} />
            )}
          </>
        ),
      } : null} />
  );
}

export default SailingModule;