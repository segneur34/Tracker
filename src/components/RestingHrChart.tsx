import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMinSec } from '../core/units';
import { HEART_RATE_COLOR } from './heartRateColors';

const MARK_COLOR = '#37474f';
/** Écart entre deux repères de l'axe du temps, en secondes. */
const TICK_S = 30;

interface Props {
  /** La FC de chaque seconde, `null` sans mesure ; plus courte que `durationS` pendant le test. */
  series: readonly (number | null)[];
  durationS: number;
  /** Fenêtre la plus basse, en secondes ; surlignée avec sa valeur. */
  lowest?: { fromS: number; toS: number; bpm: number } | null;
  height?: number;
}

/**
 * La FC de la mesure sur toute sa durée (3 min) : une courbe à la seconde, un
 * axe du temps fixe pour qu'elle se remplisse de gauche à droite pendant le
 * test, et, au résultat, la fenêtre de 30 s la plus basse surlignée.
 */
function RestingHrChart({ series, durationS, lowest = null, height = 220 }: Props) {
  const rows = useMemo(() => Array.from({ length: durationS }, (_, s) => ({ t: s + 0.5, hr: series[s] ?? null })), [series, durationS]);
  const ticks = useMemo(() => Array.from({ length: Math.floor(durationS / TICK_S) + 1 }, (_, k) => k * TICK_S), [durationS]);
  const values = series.filter((v): v is number => v !== null);
  // Un axe qui ne saute pas d'un chiffre à l'autre : bornes arrondies aux 5 bpm, au moins 20 bpm de haut.
  const lo = values.length > 0 ? Math.floor((Math.min(...values) - 3) / 5) * 5 : 50;
  const hi = Math.max(lo + 20, values.length > 0 ? Math.ceil((Math.max(...values) + 3) / 5) * 5 : 90);
  const yTicks = Array.from({ length: Math.floor((hi - lo) / 5) + 1 }, (_, k) => lo + k * 5);

  return (
    <figure className="rest-chart" aria-label="FC pendant le test, en battements par minute">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, durationS]} ticks={ticks} tickFormatter={formatMinSec} tick={{ fill: '#555', fontSize: 11 }} />
          <YAxis domain={[lo, hi]} ticks={yTicks} allowDecimals={false} width={40} tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
            label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => formatMinSec(Math.floor(Number(v)))} formatter={(v) => [`${v} bpm`, 'FC']} />
          {lowest && (
            <ReferenceArea x1={lowest.fromS} x2={lowest.toS} fill={HEART_RATE_COLOR} fillOpacity={0.18} ifOverflow="hidden"
              label={{ value: `${lowest.bpm} bpm`, position: 'top', fill: MARK_COLOR, fontSize: 12, fontWeight: 700 }} />
          )}
          {lowest && <ReferenceLine y={lowest.bpm} stroke={MARK_COLOR} strokeDasharray="4 3" ifOverflow="extendDomain" />}
          <Line type="monotone" dataKey="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

export default RestingHrChart;
