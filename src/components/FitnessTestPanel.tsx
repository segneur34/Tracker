import { toFixedNumber } from '../core/basics';
import { useMemo, type ReactElement } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HoverReadout, type Readout } from './ChartReadout';
import { NO_TOOLTIP_CONTENT, hoveredTrackIndex, inChartView, type ChartHoverEvent } from './chartHover';
import { HEART_RATE_COLOR } from './heartRateColors';
import { HelpText } from './Help';
import PanelTitle from './PanelTitle';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import Button from './ui/Button';
import { niceTicks, sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS } from '../core/displayConfig';
import type { TrackPoint } from '../core/types';
import {
  editSpeedUnit,
  SPEED_UNIT_LABEL, formatClockMinutes, formatShortDuration, formatSpeed, toDisplaySpeed, type SpeedUnit,
} from '../core/units';
import type { ChartZoom } from '../hooks/useChartZoom';
import { FITNESS_TESTS, TEST_SIGNAL_LABEL, type SessionTest, type TestEndReason, type TestSignal } from '../recording/fitnessTest';
import { fitnessTestResults } from '../running/fitnessTestResults';
import StatTile from './ui/StatTile';

/** Bleu des courbes de vitesse des analyses à pied. */
const SPEED_COLOR = '#1e88e5';
const TARGET_COLOR = '#0d47a1';
const PHASE_FILL = '#90a4ae';
const MARK_COLOR = 'var(--chart-mark)';
const CURVE_HEIGHT_PX = 150;

/** Signaux tracés sur la courbe : ceux des phases ; les corrections, trop nombreuses, restent dans le direct. */
const DRAWN_SIGNALS: readonly TestSignal[] = ['debut', 'palier', 'finRampe', 'finTest'];

const END_REASON_LABEL: Record<TestEndReason, string> = {
  auto: 'vitesse tenue sous la cible',
  manuel: '« Finir la rampe »',
  arret: "enregistrement arrêté avant la fin",
};


interface Row {
  index: number;
  minutes: number;
  speed: number | null;
  target: number | null;
  hr: number | null;
}

/** Vitesse cible à l'instant `t` : celle du dernier palier commencé, pendant la rampe ; `null` ailleurs. */
const targetAt = (test: SessionTest, t: number, rampEndMs: number): number | null => {
  if (test.rampStartMs === null || t < test.rampStartMs || t > rampEndMs) return null;
  let target: number | null = null;
  for (const step of test.steps) {
    if (step.startMs > t) break;
    target = step.targetMs;
  }
  return target;
};

/**
 * Courbes d'un test guidé, sur le temps de la session : vitesse lissée et
 * vitesse cible en marches en haut, FC en bas avec la bande de
 * l'échauffement ; phases en fond, signaux des phases en traits fins. Deux
 * graphes du même temps plutôt qu'un graphe à deux échelles, comme la page
 * du protocole ; zoom commun, survol relié à la carte (`hoveredTrackIndex`).
 * Partagées par l'onglet « test » et la carte en plein écran.
 */
export function FitnessTestCurves({ track, test, minutes, speedsMs, hrSmoothed, speedUnit, zoom, onHoverIndex, onLeave, onShowOnMap }: {
  track: readonly TrackPoint[];
  test: SessionTest;
  /** Minutes de chaque point depuis le début de la trace : l'axe et son zoom. */
  minutes: readonly number[];
  /** Vitesse des graphes, lissée. */
  speedsMs: readonly number[];
  hrSmoothed: readonly (number | null)[];
  speedUnit: SpeedUnit;
  zoom: ChartZoom;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
  onShowOnMap?: () => void;
}) {
  // Une allure ferait un axe inversé : km/h, comme le nuage FC / vitesse.
  const unit: SpeedUnit = editSpeedUnit(speedUnit);
  const t0 = track[0]?.timeMs ?? 0;
  const lastMs = track[track.length - 1]?.timeMs ?? t0;
  const rampEndMs = test.rampEndMs ?? lastMs;
  const toMin = (ms: number) => (ms - t0) / 60_000;

  const rows = useMemo((): Row[] => {
    if (minutes.length < 2) return [];
    const [first, last] = visibleIndexRange(minutes, zoom.view);
    const display = (ms: number) => toFixedNumber(toDisplaySpeed(ms, unit), 1);
    return sampledIndices(first, last, CHART_MAX_POINTS, speedsMs).map((i) => {
      const target = targetAt(test, track[i].timeMs, rampEndMs);
      return {
        index: i,
        minutes: toFixedNumber(minutes[i], 3),
        speed: display(speedsMs[i]),
        target: target === null ? null : display(target),
        hr: hrSmoothed[i] === null ? null : Math.round(hrSmoothed[i]!),
      };
    });
  }, [minutes, zoom.view, speedsMs, hrSmoothed, unit, test, track, rampEndMs]);
  if (rows.length < 2) return null;

  const phases = [
    { key: 'echauffement', label: 'Échauffement', from: test.startMs, to: test.rampStartMs ?? test.endMs ?? lastMs },
    ...(test.rampStartMs !== null ? [{ key: 'rampe', label: 'Rampe', from: test.rampStartMs, to: rampEndMs }] : []),
    ...(test.rampEndMs !== null ? [{ key: 'recuperation', label: 'Récup.', from: test.rampEndMs, to: test.endMs ?? lastMs }] : []),
  ];
  const signals = test.signals.filter((s) => DRAWN_SIGNALS.includes(s.s));
  // Des listes d'éléments, pas des composants : Recharts ne voit pas un ReferenceArea rangé dans un composant à lui.
  const phaseAreas = (labelled: boolean) => phases.map((p, i) => (
    <ReferenceArea key={p.key} x1={toMin(p.from)} x2={toMin(p.to)} fill={PHASE_FILL} fillOpacity={i % 2 === 0 ? 0.12 : 0.04} ifOverflow="hidden"
      label={labelled ? { value: p.label, position: 'insideTop', fill: 'var(--chart-axis)', fontSize: 11 } : undefined} />
  ));
  const signalLines = signals.map((s) => (
    <ReferenceLine key={`${s.s}-${s.t}`} x={toMin(s.t)} stroke={MARK_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" ifOverflow="hidden" />
  ));
  const xAxis = (hide: boolean): ReactElement => (
    <XAxis dataKey="minutes" type="number" allowDataOverflow hide={hide}
      domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
      ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
      tickFormatter={formatClockMinutes} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
  );
  const onHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, rows);
    if (index !== null) onHoverIndex(index);
  };

  /** Lecture au point survolé (`HoverReadout`), s'il est dans la plage zoomée. */
  const read = (hovered: number): Readout | null => (minutes[hovered] === undefined || !inChartView(zoom.view, minutes[hovered]) ? null : {
    values: [
      { text: formatSpeed(speedsMs[hovered], unit), color: SPEED_COLOR },
      ...(() => {
        const target = targetAt(test, track[hovered].timeMs, rampEndMs);
        return target === null ? [] : [{ text: `cible ${formatSpeed(target, unit)}`, color: TARGET_COLOR }];
      })(),
      { text: hrSmoothed[hovered] === null ? '—' : `${Math.round(hrSmoothed[hovered]!)} bpm`, color: HEART_RATE_COLOR },
    ],
    at: formatClockMinutes(minutes[hovered]),
  });

  return (
    <>
      <HoverReadout read={read} label="Test" line />
      <ZoomableChart zoom={zoom} onLeave={onLeave} onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${CURVE_HEIGHT_PX}px` }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} syncId="test" onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 18, right: 10, left: 0, bottom: 0 }}>
            <ChartZoomProbe />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            {phaseAreas(true)}
            {xAxis(true)}
            <YAxis domain={['dataMin - 1', 'dataMax + 1']} allowDecimals={false} width={46} tick={{ fill: SPEED_COLOR, fontSize: 11 }}
              label={{ value: SPEED_UNIT_LABEL[unit], angle: -90, position: 'insideLeft', fill: SPEED_COLOR, fontSize: 11 }} />
            {signalLines}
            <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
            <Line type="monotone" dataKey="speed" stroke={SPEED_COLOR} strokeWidth={1.5} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="target" stroke={TARGET_COLOR} strokeWidth={2} dot={false} activeDot={false} connectNulls={false}
              isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ZoomableChart>
      <ZoomableChart zoom={zoom} onLeave={onLeave} showReset={false} style={{ width: '100%', height: `${CURVE_HEIGHT_PX}px` }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} syncId="test" onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
            <ChartZoomProbe />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            {phaseAreas(false)}
            {xAxis(false)}
            <YAxis domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={46} tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
              label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
            <ReferenceArea x1={toMin(test.startMs)} x2={toMin(test.rampStartMs ?? test.endMs ?? lastMs)} y1={test.settings.lowBpm} y2={test.settings.highBpm}
              fill={HEART_RATE_COLOR} fillOpacity={0.15} stroke="none" ifOverflow="hidden" />
            {signalLines}
            <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
            <Line type="monotone" dataKey="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls={false}
              isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </ZoomableChart>
    </>
  );
}

/**
 * Onglet « test » de l'analyse d'une session de test guidé (Entraînement ›
 * Tests) : les résultats tirés de la trace et du test de la fiche
 * (`fitnessTestResults`), « Retenir cette FC max » vers Pratiquant, et les
 * courbes annotées. Posé dans le `ResizablePanel` du module.
 */
export default function FitnessTestPanel({
  track, test, minutes, speedsMs, hrSmoothed, speedUnit, profileHrMax, onRetainHrMax, zoom, onHoverIndex, onLeave, onShowOnMap,
  open, onToggle,
}: {
  track: TrackPoint[];
  test: SessionTest;
  minutes: readonly number[];
  speedsMs: readonly number[];
  hrSmoothed: readonly (number | null)[];
  speedUnit: SpeedUnit;
  /** FC max saisie dans Pratiquant. */
  profileHrMax: number | null;
  onRetainHrMax: (bpm: number) => void;
  zoom: ChartZoom;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
  onShowOnMap?: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const protocol = FITNESS_TESTS[test.protocol];
  const results = useMemo(() => fitnessTestResults(track, test, protocol), [track, test, protocol]);
  const speed = (ms: number | null) => (ms === null ? '—' : formatSpeed(ms, editSpeedUnit(speedUnit)));
  const bpm = (v: number | null) => (v === null ? '—' : `${v} bpm`);
  const { lowBpm, highBpm } = test.settings;
  const stat = (label: string, value: string) => <StatTile label={label} value={value} />;
  const recoveryMin = protocol.recoveryReadS / 60;

  return (
    <>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label={`Test ${protocol.label}`} open={open} onToggle={onToggle} helpKey="analyse:test" />
      </div>
      <HelpText helpKey="analyse:test" note>
        FC max : pic de la FC lissée sur {protocol.resultHrSmoothS} s. Dernier palier tenu : le dernier dont le suivant a commencé avant que la
        vitesse lâche. Le survol des courbes déplace le repère sur la carte.
      </HelpText>
      <div className="an-sheet__stats an-sheet__stats--always">
        {stat('FC max', bpm(results.hrMaxBpm))}
        {stat('Dernier palier tenu', speed(results.lastStepSpeedMs))}
        {stat('Vitesse max', speed(results.maxSpeedMs))}
        {stat('Paliers tenus', String(results.stepsHeld))}
        {stat('Rampe', results.rampS === null ? '—' : formatShortDuration(results.rampS))}
        {stat('Départ', speed(results.v0Ms))}
        {stat(`FC à +${recoveryMin} min`, results.hrDropBpm === null ? bpm(results.hrAfterBpm) : `${results.hrAfterBpm} bpm (−${results.hrDropBpm})`)}
        {stat('FC de l’échauffement', `${bpm(results.warmupAvgBpm)} (cible ${lowBpm} à ${highBpm})`)}
      </div>

      {results.hrMaxBpm !== null && results.hrMaxBpm !== profileHrMax && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0', fontSize: 'var(--text-s)' }}>
          <span>
            {profileHrMax === null
              ? `Aucune FC max dans Réglages › Pratiquant : celle du test est de ${results.hrMaxBpm} bpm.`
              : `FC max du test : ${results.hrMaxBpm} bpm ; celle de Pratiquant : ${profileHrMax}.`}
          </span>
          <Button size="s" onClick={() => onRetainHrMax(results.hrMaxBpm!)}>Retenir cette FC max</Button>
        </div>
      )}
      {results.hrMaxBpm !== null && results.hrMaxBpm === profileHrMax && (
        <p style={{ fontSize: 'var(--text-s)', margin: '8px 0' }}>FC max du test retenue dans Pratiquant : les zones du cardio en partent.</p>
      )}

      <div style={{ marginTop: '6px' }}>
        <FitnessTestCurves track={track} test={test} minutes={minutes} speedsMs={speedsMs} hrSmoothed={hrSmoothed} speedUnit={speedUnit} zoom={zoom}
          onHoverIndex={onHoverIndex} onLeave={onLeave} onShowOnMap={onShowOnMap} />
      </div>

      <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' }}>
        {test.endReason ? `Fin de la rampe : ${END_REASON_LABEL[test.endReason]}. ` : 'Rampe non terminée. '}
        En haut, <span style={{ color: SPEED_COLOR }}>vitesse lissée</span> et <span style={{ color: TARGET_COLOR }}>cible</span> ;
        en bas, <span style={{ color: HEART_RATE_COLOR }}>FC</span> et sa bande d'échauffement ; traits : {DRAWN_SIGNALS.map((s) => TEST_SIGNAL_LABEL[s].toLowerCase()).join(', ')}.
      </div>
    </>
  );
}
