import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { NO_TOOLTIP_CONTENT, hoveredTrackIndex, type ChartHoverEvent } from './chartHover';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS } from './heartRateColors';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import type { ChartZoom } from '../hooks/useChartZoom';

/** Haut de la bande de la zone 5. */
const TOP_BPM = 250;

/**
 * Courbe de FC, zoomable, reliée à la carte par l'indice de chaque ligne
 * (`hoveredTrackIndex`) ; les zones du pratiquant en bandes pâles. L'axe des
 * abscisses vient de la page : la distance dans l'onglet des graphes de la
 * course et du vélo, le temps ailleurs. La valeur se lit au-dessus, dans la
 * lecture de la page (`ChartReadout`). Partagée par l'onglet « cardio » et
 * les onglets des graphes des trois modules.
 */
export default function HeartRateChart<R extends { index: number; hr: number | null }>({
  data, zoom, xAxis, zones, thresholds, onHoverIndex, onLeave, onShowOnMap, syncId, showReset, style, children,
}: {
  data: R[];
  zoom: ChartZoom;
  /** `XAxis` de la page, sur une clé des lignes. */
  xAxis: ReactElement;
  /** Bornes basses des zones 1 à 5, ou `null` sans zones. */
  zones: readonly number[] | null;
  /** Seuils aérobie (S1) et anaérobie (S2), traits noirs ; `null` sans zones. */
  thresholds?: { s1: number; s2: number } | null;
  onHoverIndex: (index: number) => void;
  onLeave?: () => void;
  /** « +carte » une fois zoomé. */
  onShowOnMap?: () => void;
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
    <ZoomableChart zoom={zoom} onLeave={onLeave} showReset={showReset} onShowOnMap={onShowOnMap} style={style}>
      <ResponsiveContainer>
        <ComposedChart data={data} syncId={syncId} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 5, right: thresholds ? 24 : 10, left: 0, bottom: 0 }}>
          <ChartZoomProbe />
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          {xAxis}
          <YAxis yAxisId="hr" domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} width={46}
            tick={{ fill: HEART_RATE_COLOR, fontSize: 11 }}
            label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: HEART_RATE_COLOR, fontSize: 11 }} />
          {zones?.map((lower, k) => (
            <ReferenceArea key={k} yAxisId="hr" y1={lower} y2={zones[k + 1] ?? TOP_BPM} fill={HEART_ZONE_COLORS[k + 1]} fillOpacity={0.12}
              stroke="none" ifOverflow="hidden" />
          ))}
          {thresholds && ([['S1', thresholds.s1], ['S2', thresholds.s2]] as const).map(([name, bpm]) => (
            <ReferenceLine key={name} yAxisId="hr" y={bpm} stroke="var(--ink)" strokeWidth={1.5} ifOverflow="hidden"
              label={{ value: name, position: 'right', fill: 'var(--ink)', fontSize: 10, fontWeight: 700 }} />
          ))}
          {children}
          <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
          <Line yAxisId="hr" type="monotone" name="FC" dataKey="hr" stroke={HEART_RATE_COLOR} strokeWidth={2} dot={false} activeDot={{ r: 5 }}
            connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ZoomableChart>
  );
}
