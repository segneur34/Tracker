import { useMemo } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { formatClock, msToKmh } from '../core/units';
import { TEST_SIGNAL_LABEL, testPlan, type FitnessTestParams } from '../recording/fitnessTest';
import { HEART_RATE_COLOR } from './heartRateColors';

/** Bleu des courbes de vitesse des analyses à pied. */
const SPEED_COLOR = '#1e88e5';
const PHASE_FILL = '#90a4ae';
const MARK_COLOR = '#37474f';
const PHASE_LABEL = { echauffement: 'Échauffement', rampe: 'Rampe', recuperation: 'Récup.' } as const;

const kmhText = (kmh: number) => `${kmh.toFixed(1).replace('.', ',')} km/h`;
const minutesTick = (v: number) => formatClock(v * 60_000).replace(/:00$/, '');

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
    speed: p.targetMs === null ? null : Math.round(msToKmh(p.targetMs) * 10) / 10,
    hr: p.hrBpm,
    band: p.tS <= params.warmupS ? [plan.hrBand.lowBpm, plan.hrBand.highBpm] : null,
  })), [plan, params.warmupS]);
  const endMin = plan.phases[plan.phases.length - 1].endS / 60;
  const paliers = plan.beeps.filter((b) => b.signal === 'palier');
  const marks = plan.beeps.filter((b) => b.signal !== 'palier');
  // Une liste d'éléments, pas un composant : Recharts ne voit pas un ReferenceArea rangé dans un composant à lui.
  const phaseAreas = (labelled: boolean) => plan.phases.map((p, i) => (
    <ReferenceArea key={p.phase} x1={p.startS / 60} x2={p.endS / 60} fill={PHASE_FILL} fillOpacity={i % 2 === 0 ? 0.12 : 0.04} ifOverflow="hidden"
      label={labelled ? { value: PHASE_LABEL[p.phase], position: 'insideTop', fill: '#555', fontSize: 11 } : undefined} />
  ));
  const xAxis = (hide: boolean) => (
    <XAxis dataKey="minutes" type="number" domain={[0, endMin]} tickFormatter={minutesTick} tick={{ fill: '#555', fontSize: 11 }} hide={hide} />
  );
  const tooltipLabel = (v: unknown) => minutesTick(Number(v));

  return (
    <figure className="fit-plan" aria-label="Déroulé du test : vitesse cible et FC dans le temps">
      <ResponsiveContainer width="100%" height={170}>
        <ComposedChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" vertical={false} />
          {phaseAreas(true)}
          {xAxis(true)}
          <YAxis domain={['dataMin - 1', 'dataMax + 1']} allowDecimals={false} width={40} tick={{ fill: SPEED_COLOR, fontSize: 11 }}
            label={{ value: 'km/h', angle: -90, position: 'insideLeft', fill: SPEED_COLOR, fontSize: 11 }} />
          <Tooltip labelFormatter={tooltipLabel} formatter={(v) => [kmhText(Number(v)), 'Vitesse cible']} />
          <Line type="stepAfter" dataKey="speed" name="Vitesse cible" stroke={SPEED_COLOR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          {paliers.map((b, k) => (
            <ReferenceDot key={b.tS} x={b.tS / 60} y={Math.round((msToKmh(v0Ms) + 0.6 * k) * 10) / 10} r={4} fill={SPEED_COLOR} stroke="#fff" strokeWidth={2} />
          ))}
          {marks.map((b) => (
            <ReferenceLine key={b.signal} x={b.tS / 60} stroke={MARK_COLOR} strokeDasharray="3 3" ifOverflow="extendDomain" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" vertical={false} />
          {phaseAreas(false)}
          {xAxis(false)}
          <YAxis domain={[50, 'dataMax + 5']} allowDecimals={false} width={40} tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
            label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
          <Tooltip labelFormatter={tooltipLabel}
            formatter={(v, name) => (name === 'band' ? [`${(v as number[])[0]} à ${(v as number[])[1]} bpm`, 'Cible'] : [`${v} bpm`, 'FC (exemple)'])} />
          <Area type="linear" dataKey="band" name="band" stroke="none" fill={HEART_RATE_COLOR} fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="hr" name="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          {marks.map((b) => (
            <ReferenceLine key={b.signal} x={b.tS / 60} stroke={MARK_COLOR} strokeDasharray="3 3" ifOverflow="extendDomain" />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      <figcaption className="fit-plan__legend">
        <span><i className="fit-plan__key" style={{ background: SPEED_COLOR }} />Vitesse cible, un point par palier (bip long)</span>
        <span><i className="fit-plan__key" style={{ background: HEART_RATE_COLOR, opacity: 0.35 }} />Cible d'échauffement {plan.hrBand.lowBpm} à {plan.hrBand.highBpm} bpm</span>
        <span><i className="fit-plan__key fit-plan__key--dash" style={{ borderColor: HEART_RATE_COLOR }} />FC d'exemple</span>
        <span><i className="fit-plan__key fit-plan__key--dash" style={{ borderColor: MARK_COLOR }} />
          {marks.map((b) => TEST_SIGNAL_LABEL[b.signal].toLowerCase()).join(', ')}</span>
        <span className="fit-plan__note">Exemple : rampe partie à {kmhText(msToKmh(v0Ms))}, lâchée au {steps}e palier.</span>
      </figcaption>
    </figure>
  );
}

export default FitnessTestPlanChart;
