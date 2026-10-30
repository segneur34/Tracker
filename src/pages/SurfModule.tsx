import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import AnalysisBaseLayers from '../components/AnalysisBaseLayers';
import './analysisMobile.css';
import { ReferenceArea } from 'recharts';
import Swatch from '../components/ui/Swatch';
import SessionActivityField from '../components/SessionActivityField';
import SessionSettingsHeader from '../components/SessionSettingsHeader';
import CardioTab from '../components/CardioTab';
import NotesTab from '../components/NotesTab';
import FoilPumpingFields from '../components/FoilPumpingFields';
import { GraphFoldHead } from '../components/ChartFold';
import { HoverReadout, type Readout } from '../components/ChartReadout';
import { HEART_RATE_COLOR } from '../components/heartRateColors';
import { ANALYSIS_MAP_ANCHOR } from '../components/AnalysisMap';
import { SessionMarksList } from '../components/SessionMarks';
import { markReferenceLines } from '../components/markReferenceLines';
import { HelpText } from '../components/Help';
import PanelTitle, { PanelHeading, SessionDate } from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import { gearFieldsFor } from '../components/gearFields';
import GeneralStats from '../components/GeneralStats';
import type { ShareStat } from '../core/shareImage';
import SpeedGradientLegend from '../components/SpeedGradientLegend';
import SessionThresholdField from '../components/SessionThresholdField';
import { SessionColorRangeField } from '../components/SpeedRangeEditor';
import TrackSpanLayer, { type TrackSpanShown } from '../components/TrackSpanLayer';
import FlightPumpingPanel, { type FlightColumn } from '../components/FlightPumpingPanel';
import TopsPanel, { TopsHighlight } from '../components/TopsPanel';
import HeartRateChart from '../components/HeartRateChart';
import { CardioCompanion } from '../components/HeartRatePanel';
import { heartRateReadout, speedReadout } from '../components/chartReadouts';
import { useAnalysisHeart, useHeartRateZoneHighlight } from '../hooks/useAnalysisHeart';
import TrackSegmentsLayer, { type TrackSegment } from '../components/TrackSegmentsLayer';
import TrackChart, { type TrackSeries } from '../components/TrackChart';
import { zoomHint } from '../components/zoomHint';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from '../components/highlightColors';
import { ANALYSIS_PANEL_STYLE, PANEL_BLOCK_STYLE } from '../components/styles';
import Button from '../components/ui/Button';
import { SURF_TABS, tabDefaults, type SurfTab } from '../core/analysisTabs';
import { sampledIndicesKeeping, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS, trackBounds } from '../core/displayConfig';
import { defaultActiveThresholdOf, sportTreatment } from '../core/sportProfiles';
import { nearestIndexAtTime } from '../core/search';
import { computeAllTopSegments } from '../core/topSegments';
import { effectiveSpeedRange, trackColorSegments } from '../core/trackColor';
import {
  SPEED_UNIT_LABEL, speedSourceText, formatDistance, formatDuration, formatShortDuration, formatSpeed, formatSpeedValue, formatTimeOfDay,
  fromDisplaySpeed, toDisplaySpeed, formatDecimal
} from '../core/units';
import { useTimeChartAxis } from '../hooks/useTimeChartAxis';
import { useGpxSession } from '../hooks/useGpxSession';
import { useAnalysisSession } from '../hooks/useAnalysisSession';
import { useAnalysisTabs } from '../hooks/useAnalysisTabs';
import { useZoomOnMap } from '../hooks/useZoomOnMap';
import { useSessionMarks } from '../hooks/useSessionMarks';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useOpenSections } from '../hooks/useOpenSections';
import { useFlightPumping, useSessionPumping } from '../hooks/useSessionPumping';
import { useSportSettings } from '../hooks/useSportSettings';
import type { SurfFlight, SurfPhase, SurfReturn, SurfSpan } from '../surfing/surfAnalysis';
import { effectiveWaveThreshold, runSurfSession, surfProfileOf } from '../surfing/surfSession';
import StatTile from '../components/ui/StatTile';
import MapToggle from '../components/ui/MapToggle';
import SegmentedControl from '../components/ui/SegmentedControl';
import { SPEED_COLOR } from '../components/chartStyle';
import AnalysisShell from '../components/AnalysisShell';

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

const SURF_SECTION_DEFAULTS = tabDefaults(SURF_TABS);

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
const WAVE_SORT_LABEL: Record<WaveSort, string> = { ordre: 'Ordre', distance: 'Distance', vitesse: 'Vitesse', duree: 'Durée' };


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
/** Curseur commun aux graphes de vitesse et de FC (Q38) : ils lisent les mêmes lignes. */
const SURF_SYNC_ID = 'surf';
const SPEED_SERIES: TrackSeries<ChartRow>[] = [{ kind: 'line', key: 'speed', name: 'Vitesse', color: SPEED_COLOR, width: 1.5, activeDotR: 4 }];

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
  const gpx = useGpxSession({ profile });

  // Session de l'adresse et son brouillon : seuils, foil, couleurs ; écrit dans sa fiche par « Enregistrer la session ».
  const {
    sessionFile, requested: requestedFile, shownFile, error: sessionError, draft, allActivities, changeActivity: changeSessionActivity,
  } = useAnalysisSession({ family: 'surf', activity, setActivity, load: gpx.loadGpxContent, loadedFile: gpx.fileName });

  /** Foil de la session (brouillon, puis fiche), sinon celui de l'activité. */
  const foil = draft.edits.foil ?? activityFoil;
  /** Pumping foil de la session (brouillon, puis fiche), sinon celui de l'activité ; sur foil seulement. */
  const pumping = foil && (draft.edits.pumping ?? activityPumping);
  /** Seuil de la glisse : celui de la session, sinon de l'activité, sinon le défaut, de vague ou de vol selon le foil. */
  const defaultThreshold = defaultActiveThresholdOf(profile, foil);
  const threshold = draft.edits.activeThreshold ?? thresholdOverride ?? defaultThreshold;
  const surfProfile = surfProfileOf(profile);
  const waveThreshold = surfProfile ? effectiveWaveThreshold(surfProfile.surf, draft.edits.waveThreshold) : 0;

  // Onglets de l'activité, rangée « avancé », surbrillance unique de la carte, point survolé effacé à chaque session.
  const { open, toggle, toggleOf, advanced, shown, highlight } = useAnalysisTabs({
    storageId: STORAGE_ID, tabs: SURF_TABS, defaults: SURF_SECTION_DEFAULTS, activity, sessionKey: gpx.sessionKey,
  });
  const graphFolds = useOpenSections(`${STORAGE_ID}.graphes`, GRAPH_FOLDS_DEFAULT);
  /** FC de la session (ceinture, montre) et zones du pratiquant : l'onglet « cardio » et sa courbe sous la vitesse. */
  const { runner, retainHr, heart, hrZones } = useAnalysisHeart(gpx.track, profile.heartRate, hrOffsetBpm);
  const sections = useMemo(
    () => shown((s) => (s.key !== 'vols' || foil) && (s.key !== 'cardio' || heart.present)),
    [shown, foil, heart.present]
  );
  const [waveSort, setWaveSort] = useState<WaveSort>('ordre');
  const narrow = useNarrowScreen();

  const { track, cumulative } = gpx;
  // Repères du bouton « Note » : fanions, liste de « Général », traits du graphe.
  const marks = useSessionMarks(draft, track, cumulative.cumDist);
  const shownMarkKey = highlight.shownIn('general');
  const shownMark = shownMarkKey === null ? null : Number(shownMarkKey);
  /** Zone cardiaque montrée sur la carte (onglet « cardio »). */
  const hrZone = useHeartRateZoneHighlight(highlight, open.cardio, heart, hrZones, track, profile.heartRate.gapS);
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

  /** Bornes du dégradé de couleur, en m/s : celles de la session, sinon de Réglages, sinon le défaut de l'activité. */
  const range = effectiveSpeedRange({ sessionRange: draft.edits.speedRange, activityRange: speedRange, suggested: null, fallback: defaultSpeedRange });
  const treatment = sportTreatment(activity.base);
  const mapSegments = useMemo(
    (): TrackSegment[] => trackColorSegments(track, treatment, { minMs: range.minMs, maxMs: range.maxMs }),
    [track, treatment, range.minMs, range.maxMs]
  );
  const mapBounds = useMemo(() => trackBounds(track), [track]);

  /** Chiffres de l'onglet « général », proposés aussi pour l'image de partage. */
  const generalStats: ShareStat[] = summary ? [
    { key: 'totalTime', label: 'Durée de la session', value: formatDuration(summary.totalS * 1000) },
    { key: 'waveTime', label: `Sur la vague (${summary.totalS > 0 ? formatDecimal((summary.waveS / summary.totalS) * 100, 1) : '0'} %)`, value: formatShortDuration(summary.waveS) },
    { key: 'waves', label: 'Vagues', value: `${summary.waveCount}${summary.wavesPerHour !== null && summary.waveCount > 0 ? ` (${formatDecimal(summary.wavesPerHour, 1)} / h)` : ''}` },
    { key: 'averageWave', label: 'Distance moyenne', value: orDash(summary.avgWaveDistanceM, (m) => `${Math.round(m)} m`) },
    { key: 'longestWave', label: 'Plus longue vague', value: orDash(summary.longestWaveM, (m) => `${Math.round(m)} m`) },
    { key: 'maxSpeed', label: 'Vitesse max', value: orDash(summary.maxWaveSpeedMs, (v) => formatSpeed(v, speedUnit)) },
    { key: 'waveSpeed', label: 'Moyenne sur la vague', value: orDash(summary.avgWaveSpeedMs, (v) => formatSpeed(v, speedUnit)) },
    { key: 'paddleSpeed', label: 'Vitesse de rame', value: orDash(summary.paddleSpeedMs, (v) => formatSpeed(v, speedUnit)), title: 'Moyenne en mouvement, arrêts courts exclus' },
    { key: 'return', label: 'Retour au pic (moyen)', value: orDash(summary.avgReturnS, formatShortDuration), title: "De la fin d'une vague à la première attente" },
    ...(foil ? [
      { key: 'longestFlight', label: 'Plus long vol', value: orDash(summary.longestFlightS, formatShortDuration) },
      { key: 'flightTime', label: `Ratio de vol (${summary.totalS > 0 ? formatDecimal((summary.flightS / summary.totalS) * 100, 1) : '0'} %)`, value: formatShortDuration(summary.flightS) },
      { key: 'wavesInFlight', label: 'Vagues en un vol', value: String(summary.maxWavesInFlight ?? '—'), title: 'Le plus de vagues reliées par un même vol' },
    ] : []),
    { key: 'distance', label: 'Distance totale', value: formatDistance(totalDistanceM, distanceUnit) },
    ...(heart.present && heart.stats ? [{ key: 'heartRate', label: 'FC moyenne', value: `${Math.round(heart.stats.avgBpm)} bpm` }] : []),
  ] : [];

  /**
   * Chiffres de l'onglet « général » (22/10) : l'essentiel, le détail restant dans « avancé ».
   * L'image de partage garde la liste entière (`generalStats`).
   */
  const overviewKeys = ['totalTime', 'waves', 'waveTime', 'longestWave', 'maxSpeed', ...(foil ? ['flightTime', 'longestFlight'] : []), 'heartRate'];
  const overviewStats = overviewKeys.flatMap((key) => generalStats.filter((stat) => stat.key === key));

  // Une seule surbrillance : une vague (son numéro) ou le podium, un vol, une remontée.
  const waveShown = highlight.shownIn('vagues');
  const flightShown = highlight.shownIn('vols');
  const returnShown = highlight.shownIn('rame');
  const waves = useMemo(() => analysis?.waves ?? [], [analysis]);
  const flights = useMemo(() => analysis?.flights ?? [], [analysis]);
  const returns = useMemo(() => analysis?.returns ?? [], [analysis]);

  // Pumping des vols, par les capteurs de la session : il suit les vols, donc le seuil du brouillon.
  // Capteurs lus à l'ouverture de l'onglet « vols », Pumping coché, comme en voile : une capture entière pèse plusieurs Mo.
  const sensors = useSessionPumping(shownFile, pumping && open.vols);
  const {
    byFlight: flightPumping, summary: pumpSummary, podium: podiumFlights,
  } = useFlightPumping(sensors.recording, surfProfile?.pump ?? null, track, cumulative, flights);
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
      return nearestIndexAtTime(track, targetMs);
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
      const start = nearestIndexAtTime(track, r.startMs);
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
    // Les extrêmes de la vitesse et de la FC restent : un pic bref de FC ne disparaît pas.
    return sampledIndicesKeeping(first, last, CHART_MAX_POINTS, [speedSeries, heart.smoothed]).map((i): ChartRow => ({
      index: i,
      minutes: trackMinutes[i],
      speed: parseFloat(toDisplaySpeed(track[i].smoothedSpeedMs, speedUnit).toFixed(2)),
      speedMs: track[i].smoothedSpeedMs,
      hr: heart.smoothed[i] === null || heart.smoothed[i] === undefined ? null : Math.round(heart.smoothed[i]!),
    }));
  }, [track, open.graphiques, trackMinutes, zoom.view, speedUnit, heart.smoothed, speedSeries]);
  const minutesOf = (ms: number) => (track.length > 0 ? (ms - track[0].timeMs) / 60000 : 0);
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
  /** Rappels de l'onglet « cardio », stables : le panneau, mémoïsé, ne se redessine pas au zoom d'un autre graphe. */
  const firstMs = track[0]?.timeMs ?? null;
  const retainSessionHrMax = useCallback((bpm: number) => retainHr('hrMax', bpm, { kind: 'seance', atMs: firstMs }), [retainHr, firstMs]);
  const { show: showZoomOnMap } = zoomOnMap;
  const showCardioOnMap = useCallback(() => showZoomOnMap('cardio'), [showZoomOnMap]);

  /** Graphe de vitesse : bandes des vagues et des vols, repères ; dans l'onglet, et sous la carte en plein écran. */
  const speedChart = (style: CSSProperties) => (
    <TrackChart rows={chartData} zoom={zoom} x={timeChart.timeX} series={SPEED_SERIES} syncId={SURF_SYNC_ID}
      yAxes={[{ color: SPEED_COLOR, unit: unitLabel, domain: [0, 'auto'], width: 46, tickFormatter: (v) => formatSpeedValue(v, speedUnit) }]}
      onShowOnMap={showGraphsOnMap} style={style}>
      {markReferenceLines(marks.located, (m) => minutesOf(m.mark.timeMs), shownMark)}
      {foil && flights.map((f) => (
        <ReferenceArea key={`vol-${f.n}`} x1={minutesOf(f.startMs)} x2={minutesOf(f.endMs)} fill={FLIGHT_BAND_COLOR} fillOpacity={0.1} ifOverflow="hidden" />
      ))}
      {waves.map((w) => (
        <ReferenceArea key={`vague-${w.n}`} x1={minutesOf(w.startMs)} x2={minutesOf(w.endMs)} fill={WAVE_BAND_COLOR} fillOpacity={0.18} ifOverflow="hidden" />
      ))}
    </TrackChart>
  );
  /** Courbe de FC de « graphiques » ; ses boutons de zoom quand la vitesse est repliée. */
  const heartChart = (speedShown: boolean) => (
    <HeartRateChart data={chartData} zoom={zoom} x={timeChart.timeX} zones={hrZones?.bounds ?? null} thresholds={hrZones ? { s1: hrZones.s1, s2: hrZones.s2 } : null}
      syncId={SURF_SYNC_ID} showReset={!speedShown} onShowOnMap={showGraphsOnMap} style={chartBox(CHART_HEIGHT_PX)}>
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
    <AnalysisBaseLayers family="surf" track={track} zonePaths={hrZone.paths} zonePathsKey={hrZone.selectedZone}
      zoomPath={zoomOnMap.path} marks={marks.located} shownMark={shownMark}>
      <TrackSegmentsLayer segments={mapSegments} weight={5} family={'surf'} />
      <TrackSpanLayer track={track} spans={shownSpans} />
      <TopsHighlight tops={tops} selected={topShown} />
    </AnalysisBaseLayers>
  );

  const unitLabel = SPEED_UNIT_LABEL[speedUnit];
  const rideWord = foil ? 'vol' : 'vague';
  const measuredReturns = returns.filter((r) => r.after > 0);
  const firstOut = returns.find((r) => r.after === 0) ?? null;

  return (
    <AnalysisShell title="Analyse Surf" family="surf" backLabel="Surf" file={gpx.fileName}
      share={{ segments: mapSegments, stats: generalStats }} error={sessionError} draft={draft} loadError={gpx.error}
      empty={!summary && !gpx.error && requestedFile === null}
      map={{
        panelId: panelId('carte'),
        expanded: mapExpanded,
        onExpandedChange: (next) => {
          setMapExpanded(next);
          if (!next) zoomOnMap.closeCompanion();
        },
        focus: zoomOnMap.focus,
        companion: companionCharts(zoomOnMap.companionPanel),
        sessionKey: gpx.sessionKey,
        bounds: mapBounds,
        layers: mapLayers,
        defaultHeight: 480,
        legend: track.length === 0 ? null : <SpeedGradientLegend unit={speedUnit} range={range} slowLabel="rame et attente" />,
      }}
      tabs={summary && analysis && surfProfile ? {
        sections, open, onToggle: toggle, advanced, accent: ACCENT, panels: (
          <>
            {open.general && (
              <ResizablePanel id={panelId('general')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Général" extra={<SessionDate track={gpx.track} />} open={open.general} onToggle={toggleOf('general')} />
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
                            <Swatch color={PHASE_COLORS[phase]} bordered />
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
              <ResizablePanel id={panelId('vagues')} style={ANALYSIS_PANEL_STYLE}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <PanelTitle label={`Vagues (${waves.length})`} open={open.vagues} onToggle={toggleOf('vagues')} helpKey="surf:vagues" />
                  <span style={{ flex: 1 }} />
                  {waves.length > 1 && (
                    <>
                      <label style={{ fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        Tri
                        <SegmentedControl<WaveSort> label="Tri des vagues" accent={ACCENT} value={waveSort} onChange={setWaveSort}
                          items={(Object.keys(WAVE_SORT_LABEL) as WaveSort[]).map((k) => ({ key: k, label: WAVE_SORT_LABEL[k] }))} />
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
                    <table className="ui-table">
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
                            <tr key={w.n} className="ui-table__row">
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
              <ResizablePanel id={panelId('rame')} style={ANALYSIS_PANEL_STYLE}>
                <PanelHeading label="Rame et retour au pic" open={open.rame} onToggle={toggleOf('rame')} helpKey="surf:rame" />
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
                    <table className="ui-table">
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
                            <tr key={r.after} className="ui-table__row">
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
              <ResizablePanel id={panelId('vols')} style={ANALYSIS_PANEL_STYLE}>
                <FlightPumpingPanel
                  label={`Vols (${flights.length})`} helpKey="surf:vols" open={open.vols} onToggle={toggleOf('vols')}
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
              <ResizablePanel id={panelId('tops')} style={ANALYSIS_PANEL_STYLE}>
                <TopsPanel targets={profile.topTargets} tops={tops} unit={speedUnit} selected={topShown}
                  onSelect={(key) => highlight.show('tops', key)} accent={ACCENT} open={open.tops} onToggle={toggleOf('tops')} />
              </ResizablePanel>
            )}

            {open.graphiques && chartData.length > 1 && (() => {
              // Sans FC, un seul graphe : pas de repli. Avec, chacun le sien, « Tout voir » sur le premier montré.
              const folds = heart.present;
              const speedShown = !folds || graphFolds.open.vitesse;
              const hrShown = heart.present && graphFolds.open.fc;
              return (
              <ResizablePanel id={panelId('graphiques')} defaultHeight={folds ? undefined : 360} minHeight={folds ? 120 : 200} direction="vertical"
                style={{ ...PANEL_BLOCK_STYLE, display: 'flex', flexDirection: 'column', overflow: folds ? 'auto' : 'hidden' }}>
                <div className="chart-head" style={{ marginBottom: '8px', paddingRight: '28px' }}>
                  <PanelTitle label="Vitesse" open={open.graphiques} onToggle={toggleOf('graphiques')} helpKey="surf:graphiques" />
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
              <CardioTab id={panelId('cardio')} track={track} minutes={trackMinutes} heart={heart} params={profile.heartRate} zones={hrZones} runner={runner}
                onRetainHrMax={retainSessionHrMax} zone={hrZone}
                zoom={cardioZoom} onShowOnMap={showCardioOnMap}
                open={open.cardio} onToggle={toggleOf('cardio')} />
            )}

            {open.notes && (
              <NotesTab id={panelId('notes')} draft={draft} family="surf" conditions="libre"
                gearFields={gearFieldsFor(gearLabels)} gearGroups={gearGroups} activityId={activity.id} open={open.notes} onToggle={toggleOf('notes')} />
            )}

            {open.reglages && (
              <ResizablePanel id={panelId('reglages')} style={ANALYSIS_PANEL_STYLE}>
                <SessionSettingsHeader helpKey="surf:reglages" open={open.reglages} onToggle={toggleOf('reglages')}>
                  Vitesse : {speedSourceText(gpx.hasDeviceSpeed, gpx.deviceSpeedUnit)}
                  {' · '}Cap : {track.some((p) => p.courseDeg !== undefined) ? "fourni par l'appareil" : 'tiré des positions'}.
                </SessionSettingsHeader>
                <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <SessionActivityField activities={allActivities} activity={activity} withPositions families={sessionFile ? undefined : ['surf']}
                    onChange={(next) => changeSessionActivity(sessionFile, next)} />
                  <FoilPumpingFields
                    foilTitle="Surf foil pour cette session, enregistré avec elle. Celui de l'activité se règle dans Réglages."
                    foil={foil} foilIsDefault={draft.edits.foil === null} onFoilChange={(next) => draft.update({ foil: next })}
                    showPumping={foil} pumping={pumping} pumpingIsDefault={draft.edits.pumping === null}
                    onPumpingChange={(next) => draft.update({ pumping: next === activityPumping ? null : next })} />
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
                    <SessionColorRangeField unit={speedUnit} range={range} isOverridden={draft.edits.speedRange !== null}
                      onChange={(next) => draft.update({ speedRange: next })} />
                  )}
                </div>
              </ResizablePanel>
            )}
          </>
        ),
      } : null} />
  );
}

export default SurfModule;
