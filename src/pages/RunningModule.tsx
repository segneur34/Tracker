import { useCallback, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { CircleMarker, Polyline, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './analysisMobile.css';
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipPayloadEntry, type TooltipValueType,
} from 'recharts';
import AnalysisMap from '../components/AnalysisMap';
import PanelTitle from '../components/PanelTitle';
import ResizablePanel from '../components/ResizablePanel';
import SectionTabs, { type SectionDefinition } from '../components/SectionTabs';
import SessionNameEditor from '../components/SessionNameEditor';
import SessionSaveBar from '../components/SessionSaveBar';
import { hoveredTrackIndex, type ChartHoverEvent } from '../components/chartHover';
import { CARD_STYLE } from '../components/styles';
import { IconFile } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { CHART_MAX_POINTS, trackBounds } from '../core/displayConfig';
import { computeElevationStats } from '../core/elevation';
import {
  buildCumulativeTrack, buildBaseSessionStats, computeActiveDistanceM, computeActiveTimeMs,
  computeActivityMask, computeTotalTimeMs,
} from '../core/sessionStats';
import { sessionActivity } from '../core/activities';
import { ELEVATION_PRESETS, getActiveThresholds } from '../core/sportProfiles';
import { meanFilterByTime } from '../core/speedFilter';
import { isValidSpeedRange, speedGradientColor } from '../core/speedGradient';
import {
  DISTANCE_UNIT_SYMBOL, SPEED_UNIT_LABEL, formatDistance, formatSpeed, formatSpeedValue, fromDisplaySpeed, isInverseUnit,
  toDisplayDistance, toDisplaySpeed,
} from '../core/units';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { useGpxSession } from '../hooks/useGpxSession';
import { useSessionDraft } from '../hooks/useSessionDraft';
import { updateSessionRecord, useSessionName } from '../hooks/useSessionLibrary';
import { libraryPath, useImportAndOpen, useSessionFromUrl } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import {
  TERRAIN_LABEL, TEXT_SCALE_FACTOR, readStoredActivities, useSportSettings, type TerrainType,
} from '../hooks/useSportSettings';
import { DEFAULT_SPEED_RANGE_MS, averagePace, computeGrades, computeZoneStats } from '../running/runningAnalytics';
import type { RunningSessionStats } from '../running/types';
import type { LibrarySession } from '../library/record';
import { readPickedFile } from '../platform/files';

/** Lissage supplémentaire de la vitesse pour le graphe, en secondes. */
const CHART_SPEED_SMOOTHING_S = 10;
/** Lissage de la vitesse pour la couleur de la trace, en secondes. */
const MAP_SPEED_SMOOTHING_S = 15;

/**
 * Sections du module. Pour en ajouter une : une entrée ici, une valeur par
 * défaut dans `RUNNING_SECTION_DEFAULTS`, et un bloc `{open.maCle && (...)}`
 * dans le rendu. La carte n'en fait pas partie : comme en voile, elle
 * s'affiche en permanence, jamais derrière un onglet qu'on pourrait fermer
 * et oublier rouvert.
 */
type RunningSection = 'synthese' | 'zones' | 'graphiques';

const RUNNING_SECTIONS: SectionDefinition<RunningSection>[] = [
  { key: 'synthese', label: 'synthèse' },
  { key: 'zones', label: 'zones de pente' },
  { key: 'graphiques', label: 'graphiques' },
];

const RUNNING_SECTION_DEFAULTS: Record<RunningSection, boolean> = {
  synthese: true,
  zones: true,
  graphiques: true,
};

type ChartMode = 'separate' | 'overlay';

/** Une ligne des graphes : `index` renvoie au point de trace d'origine. */
interface ChartRow {
  index: number;
  /** Distance parcourue, dans l'unité de l'activité. */
  dist: number;
  speed: number | null;
  speedMs: number;
  altitude: number | null;
}

const cardStyle = CARD_STYLE;
const chartTooltipStyle = { fontSize: '12px' } as const;

/**
 * Module course à pied : trace colorée par la vitesse, graphes de vitesse et
 * d'altitude séparés ou superposés, allures par zone de pente.
 */
function RunningModule() {
  const {
    activity, activityOptions, setActivity,
    profile, activeThreshold, terrain, setTerrain, elevationProfile,
    speedUnit, distanceUnit, textScale,
    speedRange,
  } = useSportSettings('course');
  const { profile: runner } = useRunnerProfile();
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
  const { file: sessionFile, error: sessionError } = useSessionFromUrl(receiveSession);
  const sessionName = useSessionName(gpx.fileName);
  // Brouillon de la session de la mémoire affichée (couleurs de la trace), écrit
  // dans sa fiche par « Enregistrer la session ». Aucun pour un GPX lu hors de la mémoire.
  const draft = useSessionDraft(sessionFile !== null && gpx.fileName === sessionFile ? sessionFile : null);

  /** Changer d'activité l'écrit aussi dans la fiche de la session (comme en voile). */
  const changeActivity = (id: string) => {
    const next = activityOptions.find((a) => a.id === id);
    if (!next) return;
    setActivity(next.id);
    const listed = readStoredActivities().some((a) => a.id === next.id);
    if (sessionFile) updateSessionRecord(sessionFile, { sport: next.base, activityId: listed ? next.id : null });
  };

  // Un GPX ouvert ici entre d'abord dans la mémoire ; faute de mémoire, il est lu directement.
  const importAndOpen = useImportAndOpen('course');
  const openFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!(await importAndOpen(file))) loadGpxContent(await readPickedFile(file), file.name);
  };

  const { open, toggle } = useOpenSections<RunningSection>('running', RUNNING_SECTION_DEFAULTS);
  const [chartMode, setChartMode] = useState<ChartMode>('separate');
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

  /** Bornes du dégradé de couleur, en m/s : celles de la session, sinon de Réglages, sinon le défaut. */
  const range = draft.edits.speedRange ?? speedRange ?? DEFAULT_SPEED_RANGE_MS;

  /** Séries des graphes : distance dans l'unité choisie, vitesse dans l'unité choisie, altitude lissée. */
  const chartData = useMemo(() => {
    if (gpx.track.length === 0) return [];
    const displaySpeed = meanFilterByTime(
      gpx.track.map((p) => p.smoothedSpeedMs),
      gpx.track.map((p) => p.timeMs),
      CHART_SPEED_SMOOTHING_S
    );
    const step = Math.max(1, Math.ceil(gpx.track.length / CHART_MAX_POINTS));
    const data: ChartRow[] = [];
    for (let i = 0; i < gpx.track.length; i += step) {
      const altitude = elevation.smoothed[i];
      const ms = displaySpeed[i];
      // En min/km, l'arrêt tend vers l'infini : on laisse un trou plutôt qu'une valeur absurde.
      const speed = inverse && ms < 0.3 ? null : parseFloat(toDisplaySpeed(ms, speedUnit).toFixed(2));
      data.push({
        index: i,
        dist: parseFloat(toDisplayDistance(cumulative.cumDist[i], distanceUnit).toFixed(2)),
        speed,
        speedMs: ms,
        altitude: stats?.hasElevation && isFinite(altitude) ? Math.round(altitude) : null,
      });
    }
    return data;
  }, [gpx.track, elevation, cumulative, stats, speedUnit, distanceUnit, inverse]);

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

  const tooltipFormatter = (
    value: TooltipValueType | undefined,
    name: string | number | undefined,
    item: TooltipPayloadEntry
  ): [ReactNode, string | number | undefined] => {
    // Recharts ne type pas la ligne de données derrière l'entrée : on la relit sous la forme de `chartData`.
    const row: ChartRow | undefined = item.payload;
    if (name === 'Vitesse' && row) return [formatSpeed(row.speedMs, speedUnit), name];
    if (name === 'Altitude') return [`${value} m`, name];
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
  const xAxis = <XAxis dataKey="dist" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(v) => `${v} ${distanceSymbol}`} tick={{ fill: '#555', fontSize: 11 }} />;

  /** Couches de la carte, partagées par la carte compacte et sa vue agrandie (tap, écran étroit). */
  const mapLayers = (
    <>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {mapSegments.map((segment) => (
        <Polyline key={`track-${segment.id}`} positions={segment.positions} pathOptions={{ color: segment.color, weight: 5 }} />
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
        <div style={{ marginBottom: '15px' }}>
          <PageHeader title="Analyse course à pied" subtitle={gpx.fileName ? <SessionNameEditor file={gpx.fileName} /> : undefined} back={{ to: libraryPath('course'), label: 'Sessions course' }} />
          {sessionError && <div className="ui-alert ui-alert--warning" style={{ marginTop: '10px' }}>{sessionError}</div>}
        </div>

        {stats && averages && (
          <div className="an-sheet__stats">
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Distance</span><strong className="an-sheet__stat-value">{formatDistance(stats.distanceM, distanceUnit)}</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps de parcours</span><strong className="an-sheet__stat-value">{stats.totalTime}</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Moyenne en mouvement</span><strong className="an-sheet__stat-value">{formatSpeed(averages.moving.speedMs, speedUnit)}</strong></div>
            <div className="an-sheet__stat"><span className="an-sheet__stat-label">Dénivelé positif</span><strong className="an-sheet__stat-value">{stats.hasElevation ? `${stats.elevationGain} m` : '—'}</strong></div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '18px', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', fontSize: '14px' }}>
          <label className="ui-btn ui-btn--secondary">
            <IconFile size={18} />
            Ouvrir un fichier GPX
            <input type="file" accept=".gpx" onChange={openFile} hidden />
          </label>

          {activityOptions.length > 1 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <strong>Activité :</strong>
              <select value={activity.id} onChange={(e) => changeActivity(e.target.value)} className="ui-field ui-field--s">
                {activityOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <strong>Terrain :</strong>
            <select value={terrain} onChange={(e) => setTerrain(e.target.value as TerrainType)} className="ui-field ui-field--s">
              {(Object.keys(ELEVATION_PRESETS) as TerrainType[]).map((t) => (
                <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <SessionSaveBar draft={draft} />

      {gpx.error && (
        <div className="ui-alert ui-alert--danger" style={{ marginBottom: '10px', maxWidth: '520px' }}>
          {gpx.error}
        </div>
      )}

      {!stats && !gpx.error && (
        <p style={{ color: 'var(--muted)' }}>Chargez une trace GPX pour lancer l'analyse.</p>
      )}

      {stats && averages && (
        <SectionTabs sections={RUNNING_SECTIONS} open={open} onToggle={toggle} accent="var(--course)" />
      )}

      {stats && averages && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'stretch', marginBottom: '15px', fontSize: `${14 * scale}px` }}>
          {open.synthese && (
          <ResizablePanel id="running.synthese" style={{ ...cardStyle, flex: '1 1 300px' }}>
            <div style={{ marginBottom: '10px' }}>
              <PanelTitle label={sessionName ?? gpx.trackName ?? gpx.fileName ?? 'Session'} open={open.synthese} onToggle={() => toggle('synthese')} />
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.7' }}>
              <li><strong>Distance :</strong> {formatDistance(stats.distanceM, distanceUnit)} <span style={{ color: 'var(--muted)' }}>(en mouvement {formatDistance(stats.activeDistanceM, distanceUnit)})</span></li>
              <li><strong>Temps de parcours :</strong> {stats.totalTime} <span style={{ color: 'var(--muted)' }}>(en mouvement {stats.activeTime}, {stats.activeRatio} %)</span></li>
              <li><strong>Vitesse moyenne :</strong> {formatSpeed(averages.moving.speedMs, speedUnit)} <span style={{ color: 'var(--muted)' }}>(en mouvement)</span></li>
              <li><strong>Sur le temps total :</strong> {formatSpeed(averages.overall.speedMs, speedUnit)}</li>
              <li style={{ marginTop: '6px' }}><strong>Dénivelé :</strong> +{stats.elevationGain} m / -{stats.elevationLoss} m</li>
              <li><strong>Altitude :</strong> {stats.elevationMin} m à {stats.elevationMax} m</li>
              {!stats.hasElevation && (
                <li style={{ color: '#b71c1c', fontSize: '0.85em' }}>Le fichier ne porte pas d'altitude sur assez de points : pas de dénivelé ni de zones de pente.</li>
              )}
              <li style={{ color: 'var(--muted)', fontSize: '0.85em', marginTop: '6px' }}>
                Vitesse : {gpx.hasDeviceSpeed
                  ? `fournie par l'appareil${gpx.deviceSpeedUnit && gpx.deviceSpeedUnit !== 'ms' ? `, lue en ${SPEED_UNIT_LABEL[gpx.deviceSpeedUnit]} et convertie` : ''}`
                  : 'dérivée des positions, filtrée'}
                {runner.weightKg !== null ? ` · Poids : ${runner.weightKg} kg` : ' · Poids non renseigné, voir Paramètres'}
              </li>
            </ul>
          </ResizablePanel>
          )}

          {open.zones && zoneStats.length > 0 && (
            <ResizablePanel id="running.zones" style={{ ...cardStyle, flex: '1 1 420px' }}>
              <div style={{ marginBottom: '10px' }}>
                <PanelTitle
                  label="Allure par zone de pente"
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

      {open.graphiques && chartData.length > 1 && (
        <ResizablePanel id="running.graphiques" defaultHeight={460} minHeight={220} direction="vertical"
          style={{ ...cardStyle, marginBottom: '15px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px', paddingRight: '28px' }}>
            <PanelTitle label="Vitesse et altitude" open={open.graphiques} onToggle={() => toggle('graphiques')} />
            <span style={{ flex: 1 }} />
            {(['separate', 'overlay'] as ChartMode[]).map((mode) => (
              <button key={mode} onClick={() => setChartMode(mode)}
                style={{ padding: '4px 12px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: `${12 * scale}px`, backgroundColor: chartMode === mode ? 'var(--course)' : 'var(--surface-sunken)', color: chartMode === mode ? '#fff' : 'var(--ink)' }}>
                {mode === 'separate' ? 'Séparés' : 'Superposés'}
              </button>
            ))}
          </div>

          {chartMode === 'overlay' ? (
            <div style={{ width: '100%', flex: 1, minHeight: 0 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} syncId="running" onMouseMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                  {xAxis}
                  {speedAxis}
                  {stats?.hasElevation && altitudeAxis('right')}
                  <Tooltip formatter={tooltipFormatter} labelFormatter={(l) => `${l} ${distanceSymbol}`} contentStyle={chartTooltipStyle} />
                  {stats?.hasElevation && (
                    <Area yAxisId="altitude" type="monotone" name="Altitude" dataKey="altitude" stroke="#e64a19" strokeWidth={1.5} fill="#e64a19" fillOpacity={0.12} dot={false} activeDot={{ r: 4 }} connectNulls={false} />
                  )}
                  <Line yAxisId="speed" type="monotone" name="Vitesse" dataKey="speed" stroke="#1e88e5" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <>
              <div style={{ width: '100%', flex: stats?.hasElevation ? 1.1 : 1, minHeight: 0 }}>
                <ResponsiveContainer>
                  <ComposedChart data={chartData} syncId="running" onMouseMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                    {xAxis}
                    {speedAxis}
                    <Tooltip formatter={tooltipFormatter} labelFormatter={(l) => `${l} ${distanceSymbol}`} contentStyle={chartTooltipStyle} />
                    <Line yAxisId="speed" type="monotone" name="Vitesse" dataKey="speed" stroke="#1e88e5" strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {stats?.hasElevation && (
                <div style={{ width: '100%', flex: 1, minHeight: 0, marginTop: '6px' }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} syncId="running" onMouseMove={onChartHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                      {xAxis}
                      {altitudeAxis('left')}
                      <Tooltip formatter={tooltipFormatter} labelFormatter={(l) => `${l} ${distanceSymbol}`} contentStyle={chartTooltipStyle} />
                      <Area yAxisId="altitude" type="monotone" name="Altitude" dataKey="altitude" stroke="#e64a19" strokeWidth={2} fill="#e64a19" fillOpacity={0.15} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
          <div style={{ color: 'var(--muted)', fontSize: `${11 * scale}px`, marginTop: '6px', flexShrink: 0 }}>
            Vitesse lissée sur 10 s{inverse ? ', axe inversé : plus haut, plus vite' : ''}. Le survol d'un graphe déplace le repère sur l'autre graphe et sur la carte.{narrow ? '' : ' Poignée en bas à droite pour redimensionner.'}
          </div>
        </ResizablePanel>
      )}

      <div className="an-map-row" style={{ marginTop: '10px' }}>
        <AnalysisMap
          panelId="running.carte"
          sessionKey={gpx.sessionKey}
          bounds={mapBounds}
          layers={mapLayers}
          defaultHeight={580}
          legend={gpx.track.length > 0 ? {
            unit: speedUnit,
            range,
            isOverridden: draft.edits.speedRange !== null,
            onChange: (next) => { if (next === null || isValidSpeedRange(next)) draft.update({ speedRange: next }); },
            slowLabel: 'marche',
          } : null}
          style={{ width: '60%' }} />
      </div>
    </div>
  );
}

export default RunningModule;
