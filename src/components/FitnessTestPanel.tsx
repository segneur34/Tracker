import { toFixedNumber } from '../core/basics';
import { useMemo } from 'react';
import { ReferenceArea, ReferenceLine } from 'recharts';
import ChartReadout, { HoverReadout, type Readout } from './ChartReadout';
import { elapsedX } from './chartAxes';
import { inChartView } from './chartHover';
import { phaseAreas } from './fitnessTestChartParts';
import { HEART_RATE_COLOR } from './heartRateColors';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';
import TrackChart, { type TrackSeries } from './TrackChart';
import Button from './ui/Button';
import { sampledIndicesKeeping, visibleIndexRange } from '../core/chartZoom';
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
import { CHART_MARK_COLOR, SPEED_COLOR } from './chartStyle';

const TARGET_COLOR = '#0d47a1';
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

const SPEED_SERIES: TrackSeries<Row>[] = [
  { kind: 'line', key: 'speed', name: 'speed', color: SPEED_COLOR, width: 1.5, activeDotR: 4 },
  { kind: 'step', key: 'target', name: 'target', color: TARGET_COLOR, width: 2, activeDotR: false },
];
const HR_SERIES: TrackSeries<Row>[] = [{ kind: 'line', key: 'hr', name: 'hr', color: HEART_RATE_COLOR, width: 2, activeDotR: 4 }];
/** Le graphe du haut cache son abscisse : celle du graphe du bas sert aux deux. */
const HIDDEN_X = { ...elapsedX(), hide: true };
const SHOWN_X = elapsedX();

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
export function FitnessTestCurves({ track, test, minutes, speedsMs, hrSmoothed, speedUnit, zoom, onShowOnMap }: {
  track: readonly TrackPoint[];
  test: SessionTest;
  /** Minutes de chaque point depuis le début de la trace : l'axe et son zoom. */
  minutes: readonly number[];
  /** Vitesse des graphes, lissée. */
  speedsMs: readonly number[];
  hrSmoothed: readonly (number | null)[];
  speedUnit: SpeedUnit;
  zoom: ChartZoom;
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
    // Les extrêmes de la vitesse et de la FC restent : le pic de FC du test ne disparaît pas.
    return sampledIndicesKeeping(first, last, CHART_MAX_POINTS, [speedsMs, hrSmoothed]).map((i) => {
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
    { key: 'echauffement' as const, from: test.startMs, to: test.rampStartMs ?? test.endMs ?? lastMs },
    ...(test.rampStartMs !== null ? [{ key: 'rampe' as const, from: test.rampStartMs, to: rampEndMs }] : []),
    ...(test.rampEndMs !== null ? [{ key: 'recuperation' as const, from: test.rampEndMs, to: test.endMs ?? lastMs }] : []),
  ];
  const signals = test.signals.filter((s) => DRAWN_SIGNALS.includes(s.s));
  // Des listes d'éléments, pas des composants : Recharts ne voit pas un ReferenceLine rangé dans un composant à lui.
  const areas = phases.map((p) => ({ phase: p.key, x1: toMin(p.from), x2: toMin(p.to) }));
  const signalLines = signals.map((s) => (
    <ReferenceLine key={`${s.s}-${s.t}`} x={toMin(s.t)} stroke={CHART_MARK_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" ifOverflow="hidden" />
  ));

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
      <TrackChart rows={rows} zoom={zoom} x={HIDDEN_X} series={SPEED_SERIES} syncId="test" grid="horizontal"
        yAxes={[{ color: SPEED_COLOR, unit: SPEED_UNIT_LABEL[unit], domain: ['dataMin - 1', 'dataMax + 1'], allowDecimals: false, width: 46 }]}
        margin={{ top: 18, right: 10, left: 0, bottom: 0 }} onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${CURVE_HEIGHT_PX}px` }}>
        {phaseAreas(areas, true)}
        {signalLines}
      </TrackChart>
      {/* Nom de la courbe de FC : la ligne qui porte son « +carte » (règle de chaque graphe). */}
      <ChartReadout readout={null} label="FC" color={HEART_RATE_COLOR} line />
      <TrackChart rows={rows} zoom={zoom} x={SHOWN_X} series={HR_SERIES} syncId="test" grid="horizontal"
        yAxes={[{ color: HEART_RATE_COLOR, unit: 'bpm', domain: ['dataMin - 5', 'dataMax + 5'], allowDecimals: false, width: 46 }]}
        margin={{ top: 4, right: 10, left: 0, bottom: 0 }} showReset={false} onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${CURVE_HEIGHT_PX}px` }}>
        {phaseAreas(areas, false)}
        <ReferenceArea x1={toMin(test.startMs)} x2={toMin(test.rampStartMs ?? test.endMs ?? lastMs)} y1={test.settings.lowBpm} y2={test.settings.highBpm}
          fill={HEART_RATE_COLOR} fillOpacity={0.15} stroke="none" ifOverflow="hidden" />
        {signalLines}
      </TrackChart>
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
  track, test, minutes, speedsMs, hrSmoothed, speedUnit, profileHrMax, onRetainHrMax, zoom, onShowOnMap,
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
      <PanelHeading label={`Test ${protocol.label}`} open={open} onToggle={onToggle} helpKey="analyse:test" />
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
          onShowOnMap={onShowOnMap} />
      </div>

      <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' }}>
        {test.endReason ? `Fin de la rampe : ${END_REASON_LABEL[test.endReason]}. ` : 'Rampe non terminée. '}
        En haut, <span style={{ color: SPEED_COLOR }}>vitesse lissée</span> et <span style={{ color: TARGET_COLOR }}>cible</span> ;
        en bas, <span style={{ color: HEART_RATE_COLOR }}>FC</span> et sa bande d'échauffement ; traits : {DRAWN_SIGNALS.map((s) => TEST_SIGNAL_LABEL[s].toLowerCase()).join(', ')}.
      </div>
    </>
  );
}
