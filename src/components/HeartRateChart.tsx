import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { hoveredTrackIndex, type ChartHoverEvent } from './chartHover';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS } from './heartRateColors';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import type { ChartZoom } from '../hooks/useChartZoom';

/** Haut de la bande de la zone 5. */
const TOP_BPM = 250;

const tooltipStyle = { fontSize: 'var(--text-xs)' } as const;

/**
 * Courbe de FC, zoomable, reliée à la carte par l'indice de chaque ligne
 * (`hoveredTrackIndex`) ; les zones du pratiquant en bandes pâles. L'axe des
 * abscisses vient de la page : la distance dans l'onglet des graphes de la
 * course et du vélo, le temps ailleurs. Partagée par l'onglet « cardio » et
 * les onglets des graphes des trois modules.
 */
export default function HeartRateChart<R extends { index: number; hr: number | null }>({
  data, zoom, xAxis, labelFormatter, zones, onHoverIndex, onLeave, syncId, showReset, style, children,
}: {
  data: R[];
  zoom: ChartZoom;
  /** `XAxis` de la page, sur une clé des lignes. */
  xAxis: ReactElement;
  labelFormatter: (label: unknown) => string;
  /** Bornes basses des zones 1 à 5, ou `null` sans zones. */
  zones: readonly number[] | null;
  onHoverIndex: (index: number) => void;
  onLeave?: () => void;
  syncId?: string;
  showReset?: boolean;
  style?: CSSProperties;
  /** Éléments de plus dans le graphe (traits des repères). */
  children?: ReactNode;
}) {
  const onHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, data);
    if (index !== null) onHoverIndex(index);
  };
  return (
    <ZoomableChart zoom={zoom} onLeave={onLeave} showReset={showReset} style={style}>
      <ResponsiveContainer>
        <ComposedChart data={data} syncId={syncId} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <ChartZoomProbe />
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
          {xAxis}
          <YAxis yAxisId="hr" domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={46}
            tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
            label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
          {zones?.map((lower, k) => (
            <ReferenceArea key={k} yAxisId="hr" y1={lower} y2={zones[k + 1] ?? TOP_BPM} fill={HEART_ZONE_COLORS[k + 1]} fillOpacity={0.12}
              stroke="none" ifOverflow="hidden" />
          ))}
          {children}
          <Tooltip formatter={(value) => [`${value} bpm`, 'FC']} labelFormatter={labelFormatter} contentStyle={tooltipStyle} />
          <Line yAxisId="hr" type="monotone" name="FC" dataKey="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 5 }}
            connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ZoomableChart>
  );
}
