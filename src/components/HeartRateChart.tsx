import type { CSSProperties, ReactNode } from 'react';
import { ReferenceArea, ReferenceLine } from 'recharts';
import { HEART_RATE_COLOR, HEART_ZONE_COLORS } from './heartRateColors';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { ChartXSpec } from './chartAxes';
import TrackChart, { type TrackSeries, type TrackYAxis } from './TrackChart';

/** Haut de la bande de la zone 5. */
const TOP_BPM = 250;

const HR_AXIS: TrackYAxis[] = [{ id: 'hr', color: HEART_RATE_COLOR, unit: 'bpm', domain: ['dataMin - 5', 'dataMax + 5'], allowDecimals: false, width: 46 }];

/**
 * Courbe de FC, zoomable, reliée à la carte par l'indice de chaque ligne
 * (`hoveredTrackIndex`) ; les zones du pratiquant en bandes pâles. L'abscisse
 * vient de la page : la distance dans l'onglet des graphes de la course et du
 * vélo, le temps ailleurs. La valeur se lit au-dessus, dans la lecture de la
 * page (`ChartReadout`). Partagée par l'onglet « cardio » et les onglets des
 * graphes des trois modules.
 */
export default function HeartRateChart<R extends { index: number; hr: number | null }>({
  data, zoom, x, zones, thresholds, onShowOnMap, syncId, showReset, style, children,
}: {
  data: R[];
  zoom: ChartZoom;
  /** Abscisse de la page, sur une clé des lignes. */
  x: ChartXSpec;
  /** Bornes basses des zones 1 à 5, ou `null` sans zones. */
  zones: readonly number[] | null;
  /** Seuils aérobie (S1) et anaérobie (S2), traits noirs ; `null` sans zones. */
  thresholds?: { s1: number; s2: number } | null;
  /** « Afficher » ou « +carte », zoomé ou non (voir `ZoomableChart`). */
  onShowOnMap?: () => void;
  syncId?: string;
  showReset?: boolean;
  style?: CSSProperties;
  /** Éléments de plus dans le graphe (traits des repères). */
  children?: ReactNode;
}) {
  const series: TrackSeries<R>[] = [{ kind: 'line', key: 'hr', name: 'FC', yAxisId: 'hr', color: HEART_RATE_COLOR, width: 2, activeDotR: 5 }];
  return (
    <TrackChart rows={data} zoom={zoom} x={x} yAxes={HR_AXIS} series={series}
      margin={{ top: 5, right: thresholds ? 24 : 10, left: 0, bottom: 0 }}
      syncId={syncId} showReset={showReset} onShowOnMap={onShowOnMap} style={style}>
      {zones?.map((lower, k) => (
        <ReferenceArea key={k} yAxisId="hr" y1={lower} y2={zones[k + 1] ?? TOP_BPM} fill={HEART_ZONE_COLORS[k + 1]} fillOpacity={0.12}
          stroke="none" ifOverflow="hidden" />
      ))}
      {thresholds && ([['S1', thresholds.s1], ['S2', thresholds.s2]] as const).map(([name, bpm]) => (
        <ReferenceLine key={name} yAxisId="hr" y={bpm} stroke="var(--ink)" strokeWidth={1.5} ifOverflow="hidden"
          label={{ value: name, position: 'right', fill: 'var(--ink)', fontSize: 10, fontWeight: 700 }} />
      ))}
      {children}
    </TrackChart>
  );
}
