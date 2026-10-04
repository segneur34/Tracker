import { Fragment, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, Polyline } from 'react-leaflet';
import OsmTileLayer from '../components/OsmTileLayer';
import 'leaflet/dist/leaflet.css';
import './analysisMobile.css';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipPayloadEntry, type TooltipValueType,
} from 'recharts';
import ActivitySelect from '../components/ActivitySelect';
import AnalysisMap from '../components/AnalysisMap';
import PanelTitle from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import SessionNameEditor from '../components/SessionNameEditor';
import SessionSaveBar from '../components/SessionSaveBar';
import SpeedRangeEditor from '../components/SpeedRangeEditor';
import ZoomableChart, { ChartZoomProbe } from '../components/ZoomableChart';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { IconChevronRight } from '../components/icons';
import { gradeGradientDefs } from '../components/gradeGradientDefs';
import { CARD_STYLE } from '../components/styles';
import PageHeader from '../components/ui/PageHeader';
import { niceTicks, sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS, trackBounds } from '../core/displayConfig';
import { computeElevationStats } from '../core/elevation';
import {
  buildCumulativeTrack, buildBaseSessionStats, computeActiveDistanceM, computeActiveTimeMs,
  computeActivityMask, computeTotalTimeMs,
} from '../core/sessionStats';
import { sessionActivity } from '../core/activities';
import { ELEVATION_PRESETS, getActiveThresholds } from '../core/sportProfiles';
import { computeAllTopSegments } from '../core/topSegments';
import { meanFilterByTime } from '../core/speedFilter';
import { SLOW_COLOR, gradientCss, isValidSpeedRange, speedGradientColor } from '../core/speedGradient';
import {
  DISTANCE_UNIT_SYMBOL, SPEED_UNIT_LABEL, formatDistance, formatSpeed, formatSpeedValue, fromDisplaySpeed, isInverseUnit,
  toDisplayDistance, toDisplaySpeed,
} from '../core/units';
import { useChartZoom } from '../hooks/useChartZoom';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useGpxSession } from '../hooks/useGpxSession';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { libraryPath, useChangeSessionActivity, useSessionFromUrl } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import {
  TERRAIN_LABEL, TEXT_SCALE_FACTOR, readStoredActivities, useSportSettings, type TerrainType,
} from '../hooks/useSportSettings';
import { averagePace, computeGrades, computeZoneStats, gradeGradientStops } from '../running/runningAnalytics';
import { smoothMovingPower } from '../running/energy';
import type { RunningSessionStats } from '../running/types';
import { BIKE_TYPES } from '../cycling/energy';
import type { LibrarySession } from '../library/record';
import { LAND_MODULES, type LandFamily } from './landModules';

/** Lissage supplémentaire de la vitesse pour le graphe, en secondes. */
const CHART_SPEED_SMOOTHING_S = 10;
/** Lissage de la vitesse pour la couleur de la trace, en secondes. */
const MAP_SPEED_SMOOTHING_S = 15;
/** Lissage de la puissance du graphe d'énergie, en secondes. */
const ENERGY_POWER_SMOOTHING_S = 60;
/** Couleurs des trois premiers d'un top, sur la carte et dans le tableau (comme en voile). */
const TOP_COLORS = ['#d32f2f', '#f57c00', '#388e3c'];

/**
 * Sections du module. Pour en ajouter une : une entrée ici, une valeur par
 * défaut dans `LAND_SECTION_DEFAULTS`, et un bloc `{open.maCle && (...)}`
 * dans le rendu. Le premier onglet, « général », porte la synthèse (repliable
 * pour gagner de la place, comme en voile), le dernier les réglages de la
 * session. La carte n'en fait pas partie : comme en voile, elle
 * s'affiche en permanence, jamais derrière un onglet qu'on pourrait fermer
 * et oublier rouvert. « tops » n'apparaît que si le calcul a des cibles de
 * meilleurs segments (le vélo, pas la course).
 */
type LandSection = 'general' | 'tops' | 'zones' | 'energie' | 'graphiques' | 'reglages';

const LAND_SECTIONS: SectionDefinition<LandSection>[] = [
  { key: 'general', label: 'général' },
  { key: 'tops', label: 'tops' },
  { key: 'zones', label: 'zones de pente' },
  { key: 'energie', label: 'énergie' },
  { key: 'graphiques', label: 'graphiques' },
  { key: 'reglages', label: 'réglages' },
];

const LAND_SECTION_DEFAULTS: Record<LandSection, boolean> = {
  general: true,
  tops: true,
  zones: true,
  energie: false,
  graphiques: true,
  reglages: false,
};

type ChartMode = 'separate' | 'overlay';
type EnergyChartMode = 'power' | 'cumulative';

/** Une ligne des graphes : `index` renvoie au point de trace d'origine. */
interface ChartRow {
  index: number;
  /** Distance parcourue, dans l'unité de l'activité. */
  dist: number;
  speed: number | null;
  speedMs: number;
  altitude: number | null;
  /** Pente locale en fraction, `null` là où elle manque. */
  grade: number | null;
}

/** Une ligne du graphe d'énergie, en fonction du temps écoulé. */
interface EnergyChartRow {
  index: number;
  /** Temps écoulé depuis le départ, en minutes. */
  minutes: number;
  /** Puissance lissée, dans l'unité du modèle (`EnergyView.powerUnit`), `null` à l'arrêt. */
  power: number | null;
  /** Énergie totale dépensée depuis le départ, dans l'unité du modèle. */
  cumulative: number;
  speedMs: number;
  grade: number | null;
}

/** Chiffres du panneau Énergie, dépliés tant qu'on ne les a pas repliés pour voir carte et graphe ensemble. */
const ENERGY_FIGURES_DEFAULT = { chiffres: true };

/** Temps écoulé, donné en minutes, écrit en h:mm, ou en h:mm:ss hors de la minute ronde (graphe zoomé). */
const formatMinutes = (minutes: number): string => {
  const totalS = Math.round(minutes * 60);
  const hm = `${Math.floor(totalS / 3600)}:${String(Math.floor(totalS / 60) % 60).padStart(2, '0')}`;
  return totalS % 60 === 0 ? hm : `${hm}:${String(totalS % 60).padStart(2, '0')}`;
};

const cardStyle = CARD_STYLE;
const chartTooltipStyle = { fontSize: '12px' } as const;

/**
 * Module des familles terrestres, course à pied et vélo (`landModules.tsx`) :
 * trace colorée par la vitesse, graphes de vitesse et d'altitude séparés ou
 * superposés et zoomables, vitesses par zone de pente, énergie, meilleurs
 * segments.
 */
function LandModule({ family }: { family: LandFamily }) {
  const config = LAND_MODULES[family];
  const panelId = (name: string) => `${config.storageId}.${name}`;
  const {
    activity, setActivity,
    profile, activeThreshold, terrain, setTerrain, elevationProfile,
    speedUnit, distanceUnit, textScale,
    speedRange, gradeRange, defaultSpeedRange, bikeType, bikeWeightKg,
  } = useSportSettings(family);
  const { profile: runner, age } = useRunnerProfile();
  const gpx = useGpxSession({
    medianWindowSeconds: profile.medianWindowSeconds,
    maxSpeedMs: profile.maxPlausibleSpeedMs,
  });

  // Session de la mémoire désignée par l'URL.
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
  // Brouillon de la session de la mémoire affichée (couleurs de la trace), écrit
  // dans sa fiche par « Enregistrer la session ». Aucun pour un GPX lu hors de la mémoire.
  const draft = useSessionDraft(sessionFile !== null && gpx.fileName === sessionFile ? sessionFile : null);

  /**
   * Changer d'activité l'écrit aussi dans la fiche de la session (comme en
   * voile) ; vers une activité de voile, la session part dans le module voile.
   */
  const [allActivities] = useState(readStoredActivities);
  const changeSessionActivity = useChangeSessionActivity(family, setActivity);

  const { open, toggle } = useOpenSections<LandSection>(config.storageId, LAND_SECTION_DEFAULTS);
  const sections = useMemo(
    () => LAND_SECTIONS.filter((s) => s.key !== 'tops' || profile.topTargets.length > 0),
    [profile.topTargets]
  );
  const [selectedTop, setSelectedTop] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>('separate');
  const [energyMode, setEnergyMode] = useState<EnergyChartMode>('power');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const narrow = useNarrowScreen();
  const scale = TEXT_SCALE_FACTOR[textScale];
  const unitLabel = SPEED_UNIT_LABEL[speedUnit];
  const inverse = isInverseUnit(speedUnit);

  const cumulative = useMemo(() => buildCumulativeTrack(gpx.track), [gpx.track]);

  const elevation = useMemo(
    () => computeElevationStats(gpx.track, elevationProfile),
    [gpx.track, elevationProfile]
  );

  const activityMask = useMemo(() => {
    const thresholds = getActiveThresholds(profile, activeThreshold);
    return computeActivityMask(gpx.track, {
      enterThresholdMs: fromDisplaySpeed(thresholds.enter, profile.thresholdUnit),
      exitThresholdMs: fromDisplaySpeed(thresholds.exit, profile.thresholdUnit),
      minStateDurationS: profile.minStateDurationS,
    });
  }, [gpx.track, profile, activeThreshold]);

  const stats: RunningSessionStats | null = useMemo(() => {
    if (gpx.track.length === 0) return null;
    const thresholds = getActiveThresholds(profile, activeThreshold);
    return buildBaseSessionStats(gpx.track, {
      enterThresholdMs: fromDisplaySpeed(thresholds.enter, profile.thresholdUnit),
      exitThresholdMs: fromDisplaySpeed(thresholds.exit, profile.thresholdUnit),
      minStateDurationS: profile.minStateDurationS,
      cumulative,
      activityMask,
      elevationStats: elevation,
    });
  }, [gpx.track, profile, activeThreshold, cumulative, activityMask, elevation]);

  /** Allures moyennes : sur le temps total, et sur le seul temps en mouvement. */
  const averages = useMemo(() => {
    if (gpx.track.length === 0) return null;
    const totalDistanceM = cumulative.cumDist[cumulative.cumDist.length - 1] ?? 0;
    return {
      overall: averagePace(totalDistanceM, computeTotalTimeMs(gpx.track)),
      moving: averagePace(computeActiveDistanceM(gpx.track, activityMask), computeActiveTimeMs(gpx.track, activityMask)),
    };
  }, [gpx.track, cumulative, activityMask]);

  const grades = useMemo(
    () => (stats?.hasElevation ? computeGrades(elevation.smoothed, cumulative) : []),
    [stats, elevation, cumulative]
  );

  const zoneStats = useMemo(
    () => (grades.length > 0 ? computeZoneStats(gpx.track, grades, activityMask) : []),
    [gpx.track, grades, activityMask]
  );

  /**
   * Énergie dépensée, selon le modèle de la famille (`landModules.tsx`) :
   * pente, résistance de l'air, et repos sur toute la durée.
   */
  const energy = useMemo(
    () => (gpx.track.length > 1
      ? config.energy({ track: gpx.track, grades, activityMask, runner, age, bikeType, bikeWeightKg })
      : null),
    [config, gpx.track, grades, activityMask, runner, age, bikeType, bikeWeightKg]
  );

  /** Chiffres du panneau Énergie repliés ou dépliés, choix gardé sur l'appareil. */
  const energyFold = useOpenSections(`${config.storageId}.energie`, ENERGY_FIGURES_DEFAULT);
  /** Temps écoulé de chaque point, en minutes : l'axe du graphe d'énergie et de son zoom. */
  const trackMinutes = useMemo(
    () => gpx.track.map((p) => (p.timeMs - gpx.track[0].timeMs) / 60000),
    [gpx.track]
  );
  /** Zoom du graphe d'énergie, sur son axe en temps ; « tout voir » à chaque session. */
  const energyZoom = useChartZoom(
    trackMinutes.length > 1 ? { min: trackMinutes[0], max: trackMinutes[trackMinutes.length - 1] } : null,
    gpx.sessionKey
  );
  /** Puissance lissée, une fois pour toute la trace : zoomer ne la recalcule pas. */
  const smoothedPower = useMemo(
    () => (energy && open.energie ? smoothMovingPower(energy.power, gpx.track, ENERGY_POWER_SMOOTHING_S) : []),
    [energy, open.energie, gpx.track]
  );
  /** Lignes du graphe d'énergie sur la plage visible, au plus `CHART_MAX_POINTS`. */
  const energyChartData = useMemo(() => {
    if (!energy || smoothedPower.length === 0) return [];
    const [first, last] = visibleIndexRange(trackMinutes, energyZoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS).map((i): EnergyChartRow => {
      const power = smoothedPower[i];
      return {
        index: i,
        minutes: parseFloat(trackMinutes[i].toFixed(3)),
        power: isFinite(power) ? Math.round(power * 10) / 10 : null,
        cumulative: energy.cumulative[i],
        speedMs: gpx.track[i].smoothedSpeedMs,
        grade: isFinite(grades[i]) ? grades[i] : null,
      };
    });
  }, [energy, smoothedPower, trackMinutes, energyZoom.view, gpx.track, grades]);

  /** Meilleurs segments, dans l'unité affichée (km/h pour une allure). */
  const topUnit = speedUnit === 'minkm' ? 'kmh' : speedUnit;
  const tops = useMemo(
    () => (profile.topTargets.length > 0 && gpx.track.length > 1 && open.tops
      ? computeAllTopSegments(gpx.track, cumulative, profile.topTargets, (ms) => toDisplaySpeed(ms, topUnit), { decimals: 1 })
      : null),
    [profile.topTargets, gpx.track, cumulative, open.tops, topUnit]
  );
  const selectedTopPaths = selectedTop !== null && tops ? tops[selectedTop] ?? [] : [];

  /** Bornes du dégradé de couleur, en m/s : celles de la session, sinon de Réglages, sinon le défaut de la famille. */
  const range = draft.edits.speedRange ?? speedRange ?? defaultSpeedRange;

  /** Vitesse des graphes, lissée une fois pour toute la trace. */
  const chartSpeed = useMemo(
    () => meanFilterByTime(gpx.track.map((p) => p.smoothedSpeedMs), gpx.track.map((p) => p.timeMs), CHART_SPEED_SMOOTHING_S),
    [gpx.track]
  );
  /** Distance de chaque point dans l'unité choisie : l'axe des graphes et de leur zoom. */
  const trackDist = useMemo(() => cumulative.cumDist.map((m) => toDisplayDistance(m, distanceUnit)), [cumulative, distanceUnit]);
  /** Zoom des graphes de vitesse et d'altitude, qui partagent leur axe ; « tout voir » à chaque session. */
  const zoom = useChartZoom(trackDist.length > 1 ? { min: trackDist[0], max: trackDist[trackDist.length - 1] } : null, gpx.sessionKey);

  /**
   * Séries des graphes sur la plage visible, au plus `CHART_MAX_POINTS` :
   * distance et vitesse dans l'unité choisie, altitude lissée. Zoomer montre
   * plus de détail.
   */
  const chartData = useMemo(() => {
    if (gpx.track.length === 0) return [];
    const [first, last] = visibleIndexRange(trackDist, zoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS).map((i): ChartRow => {
      const altitude = elevation.smoothed[i];
      const ms = chartSpeed[i];
      // En min/km, l'arrêt tend vers l'infini : on laisse un trou plutôt qu'une valeur absurde.
      const speed = inverse && ms < 0.3 ? null : parseFloat(toDisplaySpeed(ms, speedUnit).toFixed(2));
      return {
        index: i,
        dist: parseFloat(trackDist[i].toFixed(3)),
        speed,
        speedMs: ms,
        altitude: stats?.hasElevation && isFinite(altitude) ? Math.round(altitude) : null,
        grade: isFinite(grades[i]) ? grades[i] : null,
      };
    });
  }, [gpx.track, trackDist, zoom.view, chartSpeed, elevation, stats, grades, speedUnit, inverse]);

  /** Arrêts du dégradé de pente, sur l'étendue des lignes qui portent une altitude (celle de l'aire tracée). */
  const gradeStops = useMemo(
    () => gradeGradientStops(chartData.filter((row) => row.altitude !== null), gradeRange),
    [chartData, gradeRange]
  );
  const gradientId = useId();
  const overlayGradientId = `${gradientId}-superpose`;
  const separateGradientId = `${gradientId}-separe`;

  const mapSegments = useMemo(() => {
    if (gpx.track.length < 2) return [];
    const colorSpeed = meanFilterByTime(
      gpx.track.map((p) => p.smoothedSpeedMs),
      gpx.track.map((p) => p.timeMs),
      MAP_SPEED_SMOOTHING_S
    );
    return gpx.track.slice(1).map((point, index) => {
      const prev = gpx.track[index];
      return {
        id: index,
        positions: [[prev.lat, prev.lon], [point.lat, point.lon]] as [[number, number], [number, number]],
        color: speedGradientColor(colorSpeed[index + 1], range.minMs, range.maxMs),
      };
    });
  }, [gpx.track, range.minMs, range.maxMs]);

  const mapBounds = useMemo(() => trackBounds(gpx.track), [gpx.track]);

  const onChartHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, chartData);
    if (index !== null && index !== hoveredIndex) setHoveredIndex(index);
  };

  const onEnergyChartHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, energyChartData);
    if (index !== null && index !== hoveredIndex) setHoveredIndex(index);
  };

  const energyTooltipFormatter = (
    value: TooltipValueType | undefined,
    name: string | number | undefined,
    item: TooltipPayloadEntry
  ): [ReactNode, string | number | undefined] => {
    // Recharts ne type pas la ligne de données derrière l'entrée : on la relit sous la forme de `energyChartData`.
    const row: EnergyChartRow | undefined = item.payload;
    const detail = row ? ` · ${formatSpeed(row.speedMs, speedUnit)}${row.grade !== null ? ` · pente ${Math.round(row.grade * 100)} %` : ''}` : '';
    if (name === 'Puissance') return [`${value} ${energy?.powerUnit ?? ''}${detail}`, name];
    if (name === 'Énergie dépensée') return [`${value} ${energy?.cumulativeUnit ?? ''}${detail}`, name];
    return [String(value ?? ''), name];
  };

  const tooltipFormatter = (
    value: TooltipValueType | undefined,
    name: string | number | undefined,
    item: TooltipPayloadEntry
  ): [ReactNode, string | number | undefined] => {
    // Recharts ne type pas la ligne de données derrière l'entrée : on la relit sous la forme de `chartData`.
    const row: ChartRow | undefined = item.payload;
    if (name === 'Vitesse' && row) return [formatSpeed(row.speedMs, speedUnit), name];
    if (name === 'Altitude') return [row?.grade != null ? `${value} m, pente ${Math.round(row.grade * 100)} %` : `${value} m`, name];
    return [String(value ?? ''), name];
  };

  const speedAxis = (
    <YAxis
      yAxisId="speed"
      domain={inverse ? ['auto', 'auto'] : [0, 'auto']}
      reversed={inverse}
      tickFormatter={(v) => formatSpeedValue(v, speedUnit)}
      width={46}
      tick={{ fill: '#1e88e5', fontSize: 11 }}
      label={{ value: unitLabel, angle: -90, position: 'insideLeft', fill: '#1e88e5', fontSize: 11 }} />
  );
  const altitudeAxis = (orientation: 'left' | 'right') => (
    <YAxis yAxisId="altitude" orientation={orientation} domain={['auto', 'auto']} tickFormatter={(v) => `${v}`} width={44} tick={{ fill: '#e64a19', fontSize: 11 }} label={{ value: 'm', angle: -90, position: orientation === 'left' ? 'insideLeft' : 'insideRight', fill: '#e64a19', fontSize: 11 }} />
  );
  const distanceSymbol = DISTANCE_UNIT_SYMBOL[distanceUnit];
  /** Distance de l'infobulle, au centième. */
  const distanceLabel = (v: unknown) => `${parseFloat(Number(v).toFixed(2))} ${distanceSymbol}`;
  /** Graduations rondes, zoom compris (`niceTicks`). */
  const xAxis = (
    <XAxis dataKey="dist" type="number" allowDataOverflow
      domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
      ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
      tickFormatter={(v: number) => `${parseFloat(v.toFixed(3))} ${distanceSymbol}`} tick={{ fill: '#555', fontSize: 11 }} />
  );

  /** Couches de la carte, partagées par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <>
      <OsmTileLayer />
      {mapSegments.map((segment) => (
        <Polyline key={`track-${segment.id}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 5 }} />
      ))}
      {selectedTopPaths.map((top, idx) => top.path.length > 1 && (
        <Polyline key={`top-${selectedTop}-${idx}`} positions={top.path} pathOptions={{ color: TOP_COLORS[idx] ?? TOP_COLORS[2], weight: 10, opacity: 0.8 }} />
      ))}
      {hoveredIndex !== null && gpx.track[hoveredIndex] && (
        <CircleMarker
          center={[gpx.track[hoveredIndex].lat, gpx.track[hoveredIndex].lon]}
          radius={8}
          pathOptions={{ color: 'var(--ink)', fillColor: '#fff', fillOpacity: 1, weight: 3 }} />
      )}
    </>
  );

  return (
    <div className="an-page" style={{ padding: '20px' }} onMouseLeave={() => setHoveredIndex(null)}>
      <div className="an-sheet">
        <div className="an-sheet__head">
          <PageHeader title={config.title} subtitle={gpx.fileName ? <SessionNameEditor file={gpx.fileName} /> : undefined} back={{ to: libraryPath(family), label: config.backLabel }} />
          {sessionError && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError}</div>}
        </div>
      </div>

      <SessionSaveBar draft={draft} />

      {gpx.error && (
        <div className="ui-alert ui-alert--danger" style={{ marginBottom: '10px', maxWidth: '520px' }}>
          {gpx.error}
        </div>
      )}

      {!stats && !gpx.error && requestedFile === null && (
        <p style={{ color: 'var(--muted)' }}>
          Aucune session ouverte : choisissez-en une dans <Link to={libraryPath(family)}>{config.backLabel}</Link>.
        </p>
      )}

      {stats && averages && (
        <SectionTabs sections={sections} open={open} onToggle={toggle} accent={config.accent} />
      )}

      {stats && averages && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'stretch', marginBottom: '15px', fontSize: `${14 * scale}px` }}>
          {open.general && (
            <ResizablePanel id={panelId('general')} style={{ ...cardStyle, flex: '1 1 100%' }}>
              <div style={{ marginBottom: '10px' }}>
                <PanelTitle label="Général" open={open.general} onToggle={() => toggle('general')} />
              </div>
              <div className="an-sheet__stats an-sheet__stats--always">
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Distance</span><strong className="an-sheet__stat-value">{formatDistance(stats.distanceM, distanceUnit)}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Distance en mouvement</span><strong className="an-sheet__stat-value">{formatDistance(stats.activeDistanceM, distanceUnit)}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps de parcours</span><strong className="an-sheet__stat-value">{stats.totalTime}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps en mouvement ({stats.activeRatio} %)</span><strong className="an-sheet__stat-value">{stats.activeTime}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Moyenne en mouvement</span><strong className="an-sheet__stat-value">{formatSpeed(averages.moving.speedMs, speedUnit)}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Moyenne sur le temps total</span><strong className="an-sheet__stat-value">{formatSpeed(averages.overall.speedMs, speedUnit)}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Dénivelé</span><strong className="an-sheet__stat-value">{stats.hasElevation ? `+${stats.elevationGain} / -${stats.elevationLoss} m` : '—'}</strong></div>
                <div className="an-sheet__stat"><span className="an-sheet__stat-label">Altitude</span><strong className="an-sheet__stat-value">{stats.hasElevation ? `${stats.elevationMin} à ${stats.elevationMax} m` : '—'}</strong></div>
              </div>
              {!stats.hasElevation && (
                <div style={{ color: '#b71c1c', fontSize: 'var(--text-s)' }}>Le fichier ne porte pas d'altitude sur assez de points : pas de dénivelé ni de zones de pente.</div>
              )}
            </ResizablePanel>
          )}

          {open.tops && tops && (
            <ResizablePanel id={panelId('tops')} style={{ ...cardStyle, flex: '1 1 420px' }}>
              <div style={{ marginBottom: '10px' }}>
                <PanelTitle label="Meilleurs segments" open={open.tops} onToggle={() => toggle('tops')} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.93em', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                    <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Sur</th>
                    {['1er', '2e', '3e'].map((rank, idx) => (
                      <th key={rank} style={{ padding: '0.4em 0.6em', color: TOP_COLORS[idx] }}>{rank} ({SPEED_UNIT_LABEL[topUnit]})</th>
                    ))}
                    <th style={{ padding: '0.4em 0.6em' }}>Carte</th>
                  </tr>
                </thead>
                <tbody>
                  {(['time', 'distance'] as const).map((kind) => (
                    <Fragment key={kind}>
                      {profile.topTargets.filter((t) => t.kind === kind).map((target) => {
                        const values = tops[target.key] ?? [];
                        const reached = values.some((v) => v.path.length > 1);
                        const shown = selectedTop === target.key;
                        return (
                          <tr key={target.key} style={{ borderTop: '1px solid var(--line-soft)', opacity: reached ? 1 : 0.45 }}>
                            <td style={{ padding: '0.4em 0.6em', fontWeight: 'bold' }}>{target.label}</td>
                            {[0, 1, 2].map((idx) => (
                              <td key={idx} style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: idx === 0 ? 'bold' : 'normal' }}>{values[idx]?.val ?? '-'}</td>
                            ))}
                            <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>
                              <button type="button" disabled={!reached} onClick={() => setSelectedTop(shown ? null : target.key)}
                                style={{ padding: '2px 8px', fontSize: `${11 * scale}px`, cursor: reached ? 'pointer' : 'default', backgroundColor: shown ? config.accent : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
                                {shown ? 'Masquer' : 'Voir'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <div style={{ color: 'var(--muted)', fontSize: '0.8em', marginTop: '6px' }}>
                Vitesse moyenne du meilleur passage sur chaque durée ou distance, sans chevauchement, pauses comprises.
              </div>
            </ResizablePanel>
          )}

          {open.zones && zoneStats.length > 0 && (
            <ResizablePanel id={panelId('zones')} style={{ ...cardStyle, flex: '1 1 420px' }}>
              <div style={{ marginBottom: '10px' }}>
                <PanelTitle
                  label={config.zonesTitle}
                  extra={<span style={{ color: 'var(--muted)', fontSize: '0.75em', fontWeight: 'normal' }}>(en mouvement)</span>}
                  open={open.zones}
                  onToggle={() => toggle('zones')} />
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.93em', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                    <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Zone</th>
                    <th style={{ padding: '0.4em 0.6em', fontWeight: 'normal', color: 'var(--muted)' }}>Pente</th>
                    <th style={{ padding: '0.4em 0.6em' }}>Distance</th>
                    <th style={{ padding: '0.4em 0.6em' }}>Temps</th>
                    <th style={{ padding: '0.4em 0.6em' }}>Vitesse ({unitLabel})</th>
                  </tr>
                </thead>
                <tbody>
                  {zoneStats.map((z) => (
                    <tr key={z.zone.key} style={{ borderTop: '1px solid var(--line-soft)', opacity: z.timeMs > 0 ? 1 : 0.45 }}>
                      <td style={{ padding: '0.4em 0.6em', fontWeight: 'bold' }}>{z.zone.label}</td>
                      <td style={{ padding: '0.4em 0.6em', textAlign: 'center', color: 'var(--muted)', fontSize: '0.9em' }}>{z.zone.range}</td>
                      <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{formatDistance(z.distanceM, distanceUnit)} <span style={{ color: 'var(--muted)', fontSize: '0.85em' }}>({Math.round(z.distanceShare * 100)} %)</span></td>
                      <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{z.time}</td>
                      <td style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: 'bold' }}>{formatSpeed(z.avgSpeedMs, speedUnit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ color: 'var(--muted)', fontSize: '0.8em', marginTop: '6px' }}>
                Pente mesurée sur 50 m d'altitude lissée. Les pauses sont exclues de chaque zone.
              </div>
            </ResizablePanel>
          )}
        </div>
      )}

      {open.energie && energy && (
        <ResizablePanel id={panelId('energie')} defaultHeight={720} minHeight={320} direction="vertical"
          style={{ ...cardStyle, marginBottom: '15px', display: 'flex', flexDirection: 'column', overflow: 'auto', fontSize: `${14 * scale}px` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px', paddingRight: '28px' }}>
            <PanelTitle label={config.energyLabel} open={open.energie} onToggle={() => toggle('energie')} />
            <span style={{ flex: 1 }} />
            {(['power', 'cumulative'] as EnergyChartMode[]).map((mode) => (
              <button key={mode} onClick={() => setEnergyMode(mode)}
                style={{ padding: '4px 12px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: `${12 * scale}px`, backgroundColor: energyMode === mode ? config.accent : 'var(--surface-sunken)', color: energyMode === mode ? '#fff' : 'var(--ink)' }}>
                {mode === 'power' ? 'Puissance' : 'Cumulée'}
              </button>
            ))}
            <button type="button" aria-expanded={energyFold.open.chiffres} onClick={() => energyFold.toggle('chiffres')}
              title={energyFold.open.chiffres ? 'Replier les chiffres pour voir le graphe et la carte ensemble' : 'Montrer les chiffres'}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px 4px 12px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: `${12 * scale}px`, backgroundColor: 'var(--surface-sunken)', color: 'var(--ink)' }}>
              Chiffres
              <IconChevronRight size={14} style={{ transform: `rotate(${energyFold.open.chiffres ? -90 : 90}deg)`, transition: 'transform 0.15s' }} />
            </button>
          </div>
          {energyFold.open.chiffres && (
            <>
              {energy.warning && (
                <div className="ui-alert ui-alert--warning" style={{ marginBottom: '10px' }}>
                  {energy.warning}
                </div>
              )}
              <div className="an-sheet__stats an-sheet__stats--always" style={{ flexShrink: 0 }}>
                {energy.stats.map((stat) => (
                  <div key={stat.label} className="an-sheet__stat">
                    <span className="an-sheet__stat-label">{stat.label}</span>
                    <strong className="an-sheet__stat-value">{stat.value}{stat.detail && <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: '0.75em' }}> {stat.detail}</span>}</strong>
                  </div>
                ))}
              </div>
              {!stats?.hasElevation && (
                <div style={{ color: '#b71c1c', fontSize: 'var(--text-s)', marginBottom: '6px' }}>{config.flatWarning}</div>
              )}
            </>
          )}

          {energyChartData.length > 1 && (
            <ZoomableChart zoom={energyZoom} style={{ width: '100%', flex: 1, minHeight: '200px', marginTop: '6px' }}>
              <ResponsiveContainer>
                <ComposedChart data={energyChartData} onMouseMove={onEnergyChartHover} onTouchMove={onEnergyChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <ChartZoomProbe />
                  <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                  <XAxis dataKey="minutes" type="number" allowDataOverflow
                    domain={energyZoom.shown ? [energyZoom.shown.min, energyZoom.shown.max] : ['dataMin', 'dataMax']}
                    ticks={energyZoom.shown ? niceTicks(energyZoom.shown) : undefined}
                    tickFormatter={formatMinutes} tick={{ fill: '#555', fontSize: 11 }} />
                  <YAxis domain={[0, 'auto']} width={50} tick={{ fill: '#e64a19', fontSize: 11 }}
                    label={{ value: energyMode === 'power' ? energy.powerUnit : energy.cumulativeUnit, angle: -90, position: 'insideLeft', fill: '#e64a19', fontSize: 11 }} />
                  <Tooltip formatter={energyTooltipFormatter} labelFormatter={(l) => formatMinutes(Number(l))} contentStyle={chartTooltipStyle} />
                  {energyMode === 'power' ? (
                    <Line type="monotone" name="Puissance" dataKey="power" stroke="#e64a19" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  ) : (
                    <Area type="monotone" name="Énergie dépensée" dataKey="cumulative" stroke="#e64a19" strokeWidth={2} fill="#e64a19" fillOpacity={0.15} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </ZoomableChart>
          )}

          {stats?.hasElevation && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.93em', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginTop: '12px', flexShrink: 0 }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                  <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Zone</th>
                  <th style={{ padding: '0.4em 0.6em' }}>Énergie</th>
                  <th style={{ padding: '0.4em 0.6em' }}>Part</th>
                  <th style={{ padding: '0.4em 0.6em' }}>Par km</th>
                </tr>
              </thead>
              <tbody>
                {energy.zones.map((z) => (
                  <tr key={z.zone.key} style={{ borderTop: '1px solid var(--line-soft)', opacity: z.distanceM > 0 ? 1 : 0.45 }}>
                    <td style={{ padding: '0.4em 0.6em', fontWeight: 'bold' }}>{z.zone.label} <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: '0.85em' }}>{z.zone.range}</span></td>
                    <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{z.energy}</td>
                    <td style={{ padding: '0.4em 0.6em', textAlign: 'center' }}>{Math.round(z.share * 100)} %</td>
                    <td style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: 'bold' }}>{z.perKm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ color: 'var(--muted)', fontSize: `${11 * scale}px`, marginTop: '8px', flexShrink: 0 }}>
            {energy.note}
            {' '}Puissance lissée sur {ENERGY_POWER_SMOOTHING_S} s, moins près du départ et des arrêts, interrompue aux pauses.
          </div>
        </ResizablePanel>
      )}

      {open.graphiques && chartData.length > 1 && (
        <ResizablePanel id={panelId('graphiques')} defaultHeight={460} minHeight={220} direction="vertical"
          style={{ ...cardStyle, marginBottom: '15px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px', paddingRight: '28px' }}>
            <PanelTitle label="Vitesse et altitude" open={open.graphiques} onToggle={() => toggle('graphiques')} />
            <span style={{ flex: 1 }} />
            {(['separate', 'overlay'] as ChartMode[]).map((mode) => (
              <button key={mode} onClick={() => setChartMode(mode)}
                style={{ padding: '4px 12px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: `${12 * scale}px`, backgroundColor: chartMode === mode ? config.accent : 'var(--surface-sunken)', color: chartMode === mode ? '#fff' : 'var(--ink)' }}>
                {mode === 'separate' ? 'Séparés' : 'Superposés'}
              </button>
            ))}
          </div>

          {chartMode === 'overlay' ? (
            <ZoomableChart zoom={zoom} style={{ width: '100%', flex: 1, minHeight: 0 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} syncId={config.storageId} onMouseMove={onChartHover} onTouchMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <ChartZoomProbe />
                  <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                  {xAxis}
                  {speedAxis}
                  {stats?.hasElevation && altitudeAxis('right')}
                  <Tooltip formatter={tooltipFormatter} labelFormatter={distanceLabel} contentStyle={chartTooltipStyle} />
                  {stats?.hasElevation && gradeGradientDefs(overlayGradientId, gradeStops)}
                  {stats?.hasElevation && (
                    <Area yAxisId="altitude" type="monotone" name="Altitude" dataKey="altitude" stroke={`url(#${overlayGradientId})`} strokeWidth={1.5} fill={`url(#${overlayGradientId})`} fillOpacity={0.3} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  )}
                  <Line yAxisId="speed" type="monotone" name="Vitesse" dataKey="speed" stroke="#1e88e5" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ZoomableChart>
          ) : (
            <>
              <ZoomableChart zoom={zoom} style={{ width: '100%', flex: stats?.hasElevation ? 1.1 : 1, minHeight: 0 }}>
                <ResponsiveContainer>
                  <ComposedChart data={chartData} syncId={config.storageId} onMouseMove={onChartHover} onTouchMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <ChartZoomProbe />
                    <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                    {xAxis}
                    {speedAxis}
                    <Tooltip formatter={tooltipFormatter} labelFormatter={distanceLabel} contentStyle={chartTooltipStyle} />
                    <Line yAxisId="speed" type="monotone" name="Vitesse" dataKey="speed" stroke="#1e88e5" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ZoomableChart>
              {stats?.hasElevation && (
                <ZoomableChart zoom={zoom} showReset={false} style={{ width: '100%', flex: 1, minHeight: 0, marginTop: '6px' }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} syncId={config.storageId} onMouseMove={onChartHover} onTouchMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <ChartZoomProbe />
                      <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                      {xAxis}
                      {altitudeAxis('left')}
                      <Tooltip formatter={tooltipFormatter} labelFormatter={distanceLabel} contentStyle={chartTooltipStyle} />
                      {gradeGradientDefs(separateGradientId, gradeStops)}
                      <Area yAxisId="altitude" type="monotone" name="Altitude" dataKey="altitude" stroke={`url(#${separateGradientId})`} strokeWidth={2} fill={`url(#${separateGradientId})`} fillOpacity={0.35} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </ZoomableChart>
              )}
            </>
          )}
          {stats?.hasElevation && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', color: 'var(--muted)', fontSize: `${11 * scale}px`, marginTop: '6px', flexShrink: 0 }}>
              <span>Altitude colorée par la pente, montée ou descente :</span>
              {gradeRange.min > 0 && (
                <>
                  <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: SLOW_COLOR }} />
                  <span>sous {Math.round(gradeRange.min * 100)} %,</span>
                </>
              )}
              <span>{Math.round(gradeRange.min * 100)} %</span>
              <span style={{ display: 'inline-block', width: '90px', height: '10px', borderRadius: '2px', background: gradientCss() }} />
              <span>{Math.round(gradeRange.max * 100)} % et plus</span>
            </div>
          )}
          <div style={{ color: 'var(--muted)', fontSize: `${11 * scale}px`, marginTop: '6px', flexShrink: 0 }}>
            Vitesse lissée sur 10 s{inverse ? ', axe inversé : plus haut, plus vite' : ''}. Le survol d'un graphe déplace le repère sur l'autre graphe et sur la carte.
            {narrow ? ' Écartez deux doigts sur un graphe pour zoomer.' : ' Tirez une zone à la souris pour zoomer, double-clic pour tout revoir. Poignée en bas à droite pour redimensionner.'}
          </div>
        </ResizablePanel>
      )}


      {stats && open.reglages && (
        <ResizablePanel id={panelId('reglages')} style={{ ...cardStyle, marginBottom: '15px', fontSize: `${14 * scale}px` }}>
          <div style={{ marginBottom: '10px' }}>
            <PanelTitle label="Réglages de la session" open={open.reglages} onToggle={() => toggle('reglages')} />
          </div>
          <div style={{ display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap', fontSize: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong>Activité :</strong>
              <ActivitySelect
                activities={allActivities}
                value={activity.id}
                extra={activity}
                families={sessionFile ? undefined : [family]}
                onChange={(next) => changeSessionActivity(sessionFile, next)} />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong>Terrain :</strong>
              <select value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainType)} className="ui-field ui-field--s">
                {(Object.keys(ELEVATION_PRESETS) as TerrainType[]).map((t) => (
                  <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>
                ))}
              </select>
            </label>
          </div>
          {gpx.track.length > 0 && (
            <div style={{ marginTop: '12px', fontSize: '14px' }}>
              <SpeedRangeEditor
                unit={speedUnit}
                range={range}
                isOverridden={draft.edits.speedRange !== null}
                onChange={(next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); }} />
            </div>
          )}
          <div style={{ color: 'var(--muted)', fontSize: '0.85em', marginTop: '10px' }}>
            Vitesse : {gpx.hasDeviceSpeed
              ? `fournie par l'appareil${gpx.deviceSpeedUnit && gpx.deviceSpeedUnit !== 'ms' ? `, lue en ${SPEED_UNIT_LABEL[gpx.deviceSpeedUnit]} et convertie` : ''}`
              : 'dérivée des positions, filtrée'}
            {family === 'velo' && ` · Vélo : ${BIKE_TYPES[bikeType].label.toLowerCase()}, ${bikeWeightKg} kg (Réglages)`}
            {runner.weightKg !== null ? ` · Poids : ${runner.weightKg} kg` : ' · Poids non renseigné, voir Paramètres'}
          </div>
        </ResizablePanel>
      )}

      <div className="an-map-row" style={{ marginTop: '10px' }}>
        <AnalysisMap
          panelId={panelId('carte')}
          sessionKey={gpx.sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={580}
          legend={gpx.track.length > 0 ? {
            unit: speedUnit,
            range,
            slowLabel: config.slowLabel,
          } : null}
          style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export default LandModule;
