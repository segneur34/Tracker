import { useMemo } from 'react';
import { pad2 } from '../core/units';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HEART_RATE_COLOR } from './heartRateColors';
import { CHART_GRID_PROPS, CHART_TICK, TREND_COLOR, chartTick, yAxisLabel } from './chartStyle';

/** Une nuit de la suite : son départ, sa FC la plus basse et sa moyenne, en bpm. */
export interface NightPoint {
  startMs: number;
  lowBpm: number | null;
  avgBpm: number;
}

/** Jour du départ d'une nuit, « 12/11 ». */
const dayLabel = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getDate()}/${pad2(d.getMonth() + 1)}`;
};

/**
 * Les nuits du test « FC de nuit » l'une après l'autre (lot 213), comme
 * `RestingHrChart` pour la FC repos : la FC la plus basse de chaque nuit, et sa
 * moyenne en pointillé, du plus ancien à gauche au plus récent à droite. Une
 * nuit par graduation, quel que soit l'écart entre deux nuits : c'est la suite
 * qui compte. `nights` : déjà dans l'ordre du temps.
 */
function NightHrChart({ nights, height = 200 }: { nights: readonly NightPoint[]; height?: number }) {
  const rows = useMemo(
    () => nights.map((n) => ({
      key: n.startMs,
      day: dayLabel(n.startMs),
      low: n.lowBpm === null ? null : Math.round(n.lowBpm),
      avg: Math.round(n.avgBpm),
    })),
    [nights]
  );
  // Un axe qui ne saute pas d'un chiffre à l'autre : bornes arrondies aux 5 bpm, au moins 20 bpm de haut.
  const { lo, hi } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      for (const v of [r.low, r.avg]) {
        if (v === null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const low = Number.isFinite(min) ? Math.floor((min - 3) / 5) * 5 : 40;
    return { lo: low, hi: Math.max(low + 20, Number.isFinite(max) ? Math.ceil((max + 3) / 5) * 5 : 70) };
  }, [rows]);

  return (
    <figure className="night-chart" aria-label="FC la plus basse et FC moyenne de chaque nuit, en battements par minute">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} accessibilityLayer={false} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid {...CHART_GRID_PROPS} vertical={false} />
          <XAxis dataKey="day" tick={CHART_TICK} interval="preserveStartEnd" />
          <YAxis domain={[lo, hi]} allowDecimals={false} width={40} tick={chartTick(HEART_RATE_COLOR)} label={yAxisLabel('bpm', HEART_RATE_COLOR)} />
          <Tooltip formatter={(v, name) => [`${v} bpm`, name === 'low' ? 'plus basse' : 'moyenne']} />
          <Line type="monotone" dataKey="avg" stroke={TREND_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="low" stroke={HEART_RATE_COLOR} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </figure>
  );
}

export default NightHrChart;
