import { normalizeDeg } from '../core/angles';
import { roundTo } from '../core/basics';
import { useCallback, useEffect, useRef, useState, useMemo, type CSSProperties, type ReactNode } from 'react';
import { GraphFoldHead } from '../components/ChartFold';
import { HoverReadout, type Readout } from '../components/ChartReadout';
import { Polyline, Marker, CircleMarker, Popup } from 'react-leaflet';
import BaseTileLayer from '../components/BaseTileLayer';
import L from 'leaflet';
import type { DotItemDotProps } from 'recharts';
import './analysisMobile.css';
import { Link } from 'react-router-dom';
import { useAnalysisSession } from '../hooks/useAnalysisSession';
import { useAnalysisTabs } from '../hooks/useAnalysisTabs';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useSailingSession } from '../hooks/useSailingSession';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import { effectiveHrOffset, effectiveJumpSettings, useSportSettings } from '../hooks/useSportSettings';
import { useSessionJumps } from '../hooks/useSessionJumps';
import { useSessionPumping } from '../hooks/useSessionPumping';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { runnerHeartRateZones, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useSessionHeartRate } from '../hooks/useSessionHeartRate';
import { heartRateZonePaths } from '../core/heartRate';
import { useOpenSections } from '../hooks/useOpenSections';
import { useZoomOnMap } from '../hooks/useZoomOnMap';
import { ARROW_EVERY_S, CHART_MAX_POINTS, arrowIndices, trackBounds } from '../core/displayConfig';
import { SAILING_TABS, tabDefaults, type SailingTab } from '../core/analysisTabs';
import { sampledIndices, sampledIndicesKeeping, visibleIndexRange } from '../core/chartZoom';
import { nearestIndexAtTime } from '../core/search';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { FAMILY_ACCENT } from '../core/activities';
import { activeRatioLabel, hasPositions } from '../core/sportProfiles';
import { isValidSpeedRange } from '../core/speedGradient';
import { trackColorSegments } from '../core/trackColor';
import type { TopSegment } from '../core/types';
import { measureFlightPumping, summarizePumping, type FlightPumping } from '../core/pumping';
import {
  SPEED_UNIT_LABEL, SPEED_UNIT_SYMBOL, formatDistance, formatKnots, formatShortDuration, formatSpeed, formatSpeedValue, formatTimeOfDay,
  knotsToMs, toDisplaySpeed,
} from '../core/units';
import { speedPolar, type PolarBin } from '../sailing/wind';
import { MANEUVER_METRICS, windChartRows, type ManeuverMetric, type ManeuverTop, type WindGraphPoint } from '../sailing/sailingAnalytics';
import ActivitySelect from '../components/ActivitySelect';
import JumpsPanel from '../components/JumpsPanel';
import JumpMapLayer from '../components/JumpMapLayer';
import FlightPumpingPanel from '../components/FlightPumpingPanel';
import TrackSpanLayer, { type TrackSpanShown } from '../components/TrackSpanLayer';
import StatTile from '../components/ui/StatTile';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from '../components/highlightColors';
import HeartRateChart from '../components/HeartRateChart';
import HeartRatePanel, { CardioCompanion } from '../components/HeartRatePanel';
import { heartRateReadout, speedReadout } from '../components/chartReadouts';
import { HEART_RATE_COLOR } from '../components/heartRateColors';
import AnalysisMap, { ANALYSIS_MAP_ANCHOR } from '../components/AnalysisMap';
import { HoveredTrackMarker } from '../components/HoverMarker';
import TrackChart, { type TrackSeries, type TrackYAxis } from '../components/TrackChart';
import { zoomHint } from '../components/zoomHint';
import EmptyTabPanel from '../components/EmptyTabPanel';
import ResizablePanel from '../components/ResizablePanel';
import TopsPanel from '../components/TopsPanel';
import SessionThresholdField from '../components/SessionThresholdField';
import SessionNotesPanel, { type GearField } from '../components/SessionNotesPanel';
import CollapsibleSectionTabs from '../components/CollapsibleSectionTabs';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import { HelpText } from '../components/Help';
import { useHelp } from '../components/helpContext';
import PanelTitle, { SessionDate } from '../components/PanelTitle';
import SessionNameEditor from '../components/SessionNameEditor';
import GeneralStats from '../components/GeneralStats';
import WindCompass from '../components/WindCompass';
import WindAdjustOverlay from '../components/WindAdjustOverlay';
import SpeedPolarChart from '../components/SpeedPolarChart';
import { shareableStats, type ShareStat } from '../core/shareImage';
import SessionSaveBar from '../components/SessionSaveBar';
import { SessionMarksLayer, SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import SpeedRangeEditor from '../components/SpeedRangeEditor';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import MapToggle from '../components/ui/MapToggle';
import { ALTITUDE_COLOR, SAILING_SPEED_COLOR } from '../components/chartStyle';

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

/** Graphes de l'onglet « graphiques » dépliés tant qu'on ne les replie pas. */
const SAILING_GRAPH_FOLDS_DEFAULT = { vitesse: true, fc: true, polaire: true };
type SailingGraphFold = keyof typeof SAILING_GRAPH_FOLDS_DEFAULT;
/** Nom de chaque graphe de « graphiques », à la couleur de sa courbe (règle commune des noms, Q37). */
const SAILING_GRAPH_COLORS: Record<SailingGraphFold, string> = { vitesse: SAILING_SPEED_COLOR, fc: HEART_RATE_COLOR, polaire: ALTITUDE_COLOR };

const SAILING_PANEL_DEFAULTS = tabDefaults(SAILING_TABS);

// --- Utilitaires d'affichage ---

/** Courbe du vent : le trait et les points des manœuvres partagent la couleur. */
const WIND_COLOR = '#1565c0';
/** Graphe qui remplit son cadre (onglets « graphiques » et « vent »). */
const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
/** Graphe sous la carte en plein écran (téléphone). */
const COMPANION_CHART_STYLE: CSSProperties = { width: '100%', height: '200px', flex: 'none', marginBottom: '8px' };

/**
 * Point visible aux seules manœuvres : ailleurs la courbe du vent n'est qu'une
 * interpolation, et le graphe compte jusqu'à 500 points.
 */
const maneuverDot = (props: DotItemDotProps): ReactNode => {
  // Recharts ne type pas la ligne derrière le point : c'est un `WindGraphPoint`.
  const point: WindGraphPoint | undefined = props.payload;
  if (!point?.isManeuver) return null;
  return <circle cx={props.cx} cy={props.cy} r={3} fill={WIND_COLOR} stroke="var(--surface)" strokeWidth={1} />;
};

/** Curseur commun aux graphes de vitesse et de FC (Q38) : leurs lignes viennent des mêmes points. */
const SAILING_SYNC_ID = 'sailing';
/** Graduations des axes de la voile : encre grasse, sans unité. */
const SAILING_TICK = { fill: 'var(--ink)', fontSize: 11, fontWeight: 700 };
/** Axe de la vitesse : la largeur garde le tracé où le posaient la marge de −25 et l'axe de 60 px. */
const SPEED_AXES: TrackYAxis[] = [{ color: SAILING_SPEED_COLOR, domain: [0, 'auto'], width: 35, tick: SAILING_TICK }];
const SPEED_SERIES: TrackSeries<{ vitesse: number }>[] = [
  { kind: 'line', key: 'vitesse', name: 'vitesse', color: SAILING_SPEED_COLOR, width: 2, activeDotR: 4 },
];
/** Axe du vent, en degrés : la largeur garde le tracé où le posaient la marge de −20 et l'axe de 60 px. */
const WIND_AXES: TrackYAxis[] = [{
  color: WIND_COLOR, domain: ['dataMin - 15', 'dataMax + 15'], width: 40, tick: SAILING_TICK,
  tickFormatter: (val: number) => `${normalizeDeg(Math.round(val))}°`,
}];
const WIND_SERIES: TrackSeries<WindGraphPoint>[] = [
  { kind: 'line', key: 'angle', name: 'angle', color: WIND_COLOR, width: 2, activeDotR: 6, dot: maneuverDot },
];

const createArrowIcon = (bearing: number) => {
  return L.divIcon({
    className: 'custom-arrow',
    html: `<svg width="12" height="12" viewBox="0 0 24 24" style="transform: rotate(${bearing}deg); display: block;">
             <path d="M12 0L24 24L12 18L0 24Z" fill="#222" stroke="#fff" stroke-width="2"/>
           </svg>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

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
    requested: requestedFile, sessionFile, error: sessionError, draft, allActivities, changeActivity: changeSessionActivity,
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
    windStats,
    polarGraphData,
    windEstimate,
    windInputRequired,
    hasDeviceSpeed,
    loadError,
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
  });

  // Affichage dans l'unité de l'activité ; les analyses voile restent en nœuds (règle 5).
  const speedSymbol = SPEED_UNIT_SYMBOL[speedUnit];
  const showKn = (kn: number | string) => formatKnots(kn, speedUnit);
  /** Seuil saisi en nœuds, montré tel quel en nœuds, sinon converti. */
  // Arrondi au dixième : un seuil mis à l'échelle de l'allure sort en 7,999999… nœuds.
  const showThreshold = (kn: number) => (speedUnit === 'kn' ? String(roundTo(kn, 1)) : showKn(kn));
  // Polaire dans l'unité ; en nœuds, celle du hook telle quelle.
  const polarGraphShown = useMemo(
    () => (speedUnit === 'kn' ? polarGraphData : polarGraphData.map((p) => ({ ...p, vitesse: parseFloat(formatKnots(p.vitesse, speedUnit)) }))),
    [polarGraphData, speedUnit]
  );

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
  // Pas pendant un brouillon : la liste doit refléter l'état enregistré.
  const loadedFromMemory = sessionFile !== null && fileName === sessionFile && trackData.length > 0;
  const { dirty } = draft;
  useEffect(() => {
    if (!loadedFromMemory || !sessionFile || dirty || currentWindValue === null) return;
    if (tackSuccess === null || tackFail === null || jibeSuccess === null || jibeFail === null) return;
    updateSessionRecord(sessionFile, {
      maneuverCount: tackSuccess + tackFail + jibeSuccess + jibeFail,
      maneuverResults: { tackSuccess, tackFail, jibeSuccess, jibeFail },
    });
  }, [loadedFromMemory, sessionFile, dirty, currentWindValue, tackSuccess, tackFail, jibeSuccess, jibeFail]);

  // Sauts mesurés par les capteurs du téléphone : ceux de la fiche, sinon calculés depuis le `.imu`.
  const jumpsState = useSessionJumps(loadedFromMemory ? sessionFile : null, track, profile.id);
  const jumpSettings = effectiveJumpSettings(activity);
  const jumpMinHeightM = jumpSettings?.minHeightM ?? profile.jumps?.defaultMinHeightM ?? 0;
  /** Sauts montrés : la hauteur minimale de l'activité atteinte, pris au seuil d'activité ou plus. */
  const shownJumps = useMemo(() => {
    const thresholdMs = knotsToMs(activeThresholdKn);
    return jumpsState.jumps.filter((j) => j.heightM >= jumpMinHeightM && (j.speedMs === null || j.speedMs >= thresholdMs));
  }, [jumpsState.jumps, jumpMinHeightM, activeThresholdKn]);
  const jumpsVisible = jumpsState.status !== 'none';
  /** Support sur foil de la session : le sien s'il est réglé, sinon celui de l'activité. */
  const foil = edits.foil ?? activityFoil;
  /** Pumping de la session (brouillon, puis fiche), sinon celui de l'activité ; sur foil seulement (lot 22). */
  const pumping = foil && profile.pump !== null && (edits.pumping ?? activityPumping);
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe dans « graphiques ». */
  const { profile: runner, retainHr } = useRunnerProfile();
  const heart = useSessionHeartRate(track, profile.heartRate);
  const hrOffsetBpm = effectiveHrOffset(activity);
  const hrZones = useMemo(() => runnerHeartRateZones(runner, profile.heartRate, hrOffsetBpm), [runner, profile.heartRate, hrOffsetBpm]);
  // Onglets de l'activité, rangée « avancé », point survolé effacé à chaque session ; une seule surbrillance
  // sur la carte, effacée quand son onglet se ferme (`useMapHighlight`).
  const { open, toggle, toggleOf, advanced, shown, highlight } = useAnalysisTabs({
    storageId: 'sailing-onglets', tabs: SAILING_TABS, defaults: SAILING_PANEL_DEFAULTS, activity, sessionKey,
  });

  const notes = edits.notes;
  const setNotes = draft.updateNotes;
  /**
   * Graphes de l'onglet « graphiques » dépliés, chacun replié à part par son
   * titre pour ne comparer que ceux qui restent ouverts (16/10). Replié, un
   * graphe se réduit à son titre ; sa taille mémorisée l'attend.
   */
  const graphFolds = useOpenSections('sailing-graphes', SAILING_GRAPH_FOLDS_DEFAULT);
  const graphTitle = (key: SailingGraphFold, label: string, read?: (index: number) => Readout | null) => (
    <GraphFoldHead label={label} color={SAILING_GRAPH_COLORS[key]} open={graphFolds.open[key]} onToggle={() => graphFolds.toggle(key)} read={read}
      title={graphFolds.open[key] ? 'Replier ce graphe' : 'Montrer ce graphe'}
      style={{ justifyContent: read === undefined ? 'center' : undefined, marginBottom: '10px' }} />
  );
  const foldedGraph = (key: SailingGraphFold, label: string, widthPx: number) => (
    <div style={{ flex: 'none', width: `${widthPx}px`, maxWidth: '100%', boxSizing: 'border-box', border: '1px dashed var(--line-strong)', padding: '10px 10px 0', backgroundColor: 'var(--surface)' }}>
      {graphTitle(key, label)}
    </div>
  );
  // Pumping des vols, par les capteurs de la session : il suit les vols, donc le seuil du brouillon.
  // Capteurs lus à l'ouverture de l'onglet, Pumping coché : une capture entière pèse plusieurs Mo.
  const pumpSensors = useSessionPumping(loadedFromMemory ? sessionFile : null, pumping && open.pumping);
  /** Onglet « pumping » : sur foil, pour un calcul qui le mesure, si la session a ses capteurs ; Pumping décoché, il montre les vols. */
  const pumpingVisible = foil && profile.pump !== null && pumpSensors.hasMotion;
  const pumpingOpen = open.pumping && pumpingVisible;
  const sailingPanels = useMemo(
    () => shown((p) => (p.key !== 'sauts' || jumpsVisible) && (p.key !== 'pumping' || pumpingVisible)
      && (p.key !== 'cardio' || heart.present)),
    [shown, jumpsVisible, pumpingVisible, heart.present]
  );
  /** Top montré : de vitesse (onglet tops, `t2s`…) ou de VMG (onglet VMG, `vmgUpwind`, `vmgDownwind`), ou `none`. */
  const selectedTopMap = highlight.shownIn('tops') ?? highlight.shownIn('vmg') ?? 'none';
  /** Podium de manœuvres montré : `tack:conservation`, `jibe:distance`, ou `none`. */
  const selectedManeuverTop = highlight.shownIn('manoeuvres') ?? 'none';
  /** Sauts montrés : le podium des trois plus hauts (`podium`), ou un saut, par l'heure de son décollage. */
  const jumpHighlight = highlight.shownIn('sauts');
  const jumpPodiumShown = jumpHighlight === 'podium';
  const shownJump = jumpHighlight !== null && !jumpPodiumShown ? Number(jumpHighlight) : null;
  const pumpDetection = profile.pump;
  const flightPumping = useMemo(() => {
    if (!pumpSensors.recording || !pumpDetection || flights.length === 0) return null;
    const list = measureFlightPumping(pumpSensors.recording, pumpDetection, track, cumulative, flights);
    return new Map(list.flatMap((x): [number, FlightPumping][] => (x ? [[x.n, x]] : [])));
  }, [pumpSensors.recording, pumpDetection, track, cumulative, flights]);
  const pumpSummary = useMemo(() => (flightPumping ? summarizePumping([...flightPumping.values()]) : null), [flightPumping]);
  /** Les 3 plus longs vols, le résumé de l'onglet. */
  const podiumFlights = useMemo(() => [...flights].sort((a, b) => b.durationS - a.durationS).slice(0, 3), [flights]);
  /** Vol montré sur la carte (onglet « pumping ») : son numéro, ou le podium (`podium`). */
  const flightShown = highlight.shownIn('pumping');
  const shownFlightSpans = useMemo((): TrackSpanShown[] => {
    const spanLabel = (f: (typeof flights)[number]) =>
      `Vol ${f.n} · ${formatTimeOfDay(f.startMs)} · ${formatShortDuration(f.durationS)} · ${Math.round(f.distanceM)} m`;
    if (flightShown === 'podium') {
      return podiumFlights.map((f, k) => ({ key: `vol-${f.n}`, start: f.start, end: f.end, color: HIGHLIGHT_PODIUM_COLORS[k], label: spanLabel(f) }));
    }
    const f = flightShown === null ? undefined : flights.find((x) => String(x.n) === flightShown);
    return f ? [{ key: `vol-${f.n}`, start: f.start, end: f.end, color: HIGHLIGHT_SHOWN_COLOR, label: spanLabel(f) }] : [];
  }, [flightShown, flights, podiumFlights]);
  /** Zone cardiaque montrée sur la carte (onglet « cardio »). */
  const shownHrZone = highlight.shownIn('cardio');
  const selectedHrZone = shownHrZone === null ? null : Number(shownHrZone);
  const hrZonePaths = useMemo(
    () => (selectedHrZone !== null && open.cardio && heart.present && hrZones
      ? heartRateZonePaths(track, heart.smoothed, hrZones.bounds, selectedHrZone, profile.heartRate.gapS)
      : []),
    [selectedHrZone, open.cardio, heart, hrZones, track, profile.heartRate.gapS]
  );
  // Repères du bouton « Note » : fanions, liste de « Général », traits des graphes.
  const marks = useSessionMarks(draft, track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);

  /** Bornes du dégradé de couleur de la trace, en m/s : celles de la session, sinon de Réglages, sinon la suggestion. */
  const colorRange = edits.speedRange ?? speedRange ?? suggestedSpeedRangeMs;

  const [showTacksOnMap, setShowTacksOnMap] = useState<boolean>(false);
  const [showJibesOnMap, setShowJibesOnMap] = useState<boolean>(false);
  const [showManeuverDetails, setShowManeuverDetails] = useState<boolean>(false);
  /** Explications repliées derrière un « ? » (enregistrement et virages écartés ; lecture du vent). */
  const maneuverHelpOpen = useHelp('voile:manoeuvres')?.open ?? false;
  const windHelpOpen = useHelp('voile:vent')?.open ?? false;
  /** Réglage du vent sur la carte, ouvert par « Régler » ; sur téléphone, dans la carte en plein écran. */
  const [windAdjust, setWindAdjust] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);

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
  const generalStats: ShareStat[] = stats ? [
    { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
    ...(hasActiveThreshold ? [{ key: 'activeDistance', label: 'Distance active', value: formatDistance(stats.activeDistanceM, distanceUnit) }] : []),
    { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
    ...(hasActiveThreshold ? [
      { key: 'activeTime', label: `${activeTimeWord} (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: stats.activeTime },
      { key: 'activeRatio', label: activeRatioLabel(profile, foil), value: `${stats.activeRatio}%` },
    ] : []),
    { key: 'averageSpeed', label: 'Vitesse moyenne', value: formatSpeed(stats.avgSpeedMs, speedUnit) },
    ...(hasActiveThreshold ? [
      { key: 'activeAverage', label: `Moyenne active (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: formatSpeed(stats.activeAvgSpeedMs, speedUnit) },
    ] : []),
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
      { key: 'activeRatio', label: activeRatioLabel(profile, foil), value: `${stats.activeRatio}%` },
      { key: 'activeAverage', label: `Moyenne ${activeWord}`, value: formatSpeed(stats.activeAvgSpeedMs, speedUnit) },
    ] : [
      { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
      { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
      { key: 'averageSpeed', label: 'Vitesse moyenne', value: formatSpeed(stats.avgSpeedMs, speedUnit) },
    ]),
    { key: 'tacks', label: 'Virements réussis', value: maneuverRate(maneuverSummary.tack) },
    { key: 'jibes', label: 'Empannages réussis', value: maneuverRate(maneuverSummary.jibe) },
    { key: 'top2s', label: 'Top 2 s', value: topValue(stats.tops.t2s[0]) },
    { key: 'top100m', label: 'Top 100 m', value: topValue(stats.tops.d100m[0]) },
  ] : [];
  const arrowLayers = useMemo(
    () => arrowIndices(trackData, ARROW_EVERY_S).map((index, idx) => {
      const point = trackData[index];
      return <Marker key={`arrow-${idx}`} position={[point.lat, point.lon]} icon={createArrowIcon(point.bearing)} />;
    }),
    [trackData]
  );

  const staticMapLayers = useMemo(() => {
    if (trackData.length === 0) return null;

    let topArray: Pick<TopSegment, 'val' | 'path'>[] | undefined;
    if (selectedTopMap === 'vmgUpwind') topArray = vmgStats?.topsUpwind;
    else if (selectedTopMap === 'vmgDownwind') topArray = vmgStats?.topsDownwind;
    else topArray = stats?.tops[selectedTopMap as keyof typeof stats.tops];

    return (
      <>
        {maneuverStats?.locations.map((loc, idx) => {
          if ((loc.type === 'tack' && !showTacksOnMap) || (loc.type === 'jibe' && !showJibesOnMap)) return null;
          return (
            <CircleMarker
              key={`maneuver-${idx}`}
              center={[loc.lat, loc.lon]}
              radius={6}
              pathOptions={{
                color: loc.success ? '#388e3c' : '#d32f2f',
                fillColor: loc.type === 'tack' ? '#fff' : '#000',
                fillOpacity: 1,
                weight: 3
              }}>
              <Popup>{loc.type === 'tack' ? 'Virement' : 'Empannage'} {loc.success ? 'Réussi' : 'Raté'} - Vmin: {formatKnots(loc.vmin, speedUnit)} {SPEED_UNIT_SYMBOL[speedUnit]}</Popup>
            </CircleMarker>
          );
        })}

        {topArray?.map((top, idx) => {
          if (top.path.length === 0) return null;
          const highlightColor = HIGHLIGHT_PODIUM_COLORS[idx] ?? HIGHLIGHT_PODIUM_COLORS[2];
          return (
            <Polyline
              key={`top-${selectedTopMap}-${idx}`}
              positions={top.path}
              pathOptions={{ color: highlightColor, weight: 10, opacity: 0.8 }}
            />
          );
        })}

        {maneuverTopArray.map((top, idx) => {
          if (top.path.length < 2) return null;
          const highlightColor = HIGHLIGHT_PODIUM_COLORS[idx] ?? HIGHLIGHT_PODIUM_COLORS[2];
          return (
            <Polyline
              key={`maneuver-top-${selectedManeuverTop}-${idx}`}
              positions={top.path}
              pathOptions={{ color: highlightColor, weight: 10, opacity: 0.85 }}>
              <Popup>{idx + 1}{idx === 0 ? 'er' : 'e'} · {formatTimeOfDay(top.timeMs)} · {top.label}</Popup>
            </Polyline>
          );
        })}
      </>
    );
  }, [trackData, maneuverStats, showTacksOnMap, showJibesOnMap, selectedTopMap, stats, vmgStats, maneuverTopArray, selectedManeuverTop, speedUnit]);

  const mapBounds = useMemo(() => trackBounds(trackData), [trackData]);

  const narrow = useNarrowScreen();
  /**
   * Temps écoulé de chaque point, en minutes : l'axe des graphes de vitesse et du vent. `chartZoom` est
   * commun à ces graphes, qui partagent leur axe ; `cardioZoom` est celui de la courbe de l'onglet « cardio » ;
   * « tout voir » à chaque session.
   */
  const timeChart = useTimeChartAxis(trackData, sessionKey);
  const { minutes: trackMinutes, zoom: chartZoom, cardioZoom } = timeChart;
  /** Points de trace des graphes sur la plage visible, au plus `CHART_MAX_POINTS` : zoomer montre plus de détail. */
  const speedSeries = useMemo(() => trackData.map((p) => p.smoothedSpeed), [trackData]);
  const visibleRange = useMemo(
    () => (trackData.length === 0 ? null : visibleIndexRange(trackMinutes, chartZoom.view)),
    [trackData, trackMinutes, chartZoom.view]
  );
  /** Lignes de la vitesse et de la FC : les extrêmes de l'une et de l'autre restent (un pic bref de FC aussi). */
  const chartIndices = useMemo(() => {
    if (!visibleRange) return [];
    return sampledIndicesKeeping(visibleRange[0], visibleRange[1], CHART_MAX_POINTS, heart.present ? [speedSeries, heart.smoothed] : [speedSeries]);
  }, [visibleRange, speedSeries, heart]);
  /** Lignes du vent : ses points suivent la vitesse seule. */
  const windIndices = useMemo(
    () => (visibleRange ? sampledIndices(visibleRange[0], visibleRange[1], CHART_MAX_POINTS, speedSeries) : []),
    [visibleRange, speedSeries]
  );
  const speedRows = useMemo(
    () => chartIndices.map((i) => ({ index: i, minutes: trackMinutes[i], vitesse: parseFloat(formatKnots(trackData[i].smoothedSpeed, speedUnit)) })),
    [chartIndices, trackMinutes, trackData, speedUnit]
  );
  const heartRows = useMemo(
    () => (heart.present ? chartIndices.map((i) => ({ index: i, minutes: trackMinutes[i], hr: heart.smoothed[i] === null ? null : Math.round(heart.smoothed[i]!) })) : []),
    [heart, chartIndices, trackMinutes]
  );
  const windRows = useMemo(
    () => (windStats ? windChartRows(trackData, windStats, windIndices) : []),
    [windStats, trackData, windIndices]
  );
  /** Traits des repères sur les graphes, en minutes depuis le premier point. */
  const markLines = markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark);
  /** « +carte » des graphes zoomés : tronçon en violet, cadrage, plein écran carte + graphes au téléphone. */
  const zoomOnMap = useZoomOnMap({
    highlight,
    points: trackData,
    charts: {
      graphiques: { zoom: chartZoom, axis: trackMinutes },
      vent: { zoom: chartZoom, axis: trackMinutes },
      cardio: { zoom: cardioZoom, axis: trackMinutes },
    },
    narrow,
    mapAnchorId: ANALYSIS_MAP_ANCHOR,
    mapExpanded,
    openMap: () => setMapExpanded(true),
  });
  /** Point survolé lu au-dessus des graphes de vitesse, de FC et du vent (`HoverReadout`), s'il est dans la plage zoomée. */
  const readable = (i: number): boolean => timeChart.readable(chartZoom, i);
  const readAt = timeChart.readAt;
  const readSpeed = (i: number): Readout | null => (readable(i)
    ? speedReadout(`${showKn(trackData[i].smoothedSpeed)} ${speedSymbol}`, readAt(i), SAILING_SPEED_COLOR)
    : null);
  const readHeart = (i: number): Readout | null => (readable(i) ? heartRateReadout(heart.smoothed[i], readAt(i)) : null);
  const windReadout = (i: number): Readout | null => {
    if (!readable(i) || !windStats) return null;
    const direction = windStats.windAt(trackData[i].timeMs);
    return { values: [{ text: direction === null ? '—' : `${normalizeDeg(Math.round(direction))}°`, color: WIND_COLOR }], at: readAt(i) };
  };
  const zoomText = zoomHint(narrow);

  /** Graphe de vitesse : dans l'onglet « graphiques », et sous la carte en plein écran. */
  const speedChart = (style: CSSProperties) => (
    <TrackChart rows={speedRows} zoom={chartZoom} x={timeChart.timeX} yAxes={SPEED_AXES} series={SPEED_SERIES} syncId={SAILING_SYNC_ID}
      onShowOnMap={() => zoomOnMap.show('graphiques')} style={style}>
      {markLines}
    </TrackChart>
  );
  /** Graphe du vent : dans l'onglet « vent », et sous la carte en plein écran. */
  const windChart = (style: CSSProperties) => (
    <TrackChart rows={windRows} zoom={chartZoom} x={timeChart.timeX} yAxes={WIND_AXES} series={WIND_SERIES}
      onShowOnMap={() => zoomOnMap.show('vent')} style={style}>
      {markLines}
    </TrackChart>
  );
  /** Courbe de FC de « graphiques », sur le temps de la session ; ses boutons de zoom quand la vitesse est repliée. */
  const heartChart = (style: CSSProperties) => (
    <HeartRateChart data={heartRows} zoom={chartZoom} x={timeChart.timeX} zones={hrZones?.bounds ?? null} thresholds={hrZones ? { s1: hrZones.s1, s2: hrZones.s2 } : null}
      syncId={SAILING_SYNC_ID} showReset={!graphFolds.open.vitesse} onShowOnMap={() => zoomOnMap.show('graphiques')} style={style}>
      {markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark, 'hr')}
    </HeartRateChart>
  );
  /** Graphes de l'onglet d'où vient « +carte », sous la carte en plein écran (téléphone). */
  const companionCharts = (panel: SailingTab | null): ReactNode => {
    switch (panel) {
      case 'graphiques':
        return (
          <>
            {graphFolds.open.vitesse && (
              <>
                <HoverReadout line read={readSpeed} label="Vitesse" color={SAILING_SPEED_COLOR} />
                {speedChart(COMPANION_CHART_STYLE)}
              </>
            )}
            {heart.present && heartRows.length > 1 && graphFolds.open.fc && (
              <>
                <HoverReadout line read={readHeart} label="FC" color={HEART_RATE_COLOR} />
                {heartChart(COMPANION_CHART_STYLE)}
              </>
            )}
          </>
        );
      case 'vent':
        return windStats ? (
          <>
            <HoverReadout line read={windReadout} label="Vent" color={WIND_COLOR} />
            {windChart(COMPANION_CHART_STYLE)}
          </>
        ) : null;
      case 'cardio':
        return <CardioCompanion minutes={trackMinutes} heart={heart} zoom={cardioZoom} zones={hrZones} onShowOnMap={() => zoomOnMap.show('cardio')} style={COMPANION_CHART_STYLE} />;
      default:
        return null;
    }
  };

  /** Podium de VMG (près, portant) : les tops de vitesse passent par `TopsPanel`. */
  const renderTop3 = (panel: 'vmg', title: string, topKey: string, values: Pick<TopSegment, 'val' | 'path'>[]) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <strong>{title}</strong>
        <MapToggle
          shown={selectedTopMap === topKey} color="var(--voile)" labels={['Voir (Carte)', 'Masquer (Carte)']}
          onClick={() => highlight.show(panel, selectedTopMap === topKey ? null : topKey)} />
      </div>
      <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-s)', marginTop: '4px' }}>
        {['1er', '2e', '3e'].map((rank, idx) => (
          <span key={rank} style={{ color: HIGHLIGHT_PODIUM_COLORS[idx], fontWeight: 700 }}>{rank}: {values[idx] ? showKn(values[idx].val) : '-'}</span>
        ))}
      </div>
    </div>
  );

  /** Ouvre le réglage du vent sur la carte : en plein écran sur téléphone, la carte ramenée à l'écran sinon. */
  const startWindAdjust = () => {
    setWindAdjust(true);
    if (narrow) setMapExpanded(true);
    else document.getElementById(ANALYSIS_MAP_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const endWindAdjust = () => {
    setWindAdjust(false);
    setMapExpanded(false);
  };
  /** Polaire à un vent donné, dans l'unité : elle suit la flèche pendant qu'on règle le vent. */
  const polarMinSpeedKn = maneuverThresholds.polarMinSpeedKn;
  const polarAt = useCallback((deg: number): PolarBin[] => {
    const bins = speedPolar(trackData, deg, polarMinSpeedKn);
    return speedUnit === 'kn' ? bins : bins.map((p) => ({ ...p, vitesse: parseFloat(formatKnots(p.vitesse, speedUnit)) }));
  }, [trackData, polarMinSpeedKn, speedUnit]);

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

  /** Panneaux VMG et manœuvres, parmi les onglets sous la carte. */
  const renderVmgPanel = (v: NonNullable<typeof vmgStats>) => (
    <ResizablePanel id="sailing.carte.vmg" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label="Analyse VMG" open={open.vmg} onToggle={toggleOf('vmg')} />
      </div>
      <table style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)', borderBottom: '1px solid var(--line-strong)' }}>
            <th>Allure</th>
            <th style={{ color: '#d32f2f' }}>Bâbord (Moy/Max)</th>
            <th style={{ color: '#388e3c' }}>Tribord (Moy/Max)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ textAlign: 'left', padding: '4px' }}>Près</td>
            <td>{showKn(v.upPort.avg)} / <strong>{showKn(v.upPort.max)}</strong></td>
            <td>{showKn(v.upStbd.avg)} / <strong>{showKn(v.upStbd.max)}</strong></td>
          </tr>
          <tr>
            <td style={{ textAlign: 'left', padding: '4px' }}>Portant</td>
            <td>{showKn(v.downPort.avg)} / <strong>{showKn(v.downPort.max)}</strong></td>
            <td>{showKn(v.downStbd.avg)} / <strong>{showKn(v.downStbd.max)}</strong></td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: '30px', marginTop: '15px', flexWrap: 'wrap' }}>
        <div>
          {renderTop3('vmg', "Tops Près (10s)", "vmgUpwind", v.topsUpwind)}
        </div>
        <div>
          {renderTop3('vmg', "Tops Portant (10s)", "vmgDownwind", v.topsDownwind)}
        </div>
      </div>
    </ResizablePanel>
  );

  const renderManeuversPanel = (m: NonNullable<typeof maneuverStats>) => (
    <ResizablePanel id={showManeuverDetails ? 'sailing.carte.manoeuvres.details' : 'sailing.carte.manoeuvres'} style={{ ...CARD_STYLE, ...(showManeuverDetails ? { flex: '1 1 100%' } : HALF_PANEL_STYLE), padding: '12px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <PanelTitle label="Manœuvres" open={open.manoeuvres} onToggle={toggleOf('manoeuvres')} helpKey="voile:manoeuvres" />
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>réussie si Vmin &ge; {showThreshold(activeThresholdKn)} {speedSymbol}</span>
      </div>

      <div className="an-man-scroll">
      <table className="an-man-summary" style={{ borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginBottom: '10px' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
            <th style={{ textAlign: 'left', padding: '7px 14px' }}>Type</th>
            <th style={{ padding: '7px 14px' }}>Réussis</th>
            <th style={{ padding: '7px 14px' }}>Ratés</th>
            <th style={{ padding: '7px 14px' }} title="Vitesse minimale pendant la manœuvre, moyenne sur toutes les manœuvres">Vmin moy. ({speedSymbol})</th>
            <th style={{ padding: '7px 14px' }} title="Meilleure vitesse minimale conservée sur une manœuvre">Vmin max ({speedSymbol})</th>
            <th style={{ padding: '7px 10px' }}>Carte</th>
          </tr>
        </thead>
        <tbody>
          {([
            ['Virements', maneuverSummary.tack, showTacksOnMap, () => setShowTacksOnMap(!showTacksOnMap)],
            ['Empannages', maneuverSummary.jibe, showJibesOnMap, () => setShowJibesOnMap(!showJibesOnMap)],
          ] as const).map(([label, summary, shown, toggle]) => (
            <tr key={label} style={{ borderTop: '1px solid var(--line-soft)' }}>
              <td style={{ padding: '7px 14px', fontWeight: 700 }}>{label}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#388e3c', fontWeight: 700, fontSize: 'var(--text-m)' }}>{summary?.success ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#d32f2f', fontSize: 'var(--text-m)' }}>{summary?.fail ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center' }}>{summary ? showKn(summary.vminAvg) : '-'}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', fontWeight: 700 }}>{summary ? showKn(summary.vminMax) : '-'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                <MapToggle shown={shown} color="var(--voile)" title={`Afficher les ${label.toLowerCase()} sur la carte`} onClick={toggle}
                  style={{ padding: '3px 10px', border: 'none' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {maneuverHelpOpen && (<>
      <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
        <strong>Enregistrement :</strong> {pointCount} points, un toutes les {samplingS < 10 ? samplingS.toFixed(1) : Math.round(samplingS)} s en médiane. Entrée de virage retenue au-dessus de {showKn(maneuverThresholds.minEntrySpeedKn)} {speedSymbol}, d'après l'allure de la session.
        {samplingS > 10 && (
          <>
            {' '}Cadence économique : les manœuvres se lisent encore, mais leur qualité
            (Vmin, relance) et les tops courts reposent sur des moyennes de plusieurs
            dizaines de secondes.
          </>
        )}
      </p>

      {(m.rejected.unclassified > 0 ||
        m.rejected.slowEntry > 0 ||
        m.rejected.incoherent > 0 ||
        m.rejected.tooShort > 0 ||
        m.rejected.noFlight > 0 ||
        m.rejected.fullTurn > 0) && (
        <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
          <strong>{m.locations.length} virage{m.locations.length > 1 ? 's' : ''} retenu{m.locations.length > 1 ? 's' : ''}</strong>, et d'autres écartés en chemin :
          {m.rejected.noFlight > 0 && (
            <>
              <br />
              <strong>{m.rejected.noFlight}</strong> demi-tour{m.rejected.noFlight > 1 ? 's' : ''} hors {foil ? 'vol' : 'navigation'} : entamé{m.rejected.noFlight > 1 ? 's' : ''} sous le seuil {foil ? 'de vol' : 'de navigation'}, ni réussi{m.rejected.noFlight > 1 ? 's' : ''} ni raté{m.rejected.noFlight > 1 ? 's' : ''}.
            </>
          )}
          {m.rejected.fullTurn > 0 && (
            <>
              <br />
              <strong>{m.rejected.fullTurn}</strong> tour{m.rejected.fullTurn > 1 ? 's' : ''} complet{m.rejected.fullTurn > 1 ? 's' : ''}, non compté{m.rejected.fullTurn > 1 ? 's' : ''}.
            </>
          )}
          {m.rejected.unclassified > 0 && (
            <>
              <br />
              <strong>{m.rejected.unclassified}</strong> franc{m.rejected.unclassified > 1 ? 's' : ''} et net{m.rejected.unclassified > 1 ? 's' : ''}, mais sans changer d'amures ou ni face au vent ni au vent arrière : ce sont des abattées ou des remontées — ou le vent retenu est faux, ce qui range tous les demi-tours au travers.
            </>
          )}
          {m.rejected.slowEntry > 0 && (
            <>
              <br />
              <strong>{m.rejected.slowEntry}</strong> entamé{m.rejected.slowEntry > 1 ? 's' : ''} trop lentement (moins de {showKn(maneuverThresholds.minEntrySpeedKn)} {speedSymbol} à l'entrée).
            </>
          )}
          {m.rejected.incoherent > 0 && (
            <>
              <br />
              <strong>{m.rejected.incoherent}</strong> dont le cap partait dans tous les sens, ou se lisait à l'arrêt : chute ou hésitation.
            </>
          )}
          {m.rejected.tooShort > 0 && (
            <>
              <br />
              <strong>{m.rejected.tooShort}</strong> sur place, moins de 10 m parcourus : à cette distance le cap n'est que du bruit de position.
            </>
          )}
        </p>
      )}
      {showManeuverDetails && (
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 'var(--text-xs)', lineHeight: 1.45 }}>
          Survolez une ligne pour la définition, une case du podium pour l'heure de la manœuvre. Le podium retient la meilleure valeur : conservation la plus haute, relance la plus courte, cap (virements seulement) et distance les plus faibles, gain au vent le plus grand ; à égalité, la meilleure conservation.
        </p>
      )}
      </>)}

      <button
        onClick={() => setShowManeuverDetails(!showManeuverDetails)}
        style={{ padding: '4px 10px', cursor: 'pointer', backgroundColor: showManeuverDetails ? 'var(--voile)' : 'var(--surface-sunken)', color: showManeuverDetails ? 'var(--on-accent)' : 'var(--ink)', border: 'none', borderRadius: '4px', fontSize: 'var(--text-xs)' }}>
        {showManeuverDetails ? 'Replier les détails ▲' : 'Détails des manœuvres ▼'}
      </button>

      {showManeuverDetails && (
      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '12px' }}>
        {([
          ['tack', 'Virements', maneuverSummary.tack],
          ['jibe', 'Empannages', maneuverSummary.jibe],
        ] as const).map(([type, title, summary]) => (
          <div key={type} className="an-man-detail" style={{ flex: '1 1 380px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <strong className="ui-subtitle">{title}</strong>
              {summary ? (
                <span style={{ fontSize: 'var(--text-s)' }}>
                  <span style={{ color: '#388e3c', fontWeight: 700 }}>{summary.success} réussi{summary.success > 1 ? 's' : ''}</span>
                  {' · '}
                  <span style={{ color: '#d32f2f' }}>{summary.fail} raté{summary.fail > 1 ? 's' : ''}</span>
                  {' · Vmin moy. '}{showKn(summary.vminAvg)}{` ${speedSymbol}, max `}<strong>{showKn(summary.vminMax)}</strong>{` ${speedSymbol}`}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)' }}>aucun</span>
              )}
            </div>

            {summary && (
              <table className="an-man-podium" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 'normal' }}>Métrique</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal' }}>Moyenne</th>
                    {['1er', '2e', '3e'].map((rank, idx) => (
                      <th key={rank} style={{ padding: '3px 4px', fontWeight: 'normal', color: HIGHLIGHT_PODIUM_COLORS[idx] }}>{rank}</th>
                    ))}
                    <th style={{ padding: '3px 4px' }} />
                  </tr>
                </thead>
                <tbody>
                  {MANEUVER_METRICS.map((metric) => {
                    const key = `${type}:${metric.key}`;
                    const active = selectedManeuverTop === key;
                    const tops = summary.tops[metric.key];
                    const ranked = metric.ranked.includes(type);
                    return (
                      <tr key={metric.key} title={metric.hint} style={{ borderBottom: '1px solid var(--line-soft)', backgroundColor: active ? 'var(--voile-soft)' : 'transparent' }}>
                        <td style={{ padding: '4px', textAlign: 'left' }}>{metric.label}</td>
                        <td style={{ padding: '4px', textAlign: 'center', fontWeight: 700 }}>
                          {summary.averages[metric.key]}
                          {metric.key === 'relaunch' && summary.withoutRelaunch > 0 && (
                            <span style={{ display: 'block', fontWeight: 'normal', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
                              {summary.withoutRelaunch} sans relance
                            </span>
                          )}
                        </td>
                        {[0, 1, 2].map((rank) => (
                          <td key={rank} title={tops[rank] ? formatTimeOfDay(tops[rank].timeMs) : undefined} style={{ padding: '4px', textAlign: 'center' }}>
                            {ranked ? tops[rank]?.label ?? '-' : '—'}
                          </td>
                        ))}
                        <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                          <MapToggle
                            shown={active} color="var(--voile)" labels={['Carte', 'Masquer']} disabled={tops.length === 0}
                            onClick={() => highlight.show('manoeuvres', active ? null : key)}
                            style={{ padding: '2px 7px', opacity: tops.length === 0 ? 0.5 : 1 }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      )}
    </ResizablePanel>
  );

  /** Point de trace le plus proche d'un instant : relie la courbe d'un saut à la carte. */
  const trackIndexAt = useCallback((ms: number): number => nearestIndexAtTime(trackData, ms), [trackData]);

  /** Contenu partagé par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <>
      <BaseTileLayer family={'voile'} />

      {trackData.length > 0 && <TrackSegmentsLayer segments={mapSegments} weight={5} family={'voile'} />}
      {arrowLayers}
      {staticMapLayers}
      <JumpMapLayer track={trackData} jumps={shownJumps} shownJump={shownJump} podiumShown={jumpPodiumShown} />
      <TrackSpanLayer track={track} spans={shownFlightSpans} />
      {hrZonePaths.map((path, idx) => (
        <Polyline key={`cardio-${selectedHrZone}-${idx}`} positions={path} pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 }} />
      ))}

      {zoomOnMap.path.length > 1 && (
        <Polyline key="zoom" positions={zoomOnMap.path} pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 }} />
      )}

      <SessionMarksLayer located={marks.located} shownMs={shownMark} />
      <HoveredTrackMarker points={trackData} />
    </>
  );

  return (
    <div className="an-page" style={{ padding: '20px' }}>
      <div className="an-sheet">
        <div className="an-sheet__head">
          <PageHeader title="Analyse voile" subtitle={requestedFile ? (
            <SessionNameEditor file={requestedFile}
              share={generalStats.length > 0 ? { family: 'voile', segments: mapSegments, stats: shareableStats(generalStats) } : undefined} />
          ) : undefined} back={{ to: libraryPath('voile'), label: 'Sessions voile' }} />
          {sessionError && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError}</div>}
        </div>
      </div>

      {/* Barre visible pendant un brouillon seulement : rien ne s'affiche quand tout est enregistré. */}
      {loadedFromMemory && <SessionSaveBar draft={draft} />}

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

      {trackData.length === 0 && requestedFile === null && (
        <p style={{ color: 'var(--muted)' }}>
          Aucune session ouverte : choisissez-en une dans <Link to={libraryPath('voile')}>Sessions voile</Link>.
        </p>
      )}


      <div className="an-map-row" style={{ marginTop: '10px', zIndex: 0 }}>
        <AnalysisMap
          panelId="sailing.carte"
          anchorId={ANALYSIS_MAP_ANCHOR}
          sessionKey={sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={480}
          expanded={mapExpanded}
          focus={zoomOnMap.focus}
          companion={companionCharts(zoomOnMap.companionPanel)}
          onExpandedChange={(next) => {
            setMapExpanded(next);
            if (!next) zoomOnMap.closeCompanion();
            // Fermer la carte agrandie termine le réglage commencé dedans.
            if (!next) setWindAdjust(false);
          }}
          overlay={windAdjust && trackData.length > 0 ? (
            <WindAdjustOverlay windDeg={currentWindValue} autoWind={autoWind} confidence={windEstimate?.confidence ?? null}
              manual={edits.windDeg !== null} onChange={(deg) => draft.update({ windDeg: deg })} onClose={endWindAdjust}
              polarAt={polarAt} unitSymbol={speedSymbol} />
          ) : undefined}
          legend={trackData.length > 0 ? (
            <SpeedGradientLegend unit={speedUnit} range={colorRange}
              slowLabel={`sous ${Math.round(toDisplaySpeed(colorRange.minMs, speedUnit))} ${speedSymbol}`} />
          ) : null} />
      </div>

      {/* Onglets sous la carte, et leurs panneaux deux par ligne sur ordinateur (`docs/MISE_EN_PAGE.md`). */}
      {stats && (
        <div className="an-carte-col">
          <CollapsibleSectionTabs sections={sailingPanels} open={open} onToggle={toggle} advancedOpen={advanced.open} onToggleAdvanced={advanced.toggle} />
          <div className="an-carte-panels">
            {open.general && (
              <ResizablePanel id="sailing.general" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Général" extra={<SessionDate track={trackData} />} open={open.general} onToggle={toggleOf('general')} />
                </div>
                <GeneralStats stats={overviewStats} />
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
              <ResizablePanel id="sailing.tops" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
                <TopsPanel targets={profile.topTargets} tops={stats.tops} unit={speedUnit} selected={highlight.shownIn('tops')}
                  onSelect={(key) => highlight.show('tops', key)} accent={FAMILY_ACCENT.voile} open={open.tops} onToggle={toggleOf('tops')} />
              </ResizablePanel>
            )}

            {open.manoeuvres && trackData.length > 0 && (maneuverStats
              ? renderManeuversPanel(maneuverStats)
              : renderEmptyPanel('manoeuvres', 'Manœuvres', 'virements et empannages se reconnaissent', 'Aucune manœuvre reconnue sur cette session.'))}

            {open.graphiques && (
              <div style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 100%' }}>
                  <PanelTitle label="Graphiques" open={open.graphiques} onToggle={toggleOf('graphiques')} helpKey="voile:graphiques" />
                  <HelpText helpKey="voile:graphiques" note>Le survol déplace le repère sur la carte. {zoomText}</HelpText>
                </div>

                {graphFolds.open.vitesse ? (
                <ResizablePanel id="sailing.graph.vitesse" defaultHeight={350} minWidth={250} minHeight={200} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  {graphTitle('vitesse', 'Historique de Vitesse', readSpeed)}
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    {speedChart(FILL_STYLE)}
                  </div>
                </ResizablePanel>
                ) : foldedGraph('vitesse', 'Historique de Vitesse', 500)}

                {heart.present && heartRows.length > 1 && (
                  graphFolds.open.fc ? (
                  <ResizablePanel id="sailing.graph.fc" defaultHeight={250} minWidth={250} minHeight={160} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                    {graphTitle('fc', 'Fréquence cardiaque', readHeart)}
                    <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                      {heartChart(FILL_STYLE)}
                    </div>
                  </ResizablePanel>
                  ) : foldedGraph('fc', 'Fréquence cardiaque', 500)
                )}

                {graphFolds.open.polaire ? (
                <ResizablePanel id="sailing.graph.polaire" defaultHeight={350} minWidth={250} minHeight={250} style={{ flex: 'none', width: '350px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  {graphTitle('polaire', 'Polaire de Vitesse (TWA)')}
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    <SpeedPolarChart data={polarGraphShown} unitSymbol={speedSymbol} />
                  </div>
                </ResizablePanel>
                ) : foldedGraph('polaire', 'Polaire de Vitesse (TWA)', 350)}
              </div>
            )}

            {open.cardio && heart.present && (
              <ResizablePanel id="sailing.cardio" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <HeartRatePanel track={track} minutes={trackMinutes} heart={heart} params={profile.heartRate} zones={hrZones} profileHrMax={runner.hrMax} runner={runner}
                  onRetainHrMax={(bpm) => retainHr('hrMax', bpm, { kind: 'seance', atMs: track[0]?.timeMs ?? null })} selectedZone={selectedHrZone}
                  onSelectZone={(zone) => highlight.show('cardio', zone === null ? null : String(zone))}
                  zoom={cardioZoom} onShowOnMap={() => zoomOnMap.show('cardio')}
                  open={open.cardio} onToggle={toggleOf('cardio')} />
              </ResizablePanel>
            )}

            {open.vmg && trackData.length > 0 && (vmgStats
              ? renderVmgPanel(vmgStats)
              : renderEmptyPanel('vmg', 'Analyse VMG', 'la VMG se mesure', 'Pas de VMG mesurable sur cette session.'))}

            {open.sauts && jumpsVisible && (
              <JumpsPanel
                status={jumpsState.status}
                error={jumpsState.error}
                jumps={shownJumps}
                hiddenCount={jumpsState.jumps.length - shownJumps.length}
                minHeightM={jumpMinHeightM}
                thresholdLabel={`${showThreshold(activeThresholdKn)} ${speedSymbol}`}
                speedUnit={speedUnit}
                distanceUnit={distanceUnit}
                open={open.sauts}
                onToggle={toggleOf('sauts')}
                shownJump={shownJump}
                onShowJump={(takeoffMs) => highlight.show('sauts', takeoffMs === null ? null : String(takeoffMs))}
                podiumShown={jumpPodiumShown}
                onTogglePodium={() => highlight.show('sauts', jumpPodiumShown ? null : 'podium')}
                trackIndexAt={trackIndexAt}
              />
            )}

            {pumpingOpen && (
              <ResizablePanel id="sailing.pumping" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <FlightPumpingPanel
                  label={`Pumping (${flights.length} vol${flights.length > 1 ? 's' : ''})`} helpKey="voile:pumping"
                  open={open.pumping} onToggle={toggleOf('pumping')}
                  help={<>
                    Vol : au-dessus du seuil d'activité ({showThreshold(activeThresholdKn)} {speedSymbol}), d'une traite, d'au moins {pumpDetection?.minFlightS ?? 0} s.
                    {flightPumping
                      ? " Pumping : mesuré par les capteurs du téléphone fixé sur la poitrine, sur les séries de coups. Décollage : vitesse GPS quand les chocs de la planche sur l'eau cessent (expérimental)."
                      : ''}
                  </>}
                  flights={flights} podium={podiumFlights}
                  tiles={<>
                    <StatTile label="Vols" value={flights.length} />
                    <StatTile label="Plus long vol" value={podiumFlights.length > 0 ? formatShortDuration(podiumFlights[0].durationS) : '—'} />
                  </>}
                  pumping={flightPumping} pumpSummary={pumpSummary}
                  shown={flightShown} onShow={(key) => highlight.show('pumping', key)} accent={FAMILY_ACCENT.voile}
                  speedCell={(ms) => (ms === null ? '—' : formatSpeedValue(toDisplaySpeed(ms, speedUnit), speedUnit))}
                  unitLabel={SPEED_UNIT_LABEL[speedUnit]}
                  pumpingOn={pumping} sensors={pumpSensors}
                  offNote="Cochez « Pumping » dans l'onglet réglages pour compter les coups de chaque vol, téléphone fixé sur la poitrine." />
              </ResizablePanel>
            )}

            {open.vent && trackData.length > 0 && !windStats && renderEmptyPanel('vent', 'Variations du Vent', 'ses variations se lisent aux manœuvres, qui se classent',
              'Il faut au moins deux manœuvres pour suivre le vent au fil de la session.')}
            {open.vent && windStats && (
              <div style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 300px', minWidth: '250px' }}>
                  <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <PanelTitle
                      label="Variations du Vent"
                      open={open.vent}
                      onToggle={toggleOf('vent')}
                      extra={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', fontWeight: 'normal' }}> (mesurées sur {windStats.count} manœuvres)</span>}
                      helpKey="voile:vent" />
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                    <li><strong>Moyenne :</strong> {windStats.avgWind}°</li>
                    <li><strong>Plage de variation :</strong> {windStats.range}° (de {windStats.minWind}° à {windStats.maxWind}°)</li>
                    <li><strong>Régularité (écart-type circulaire) :</strong> ± {windStats.stdDev}° <em>(faible = vent laminaire, élevé = vent oscillant)</em></li>
                    <li><strong>Tendance temporelle :</strong> {Math.abs(windStats.slopePerHour).toFixed(1)}°/heure ({windStats.slopePerHour > 0 ? 'rotation droite / horaire' : 'rotation gauche / anti-horaire'})</li>
                    <li style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
                      {Math.round(windStats.stableShare * 100)}% des manœuvres ont des caps stabilisés avant et après : ce sont les mesures les plus nettes, mais toutes comptent.
                    </li>
                  </ul>
                  {windHelpOpen && <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 'var(--text-xs)', lineHeight: '1.5' }}>
                    Chaque virement et chaque empannage donne une lecture du vent local, sans exception. Une manœuvre
                    symétrique, entrée et sortie au même angle du vent, place son milieu sur l'axe du vent et mesure
                    juste ; entrer au largue pour ressortir au près décale ce milieu d'autant. Ce biais ne peut pas se
                    corriger manœuvre par manœuvre, mais il change de signe d'une fois sur l'autre : les manœuvres les
                    plus symétriques pèsent davantage dans la moyenne et l'écart-type, et l'ensemble compense. Entre
                    deux manœuvres la courbe est interpolée ; avant la première et après la dernière, elle garde la
                    valeur la plus proche. Elle s'interrompt au-delà de 30 minutes sans manœuvre. Sur le graphe, les
                    points marquent les manœuvres : c'est là, et là seulement, que le vent est mesuré. Le graphe garde le
                    même zoom que celui de la vitesse. {zoomText}
                  </p>}
                </div>

                <ResizablePanel id="sailing.graph.vent" defaultHeight={250} minWidth={300} minHeight={180} style={{ flex: '2 1 500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  <div className="chart-head" style={{ marginBottom: '10px' }}>
                    <HoverReadout read={windReadout} label="Évolution du Vent" color={WIND_COLOR} />
                  </div>
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    {windChart(FILL_STYLE)}
                  </div>
                </ResizablePanel>
              </div>
            )}

            {open.matos && (
              <ResizablePanel id="sailing.matos" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* Foil et mât sur foil seulement ; ce qui est saisi reste dans la fiche, et revient si l'on recoche. */}
                <SessionNotesPanel notes={notes} setNotes={setNotes} family="voile" conditions="voile" draft={draft}
                  gearFields={foil ? SAILING_GEAR_FIELDS_FOIL : SAILING_GEAR_FIELDS} gearGroups={gearGroups} activityId={activity.id}
                  open={open.matos} onToggle={toggleOf('matos')} />
              </ResizablePanel>
            )}

            {open.reglages && (
              <ResizablePanel id="sailing.reglages" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Réglages de la session" open={open.reglages} onToggle={toggleOf('reglages')} helpKey="voile:reglages" />
                </div>
                <HelpText helpKey="voile:reglages" note>Vitesse : {hasDeviceSpeed ? "Doppler de l'appareil" : 'dérivée des positions, filtrée'}.</HelpText>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-s)' }}>
                    <strong>Activité :</strong>
                    <ActivitySelect
                      // Pas vers une activité sans trace (muscu) : la session a des positions.
                      activities={allActivities.filter((a) => hasPositions(a.base))}
                      value={activity.id}
                      extra={activity}
                      families={sessionFile ? undefined : ['voile']}
                      onChange={(next) => changeSessionActivity(sessionFile, next)} />
                  </label>

                  {hasActiveThreshold && (
                    <div style={{ fontSize: 'var(--text-s)' }}>
                      <SessionThresholdField
                        label="Seuil d'activité"
                        title="Seuil propre à cette session, enregistré avec elle. Celui du support se règle dans Réglages."
                        value={activeThresholdKn}
                        defaultValue={defaultActiveThresholdKn}
                        isOverridden={edits.activeThreshold !== null}
                        unit={speedUnit}
                        thresholdUnit="kn"
                        onChange={(next) => draft.update({ activeThreshold: next })} />
                    </div>
                  )}

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-s)' }}
                    title="Support sur foil pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
                    <input type="checkbox" checked={foil} onChange={(e) => draft.update({ foil: e.target.checked })} />
                    <strong>Foil</strong>
                    {edits.foil === null && <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>(supposé : celui de l'activité)</span>}
                  </label>

                  {foil && profile.pump !== null && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-s)' }}
                      title="Pumping des vols par les capteurs du téléphone, pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
                      <input type="checkbox" checked={pumping} onChange={(e) => draft.update({ pumping: e.target.checked === activityPumping ? null : e.target.checked })} />
                      <strong>Pumping</strong>
                      {edits.pumping === null && <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>(celui de l'activité)</span>}
                    </label>
                  )}

                  {trackData.length > 0 && (
                    <div style={{ fontSize: 'var(--text-s)' }}>
                      <SessionThresholdField
                        label="Allure de la session"
                        title="Vitesse de croisière de la session, dont dépendent les seuils de filtrage. Déduite de la trace ; imposée si elle la décrit mal, et alors enregistrée avec la session."
                        value={referenceSpeedMs}
                        isOverridden={edits.referenceSpeedMs !== null}
                        unit={speedUnit}
                        thresholdUnit="ms"
                        hint="déduite de la trace"
                        onChange={(next) => draft.update({ referenceSpeedMs: next })} />
                    </div>
                  )}
                </div>
                {trackData.length > 0 && (
                  <div style={{ marginTop: '12px', fontSize: 'var(--text-s)' }}>
                    <SpeedRangeEditor
                      unit={speedUnit}
                      range={colorRange}
                      isOverridden={edits.speedRange !== null}
                      onChange={(next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); }} />
                  </div>
                )}
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SailingModule;