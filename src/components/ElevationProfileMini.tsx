import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipPayloadEntry, type TooltipValueType } from 'recharts';
import type { GradientStop } from '../running/runningAnalytics';
import { gradeGradientDefs } from './gradeGradientDefs';
import { hoveredTrackIndex, type ChartHoverEvent } from './chartHover';

/** Une ligne du profil : `index` renvoie au point de trace, `dist` dans l'unité de l'activité. */
export interface ElevationProfileRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

/** Hauteur du profil, en px. */
const PROFILE_HEIGHT_PX = 130;

/**
 * Profil d'altitude compact de l'onglet « général », à pied et à vélo (22/10) :
 * coloré par la pente, toute la trace, sans zoom ; le survol déplace le repère
 * sur la carte. Le graphe complet et zoomable reste dans « graphiques ».
 */
function ElevationProfileMini({ rows, stops, gradientId, distanceSymbol, onHoverIndex, onLeave }: {
  rows: ElevationProfileRow[];
  stops: GradientStop[];
  /** Identifiant du dégradé, unique dans la page. */
  gradientId: string;
  distanceSymbol: string;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
}) {
  const onHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, rows);
    if (index !== null) onHoverIndex(index);
  };
  return (
    <div style={{ width: '100%', height: `${PROFILE_HEIGHT_PX}px`, marginTop: '10px' }} onMouseLeave={onLeave} onTouchEnd={onLeave}>
      <ResponsiveContainer>
        <AreaChart data={rows} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
          {gradeGradientDefs(gradientId, stops)}
          <XAxis dataKey="dist" type="number" domain={['dataMin', 'dataMax']} tickCount={5}
            tickFormatter={(v: number) => `${parseFloat(v.toFixed(1))} ${distanceSymbol}`} tick={{ fill: '#555', fontSize: 11 }} />
          <YAxis domain={['auto', 'auto']} width={38} tickFormatter={(v) => `${v}`} tick={{ fill: '#e64a19', fontSize: 11 }} />
          <Tooltip labelFormatter={(v) => `${parseFloat(Number(v).toFixed(2))} ${distanceSymbol}`}
            contentStyle={{ fontSize: 'var(--text-xs)' }}
            formatter={(value: TooltipValueType | undefined, _name: string | number | undefined, item: TooltipPayloadEntry): [string, string] => {
              // Recharts ne type pas la ligne derrière l'entrée : c'est une `ElevationProfileRow`.
              const row: ElevationProfileRow | undefined = item.payload;
              const grade = row?.grade;
              return [grade != null ? `${value} m, pente ${Math.round(grade * 100)} %` : `${value} m`, 'Altitude'];
            }} />
          <Area type="monotone" dataKey="altitude" stroke={`url(#${gradientId})`} strokeWidth={2} fill={`url(#${gradientId})`} fillOpacity={0.35}
            dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ElevationProfileMini;
