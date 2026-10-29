import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BaseTileLayer from '../components/BaseTileLayer';
import './analysisMobile.css';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import ActivitySelect from '../components/ActivitySelect';
import { GraphFoldHead } from '../components/ChartFold';
import { HoverReadout, type Readout } from '../components/ChartReadout';
import { HEART_RATE_COLOR } from '../components/heartRateColors';
import AnalysisMap, { ANALYSIS_MAP_ANCHOR } from '../components/AnalysisMap';
import { HoveredTrackMarker } from '../components/HoverMarker';
import { SessionMarksLayer, SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import { HelpText } from '../components/Help';
import PanelTitle, { SessionDate } from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import SessionNotesPanel, { type GearField } from '../components/SessionNotesPanel';
import CollapsibleSectionTabs from '../components/CollapsibleSectionTabs';
import SessionNameEditor from '../components/SessionNameEditor';
import GeneralStats from '../components/GeneralStats';
import { shareableStats, type ShareStat } from '../core/shareImage';
import SessionSaveBar from '../components/SessionSaveBar';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import SessionThresholdField from '../components/SessionThresholdField';
import SpeedRangeEditor from '../components/SpeedRangeEditor';
import TrackSpanLayer, { type TrackSpanShown } from '../components/TrackSpanLayer';
import FlightPumpingPanel, { type FlightColumn } from '../components/FlightPumpingPanel';
import TopsPanel, { TopsHighlight } from '../components/TopsPanel';
import HeartRateChart from '../components/HeartRateChart';
import HeartRatePanel, { CardioCompanion } from '../components/HeartRatePanel';
import { heartRateReadout, speedReadout } from '../components/chartReadouts';
import { heartRateZonePaths } from '../core/heartRate';
import { runnerHeartRateZones, useRunnerProfile } from '../hooks/useRunnerProfile';
import { useSessionHeartRate } from '../hooks/useSessionHeartRate';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import { zoomHint } from '../components/zoomHint';
import { NO_TOOLTIP_CONTENT, trackHover } from '../components/chartHover';
import { Polyline } from 'react-leaflet';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from '../components/highlightColors';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../components/styles';
import Button from '../components/ui/Button';
import PageHeader from '../components/ui/PageHeader';
import { sessionActivity } from '../core/activities';
import { SURF_TABS, maskAdvancedTabs, maskHiddenTabs, shownTabs, type SurfTab } from '../core/analysisTabs';
import { sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS, trackBounds } from '../core/displayConfig';
import { buildCumulativeTrack } from '../core/sessionStats';
import { defaultActiveThresholdOf, hasPositions, sportTreatment } from '../core/sportProfiles';
import { isValidSpeedRange } from '../core/speedGradient';
import { computeAllTopSegments } from '../core/topSegments';
import { trackColorSegments } from '../core/trackColor';
import {
  SPEED_UNIT_LABEL, formatDistance, formatDuration, formatShortDuration, formatSpeed, formatSpeedValue, formatTimeOfDay,
  fromDisplaySpeed, toDisplaySpeed,
} from '../core/units';
import { setHoveredIndex, useResetChartHover } from '../hooks/useChartHover';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import { useGpxSession } from '../hooks/useGpxSession';
import { libraryPath, useChangeSessionActivity, useSessionFromUrl } from '../hooks/useLibraryNavigation';
import { useMapHighlight } from '../hooks/useMapHighlight';
import { useZoomOnMap } from '../hooks/useZoomOnMap';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useOpenSections } from '../hooks/useOpenSections';
import { useAdvancedTabs } from '../hooks/useAdvancedTabs';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { useSessionPumping } from '../hooks/useSessionPumping';
import { effectiveTabChoices, readStoredActivities, useSportSettings } from '../hooks/useSportSettings';
import type { LibrarySession } from '../library/record';
import { measureFlightPumping, summarizePumping, type FlightPumping } from '../core/pumping';
import type { SurfFlight, SurfPhase, SurfReturn, SurfSpan } from '../surfing/surfAnalysis';
import { effectiveWaveThreshold, runSurfSession, surfProfileOf } from '../surfing/surfSession';
import StatTile from '../components/ui/StatTile';
import MapToggle from '../components/ui/MapToggle';
import { CHART_GRID_PROPS, SPEED_COLOR, chartTick, yAxisLabel } from '../components/chartStyle';

/**
 * Analyse d'une session de surf (§10, point 97), selon le patron commun
 * (`docs/MISE_EN_PAGE.md`) : carte colorée par la vitesse, puis les onglets.
 * « général » porte la synthèse ; « vagues » le tableau des vagues ; « rame »
 * les remontées et le retour au pic ; « vols », sur foil seulement, les vols
 * qui relient plusieurs vagues en pompant, et leur pumping mesuré par les
 * capteurs si la session les a (point 104) ; « tops », si l'activité le coche
 * dans Réglages (paddle, kayak, downwind), les meilleurs passages sur chaque
 * durée ou distance ; « graphiques » la vitesse au fil
 * de la session, vagues en bandes ; « matériel et notes » le matériel (deux
 * champs nommés par activité dans Réglages), les conditions, l'appréciation et
 * le commentaire ; « réglages » ceux de la session. Leur liste est `SURF_TABS`
 * (`core/analysisTabs.ts`), où chaque activité choisit dans Réglages ceux qu'elle montre.
 */

const SURF_SECTION_DEFAULTS: Record<SurfTab, boolean> = {
  general: true,
  vagues: false,
  rame: false,
  vols: false,
  tops: false,
  graphiques: false,
  cardio: false,
  notes: false,
  reglages: false,
};

/** Préfixe des identifiants mémorisés (tailles des panneaux, onglets ouverts) : ne pas le renommer. */
const STORAGE_ID = 'surf';
const panelId = (name: string) => `${STORAGE_ID}.${name}`;

/**
 * Graphes de l'onglet « graphiques » dépliés : avec la FC, chacun se replie à
 * part pour ne comparer que ceux qui restent ouverts (16/10). Choix gardé sur l'appareil.
 */
const GRAPH_FOLDS_DEFAULT = { vitesse: true, fc: true };
/** Hauteur de base d'un graphe : le panneau suit le nombre de graphes dépliés. */
const CHART_HEIGHT_PX = 170;
const chartBox = (heightPx: number): CSSProperties => ({ width: '100%', flex: `1 0 ${heightPx}px`, height: `${heightPx}px`, marginTop: '4px' });
const ACCENT = 'var(--surf)';

/** Couleurs de la répartition du temps (données, en dur) : glisse, rame, attente, sans signal. */
const PHASE_COLORS: Record<SurfPhase, string> = { glisse: '#1e88e5', rame: '#8d6e63', attente: '#bdbdbd', trou: '#eceff1' };
const PHASE_LABELS: Record<SurfPhase, string> = { glisse: 'sur la vague', rame: 'rame', attente: 'attente', trou: 'sans signal' };
/** Bandes des vagues et des vols sur le graphe de vitesse. */
const WAVE_BAND_COLOR = '#1e88e5';
const FLIGHT_BAND_COLOR = '#7e57c2';

type WaveSort = 'ordre' | 'distance' | 'vitesse' | 'duree';
const WAVE_SORT_LABEL: Record<WaveSort, string> = { ordre: 'ordre', distance: 'distance', vitesse: 'vitesse max', duree: 'durée' };

const panelStyle = { ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' } as const;

/** Champs du matériel, sous les intitulés de l'activité. */
const gearFields = (labels: [string, string]): GearField[] => [
  { field: 'gear1', label: labels[0], placeholder: 'ex. modèle, taille' },
  { field: 'gear2', label: labels[1], placeholder: 'ex. modèle, taille' },
];
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' } as const;
const thStyle = { padding: '0.4em 0.5em', whiteSpace: 'nowrap' } as const;
const tdStyle = { padding: '0.35em 0.5em', textAlign: 'center', whiteSpace: 'nowrap' } as const;

const orDash = (value: number | null, format: (v: number) => string): string => (value === null ? '—' : format(value));

/** Colonnes des vols propres au surf : vagues du vol, pompage vu par le GPS. */
const SURF_FLIGHT_PODIUM_COLUMNS: FlightColumn<SurfFlight>[] = [
  { header: 'Vagues', cell: (f) => f.waveCount },
  { header: 'Pompage', cell: (f) => formatShortDuration(f.pumpS) },
];
const SURF_FLIGHT_ALL_COLUMNS: FlightColumn<SurfFlight>[] = [{ header: 'Vagues', cell: (f) => f.waveCount }];

/** Bouton « Voir » d'une ligne de tableau : montre ou masque son passage sur la carte. */
const ShowButton = ({ shown, onClick, disabled }: { shown: boolean; onClick: () => void; disabled?: boolean }) => (
  <MapToggle shown={shown} disabled={disabled} color={ACCENT} onClick={onClick} />
);

/** Une ligne du graphe : `index` renvoie au point de trace d'origine. */
interface ChartRow {
  index: number;
  /** Temps écoulé depuis le départ, en minutes : l'axe et son zoom. */
  minutes: number;
  speed: number;
  speedMs: number;
  /** FC lissée, `null` là où elle manque. */
  hr: number | null;
}

function SurfModule() {
  const {
    activity, setActivity, profile, thresholdOverride, speedUnit, distanceUnit, speedRange, defaultSpeedRange, foil: activityFoil,
    pumping: activityPumping, gearLabels, gearGroups, hrOffsetBpm,
  } = useSportSettings('surf');
  const gpx = useGpxSession({
    medianWindowSeconds: profile.medianWindowSeconds, maxDetourRatio: profile.maxDetourRatio, maxSpeedMs: profile.maxPlausibleSpeedMs, maxGapS: profile.maxGapS,
  });

  const { loadGpxContent } = gpx;
  // Session de la mémoire désignée par l'URL : son activité devient celle du module.
  const receiveSession = useCallback(
    (content: string, session: LibrarySession) => {
      const recorded = sessionActivity(readStoredActivities(), session.record.activityId, session.record.sport);
      if (recorded && recorded.id !== activity.id) setActivity(recorded.id);
      loadGpxContent(content, session.file);
    },
    [activity.id, setActivity, loadGpxContent]
  );
  const { file: sessionFile, requested: requestedFile, error: sessionError } = useSessionFromUrl(receiveSession);
  // Brouillon de la session : seuils, foil, couleurs ; écrit dans sa fiche par « Enregistrer la session ».
  const shownFile = sessionFile !== null && gpx.fileName === sessionFile ? sessionFile : null;
  const draft = useSessionDraft(shownFile);
  const [allActivities] = useState(readStoredActivities);
  const changeSessionActivity = useChangeSessionActivity('surf', setActivity);

  /** Foil de la session (brouillon, puis fiche), sinon celui de l'activité. */
  const foil = draft.edits.foil ?? activityFoil;
  /** Pumping foil de la session (brouillon, puis fiche), sinon celui de l'activité ; sur foil seulement. */
  const pumping = foil && (draft.edits.pumping ?? activityPumping);
  /** Seuil de la glisse : celui de la session, sinon de l'activité, sinon le défaut, de vague ou de vol selon le foil. */
  const defaultThreshold = defaultActiveThresholdOf(profile, foil);
  const threshold = draft.edits.activeThreshold ?? thresholdOverride ?? defaultThreshold;
  const surfProfile = surfProfileOf(profile);
  const waveThreshold = surfProfile ? effectiveWaveThreshold(surfProfile.surf, draft.edits.waveThreshold) : 0;

  const { open: storedOpen, toggle, set: setSections } = useOpenSections<SurfTab>(STORAGE_ID, SURF_SECTION_DEFAULTS);
  const graphFolds = useOpenSections(`${STORAGE_ID}.graphes`, GRAPH_FOLDS_DEFAULT);
  // Onglets de l'activité : ceux cachés dans Réglages sont fermés, même laissés ouverts.
  const tabChoices = useMemo(() => effectiveTabChoices(activity), [activity]);
  /** Rangée « avancé » : refermée, ses onglets et leurs panneaux se replient, mémorisés pour sa réouverture. */
  const setGeneral = useCallback((shown: boolean) => setSections({ general: shown }), [setSections]);
  const advanced = useAdvancedTabs(gpx.sessionKey, setGeneral);
  const open = useMemo(() => maskAdvancedTabs(maskHiddenTabs(storedOpen, SURF_TABS, tabChoices), SURF_TABS, advanced.open), [storedOpen, tabChoices, advanced.open]);
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe sous la vitesse. */
  const { profile: runner, retainHr } = useRunnerProfile();
  const heart = useSessionHeartRate(gpx.track, profile.heartRate);
  const hrZones = useMemo(() => runnerHeartRateZones(runner, profile.heartRate, hrOffsetBpm), [runner, profile.heartRate, hrOffsetBpm]);
  const sections = useMemo(
    () => shownTabs(SURF_TABS, tabChoices).filter((s) => (s.key !== 'vols' || foil) && (s.key !== 'cardio' || heart.present)),
    [tabChoices, foil, heart.present]
  );
  const highlight = useMapHighlight(open);
  const [waveSort, setWaveSort] = useState<WaveSort>('ordre');
  // Point survolé hors de l'état du module (`useChartHover`) : effacé à chaque session et au démontage.
  useResetChartHover(gpx.sessionKey);
  const narrow = useNarrowScreen();

  const track = gpx.track;
  const cumulative = useMemo(() => buildCumulativeTrack(track), [track]);
  // Repères du bouton « Note » : fanions, liste de « Général », traits du graphe.
  const marks = useSessionMarks(draft, track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);
  /** Zone cardiaque montrée sur la carte (onglet « cardio »). */
  const shownHrZone = highlight.shownIn('cardio');
  const selectedHrZone = shownHrZone === null ? null : Number(shownHrZone);
  const hrZonePaths = useMemo(
    () => (selectedHrZone !== null && open.cardio && heart.present && hrZones
      ? heartRateZonePaths(track, heart.smoothed, hrZones.bounds, selectedHrZone, profile.heartRate.gapS)
      : []),
    [selectedHrZone, open.cardio, heart, hrZones, track, profile.heartRate.gapS]
  );
  const result = useMemo(
    () => (surfProfile && track.length > 1
      ? runSurfSession(track, cumulative, surfProfile, { threshold, foil, waveThreshold: draft.edits.waveThreshold })
      : null),
    [surfProfile, track, cumulative, threshold, foil, draft.edits.waveThreshold]
  );
  const summary = result?.summary ?? null;
  const analysis = result?.analysis ?? null;
  /** Meilleurs segments, calculés à l'ouverture de leur onglet. */
  const tops = useMemo(
    () => (open.tops && track.length > 1
      ? computeAllTopSegments(track, cumulative, profile.topTargets, (ms) => toDisplaySpeed(ms, speedUnit), { decimals: 1 })
      : null),
    [open.tops, track, cumulative, profile.topTargets, speedUnit]
  );
  const topShown = highlight.shownIn('tops');
  const totalDistanceM = cumulative.cumDist[cumulative.cumDist.length - 1] ?? 0;

  /** Bornes du dégradé de couleur, en m/s : celles de la session, sinon de Réglages, sinon le défaut du surf. */
  const range = draft.edits.speedRange ?? speedRange ?? defaultSpeedRange;
  const treatment = sportTreatment(activity.base);
  const mapSegments = useMemo(
    (): TrackSegment[] => trackColorSegments(track, treatment, { minMs: range.minMs, maxMs: range.maxMs }),
    [track, treatment, range.minMs, range.maxMs]
  );
  const mapBounds = useMemo(() => trackBounds(track), [track]);

  /** Chiffres de l'onglet « général », proposés aussi pour l'image de partage. */
  const generalStats: ShareStat[] = summary ? [
    { key: 'totalTime', label: 'Durée de la session', value: formatDuration(summary.totalS * 1000) },
    { key: 'waveTime', label: `Sur la vague (${summary.totalS > 0 ? ((summary.waveS / summary.totalS) * 100).toFixed(1) : '0'} %)`, value: formatShortDuration(summary.waveS) },
    { key: 'waves', label: 'Vagues', value: `${summary.waveCount}${summary.wavesPerHour !== null && summary.waveCount > 0 ? ` (${summary.wavesPerHour.toFixed(1)} / h)` : ''}` },
    { key: 'averageWave', label: 'Distance moyenne', value: orDash(summary.avgWaveDistanceM, (m) => `${Math.round(m)} m`) },
    { key: 'longestWave', label: 'Plus longue vague', value: orDash(summary.longestWaveM, (m) => `${Math.round(m)} m`) },
    { key: 'maxSpeed', label: 'Vitesse max', value: orDash(summary.maxWaveSpeedMs, (v) => formatSpeed(v, speedUnit)) },
    { key: 'waveSpeed', label: 'Moyenne sur la vague', value: orDash(summary.avgWaveSpeedMs, (v) => formatSpeed(v, speedUnit)) },
    { key: 'paddleSpeed', label: 'Vitesse de rame', value: orDash(summary.paddleSpeedMs, (v) => formatSpeed(v, speedUnit)), title: 'Moyenne en mouvement, arrêts courts exclus' },
    { key: 'return', label: 'Retour au pic (moyen)', value: orDash(summary.avgReturnS, formatShortDuration), title: "De la fin d'une vague à la première attente" },
    ...(foil ? [
      { key: 'longestFlight', label: 'Plus long vol', value: orDash(summary.longestFlightS, formatShortDuration) },
      { key: 'flightTime', label: `Ratio de vol (${summary.totalS > 0 ? ((summary.flightS / summary.totalS) * 100).toFixed(1) : '0'} %)`, value: formatShortDuration(summary.flightS) },
      { key: 'wavesInFlight', label: 'Vagues en un vol', value: String(summary.maxWavesInFlight ?? '—'), title: 'Le plus de vagues reliées par un même vol' },
    ] : []),
    { key: 'distance', label: 'Distance totale', value: formatDistance(totalDistanceM, distanceUnit) },
  ] : [];

  /**
   * Chiffres de l'onglet « général » (22/10) : l'essentiel, le détail restant dans « avancé ».
   * L'image de partage garde la liste entière (`generalStats`).
   */
  const overviewKeys = ['totalTime', 'waves', 'waveTime', 'longestWave', 'maxSpeed', ...(foil ? ['flightTime', 'longestFlight'] : [])];
  const overviewStats = overviewKeys.flatMap((key) => generalStats.filter((stat) => stat.key === key));

  // Une seule surbrillance : une vague (son numéro) ou le podium, un vol, une remontée.
  const waveShown = highlight.shownIn('vagues');
  const flightShown = highlight.shownIn('vols');
  const returnShown = highlight.shownIn('rame');
  const waves = useMemo(() => analysis?.waves ?? [], [analysis]);
  const flights = useMemo(() => analysis?.flights ?? [], [analysis]);
  const returns = useMemo(() => analysis?.returns ?? [], [analysis]);

  // Pumping des vols, par les capteurs de la session : il suit les vols, donc le seuil du brouillon.
  const sensors = useSessionPumping(shownFile, pumping);
  const pumpDetection = surfProfile?.pump ?? null;
  const flightPumping = useMemo(() => {
    if (!sensors.recording || !pumpDetection || flights.length === 0) return null;
    const list = measureFlightPumping(sensors.recording, pumpDetection, track, cumulative, flights);
    return new Map(list.flatMap((x): [number, FlightPumping][] => (x ? [[x.n, x]] : [])));
  }, [sensors.recording, pumpDetection, track, cumulative, flights]);
  const pumpSummary = useMemo(() => (flightPumping ? summarizePumping([...flightPumping.values()]) : null), [flightPumping]);
  /** Les 3 plus longs vols, le résumé de l'onglet. */
  const podiumFlights = useMemo(() => [...flights].sort((a, b) => b.durationS - a.durationS).slice(0, 3), [flights]);
  const speedCell = (ms: number | null): string => (ms === null ? '—' : formatSpeedValue(toDisplaySpeed(ms, speedUnit), speedUnit));
  /** Colonnes « Tous les vols » du GPS, sans pumping mesuré : pompage et vitesse de pompe (unité de l'activité). */
  const surfFlightGpsColumns: FlightColumn<SurfFlight>[] = [
    { header: 'Pompage', cell: (f) => formatShortDuration(f.pumpS) },
    { header: `Pompe (${SPEED_UNIT_LABEL[speedUnit]})`, cell: (f) => speedCell(f.pumpSpeedMs) },
  ];

  /** Point d'arrivée d'une remontée sur la carte : le pic (début de l'attente), sinon la glisse suivante. */
  const returnEnd = useCallback(
    (r: SurfReturn): number => {
      const targetMs = r.returnS !== null ? r.startMs + r.returnS * 1000 : r.endMs;
      let i = 0;
      while (i < track.length - 1 && track[i].timeMs < targetMs) i++;
      return i;
    },
    [track]
  );
  const shownSpans = useMemo((): TrackSpanShown[] => {
    const spanLabel = (kind: string, s: SurfSpan) =>
      `${kind} ${s.n} · ${formatTimeOfDay(s.startMs)} · ${formatShortDuration(s.durationS)} · ${Math.round(s.distanceM)} m · max ${formatSpeed(s.maxSpeedMs, speedUnit)}`;
    if (waveShown === 'podium') {
      return [...waves].sort((a, b) => b.distanceM - a.distanceM).slice(0, 3)
        .map((w, k) => ({ key: `vague-${w.n}`, start: w.start, end: w.end, color: HIGHLIGHT_PODIUM_COLORS[k], label: spanLabel('Vague', w) }));
    }
    if (waveShown !== null) {
      const w = waves.find((x) => String(x.n) === waveShown);
      return w ? [{ key: `vague-${w.n}`, start: w.start, end: w.end, color: HIGHLIGHT_SHOWN_COLOR, label: spanLabel('Vague', w) }] : [];
    }
    if (flightShown === 'podium') {
      return podiumFlights
        .map((f, k) => ({ key: `vol-${f.n}`, start: f.start, end: f.end, color: HIGHLIGHT_PODIUM_COLORS[k], label: spanLabel('Vol', f) }));
    }
    if (flightShown !== null) {
      const f = flights.find((x) => String(x.n) === flightShown);
      return f ? [{ key: `vol-${f.n}`, start: f.start, end: f.end, color: HIGHLIGHT_SHOWN_COLOR, label: spanLabel('Vol', f) }] : [];
    }
    if (returnShown !== null) {
      const r = returns.find((x) => String(x.after) === returnShown);
      if (!r) return [];
      let start = 0;
      while (start < track.length - 1 && track[start].timeMs < r.startMs) start++;
      // Sur foil, les remontées suivent les vols, numérotés comme eux.
      const label = r.after === 0 ? 'Première sortie' : `Remontée après ${foil ? 'le vol' : 'la vague'} ${r.after}`;
      return [{ key: `remontee-${r.after}`, start, end: returnEnd(r), color: HIGHLIGHT_SHOWN_COLOR, label: `${label} · ${formatTimeOfDay(r.startMs)}` }];
    }
    return [];
  }, [waveShown, flightShown, returnShown, waves, flights, podiumFlights, returns, track, returnEnd, speedUnit, foil]);

  const sortedWaves = useMemo(() => {
    const list = [...waves];
    if (waveSort === 'distance') list.sort((a, b) => b.distanceM - a.distanceM);
    if (waveSort === 'vitesse') list.sort((a, b) => b.maxSpeedMs - a.maxSpeedMs);
    if (waveSort === 'duree') list.sort((a, b) => b.durationS - a.durationS);
    return list;
  }, [waves, waveSort]);

  // Graphe de vitesse au fil de la session, en heure du jour, zoomable.
  const timeChart = useTimeChartAxis(track, gpx.sessionKey);
  const { minutes: trackMinutes, zoom, cardioZoom } = timeChart;
  const speedSeries = useMemo(() => track.map((p) => p.smoothedSpeedMs), [track]);
  const chartData = useMemo(() => {
    if (track.length === 0 || !open.graphiques) return [];
    const [first, last] = visibleIndexRange(trackMinutes, zoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS, speedSeries).map((i): ChartRow => ({
      index: i,
      minutes: trackMinutes[i],
      speed: parseFloat(toDisplaySpeed(track[i].smoothedSpeedMs, speedUnit).toFixed(2)),
      speedMs: track[i].smoothedSpeedMs,
      hr: heart.smoothed[i] === null || heart.smoothed[i] === undefined ? null : Math.round(heart.smoothed[i]!),
    }));
  }, [track, open.graphiques, trackMinutes, zoom.view, speedUnit, heart.smoothed, speedSeries]);
  const minutesOf = (ms: number) => (track.length > 0 ? (ms - track[0].timeMs) / 60000 : 0);
  /** Survol des graphes : le point va au magasin du survol, lu par le repère de la carte et les lectures, pas par le module. */
  const clearHover = () => setHoveredIndex(null);
  /** Axe du temps des graphes, en heure du jour, graduations rondes zoom compris. */
  const timeAxis = timeChart.timeAxis(zoom);
  const onChartHover = trackHover(chartData);
  /** Point survolé lu au-dessus des graphes (`HoverReadout`), s'il est dans la plage zoomée. */
  const readable = (i: number): boolean => timeChart.readable(zoom, i);
  const readAt = timeChart.readAt;
  const readSpeed = (i: number): Readout | null => (readable(i) ? speedReadout(formatSpeed(track[i].smoothedSpeedMs, speedUnit), readAt(i)) : null);
  const readHeart = (i: number): Readout | null => (readable(i) ? heartRateReadout(heart.smoothed[i], readAt(i)) : null);
  /** Carte en plein écran (téléphone), seule ou avec les graphes d'un onglet. */
  const [mapExpanded, setMapExpanded] = useState(false);
  /** « +carte » des graphes zoomés : tronçon en violet, cadrage, plein écran carte + graphes au téléphone. */
  const zoomOnMap = useZoomOnMap({
    highlight,
    points: track,
    charts: {
      graphiques: { zoom, axis: trackMinutes },
      cardio: { zoom: cardioZoom, axis: trackMinutes },
    },
    narrow,
    mapAnchorId: ANALYSIS_MAP_ANCHOR,
    mapExpanded,
    openMap: () => setMapExpanded(true),
  });
  const showGraphsOnMap = () => zoomOnMap.show('graphiques');

  /** Graphe de vitesse : bandes des vagues et des vols, repères ; dans l'onglet, et sous la carte en plein écran. */
  const speedChart = (style: CSSProperties) => (
    <ZoomableChart zoom={zoom} onLeave={clearHover} onShowOnMap={showGraphsOnMap} style={style}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} onMouseMove={onChartHover} onTouchMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <ChartZoomProbe />
          <CartesianGrid {...CHART_GRID_PROPS} />
          {timeAxis}
          {markReferenceLines(marks.located, (m) => minutesOf(m.mark.timeMs), shownMark)}
          <YAxis domain={[0, 'auto']} tickFormatter={(v) => formatSpeedValue(v, speedUnit)} width={46}
            tick={chartTick(SPEED_COLOR)}
            label={yAxisLabel(unitLabel, SPEED_COLOR)} />
          {foil && flights.map((f) => (
            <ReferenceArea key={`vol-${f.n}`} x1={minutesOf(f.startMs)} x2={minutesOf(f.endMs)} fill={FLIGHT_BAND_COLOR} fillOpacity={0.1} ifOverflow="hidden" />
          ))}
          {waves.map((w) => (
            <ReferenceArea key={`vague-${w.n}`} x1={minutesOf(w.startMs)} x2={minutesOf(w.endMs)} fill={WAVE_BAND_COLOR} fillOpacity={0.18} ifOverflow="hidden" />
          ))}
          <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
          <Line type="monotone" name="Vitesse" dataKey="speed" stroke={SPEED_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ZoomableChart>
  );
  /** Courbe de FC de « graphiques » ; ses boutons de zoom quand la vitesse est repliée. */
  const heartChart = (speedShown: boolean) => (
    <HeartRateChart data={chartData} zoom={zoom} x={timeChart.timeX} zones={hrZones?.bounds ?? null} thresholds={hrZones ? { s1: hrZones.s1, s2: hrZones.s2 } : null}
      showReset={!speedShown} onShowOnMap={showGraphsOnMap} style={chartBox(CHART_HEIGHT_PX)}>
      {markReferenceLines(marks.located, (m) => minutesOf(m.mark.timeMs), shownMark, 'hr')}
    </HeartRateChart>
  );
  /** Graphes de l'onglet d'où vient « +carte », sous la carte en plein écran (téléphone). */
  const companionCharts = (panel: SurfTab | null): ReactNode => {
    switch (panel) {
      case 'graphiques': {
        const speedShown = !heart.present || graphFolds.open.vitesse;
        return chartData.length > 1 ? (
          <>
            {speedShown && (
              <>
                <HoverReadout line read={readSpeed} label="Vitesse" color={SPEED_COLOR} />
                {speedChart(chartBox(CHART_HEIGHT_PX))}
              </>
            )}
            {heart.present && graphFolds.open.fc && (
              <>
                <HoverReadout line read={readHeart} label="FC" color={HEART_RATE_COLOR} />
                {heartChart(speedShown)}
              </>
            )}
          </>
        ) : null;
      }
      case 'cardio':
        return <CardioCompanion minutes={trackMinutes} heart={heart} zoom={cardioZoom} zones={hrZones} onShowOnMap={() => zoomOnMap.show('cardio')} style={chartBox(CHART_HEIGHT_PX)} />;
      default:
        return null;
    }
  };

  const mapLayers = (
    <>
      <BaseTileLayer family={'surf'} />
      <TrackSegmentsLayer segments={mapSegments} weight={5} family={'surf'} />
      <TrackSpanLayer track={track} spans={shownSpans} />
      <TopsHighlight tops={tops} selected={topShown} />
      {hrZonePaths.map((path, idx) => (
        <Polyline key={`cardio-${selectedHrZone}-${idx}`} positions={path} pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 }} />
      ))}
      {zoomOnMap.path.length > 1 && (
        <Polyline key="zoom" positions={zoomOnMap.path} pathOptions={{ color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 }} />
      )}
      <SessionMarksLayer located={marks.located} shownMs={shownMark} />
      <HoveredTrackMarker points={track} />
    </>
  );

  const unitLabel = SPEED_UNIT_LABEL[speedUnit];
  const rideWord = foil ? 'vol' : 'vague';
  const measuredReturns = returns.filter((r) => r.after > 0);
  const firstOut = returns.find((r) => r.after === 0) ?? null;

  return (
    <div className="an-page" style={{ padding: '20px' }}>
      <div className="an-sheet">
        <div className="an-sheet__head">
          <PageHeader title="Analyse Surf" subtitle={gpx.fileName ? (
            <SessionNameEditor file={gpx.fileName}
              share={generalStats.length > 0 ? { family: 'surf', segments: mapSegments, stats: shareableStats(generalStats) } : undefined} />
          ) : undefined} back={{ to: libraryPath('surf'), label: 'Surf' }} />
          {sessionError && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError}</div>}
        </div>
      </div>

      <SessionSaveBar draft={draft} />

      {gpx.error && (
        <div className="ui-alert ui-alert--danger" style={{ marginBottom: '10px', maxWidth: '520px' }}>{gpx.error}</div>
      )}

      {!summary && !gpx.error && requestedFile === null && (
        <p style={{ color: 'var(--muted)' }}>
          Aucune session ouverte : choisissez-en une dans <Link to={libraryPath('surf')}>Surf</Link>.
        </p>
      )}

      <div className="an-map-row" style={{ marginTop: '10px' }}>
        <AnalysisMap
          panelId={panelId('carte')}
          anchorId={ANALYSIS_MAP_ANCHOR}
          expanded={mapExpanded}
          onExpandedChange={(next) => {
            setMapExpanded(next);
            if (!next) zoomOnMap.closeCompanion();
          }}
          focus={zoomOnMap.focus}
          companion={companionCharts(zoomOnMap.companionPanel)}
          sessionKey={gpx.sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={480}
          legend={track.length === 0 ? null : <SpeedGradientLegend unit={speedUnit} range={range} slowLabel="rame et attente" />} />
      </div>

      {summary && analysis && surfProfile && (
        <div className="an-carte-col">
          <CollapsibleSectionTabs sections={sections} open={open} onToggle={toggle} advancedOpen={advanced.open} onToggleAdvanced={advanced.toggle} accent={ACCENT} />
          <div className="an-carte-panels">
            {open.general && (
              <ResizablePanel id={panelId('general')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Général" extra={<SessionDate track={gpx.track} />} open={open.general} onToggle={() => toggle('general')} />
                </div>
                <GeneralStats stats={overviewStats} />
                {draft.edits.foil === null && (
                  <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' }}>
                    {foil ? 'Sur foil' : 'Sans foil'}, supposé d'après l'activité : la session ne le dit pas. Il se règle dans l'onglet réglages.
                  </div>
                )}
                {summary.totalS > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', border: '1px solid var(--line)' }}
                      title="Répartition du temps de la session">
                      {(Object.keys(PHASE_COLORS) as SurfPhase[]).map((phase) => {
                        const s = phase === 'glisse' ? summary.glisseS : phase === 'rame' ? summary.rameS : phase === 'attente' ? summary.attenteS : summary.trouS;
                        return s > 0 ? <span key={phase} style={{ width: `${(s / summary.totalS) * 100}%`, backgroundColor: PHASE_COLORS[phase] }} /> : null;
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px', fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
                      {(Object.keys(PHASE_COLORS) as SurfPhase[]).map((phase) => {
                        const s = phase === 'glisse' ? summary.glisseS : phase === 'rame' ? summary.rameS : phase === 'attente' ? summary.attenteS : summary.trouS;
                        if (s <= 0) return null;
                        const label = phase === 'glisse' && foil ? 'en vol' : PHASE_LABELS[phase];
                        // Sans foil, la glisse est faite des vagues : son temps est déjà « Sur la vague » au-dessus,
                        // la légende ne le redit pas (demande du 19/10). Sur foil, « en vol » est une autre durée.
                        const repeated = phase === 'glisse' && !foil;
                        return (
                          <span key={phase} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: PHASE_COLORS[phase], border: '1px solid var(--line)' }} />
                            {label}{repeated ? '' : ` ${Math.round((s / summary.totalS) * 100)} %`}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <SessionMarksList view={marks} distanceUnit={distanceUnit} shownMs={shownMark} accent={ACCENT}
                  onShow={(ms) => highlight.show('general', ms === null ? null : String(ms))} />
              </ResizablePanel>
            )}

            {open.vagues && (
              <ResizablePanel id={panelId('vagues')} style={panelStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <PanelTitle label={`Vagues (${waves.length})`} open={open.vagues} onToggle={() => toggle('vagues')} helpKey="surf:vagues" />
                  <span style={{ flex: 1 }} />
                  {waves.length > 1 && (
                    <>
                      <label style={{ fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Tri
                        <select className="ui-field ui-field--s" value={waveSort} onChange={(e) => setWaveSort(e.target.value as WaveSort)}>
                          {(Object.keys(WAVE_SORT_LABEL) as WaveSort[]).map((k) => <option key={k} value={k}>{WAVE_SORT_LABEL[k]}</option>)}
                        </select>
                      </label>
                      <Button size="s" aria-pressed={waveShown === 'podium'} onClick={() => highlight.show('vagues', waveShown === 'podium' ? null : 'podium')}>
                        {waveShown === 'podium' ? 'Masquer les 3 plus longues' : 'Les 3 plus longues'}
                      </Button>
                    </>
                  )}
                </div>
                <HelpText helpKey="surf:vagues" note>
                  {foil
                    ? `Vague : un passage d'au moins ${surfProfile.surf.minWaveS} s au-dessus du seuil de vague en foil, pendant un vol.`
                    : `Vague : au moins ${surfProfile.surf.minWaveS} s et ${surfProfile.surf.minWaveM} m au-dessus du seuil de vague.`}
                  {' '}* Virages : seuls les grands changements de direction (au moins {surfProfile.surf.turnMinDeg}°) se voient à une position par seconde ; un bottom turn ou un top turn bref peut échapper au GPS. Valeur expérimentale.
                </HelpText>
                {waves.length === 0 ? (
                  <div style={{ color: 'var(--muted)' }}>
                    Aucune vague : rien n'a dépassé le seuil {foil ? 'de vague en foil' : 'de vague'} ({formatSpeed(fromDisplaySpeed(foil ? waveThreshold : threshold, profile.thresholdUnit), speedUnit)}) pendant {surfProfile.surf.minWaveS} s. Il se règle dans l'onglet réglages.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                          <th style={thStyle}>N°</th>
                          <th style={thStyle}>Heure</th>
                          <th style={thStyle}>Durée</th>
                          <th style={thStyle}>Distance</th>
                          <th style={thStyle}>Max ({unitLabel})</th>
                          <th style={thStyle}>Moy.</th>
                          <th style={thStyle} title="Grands changements de direction vus par le GPS">Virages*</th>
                          {foil && <th style={thStyle}>Vol</th>}
                          <th style={thStyle}>Carte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedWaves.map((w) => {
                          const shown = waveShown === String(w.n);
                          return (
                            <tr key={w.n} style={{ borderTop: '1px solid var(--line-soft)' }}>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{w.n}</td>
                              <td style={tdStyle}>{formatTimeOfDay(w.startMs).slice(0, 5)}</td>
                              <td style={tdStyle}>{formatShortDuration(w.durationS)}</td>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{Math.round(w.distanceM)} m</td>
                              <td style={tdStyle}>{formatSpeedValue(toDisplaySpeed(w.maxSpeedMs, speedUnit), speedUnit)}</td>
                              <td style={tdStyle}>{formatSpeedValue(toDisplaySpeed(w.avgSpeedMs, speedUnit), speedUnit)}</td>
                              <td style={tdStyle}>{w.turns}</td>
                              {foil && <td style={tdStyle}>{w.flight ?? '—'}</td>}
                              <td style={tdStyle}>
                                <ShowButton shown={shown} onClick={() => highlight.show('vagues', shown ? null : String(w.n))} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </ResizablePanel>
            )}

            {open.rame && (
              <ResizablePanel id={panelId('rame')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Rame et retour au pic" open={open.rame} onToggle={() => toggle('rame')} helpKey="surf:rame" />
                </div>
                <HelpText helpKey="surf:rame" note>
                  Retour au pic : de la fin {foil ? "d'un vol" : "d'une vague"} au début de la première attente (immobile au moins {surfProfile.surf.minWaitS} s) ; un arrêt plus court (canard, série) compte dans la rame.
                  {' '}Remontée : distance à vol d'oiseau jusqu'au pic, divisée par ce temps. Rame : vitesse en mouvement.
                </HelpText>
                <div className="an-sheet__stats an-sheet__stats--always">
                  <StatTile label="Vitesse de rame" value={orDash(summary.paddleSpeedMs, (v) => formatSpeed(v, speedUnit))} title="Moyenne en mouvement, arrêts courts exclus" />
                  <StatTile label="Vitesse de remontée" value={orDash(summary.avgReturnSpeedMs, (v) => formatSpeed(v, speedUnit))} title="Distance à vol d'oiseau de la fin de la vague au pic, divisée par le temps du retour" />
                  <StatTile label="Retour au pic (moyen)" value={orDash(summary.avgReturnS, formatShortDuration)} />
                  <StatTile label="Meilleur retour" value={orDash(summary.bestReturnS, formatShortDuration)} />
                  <StatTile label="Première sortie" value={orDash(summary.firstOutS, formatShortDuration)} title="Du premier mouvement à la première attente, marche sur la plage comprise" />
                  <StatTile label={`${foil ? 'Vols' : 'Vagues'} enchaîné${foil ? 's' : 'es'}`} value={summary.chainedCount} title="Prise sans attente depuis la précédente : pas de retour au pic mesuré" />
                  <StatTile label="Temps de rame" value={formatShortDuration(summary.rameS)} />
                  <StatTile label="Temps d'attente" value={formatShortDuration(summary.attenteS)} />
                </div>
                {(measuredReturns.length > 0 || firstOut) && (
                  <div style={{ overflowX: 'auto', marginTop: '10px' }}>
                    <table style={tableStyle}>
                      <thead>
                        <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                          <th style={thStyle}>Après</th>
                          <th style={thStyle}>Retour</th>
                          <th style={thStyle}>Distance</th>
                          <th style={thStyle}>Remontée</th>
                          <th style={thStyle}>Rame</th>
                          <th style={thStyle}>Attente</th>
                          <th style={thStyle}>Carte</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...(firstOut ? [firstOut] : []), ...measuredReturns].map((r) => {
                          const shown = returnShown === String(r.after);
                          return (
                            <tr key={r.after} style={{ borderTop: '1px solid var(--line-soft)' }}>
                              <td style={{ ...tdStyle, fontWeight: 700 }}>{r.after === 0 ? 'départ' : `${rideWord} ${r.after}`}</td>
                              <td style={tdStyle}>{r.returnS === null ? 'enchaîné' : formatShortDuration(r.returnS)}</td>
                              <td style={tdStyle}>{r.straightM === null ? '—' : `${Math.round(r.straightM)} m`}</td>
                              <td style={tdStyle}>{orDash(r.returnSpeedMs, (v) => formatSpeed(v, speedUnit))}</td>
                              <td style={tdStyle}>{orDash(r.paddleSpeedMs, (v) => formatSpeed(v, speedUnit))}</td>
                              <td style={tdStyle}>{formatShortDuration(r.waitS)}</td>
                              <td style={tdStyle}>
                                <ShowButton shown={shown} onClick={() => highlight.show('rame', shown ? null : String(r.after))} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </ResizablePanel>
            )}

            {open.vols && foil && (
              <ResizablePanel id={panelId('vols')} style={panelStyle}>
                <FlightPumpingPanel
                  label={`Vols (${flights.length})`} helpKey="surf:vols" open={open.vols} onToggle={() => toggle('vols')}
                  help={<>
                    Vol : au-dessus du seuil de vol, d'une traite ; ses vagues sont ses passages au-dessus du seuil de vague en foil.
                    {flightPumping
                      ? " Pumping : mesuré par les capteurs du téléphone, sur les séries de coups. Décollage : vitesse GPS quand les chocs de la planche sur l'eau cessent (expérimental)."
                      : ' Le reste du vol est pompé.'}
                  </>}
                  flights={flights} podium={podiumFlights}
                  tiles={<>
                    <StatTile label="Plus long vol" value={orDash(summary.longestFlightS, formatShortDuration)} />
                    <StatTile label="Temps de vol" value={formatShortDuration(summary.flightS)} />
                    <StatTile label="Vagues en un vol" value={summary.maxWavesInFlight ?? '—'} />
                  </>}
                  pumping={flightPumping} pumpSummary={pumpSummary}
                  shown={flightShown} onShow={(key) => highlight.show('vols', key)} accent={ACCENT}
                  speedCell={speedCell} unitLabel={unitLabel}
                  podiumColumns={SURF_FLIGHT_PODIUM_COLUMNS}
                  allColumns={SURF_FLIGHT_ALL_COLUMNS}
                  allColumnsWithoutPumping={surfFlightGpsColumns}
                  pumpingOn={pumping} sensors={sensors} />
              </ResizablePanel>
            )}

            {open.tops && tops && (
              <ResizablePanel id={panelId('tops')} style={panelStyle}>
                <TopsPanel targets={profile.topTargets} tops={tops} unit={speedUnit} selected={topShown}
                  onSelect={(key) => highlight.show('tops', key)} accent={ACCENT} open={open.tops} onToggle={() => toggle('tops')} />
              </ResizablePanel>
            )}

            {open.graphiques && chartData.length > 1 && (() => {
              // Sans FC, un seul graphe : pas de repli. Avec, chacun le sien, « Tout voir » sur le premier montré.
              const folds = heart.present;
              const speedShown = !folds || graphFolds.open.vitesse;
              const hrShown = heart.present && graphFolds.open.fc;
              return (
              <ResizablePanel id={panelId('graphiques')} defaultHeight={folds ? undefined : 360} minHeight={folds ? 120 : 200} direction="vertical"
                style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', flexDirection: 'column', overflow: folds ? 'auto' : 'hidden' }}>
                <div className="chart-head" style={{ marginBottom: '8px', paddingRight: '28px' }}>
                  <PanelTitle label="Vitesse" open={open.graphiques} onToggle={() => toggle('graphiques')} helpKey="surf:graphiques" />
                  {!folds && <HoverReadout read={readSpeed} />}
                </div>
                <HelpText helpKey="surf:graphiques" note>
                  Le survol déplace le repère sur la carte.
                  {folds ? ' Chaque graphe se replie par son nom.' : ''}
                  {` ${zoomHint(narrow)}`}
                </HelpText>
                {folds && (
                  <GraphFoldHead label="Vitesse" color={SPEED_COLOR} open={graphFolds.open.vitesse} onToggle={() => graphFolds.toggle('vitesse')}
                    read={speedShown ? readSpeed : undefined}
                    title={graphFolds.open.vitesse ? 'Replier le graphe de vitesse' : 'Montrer le graphe de vitesse'} />
                )}
                {speedShown && speedChart(folds ? chartBox(CHART_HEIGHT_PX) : { width: '100%', flex: 1, minHeight: 0 })}
                {folds && (
                  <GraphFoldHead label="FC" color={HEART_RATE_COLOR} open={graphFolds.open.fc} onToggle={() => graphFolds.toggle('fc')}
                    read={hrShown ? readHeart : undefined} style={{ marginTop: '8px' }}
                    title={graphFolds.open.fc ? 'Replier le graphe de FC' : 'Montrer le graphe de FC'} />
                )}
                {hrShown && heartChart(speedShown)}
                <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', flexShrink: 0 }}>
                  Bandes bleues : les vagues{foil ? ', violettes : les vols' : ''}.
                </div>
              </ResizablePanel>
              );
            })()}

            {open.cardio && heart.present && (
              <ResizablePanel id={panelId('cardio')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' }}>
                <HeartRatePanel track={track} minutes={trackMinutes} heart={heart} params={profile.heartRate} zones={hrZones} profileHrMax={runner.hrMax} runner={runner}
                  onRetainHrMax={(bpm) => retainHr('hrMax', bpm, { kind: 'seance', atMs: track[0]?.timeMs ?? null })} selectedZone={selectedHrZone}
                  onSelectZone={(zone) => highlight.show('cardio', zone === null ? null : String(zone))}
                  zoom={cardioZoom} onShowOnMap={() => zoomOnMap.show('cardio')}
                  open={open.cardio} onToggle={() => toggle('cardio')} />
              </ResizablePanel>
            )}

            {open.notes && (
              <ResizablePanel id={panelId('notes')} style={{ ...CARD_STYLE, ...HALF_PANEL_STYLE, display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <SessionNotesPanel notes={draft.edits.notes} setNotes={draft.updateNotes} family="surf" conditions="libre" draft={draft}
                  gearFields={gearFields(gearLabels)} gearGroups={gearGroups} activityId={activity.id} open={open.notes} onToggle={() => toggle('notes')} />
              </ResizablePanel>
            )}

            {open.reglages && (
              <ResizablePanel id={panelId('reglages')} style={panelStyle}>
                <div style={{ marginBottom: '10px' }}>
                  <PanelTitle label="Réglages de la session" open={open.reglages} onToggle={() => toggle('reglages')} helpKey="surf:reglages" />
                </div>
                <HelpText helpKey="surf:reglages" note>
                  Vitesse : {gpx.hasDeviceSpeed
                    ? `fournie par l'appareil${gpx.deviceSpeedUnit && gpx.deviceSpeedUnit !== 'ms' ? `, lue en ${SPEED_UNIT_LABEL[gpx.deviceSpeedUnit]} et convertie` : ''}`
                    : 'dérivée des positions, filtrée'}
                  {' · '}Cap : {track.some((p) => p.courseDeg !== undefined) ? "fourni par l'appareil" : 'tiré des positions'}.
                </HelpText>
                <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong>Activité :</strong>
                    <ActivitySelect
                      // Pas vers une activité sans trace (muscu) : la session a des positions.
                      activities={allActivities.filter((a) => hasPositions(a.base))}
                      value={activity.id}
                      extra={activity}
                      families={sessionFile ? undefined : ['surf']}
                      onChange={(next) => changeSessionActivity(sessionFile, next)} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="Surf foil pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
                    <input type="checkbox" checked={foil} onChange={(e) => draft.update({ foil: e.target.checked })} />
                    <strong>Foil</strong>
                    {draft.edits.foil === null && <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>(supposé : celui de l'activité)</span>}
                  </label>
                  {foil && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      title="Pumping des vols par les capteurs du téléphone, pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages.">
                      <input type="checkbox" checked={pumping} onChange={(e) => draft.update({ pumping: e.target.checked === activityPumping ? null : e.target.checked })} />
                      <strong>Pumping</strong>
                      {draft.edits.pumping === null && <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>(celui de l'activité)</span>}
                    </label>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                  <SessionThresholdField
                    label={foil ? 'Seuil de vol' : 'Seuil de vague'}
                    title={foil
                      ? 'Au-dessus, la planche vole. Seuil propre à cette session, enregistré avec elle ; celui de l\'activité se règle dans Réglages.'
                      : 'Au-dessus, la planche est sur la vague. Seuil propre à cette session, enregistré avec elle ; celui de l\'activité se règle dans Réglages.'}
                    value={threshold}
                    defaultValue={thresholdOverride ?? defaultThreshold}
                    isOverridden={draft.edits.activeThreshold !== null}
                    unit={speedUnit}
                    thresholdUnit={profile.thresholdUnit}
                    onChange={(next) => draft.update({ activeThreshold: next })} />
                  {foil && (
                    <SessionThresholdField
                      label="Seuil de vague en foil"
                      title="Pendant un vol, au-dessus : porté par une vague ; en dessous : pompé."
                      value={waveThreshold}
                      defaultValue={surfProfile.surf.foilWaveThreshold}
                      isOverridden={draft.edits.waveThreshold !== null}
                      unit={speedUnit}
                      thresholdUnit={profile.thresholdUnit}
                      onChange={(next) => draft.update({ waveThreshold: next })} />
                  )}
                  {track.length > 0 && (
                    <SpeedRangeEditor
                      unit={speedUnit}
                      range={range}
                      isOverridden={draft.edits.speedRange !== null}
                      onChange={(next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); }} />
                  )}
                </div>
              </ResizablePanel>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SurfModule;
