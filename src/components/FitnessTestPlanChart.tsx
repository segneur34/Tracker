import { roundTo } from '../core/basics';
import { useMemo } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatClockMinutes, msToKmh, formatDecimal } from '../core/units';
import { TEST_SIGNAL_LABEL, testPlan, type FitnessTestParams } from '../recording/fitnessTest';
import { phaseAreas } from './fitnessTestChartParts';
import { HEART_RATE_COLOR } from './heartRateColors';
import { CHART_GRID_PROPS, CHART_MARK_COLOR, CHART_TICK, SPEED_COLOR, chartTick, yAxisLabel } from './chartStyle';

const kmhText = (kmh: number) => `${formatDecimal(kmh, 1)} km/h`;

interface Row {
  minutes: number;
  speed: number | null;
  hr: number;
  band: [number, number] | null;
}

/**
 * Graphique annoté du protocole d'un test (page du test) : deux graphes du
 * même temps, plutôt qu'un graphe à deux échelles. En haut la vitesse cible,
 * en marches de +0,6 km/h, un repère à chaque palier (bip long) et les
 * signaux de début et de fin ; en bas la bande de FC de l'échauffement et
 * une FC d'exemple. Phases en fond. Le départ et le nombre de paliers sont
 * un exemple, dit dans la légende.
 */
function FitnessTestPlanChart({ params, v0Ms, steps }: { params: FitnessTestParams; v0Ms: number; steps: number }) {
  const plan = useMemo(() => testPlan(params, { v0Ms, steps }), [params, v0Ms, steps]);
  const rows: Row[] = useMemo(() => plan.points.map((p) => ({
    minutes: p.tS / 60,
    speed: p.targetMs === null ? null : roundTo(msToKmh(p.targetMs), 1),
    hr: p.hrBpm,
    band: p.tS <= params.warmupS ? [plan.hrBand.lowBpm, plan.hrBand.highBpm] : null,
  })), [plan, params.warmupS]);
  const endMin = plan.phases[plan.phases.length - 1].endS / 60;
  const paliers = plan.beeps.filter((b) => b.signal === 'palier');
  const marks = plan.beeps.filter((b) => b.signal !== 'palier');
  const areas = plan.phases.map((p) => ({ phase: p.phase, x1: p.startS / 60, x2: p.endS / 60 }));
  /** Cible du palier au bip : celle du plan à cet instant (le pas du protocole, non une valeur en dur). */
  const palierKmh = (tS: number, k: number): number => {
    const point = plan.points.find((p) => p.tS === tS && p.targetMs !== null);
    return roundTo(msToKmh(point?.targetMs ?? v0Ms + k * params.protocol.stepMs), 1);
  };
  const xAxis = (hide: boolean) => (
    <XAxis dataKey="minutes" type="number" domain={[0, endMin]} tickFormatter={formatClockMinutes} tick={CHART_TICK} hide={hide} />
  );
  const tooltipLabel = (v: unknown) => formatClockMinutes(Number(v));

  return (
    <figure className="fit-plan" aria-label="Déroulé du test : vitesse cible et FC dans le temps">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
          {phaseAreas(areas, true)}
          {xAxis(true)}
          <YAxis domain={['dataMin - 1', 'dataMax + 1']} allowDecimals={false} width={40} tick={chartTick(SPEED_COLOR)}
            label={yAxisLabel('km/h', SPEED_COLOR)} />
          <Tooltip labelFormatter={tooltipLabel} formatter={(v) => [kmhText(Number(v)), 'Vitesse cible']} />
          <Line type="stepAfter" dataKey="speed" name="Vitesse cible" stroke={SPEED_COLOR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          {paliers.map((b, k) => (
            <ReferenceDot key={b.tS} x={b.tS / 60} y={palierKmh(b.tS, k)} r={4} fill={SPEED_COLOR} stroke="var(--surface)" strokeWidth={2} />
          ))}
          {marks.map((b) => (
            <ReferenceLine key={b.signal} x={b.tS / 60} stroke={CHART_MARK_COLOR} strokeDasharray="3 3" ifOverflow="extendDomain" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
          {phaseAreas(areas, false)}
          {xAxis(false)}
          <YAxis domain={[50, 'dataMax + 5']} allowDecimals={false} width={40} tick={chartTick(HEART_RATE_COLOR)}
            label={yAxisLabel('bpm', HEART_RATE_COLOR)} />
          <Tooltip labelFormatter={tooltipLabel}
            formatter={(v, name) => (name === 'band' ? [`${(v as number[])[0]} à ${(v as number[])[1]} bpm`, 'Cible'] : [`${v} bpm`, 'FC (exemple)'])} />
          <Area type="linear" dataKey="band" name="band" stroke="none" fill={HEART_RATE_COLOR} fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="hr" name="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          {marks.map((b) => (
            <ReferenceLine key={b.signal} x={b.tS / 60} stroke={CHART_MARK_COLOR} strokeDasharray="3 3" ifOverflow="extendDomain" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <figcaption className="fit-plan__legend">
        <span><i className="fit-plan__key" style={{ background: SPEED_COLOR }} />Vitesse cible, un point par palier (bip long)</span>
        <span><i className="fit-plan__key" style={{ background: HEART_RATE_COLOR, opacity: 0.35 }} />Cible d'échauffement {plan.hrBand.lowBpm} à {plan.hrBand.highBpm} bpm</span>
        <span><i className="fit-plan__key fit-plan__key--dash" style={{ borderColor: HEART_RATE_COLOR }} />FC d'exemple</span>
        <span><i className="fit-plan__key fit-plan__key--dash" style={{ borderColor: CHART_MARK_COLOR }} />
          {marks.map((b) => TEST_SIGNAL_LABEL[b.signal].toLowerCase()).join(', ')}</span>
        <span className="fit-plan__note">Exemple : rampe partie à {kmhText(msToKmh(v0Ms))}, lâchée au {steps}e palier.</span>
      </figcaption>
    </figure>
  );
}

export default FitnessTestPlanChart;
