import { useCallback, useEffect, useState, useMemo, type ReactNode } from 'react';
import ChartFold from '../components/ChartFold';
import { Polyline, Marker, CircleMarker, Popup } from 'react-leaflet';
import BaseTileLayer from '../components/BaseTileLayer';
import L from 'leaflet';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, RadarChart, Radar,
  type DotItemDotProps, type TooltipPayloadEntry,
} from 'recharts';
import 'leaflet/dist/leaflet.css';
import './analysisMobile.css';
import { Link, useSearchParams } from 'react-router-dom';
import { libraryPath, useChangeSessionActivity, useSessionFromUrl } from '../hooks/useLibraryNavigation';
import { useSailingSession } from '../hooks/useSailingSession';
import { updateSessionRecord } from '../hooks/useSessionLibrary';
import { effectiveJumpSettings, effectiveTabChoices, readStoredActivities } from '../hooks/useSportSettings';
import { useSessionJumps } from '../hooks/useSessionJumps';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { runnerHeartRateZones, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useSessionHeartRate } from '../hooks/useSessionHeartRate';
import { heartRateZonePaths } from '../core/heartRate';
import { buildCumulativeTrack } from '../core/sessionStats';
import { useOpenSections } from '../hooks/useOpenSections';
import { useMapHighlight } from '../hooks/useMapHighlight';
import { ARROW_EVERY_S, CHART_MAX_POINTS, arrowIndices, trackBounds } from '../core/displayConfig';
import { SAILING_TABS, maskHiddenTabs, shownTabs, type SailingTab } from '../core/analysisTabs';
import { niceTicks, sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { trackIndexAtTime } from '../core/jumps';
import { useChartZoom } from '../hooks/useChartZoom';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { FAMILY_ACCENT, sessionActivity } from '../core/activities';
import { activeRatioLabel } from '../core/sportProfiles';
import { isValidSpeedRange } from '../core/speedGradient';
import { trackColorSegments } from '../core/trackColor';
import type { TopSegment } from '../core/types';
import type { LibrarySession } from '../library/record';
import {
  SPEED_UNIT_LABEL, SPEED_UNIT_SYMBOL, formatDistance, formatKnots, formatSpeed, formatTimeOfDay, fromDisplaySpeed, knotsToDisplay, knotsToMs, msToKnots, toDisplaySpeed,
} from '../core/units';
import { MANEUVER_METRICS, windChartRows, type ManeuverMetric, type ManeuverTop, type WindGraphPoint } from '../sailing/sailingAnalytics';
import ActivitySelect from '../components/ActivitySelect';
import JumpsPanel from '../components/JumpsPanel';
import JumpMapLayer from '../components/JumpMapLayer';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from '../components/highlightColors';
import HeartRateChart from '../components/HeartRateChart';
import HeartRatePanel from '../components/HeartRatePanel';
import AnalysisMap from '../components/AnalysisMap';
import HoverMarker from '../components/HoverMarker';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import EmptyTabPanel from '../components/EmptyTabPanel';
import ResizablePanel from '../components/ResizablePanel';
import SessionNotesPanel, { type GearField } from '../components/SessionNotesPanel';
import CollapsibleSectionTabs from '../components/CollapsibleSectionTabs';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import PanelTitle, { SessionDate } from '../components/PanelTitle';
import SessionNameEditor from '../components/SessionNameEditor';
import GeneralStats from '../components/GeneralStats';
import { shareableStats, type ShareStat } from '../core/shareImage';
import SessionSaveBar from '../components/SessionSaveBar';
import { SessionMarksLayer, SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import SpeedRangeEditor from '../components/SpeedRangeEditor';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import HelpButton from '../components/ui/HelpButton';

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
 * une entrée là, une valeur par défaut dans `SAILING_PANEL_DEFAULTS`, et un bloc `{open.maCle && (...)}` dans la colonne.
 */
type SailingPanel = SailingTab;

/** Graphes de l'onglet « graphiques » dépliés tant qu'on ne les replie pas. */
const SAILING_GRAPH_FOLDS_DEFAULT = { vitesse: true, fc: true, polaire: true };
type SailingGraphFold = keyof typeof SAILING_GRAPH_FOLDS_DEFAULT;

const SAILING_PANEL_DEFAULTS: Record<SailingPanel, boolean> = {
  general: true,
  tops: false,
  manoeuvres: false,
  graphiques: false,
  cardio: false,
  vmg: false,
  sauts: false,
  vent: false,
  matos: false,
  reglages: false,
};

// --- Utilitaires d'affichage ---

/** Courbe du vent : le trait et les points des manœuvres partagent la couleur. */
const WIND_COLOR = '#1565c0';

/**
 * Point visible aux seules manœuvres : ailleurs la courbe du vent n'est qu'une
 * interpolation, et le graphe compte jusqu'à 500 points.
 */
const maneuverDot = (props: DotItemDotProps): ReactNode => {
  // Recharts ne type pas la ligne derrière le point : c'est un `WindGraphPoint`.
  const point: WindGraphPoint | undefined = props.payload;
  if (!point?.isManeuver) return null;
  return <circle cx={props.cx} cy={props.cy} r={3} fill={WIND_COLOR} stroke="#fff" strokeWidth={1} />;
};

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

// --- Composants UI locaux ---

const Compass = ({ windAngle }: { windAngle: number }) => {
  const size = 120;
  const center = size / 2;
  return (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: '#fff', borderRadius: '50%', border: '2px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.1)', flexShrink: 0 }}>
      <span style={{position:'absolute', top: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', left: '50%', transform: 'translateX(-50%)'}}>N(0°)</span>
      <span style={{position:'absolute', bottom: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', left: '50%', transform: 'translateX(-50%)'}}>S(180°)</span>
      <span style={{position:'absolute', right: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', top: '50%', transform: 'translateY(-50%)'}}>E(90°)</span>
      <span style={{position:'absolute', left: 3, fontSize: '10px', fontWeight: 'bold', color: 'var(--muted)', top: '50%', transform: 'translateY(-50%)'}}>O(270°)</span>
      <svg width={size} height={size} style={{ position: 'absolute', transform: `rotate(${windAngle}deg)`, transition: 'transform 0.3s ease' }}>
        <line x1={center} y1={25} x2={center} y2={center} stroke="red" strokeWidth="3" />
        <polygon points={`${center - 5},${center - 10} ${center + 5},${center - 10} ${center},${center + 2}`} fill="red" />
      </svg>
    </div>
  );
};

/** Parties d'une session modifiées, en clair. */
function SailingModule() {
  // Session de la mémoire désignée par l'URL, et son brouillon : vent saisi, seuil
  // d'activité, allure imposée, couleurs et notes, écrits dans sa fiche par « Enregistrer la session ».
  const [searchParams] = useSearchParams();
  const requestedFile = searchParams.get('session');
  const draft = useSessionDraft(requestedFile);
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
    activity,
    setActivity,
    profile,
    activityFoil,
    speedUnit,
    distanceUnit,
    activeThresholdKn,
    defaultActiveThresholdKn,
    speedRange,
    suggestedSpeedRangeMs,
    referenceSpeedMs,
    samplingS,
    pointCount,
    maneuverThresholds,
  } = useSailingSession({
    windDeg: edits.windDeg,
    activeThresholdKn: edits.activeThreshold,
    referenceSpeedMs: edits.referenceSpeedMs,
  });

  // Affichage dans l'unité de l'activité ; les analyses voile restent en nœuds (règle 5).
  const speedSymbol = SPEED_UNIT_SYMBOL[speedUnit];
  const showKn = (kn: number | string) => formatKnots(kn, speedUnit);
  /** Seuil saisi en nœuds, montré tel quel en nœuds, sinon converti. */
  // Arrondi au dixième : un seuil mis à l'échelle de l'allure sort en 7,999999… nœuds.
  const showThreshold = (kn: number) => (speedUnit === 'kn' ? String(Math.round(kn * 10) / 10) : showKn(kn));
  /** Valeur d'un champ de vitesse dans l'unité, arrondie. */
  const speedFieldValue = (kn: number) => parseFloat(knotsToDisplay(kn, speedUnit).toFixed(speedUnit === 'ms' ? 2 : 1));
  /** Infobulle des graphes de vitesse : la valeur suivie de l'unité. */
  const speedFormatter = (label: string) => (value: unknown): [string, string] => [`${value} ${speedSymbol}`, label];
  // Polaire dans l'unité ; en nœuds, celle du hook telle quelle.
  const polarGraphShown = useMemo(
    () => (speedUnit === 'kn' ? polarGraphData : polarGraphData.map((p) => ({ ...p, vitesse: parseFloat(formatKnots(p.vitesse, speedUnit)) }))),
    [polarGraphData, speedUnit]
  );

  // Session de la mémoire désignée par l'URL : son activité devient celle du module.
  const receiveSession = useCallback((content: string, session: LibrarySession) => {
    const recorded = sessionActivity(readStoredActivities(), session.record.activityId, session.record.sport);
    if (recorded && recorded.id !== activity.id) setActivity(recorded.id);
    loadGpxContent(content, session.file);
  }, [activity.id, setActivity, loadGpxContent]);
  const { file: sessionFile, error: sessionError } = useSessionFromUrl(receiveSession);

  /**
   * Changer d'activité l'écrit aussi dans la fiche de la session ; vers une
   * activité de course, la session part dans le module course
   * (`useChangeSessionActivity`). Toutes les activités sont proposées pour une
   * session de la mémoire, celles de la voile seules sinon.
   */
  const [allActivities] = useState(readStoredActivities);
  const changeSessionActivity = useChangeSessionActivity('voile', setActivity);

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
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe dans « graphiques ». */
  const { profile: runner, setNumber: setRunnerNumber } = useRunnerProfile();
  const heart = useSessionHeartRate(track, profile.heartRate);
  const hrZones = useMemo(() => runnerHeartRateZones(runner, profile.heartRate.zoneFractions), [runner, profile.heartRate]);
  // Onglets de l'activité : ceux cachés dans Réglages sont fermés, même laissés ouverts.
  const tabChoices = useMemo(() => effectiveTabChoices(activity), [activity]);
  const sailingPanels = useMemo(
    () => shownTabs(SAILING_TABS, tabChoices).filter((p) => (p.key !== 'sauts' || jumpsVisible) && (p.key !== 'cardio' || heart.present)),
    [tabChoices, jumpsVisible, heart.present]
  );

  const notes = edits.notes;
  const setNotes = draft.updateNotes;
  /** Support sur foil de la session : le sien s'il est réglé, sinon celui de l'activité. */
  const foil = edits.foil ?? activityFoil;
  const { open: storedOpen, toggle } = useOpenSections<SailingPanel>('sailing-onglets', SAILING_PANEL_DEFAULTS);
  /**
   * Graphes de l'onglet « graphiques » dépliés, chacun replié à part par son
   * titre pour ne comparer que ceux qui restent ouverts (16/10). Replié, un
   * graphe se réduit à son titre ; sa taille mémorisée l'attend.
   */
  const graphFolds = useOpenSections('sailing-graphes', SAILING_GRAPH_FOLDS_DEFAULT);
  const graphTitle = (key: SailingGraphFold, label: string) => (
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', flexShrink: 0 }}>
      <ChartFold label={label} open={graphFolds.open[key]} onToggle={() => graphFolds.toggle(key)}
        title={graphFolds.open[key] ? 'Replier ce graphe' : 'Montrer ce graphe'} style={{ fontSize: '14px', fontWeight: 700 }} />
    </div>
  );
  const foldedGraph = (key: SailingGraphFold, label: string, widthPx: number) => (
    <div style={{ flex: 'none', width: `${widthPx}px`, maxWidth: '100%', boxSizing: 'border-box', border: '1px dashed var(--line-strong)', padding: '10px 10px 0', backgroundColor: 'var(--surface)' }}>
      {graphTitle(key, label)}
    </div>
  );
  const open = useMemo(() => maskHiddenTabs(storedOpen, SAILING_TABS, tabChoices), [storedOpen, tabChoices]);
  /** Une seule surbrillance sur la carte, effacée quand son onglet se ferme (`useMapHighlight`). */
  const highlight = useMapHighlight(open);
  /** Top montré : de vitesse (onglet tops, `t2s`…) ou de VMG (onglet VMG, `vmgUpwind`, `vmgDownwind`), ou `none`. */
  const selectedTopMap = highlight.shownIn('tops') ?? highlight.shownIn('vmg') ?? 'none';
  /** Podium de manœuvres montré : `tack:conservation`, `jibe:distance`, ou `none`. */
  const selectedManeuverTop = highlight.shownIn('manoeuvres') ?? 'none';
  /** Sauts montrés : le podium des trois plus hauts (`podium`), ou un saut, par l'heure de son décollage. */
  const jumpHighlight = highlight.shownIn('sauts');
  const jumpPodiumShown = jumpHighlight === 'podium';
  const shownJump = jumpHighlight !== null && !jumpPodiumShown ? Number(jumpHighlight) : null;
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
  const cumulative = useMemo(() => buildCumulativeTrack(track), [track]);
  const marks = useSessionMarks(draft, track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);

  /** Bornes du dégradé de couleur de la trace, en m/s : celles de la session, sinon de Réglages, sinon la suggestion. */
  const colorRange = edits.speedRange ?? speedRange ?? suggestedSpeedRangeMs;

  const [showTacksOnMap, setShowTacksOnMap] = useState<boolean>(false);
  const [showJibesOnMap, setShowJibesOnMap] = useState<boolean>(false);
  const [showManeuverDetails, setShowManeuverDetails] = useState<boolean>(false);
  /** Explications repliées derrière un « ? » (enregistrement et virages écartés ; lecture du vent). */
  const [maneuverHelpOpen, setManeuverHelpOpen] = useState(false);
  const [windHelpOpen, setWindHelpOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
  /** Chiffres de l'onglet « général », proposés aussi pour l'image de partage. */
  const generalStats: ShareStat[] = stats ? [
    { key: 'distance', label: 'Distance', value: formatDistance(stats.distanceM, distanceUnit) },
    { key: 'activeDistance', label: 'Distance active', value: formatDistance(stats.activeDistanceM, distanceUnit) },
    { key: 'totalTime', label: 'Temps total', value: stats.totalTime },
    { key: 'activeTime', label: `Temps actif (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: stats.activeTime },
    { key: 'activeRatio', label: activeRatioLabel(profile, foil), value: `${stats.activeRatio}%` },
    { key: 'averageSpeed', label: 'Vitesse moyenne', value: formatSpeed(stats.avgSpeedMs, speedUnit) },
    { key: 'activeAverage', label: `Moyenne active (≥${showThreshold(activeThresholdKn)} ${speedSymbol})`, value: formatSpeed(stats.activeAvgSpeedMs, speedUnit) },
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

    let topArray: TopSegment[] | undefined;
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

  /** Survol d'un graphe : déplace le marqueur de la carte sur le point de trace correspondant. */
  const onChartHover = (data: ReadonlyArray<{ index: number }>) => (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, data);
    if (index !== null && index !== hoveredIndex) setHoveredIndex(index);
  };
  const clearHover = () => setHoveredIndex(null);
  const hoverIndex = (index: number) => {
    if (index !== hoveredIndex) setHoveredIndex(index);
  };

  const narrow = useNarrowScreen();
  /** Temps écoulé de chaque point, en minutes : l'axe des graphes de vitesse et du vent, et de leur zoom. */
  const trackMinutes = useMemo(
    () => trackData.map((p) => (p.timeMs - trackData[0].timeMs) / 60000),
    [trackData]
  );
  /** Zoom commun aux graphes de vitesse et du vent, qui partagent leur axe ; « tout voir » à chaque session. */
  const chartZoom = useChartZoom(trackMinutes.length > 1 ? { min: 0, max: trackMinutes[trackMinutes.length - 1] } : null, sessionKey);
  /** Points de trace des graphes sur la plage visible, au plus `CHART_MAX_POINTS` : zoomer montre plus de détail. */
  const chartIndices = useMemo(() => {
    if (trackData.length === 0) return [];
    const [first, last] = visibleIndexRange(trackMinutes, chartZoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS);
  }, [trackData, trackMinutes, chartZoom.view]);
  const speedRows = useMemo(
    () => chartIndices.map((i) => ({ index: i, minutes: trackMinutes[i], vitesse: parseFloat(formatKnots(trackData[i].smoothedSpeed, speedUnit)) })),
    [chartIndices, trackMinutes, trackData, speedUnit]
  );
  const heartRows = useMemo(
    () => (heart.present ? chartIndices.map((i) => ({ index: i, minutes: trackMinutes[i], hr: heart.smoothed[i] === null ? null : Math.round(heart.smoothed[i]!) })) : []),
    [heart, chartIndices, trackMinutes]
  );
  const windRows = useMemo(
    () => (windStats ? windChartRows(trackData, windStats, chartIndices) : []),
    [windStats, trackData, chartIndices]
  );
  /** Axe du temps, en heure du jour, graduations rondes zoom compris (`niceTicks`). */
  const timeAxis = (
    <XAxis dataKey="minutes" type="number" allowDataOverflow
      domain={chartZoom.shown ? [chartZoom.shown.min, chartZoom.shown.max] : ['dataMin', 'dataMax']}
      ticks={chartZoom.shown ? niceTicks(chartZoom.shown) : undefined}
      tickFormatter={(v: number) => (trackData.length > 0 ? formatTimeOfDay(trackData[0].timeMs + v * 60000).slice(0, 5) : '')}
      tick={{ fill: '#555', fontSize: 11 }} />
  );
  /** Traits des repères sur les graphes, en minutes depuis le premier point. */
  const markLines = markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark);
  const zoomHint = narrow
    ? 'Écartez deux doigts sur un graphe pour zoomer.'
    : 'Tirez une zone à la souris pour zoomer, double-clic pour tout revoir.';

  const renderTop3 = (panel: 'tops' | 'vmg', title: string, topKey: string, values: TopSegment[]) => (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <strong>{title}</strong>
        <button
          onClick={() => highlight.show(panel, selectedTopMap === topKey ? null : topKey)}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', backgroundColor: selectedTopMap === topKey ? 'var(--voile)' : 'var(--surface-sunken)', color: selectedTopMap === topKey ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
          {selectedTopMap === topKey ? 'Masquer (Carte)' : 'Voir (Carte)'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '10px', fontSize: '13px', marginTop: '4px' }}>
        <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>1er: {values[0] ? showKn(values[0].val) : "-"}</span>
        <span style={{ color: '#f57c00', fontWeight: 'bold' }}>2e: {values[1] ? showKn(values[1].val) : "-"}</span>
        <span style={{ color: '#388e3c', fontWeight: 'bold' }}>3e: {values[2] ? showKn(values[2].val) : "-"}</span>
      </div>
    </div>
  );

  /**
   * Onglet ouvert sans rien à montrer : sans vent, les manœuvres, la VMG et le vent ne se calculent pas ;
   * l'onglet le dit, avec de quoi ouvrir « général » où on le saisit (demande du 19/10).
   */
  const renderEmptyPanel = (key: 'manoeuvres' | 'vmg' | 'vent', label: string, what: string, otherwise: string) => (
    <EmptyTabPanel id={`sailing.carte.${key}.vide`} label={label} open={open[key]} onToggle={() => toggle(key)}
      action={windInputRequired && !open.general
        ? <Button size="s" onClick={() => toggle('general')}>Ouvrir l'onglet général</Button>
        : undefined}>
      {windInputRequired ? `Vent inconnu : ${what} par rapport à lui. Saisissez-le dans l'onglet général.` : otherwise}
    </EmptyTabPanel>
  );

  /** Panneaux VMG et manœuvres, parmi les onglets sous la carte. */
  const renderVmgPanel = (v: NonNullable<typeof vmgStats>) => (
    <ResizablePanel id="sailing.carte.vmg" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label="Analyse VMG" open={open.vmg} onToggle={() => toggle('vmg')} />
      </div>
      <table style={{ width: '100%', textAlign: 'center', borderCollapse: 'collapse', fontSize: '13px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
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
        <PanelTitle label="Manœuvres" open={open.manoeuvres} onToggle={() => toggle('manoeuvres')} />
        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>réussie si Vmin &ge; {showThreshold(activeThresholdKn)} {speedSymbol}</span>
        <HelpButton size="s" open={maneuverHelpOpen} onToggle={() => setManeuverHelpOpen(!maneuverHelpOpen)}
          label="Enregistrement et virages écartés" />
      </div>

      <div className="an-man-scroll">
      <table className="an-man-summary" style={{ borderCollapse: 'collapse', fontSize: '14px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginBottom: '10px' }}>
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
              <td style={{ padding: '7px 14px', fontWeight: 'bold' }}>{label}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#388e3c', fontWeight: 'bold', fontSize: '16px' }}>{summary?.success ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', color: '#d32f2f', fontSize: '16px' }}>{summary?.fail ?? 0}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center' }}>{summary ? showKn(summary.vminAvg) : '-'}</td>
              <td style={{ padding: '7px 14px', textAlign: 'center', fontWeight: 'bold' }}>{summary ? showKn(summary.vminMax) : '-'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                <button onClick={toggle} title={`Afficher les ${label.toLowerCase()} sur la carte`} style={{ padding: '3px 10px', cursor: 'pointer', backgroundColor: shown ? 'var(--voile)' : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: 'none', borderRadius: '4px', fontSize: '12px' }}>
                  {shown ? 'Masquer' : 'Voir'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {maneuverHelpOpen && (<>
      <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: '12px', lineHeight: '1.6' }}>
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
        m.rejected.tooShort > 0) && (
        <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: '12px', lineHeight: '1.6' }}>
          <strong>{m.locations.length} virage{m.locations.length > 1 ? 's' : ''} retenu{m.locations.length > 1 ? 's' : ''}</strong>, et d'autres écartés en chemin :
          {m.rejected.unclassified > 0 && (
            <>
              <br />
              <strong>{m.rejected.unclassified}</strong> franc{m.rejected.unclassified > 1 ? 's' : ''} et net{m.rejected.unclassified > 1 ? 's' : ''}, mais ni face au vent ni au vent arrière : ce sont des abattées ou des remontées — ou le vent retenu est faux, ce qui range tous les demi-tours au travers.
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
              <strong>{m.rejected.incoherent}</strong> dont le cap partait dans tous les sens : chute ou hésitation.
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
      </>)}

      <button
        onClick={() => setShowManeuverDetails(!showManeuverDetails)}
        style={{ padding: '4px 10px', cursor: 'pointer', backgroundColor: showManeuverDetails ? 'var(--voile)' : 'var(--surface-sunken)', color: showManeuverDetails ? '#fff' : 'var(--ink)', border: 'none', borderRadius: '4px', fontSize: '12px' }}>
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
              <strong style={{ fontSize: '15px' }}>{title}</strong>
              {summary ? (
                <span style={{ fontSize: '13px' }}>
                  <span style={{ color: '#388e3c', fontWeight: 'bold' }}>{summary.success} réussi{summary.success > 1 ? 's' : ''}</span>
                  {' · '}
                  <span style={{ color: '#d32f2f' }}>{summary.fail} raté{summary.fail > 1 ? 's' : ''}</span>
                  {' · Vmin moy. '}{showKn(summary.vminAvg)}{` ${speedSymbol}, max `}<strong>{showKn(summary.vminMax)}</strong>{` ${speedSymbol}`}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: '13px' }}>aucun</span>
              )}
            </div>

            {summary && (
              <table className="an-man-podium" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 'normal' }}>Métrique</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal' }}>Moyenne</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#d32f2f' }}>1er</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#f57c00' }}>2e</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal', color: '#388e3c' }}>3e</th>
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
                        <td style={{ padding: '4px', textAlign: 'center', fontWeight: 'bold' }}>
                          {summary.averages[metric.key]}
                          {metric.key === 'relaunch' && summary.withoutRelaunch > 0 && (
                            <span style={{ display: 'block', fontWeight: 'normal', color: 'var(--muted)', fontSize: '0.85em' }}>
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
                          <button
                            disabled={tops.length === 0}
                            onClick={() => highlight.show('manoeuvres', active ? null : key)}
                            style={{ padding: '2px 7px', fontSize: '11px', cursor: tops.length === 0 ? 'default' : 'pointer', backgroundColor: active ? 'var(--voile)' : 'var(--surface-sunken)', color: active ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px', opacity: tops.length === 0 ? 0.5 : 1 }}>
                            {active ? 'Masquer' : 'Carte'}
                          </button>
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
      {showManeuverDetails && (
        <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '8px' }}>
          Survolez une ligne pour la définition, une case du podium pour l'heure de la manœuvre. Le podium retient la meilleure valeur : conservation la plus haute, relance la plus courte, cap (virements seulement) et distance les plus faibles, gain au vent le plus grand ; à égalité, la meilleure conservation.
        </div>
      )}
    </ResizablePanel>
  );

  /** Point de trace le plus proche d'un instant : relie la courbe d'un saut à la carte. */
  const trackIndexAt = useCallback((ms: number): number => trackIndexAtTime(trackData, ms), [trackData]);

  /** Contenu partagé par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <>
      <BaseTileLayer family={'voile'} />

      {trackData.length > 0 && <TrackSegmentsLayer segments={mapSegments} weight={5} family={'voile'} />}
      {arrowLayers}
      {staticMapLayers}
      <JumpMapLayer track={trackData} jumps={shownJumps} shownJump={shownJump} podiumShown={jumpPodiumShown} />
      {hrZonePaths.map((path, idx) => (
        <Polyline key={`cardio-${selectedHrZone}-${idx}`} positions={path} pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 }} />
      ))}

      <SessionMarksLayer located={marks.located} shownMs={shownMark} />
      {hoveredIndex !== null && trackData[hoveredIndex] && (
        <HoverMarker position={[trackData[hoveredIndex].lat, trackData[hoveredIndex].lon]} />
      )}
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
        <div style={{ padding: '10px 15px', backgroundColor: '#fdecea', border: '1px solid #d32f2f', borderRadius: '8px', color: '#b71c1c', marginBottom: '10px' }}>
          {loadError}
        </div>
      )}

      {windInputRequired && (
        <div style={{ padding: '10px 15px', backgroundColor: '#fff8e1', border: '1px solid #f9a825', borderRadius: '8px', marginBottom: '10px' }}>
          <strong>Vent non fiable.</strong> L'estimation automatique donne {autoWind}° avec un indice de confiance
          de {windEstimate ? Math.round(windEstimate.confidence * 100) : 0}%, trop faible pour être utilisée.
          C'est typique d'un aller simple ou d'un plan d'eau à courant. Saisissez le vent dans l'onglet général pour
          débloquer les manœuvres, la VMG et la polaire.
          {!open.general && (
            <Button size="s" onClick={() => toggle('general')} style={{ marginLeft: '6px' }}>Ouvrir l'onglet général</Button>
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
          anchorId="map-view"
          sessionKey={sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={480}
          legend={trackData.length > 0 ? (
            <SpeedGradientLegend unit={speedUnit} range={colorRange}
              slowLabel={`sous ${Math.round(toDisplaySpeed(colorRange.minMs, speedUnit))} ${speedSymbol}`} />
          ) : null} />
      </div>

      {/* Onglets sous la carte, et leurs panneaux deux par ligne sur ordinateur (`docs/MISE_EN_PAGE.md`). */}
      {stats && (
        <div className="an-carte-col">
          <CollapsibleSectionTabs sections={sailingPanels} open={open} onToggle={toggle} />
          <div className="an-carte-panels">
            {open.general && (
              <ResizablePanel id="sailing.general" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Général" extra={<SessionDate track={trackData} />} open={open.general} onToggle={() => toggle('general')} />
                </div>
                <GeneralStats stats={generalStats} />
                <div className="an-sheet__wind" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  {/* Boussole à gauche, calcul et saisie à sa droite : le bloc tient dans la hauteur de la boussole. */}
                  <Compass windAngle={currentWindValue ?? autoWind ?? 0} />
                  <div style={{ flex: '1 1 0', minWidth: 0 }}>
                    <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Axe du Vent Global (Polaire)</strong>
                    <div style={{ marginBottom: '10px' }}>
                      Calculé : {autoWind}°
                      {windEstimate && (
                        <span style={{ color: windEstimate.reliable ? '#388e3c' : '#d32f2f', fontSize: '12px', marginLeft: '6px' }}>
                          (confiance {Math.round(windEstimate.confidence * 100)}%, angle mort de la polaire{windEstimate.maneuverCount > 0 ? ` affiné par ${windEstimate.maneuverCount} manœuvres` : ''}, sens donné par {windEstimate.orientedBy === 'virages' ? 'les virages' : 'la polaire'})
                        </span>
                      )}
                      <br/>
                      <div style={{ marginTop: '5px' }}>
                        Saisie : <input
                          type="number"
                          value={edits.windDeg ?? ''}
                          onChange={(e) => {
                            if (e.target.value === '') {
                              draft.update({ windDeg: null });
                              return;
                            }
                            const parsed = parseInt(e.target.value, 10);
                            if (!isNaN(parsed)) draft.update({ windDeg: parsed });
                          }}
                          className="ui-field ui-field--s num"
                          style={{ width: '64px' }} /> °
                        <Button
                          size="s"
                          onClick={() => draft.update({ windDeg: ((currentWindValue ?? autoWind ?? 0) + 180) % 360 })}
                          style={{ marginLeft: '6px' }}>
                          Inverser
                        </Button>
                        {edits.windDeg !== null && (
                          <Button
                            size="s"
                            onClick={() => draft.update({ windDeg: null })}
                            title="Revenir au vent calculé"
                            style={{ marginLeft: '6px' }}>
                            Calculé
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <SessionMarksList view={marks} distanceUnit={distanceUnit} shownMs={shownMark} accent={FAMILY_ACCENT.voile}
                  onShow={(ms) => highlight.show('general', ms === null ? null : String(ms))} />
              </ResizablePanel>
            )}

            {open.tops && (
              <ResizablePanel id="sailing.tops" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ marginBottom: '10px' }}>
                    <PanelTitle label="Tops Temps" open={open.tops} onToggle={() => toggle('tops')} />
                  </div>
                  {renderTop3('tops', "2 Secondes", "t2s", stats.tops.t2s)}
                  {renderTop3('tops', "5 Secondes", "t5s", stats.tops.t5s)}
                  {renderTop3('tops', "10 Secondes", "t10s", stats.tops.t10s)}
                </div>
                <div>
                  <strong style={{ display: 'block', marginBottom: '10px', fontSize: '16px' }}>Tops Distance</strong>
                  {renderTop3('tops', "100 Mètres", "d100m", stats.tops.d100m)}
                  {renderTop3('tops', "500 Mètres", "d500m", stats.tops.d500m)}
                  {renderTop3('tops', "1000 Mètres", "d1000m", stats.tops.d1000m)}
                  {renderTop3('tops', "1 Mille Nautique", "d1NM", stats.tops.d1NM)}
                </div>
              </ResizablePanel>
            )}

            {open.manoeuvres && trackData.length > 0 && (maneuverStats
              ? renderManeuversPanel(maneuverStats)
              : renderEmptyPanel('manoeuvres', 'Manœuvres', 'virements et empannages se reconnaissent', 'Aucune manœuvre reconnue sur cette session.'))}

            {open.graphiques && (
              <div style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 100%' }}>
                  <PanelTitle label="Graphiques" open={open.graphiques} onToggle={() => toggle('graphiques')} />
                </div>

                {graphFolds.open.vitesse ? (
                <ResizablePanel id="sailing.graph.vitesse" defaultHeight={350} minWidth={250} minHeight={200} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  {graphTitle('vitesse', 'Historique de Vitesse')}
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    <ZoomableChart zoom={chartZoom} onLeave={clearHover} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={speedRows}
                          onMouseMove={onChartHover(speedRows)}
                          onTouchMove={onChartHover(speedRows)}
                          margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                          <ChartZoomProbe />
                          <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
                          {timeAxis}
                          {markLines}
                          <YAxis domain={[0, 'auto']} tick={{fill: '#111', fontSize: 11, fontWeight: 'bold'}} />
                          <Tooltip formatter={speedFormatter('Vitesse')} labelFormatter={() => ''} />
                          <Line type="monotone" dataKey="vitesse" stroke="#1976d2" dot={false} strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </ZoomableChart>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '6px' }}>
                    Le survol déplace le repère sur la carte. {zoomHint}
                  </div>
                </ResizablePanel>
                ) : foldedGraph('vitesse', 'Historique de Vitesse', 500)}

                {heart.present && heartRows.length > 1 && (
                  graphFolds.open.fc ? (
                  <ResizablePanel id="sailing.graph.fc" defaultHeight={250} minWidth={250} minHeight={160} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                    {graphTitle('fc', 'Fréquence cardiaque')}
                    <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                      <HeartRateChart data={heartRows} zoom={chartZoom} xAxis={timeAxis} labelFormatter={() => ''} zones={hrZones?.bounds ?? null}
                        onHoverIndex={hoverIndex} onLeave={clearHover} showReset={false} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                        {markReferenceLines(marks.located, (m) => (trackData.length > 0 ? (m.mark.timeMs - trackData[0].timeMs) / 60000 : 0), shownMark, 'hr')}
                      </HeartRateChart>
                    </div>
                  </ResizablePanel>
                  ) : foldedGraph('fc', 'Fréquence cardiaque', 500)
                )}

                {graphFolds.open.polaire ? (
                <ResizablePanel id="sailing.graph.polaire" defaultHeight={350} minWidth={250} minHeight={250} style={{ flex: 'none', width: '350px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  {graphTitle('polaire', 'Polaire de Vitesse (TWA)')}
                  <div style={{ position: 'absolute', top: 35, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', zIndex: 10, pointerEvents: 'none' }}>
                    <span style={{ fontSize: 9, fontWeight: 'bold', color: '#d32f2f', marginBottom: -2 }}>VENT</span>
                    <svg width="12" height="16" viewBox="0 0 24 24">
                      <path d="M12 24L0 12h8V0h8v12h8z" fill="#d32f2f" />
                    </svg>
                  </div>
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={polarGraphShown}>
                          <PolarGrid />
                          <PolarAngleAxis dataKey="angle" tick={{ fill: '#333', fontSize: 11 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={{ fill: '#000', fontSize: 11, fontWeight: 'bold' }} />
                          <Radar name="Vitesse Max" dataKey="vitesse" stroke="#e64a19" fill="#e64a19" fillOpacity={0.4} />
                          <Tooltip formatter={speedFormatter('Vmax')} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </ResizablePanel>
                ) : foldedGraph('polaire', 'Polaire de Vitesse (TWA)', 350)}
              </div>
            )}

            {open.cardio && heart.present && (
              <ResizablePanel id="sailing.cardio" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: '14px' }}>
                <HeartRatePanel track={track} heart={heart} params={profile.heartRate} zones={hrZones} profileHrMax={runner.hrMax}
                  onRetainHrMax={(bpm) => setRunnerNumber('hrMax', bpm)} selectedZone={selectedHrZone}
                  onSelectZone={(zone) => highlight.show('cardio', zone === null ? null : String(zone))}
                  onHoverIndex={hoverIndex} onLeave={clearHover} resetKey={sessionKey}
                  open={open.cardio} onToggle={() => toggle('cardio')} />
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
                onToggle={() => toggle('sauts')}
                shownJump={shownJump}
                onShowJump={(takeoffMs) => highlight.show('sauts', takeoffMs === null ? null : String(takeoffMs))}
                podiumShown={jumpPodiumShown}
                onTogglePodium={() => highlight.show('sauts', jumpPodiumShown ? null : 'podium')}
                trackIndexAt={trackIndexAt}
                onCurveHover={onChartHover}
                onCurveLeave={clearHover}
              />
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
                      onToggle={() => toggle('vent')}
                      extra={<span style={{ color: 'var(--muted)', fontSize: '12px', fontWeight: 'normal' }}> (mesurées sur {windStats.count} manœuvres)</span>} />
                    <HelpButton size="s" open={windHelpOpen} onToggle={() => setWindHelpOpen(!windHelpOpen)}
                      label="Comment le vent est-il mesuré ?" />
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.8' }}>
                    <li><strong>Moyenne :</strong> {windStats.avgWind}°</li>
                    <li><strong>Plage de variation :</strong> {windStats.range}° (de {windStats.minWind}° à {windStats.maxWind}°)</li>
                    <li><strong>Régularité (écart-type circulaire) :</strong> ± {windStats.stdDev}° <em>(faible = vent laminaire, élevé = vent oscillant)</em></li>
                    <li><strong>Tendance temporelle :</strong> {Math.abs(windStats.slopePerHour).toFixed(1)}°/heure ({windStats.slopePerHour > 0 ? 'rotation droite / horaire' : 'rotation gauche / anti-horaire'})</li>
                    <li style={{ color: 'var(--muted)', fontSize: '12px' }}>
                      {Math.round(windStats.stableShare * 100)}% des manœuvres ont des caps stabilisés avant et après : ce sont les mesures les plus nettes, mais toutes comptent.
                    </li>
                  </ul>
                  {windHelpOpen && <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '12px', lineHeight: '1.5' }}>
                    Chaque virement et chaque empannage donne une lecture du vent local, sans exception. Une manœuvre
                    symétrique, entrée et sortie au même angle du vent, place son milieu sur l'axe du vent et mesure
                    juste ; entrer au largue pour ressortir au près décale ce milieu d'autant. Ce biais ne peut pas se
                    corriger manœuvre par manœuvre, mais il change de signe d'une fois sur l'autre : les manœuvres les
                    plus symétriques pèsent davantage dans la moyenne et l'écart-type, et l'ensemble compense. Entre
                    deux manœuvres la courbe est interpolée ; avant la première et après la dernière, elle garde la
                    valeur la plus proche. Elle s'interrompt au-delà de 30 minutes sans manœuvre. Sur le graphe, les
                    points marquent les manœuvres : c'est là, et là seulement, que le vent est mesuré.
                  </p>}
                </div>

                <ResizablePanel id="sailing.graph.vent" defaultHeight={250} minWidth={300} minHeight={180} style={{ flex: '2 1 500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
                  <strong style={{ display: 'block', marginBottom: '10px', fontSize: '14px', textAlign: 'center' }}>Évolution du Vent</strong>
                  <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                    <ZoomableChart zoom={chartZoom} onLeave={clearHover} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={windRows}
                          onMouseMove={onChartHover(windRows)}
                          onTouchMove={onChartHover(windRows)}
                          margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                          <ChartZoomProbe />
                          <CartesianGrid strokeDasharray="3 3" stroke="#ccc" />
                          {timeAxis}
                          {markLines}
                          <YAxis domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={(val: number) => `${((Math.round(val) % 360) + 360) % 360}°`} tick={{fill: '#111', fontSize: 11, fontWeight: 'bold'}} />
                          <Tooltip
                            formatter={(_val, _name, item: TooltipPayloadEntry): [string, string] => {
                              // Recharts ne type pas la ligne derrière l'entrée : c'est un `WindGraphPoint`.
                              const point: WindGraphPoint | undefined = item.payload;
                              const angle = point?.display;
                              return [angle === null || angle === undefined ? '-' : `${angle}°`, 'Vent local'];
                            }}
                            labelFormatter={(_label, payload) => {
                              const point: WindGraphPoint | undefined = payload?.[0]?.payload;
                              return point ? `Heure: ${point.timeLabel}` : '';
                            }} />
                          <Line type="monotone" dataKey="angle" stroke={WIND_COLOR} strokeWidth={2} dot={maneuverDot} activeDot={{ r: 6 }} connectNulls={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </ZoomableChart>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '6px' }}>
                    Même zoom que le graphe de vitesse. {zoomHint}
                  </div>
                </ResizablePanel>
              </div>
            )}

            {open.matos && (
              <ResizablePanel id="sailing.matos" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                {/* Foil et mât sur foil seulement ; ce qui est saisi reste dans la fiche, et revient si l'on recoche. */}
                <SessionNotesPanel notes={notes} setNotes={setNotes} family="voile" conditions="voile" draft={draft}
                  gearFields={foil ? SAILING_GEAR_FIELDS_FOIL : SAILING_GEAR_FIELDS}
                  open={open.matos} onToggle={() => toggle('matos')} />
              </ResizablePanel>
            )}

            {open.reglages && (
              <ResizablePanel id="sailing.reglages" style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE }}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Réglages de la session" open={open.reglages} onToggle={() => toggle('reglages')} />
                </div>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                    <strong>Activité :</strong>
                    <ActivitySelect
                      activities={allActivities}
                      value={activity.id}
                      extra={activity}
                      families={sessionFile ? undefined : ['voile']}
                      onChange={(next) => changeSessionActivity(sessionFile, next)} />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                    <strong>Seuil d'activité :</strong>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={speedUnit === 'kn' ? activeThresholdKn : speedFieldValue(activeThresholdKn)}
                      onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        if (!isNaN(parsed) && parsed >= 0) {
                          draft.update({ activeThreshold: speedUnit === 'kn' ? parsed : msToKnots(fromDisplaySpeed(parsed, speedUnit)) });
                        }
                      }}
                      title="Seuil propre à cette session, enregistré avec elle. Celui du support se règle dans Réglages."
                      className="ui-field ui-field--s num"
                      style={{ width: '70px' }} />
                    {SPEED_UNIT_LABEL[speedUnit]}
                    {edits.activeThreshold !== null && (
                      <Button
                        size="s"
                        onClick={() => draft.update({ activeThreshold: null })}
                        title={`Revenir au seuil du support (${showThreshold(defaultActiveThresholdKn)} ${SPEED_UNIT_LABEL[speedUnit]})`}>
                        Défaut
                      </Button>
                    )}
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}
                    title="Support sur foil pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
                    <input type="checkbox" checked={foil} onChange={(e) => draft.update({ foil: e.target.checked })} />
                    <strong>Foil</strong>
                    {edits.foil === null && <span style={{ color: 'var(--muted)', fontSize: '12px' }}>(supposé : celui de l'activité)</span>}
                  </label>

                  {trackData.length > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}>
                      <strong>Allure de la session :</strong>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={toDisplaySpeed(referenceSpeedMs, speedUnit).toFixed(speedUnit === 'ms' ? 2 : 1)}
                        onChange={(e) => {
                          const parsed = parseFloat(e.target.value);
                          if (!isNaN(parsed) && parsed > 0) draft.update({ referenceSpeedMs: fromDisplaySpeed(parsed, speedUnit) });
                        }}
                        title="Vitesse de croisière de la session, dont dépendent les seuils de filtrage. Déduite de la trace ; imposée si elle la décrit mal, et alors enregistrée avec la session."
                        className="ui-field ui-field--s num"
                        style={{ width: '70px' }} />
                      {speedSymbol}
                      {edits.referenceSpeedMs === null ? (
                        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>(déduite de la trace)</span>
                      ) : (
                        <Button size="s" onClick={() => draft.update({ referenceSpeedMs: null })} title="Revenir à l'allure déduite de la trace">
                          Défaut
                        </Button>
                      )}
                    </label>
                  )}
                </div>
                {trackData.length > 0 && (
                  <div style={{ marginTop: '12px', fontSize: '14px' }}>
                    <SpeedRangeEditor
                      unit={speedUnit}
                      range={colorRange}
                      isOverridden={edits.speedRange !== null}
                      onChange={(next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); }} />
                  </div>
                )}
                <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '10px' }}>
                  Vitesse : {hasDeviceSpeed ? "Doppler de l'appareil" : 'dérivée des positions, filtrée'}
                </div>
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SailingModule;