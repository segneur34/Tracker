import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import CardioLoadHelp from './CardioLoadHelp';
import ChartReadout, { type Readout } from './ChartReadout';
import HeartRateChart from './HeartRateChart';
import { inChartView } from './chartHover';
import { HelpText, HelpToggle } from './Help';
import { useHelp } from './helpContext';
import PanelTitle from './PanelTitle';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS, zoneLabel } from './heartRateColors';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import Button from './ui/Button';
import { niceTicks, sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS } from '../core/displayConfig';
import {
  edwardsLoad, efficiencyBlocks, heartRateDrift, timeInZones, type HeartRatePoint, type HeartRateZones,
} from '../core/heartRate';
import type { HeartRateProfile } from '../core/sportProfiles';
import { SPEED_UNIT_LABEL, formatClock, formatShortDuration, isInverseUnit, toDisplaySpeed, type SpeedUnit } from '../core/units';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { RunnerProfile } from '../hooks/useRunnerProfile';
import type { SessionHeartRate } from '../hooks/useSessionHeartRate';
import { zonesOriginText } from './heartRateOrigin';

/** Vitesse et activité de la trace, pour la dérive et le nuage FC / vitesse (course et vélo). */
export interface HeartRateEfficiency {
  speedsMs: readonly number[];
  active: readonly boolean[];
  speedUnit: SpeedUnit;
}

interface Props {
  track: readonly HeartRatePoint[];
  heart: SessionHeartRate;
  params: HeartRateProfile;
  /** Zones du pratiquant, `null` sans FC max ni âge. */
  zones: HeartRateZones | null;
  /** FC max saisie dans Pratiquant. */
  profileHrMax: number | null;
  /** Profil du pratiquant, pour dire d'où viennent les zones. */
  runner: RunnerProfile;
  /** « La retenir » : la FC max de la sortie devient celle du pratiquant. */
  onRetainHrMax: (bpm: number) => void;
  /** Zone montrée sur la carte (1 à 5, 0 sous Z1), ou `null`. */
  selectedZone: number | null;
  onSelectZone: (zone: number | null) => void;
  /** Point de trace survolé, d'un graphe ou d'un autre : la lecture de la courbe. */
  hoveredIndex: number | null;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
  /** Course et vélo seulement. */
  efficiency?: HeartRateEfficiency;
  /** Zoom de la courbe, tenu par le module (« Sur la carte », plein écran carte + graphes) ; « tout voir » à chaque session. */
  zoom: ChartZoom;
  /** « Sur la carte » de la courbe zoomée. */
  onShowOnMap?: () => void;
  open: boolean;
  onToggle: () => void;
}

const minutesLabel = (v: unknown) => formatClock(Number(v) * 60_000);
const cell = { padding: '0.4em 0.6em', textAlign: 'center' } as const;
const scatterTooltipStyle = { fontSize: 'var(--text-xs)' } as const;

/**
 * Courbe de FC de l'onglet « cardio », sur le temps écoulé, avec sa lecture
 * au-dessus : dans le panneau, et sous la carte en plein écran.
 */
export function CardioCurve({ track, smoothed, zoom, zones, hoveredIndex, onHoverIndex, onLeave, onShowOnMap, style }: {
  track: readonly HeartRatePoint[];
  smoothed: readonly (number | null)[];
  zoom: ChartZoom;
  /** Bornes basses des zones 1 à 5, ou `null` sans zones. */
  zones: readonly number[] | null;
  hoveredIndex: number | null;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
  onShowOnMap?: () => void;
  style?: CSSProperties;
}) {
  const t0 = track[0]?.timeMs ?? 0;
  const minutes = useMemo(() => track.map((p) => (p.timeMs - t0) / 60_000), [track, t0]);
  const rows = useMemo(() => {
    if (minutes.length < 2) return [];
    const [first, last] = visibleIndexRange(minutes, zoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS).map((i) => ({
      index: i,
      minutes: parseFloat(minutes[i].toFixed(3)),
      hr: smoothed[i] === null ? null : Math.round(smoothed[i]!),
    }));
  }, [minutes, zoom.view, smoothed]);
  if (rows.length < 2) return null;
  const bpm = hoveredIndex !== null ? smoothed[hoveredIndex] : null;
  const readout: Readout | null = hoveredIndex !== null && minutes[hoveredIndex] !== undefined && inChartView(zoom.view, minutes[hoveredIndex])
    ? { values: [{ text: bpm === null || bpm === undefined ? '—' : `${Math.round(bpm)} bpm`, color: HEART_RATE_COLOR }], at: minutesLabel(minutes[hoveredIndex]) }
    : null;
  return (
    <>
      <ChartReadout readout={readout} label="FC" color={HEART_RATE_COLOR} line />
      <HeartRateChart data={rows} zoom={zoom} zones={zones} onHoverIndex={onHoverIndex} onLeave={onLeave} onShowOnMap={onShowOnMap}
        style={style}
        xAxis={(
          <XAxis dataKey="minutes" type="number" allowDataOverflow
            domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
            ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
            tickFormatter={(v: number) => formatClock(v * 60_000).replace(/:00$/, '')} tick={{ fill: '#555', fontSize: 11 }} />
        )} />
    </>
  );
}

/**
 * Onglet « cardio » des trois modules : FC moyenne, max et charge, courbe
 * reliée à la carte, temps par zone avec ses passages sur la carte, FC max
 * observée à retenir ; en course et à vélo, dérive et nuage FC / vitesse.
 * Posé dans le `ResizablePanel` du module.
 */
export default function HeartRatePanel({
  track, heart, params, zones, profileHrMax, runner, onRetainHrMax, selectedZone, onSelectZone, hoveredIndex, onHoverIndex, onLeave, efficiency,
  zoom, onShowOnMap, open, onToggle,
}: Props) {
  const { smoothed, stats } = heart;

  const zoneTimes = useMemo(() => (zones ? timeInZones(track, smoothed, zones.bounds, params.gapS) : null), [zones, track, smoothed, params.gapS]);
  const countedS = zoneTimes?.reduce((a, b) => a + b, 0) ?? 0;
  const loadHelp = useHelp('analyse:charge');
  const drift = useMemo(
    () => (efficiency ? heartRateDrift(track, smoothed, efficiency.speedsMs, efficiency.active, params.gapS, params.driftMinS) : null),
    [efficiency, track, smoothed, params.gapS, params.driftMinS]
  );
  /** Vitesse du nuage : km/h quand l'unité est une allure, qui ferait un axe inversé. */
  const scatterUnit: SpeedUnit | null = efficiency ? (isInverseUnit(efficiency.speedUnit) ? 'kmh' : efficiency.speedUnit) : null;
  const blocks = useMemo(() => {
    if (!efficiency || scatterUnit === null) return null;
    const all = efficiencyBlocks(track, smoothed, efficiency.speedsMs, efficiency.active, params.gapS, params.scatterBlockS)
      .map((b) => ({ speed: parseFloat(toDisplaySpeed(b.speedMs, scatterUnit).toFixed(1)), bpm: Math.round(b.bpm), half: b.half }));
    return [all.filter((b) => b.half === 0), all.filter((b) => b.half === 1)];
  }, [efficiency, scatterUnit, track, smoothed, params.gapS, params.scatterBlockS]);

  if (!stats) return null;
  const aboveProfile = profileHrMax === null || stats.maxBpm > profileHrMax;

  return (
    <>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label="Cardio" open={open} onToggle={onToggle} helpKey="analyse:cardio" />
      </div>
      <HelpText helpKey="analyse:cardio" note>
        FC lissée sur {params.smoothS} s ; un trou de plus de {params.gapS} s (ceinture retirée, pause) n'est pas compté. Le survol de la courbe déplace le repère sur la carte.
        {zones && " « Voir » montre les passages d'une zone sur la carte, en violet."}
        {efficiency && scatterUnit !== null && " D'une sortie à l'autre, le nuage qui glisse vers la droite à FC égale dit le progrès."}
      </HelpText>
      <div className="an-sheet__stats an-sheet__stats--always">
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">FC moyenne</span><strong className="an-sheet__stat-value">{Math.round(stats.avgBpm)} bpm</strong></div>
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">FC max</span><strong className="an-sheet__stat-value">{stats.maxBpm} bpm</strong></div>
        {zoneTimes && (
          <div className="an-sheet__stat">
            <span className="an-sheet__stat-label">Charge <HelpToggle helpKey="analyse:charge" label="Qu'est-ce que la charge ?" /></span>
            <strong className="an-sheet__stat-value">{Math.round(edwardsLoad(zoneTimes, params.loadWeights))}</strong>
          </div>
        )}
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps mesuré</span><strong className="an-sheet__stat-value">{formatShortDuration(stats.coveredS)}</strong></div>
      </div>
      {loadHelp?.open && zones && <CardioLoadHelp bounds={zones.bounds} weights={params.loadWeights} />}

      {aboveProfile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0', fontSize: 'var(--text-s)' }}>
          <span>
            {profileHrMax === null
              ? `Aucune FC max dans Réglages › Pratiquant : celle de cette sortie est de ${stats.maxBpm} bpm.`
              : `FC max de la sortie : ${stats.maxBpm} bpm, au-dessus de celle de Pratiquant (${profileHrMax}).`}
          </span>
          <Button size="s" onClick={() => onRetainHrMax(stats.maxBpm)}>La retenir</Button>
        </div>
      )}

      <div style={{ marginTop: '6px' }}>
        <CardioCurve track={track} smoothed={smoothed} zoom={zoom} zones={zones?.bounds ?? null} hoveredIndex={hoveredIndex}
          onHoverIndex={onHoverIndex} onLeave={onLeave} onShowOnMap={onShowOnMap} style={{ width: '100%', height: '200px' }} />
      </div>

      {zones && zoneTimes ? (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginTop: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Zone</th>
                <th style={{ ...cell, fontWeight: 'normal', color: 'var(--muted)' }}>FC</th>
                <th style={cell}>Temps</th>
                <th style={{ ...cell, width: '30%' }}>Part</th>
                <th style={cell}>Carte</th>
              </tr>
            </thead>
            <tbody>
              {zoneTimes.map((s, zone) => {
                const share = countedS > 0 ? s / countedS : 0;
                const shown = selectedZone === zone;
                const range = zone === 0 ? `< ${zones.bounds[0]}` : zone === zones.bounds.length ? `≥ ${zones.bounds[zone - 1]}` : `${zones.bounds[zone - 1]}-${zones.bounds[zone] - 1}`;
                return (
                  <tr key={zone} style={{ borderTop: '1px solid var(--line-soft)', opacity: s > 0 ? 1 : 0.45 }}>
                    <td style={{ padding: '0.4em 0.6em', fontWeight: 700 }}>
                      <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: HEART_ZONE_COLORS[zone], marginRight: '6px' }} />
                      {zoneLabel(zone)}
                    </td>
                    <td style={{ ...cell, color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{range}</td>
                    <td style={cell}>{formatShortDuration(s)}</td>
                    <td style={cell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--surface-sunken)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${share * 100}%`, height: '100%', backgroundColor: HEART_ZONE_COLORS[zone] }} />
                        </div>
                        <span style={{ minWidth: '3em', textAlign: 'right', fontSize: 'var(--text-xs)' }}>{Math.round(share * 100)} %</span>
                      </div>
                    </td>
                    <td style={cell}>
                      <button type="button" disabled={s <= 0} onClick={() => onSelectZone(shown ? null : zone)}
                        style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: s > 0 ? 'pointer' : 'default', backgroundColor: shown ? HIGHLIGHT_SHOWN_COLOR : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
                        {shown ? 'Masquer' : 'Voir'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px' }}>
            Zones calées sur {zonesOriginText(zones, runner)}
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 'var(--text-s)', marginTop: '10px' }}>
          Pour les zones d'effort, saisir la FC max ou l'année de naissance dans <Link to="/parametres">Réglages</Link>, bloc « Pratiquant ».
        </p>
      )}

      {efficiency && scatterUnit !== null && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>Dérive et efficacité</div>
          <div style={{ fontSize: 'var(--text-s)', marginBottom: '6px' }}>
            {drift === null
              ? `Dérive cardiaque : il faut au moins ${Math.round(params.driftMinS / 60)} min en mouvement avec la FC.`
              : Math.abs(drift.driftPct) < params.driftStablePct
                ? `Dérive cardiaque de ${drift.driftPct.toFixed(1)} % : FC stable à vitesse égale d'une moitié à l'autre.`
                : drift.driftPct > 0
                  ? `Dérive cardiaque de ${drift.driftPct.toFixed(1)} % : à vitesse égale, le cœur bat plus vite en seconde moitié (fatigue, chaleur, déshydratation).`
                  : `Dérive cardiaque de ${drift.driftPct.toFixed(1)} % : la seconde moitié est plus efficace que la première (échauffement, descente).`}
          </div>
          {blocks && blocks[0].length + blocks[1].length > 1 && (
            <div style={{ width: '100%', height: '200px' }}>
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                  <XAxis dataKey="speed" type="number" name="Vitesse" domain={['auto', 'auto']} tick={{ fill: '#555', fontSize: 11 }}
                    label={{ value: SPEED_UNIT_LABEL[scatterUnit], position: 'insideBottomRight', offset: -2, fill: '#555', fontSize: 11 }} />
                  <YAxis dataKey="bpm" type="number" name="FC" domain={['auto', 'auto']} width={46} tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
                    label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
                  <Tooltip contentStyle={scatterTooltipStyle} formatter={(value, name) => [name === 'FC' ? `${value} bpm` : `${value} ${SPEED_UNIT_LABEL[scatterUnit]}`, name]} />
                  <Scatter name="Première moitié" data={blocks[0]} fill="#1e88e5" isAnimationActive={false} />
                  <Scatter name="Seconde moitié" data={blocks[1]} fill="#fb8c00" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
          <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '4px' }}>
            Un point par bloc de {params.scatterBlockS} s en mouvement : <span style={{ color: '#1e88e5' }}>première moitié</span>, <span style={{ color: '#fb8c00' }}>seconde moitié</span>.
          </div>
        </div>
      )}
    </>
  );
}
