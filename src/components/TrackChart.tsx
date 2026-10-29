import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, YAxis, type AxisDomainItem, type Margin } from 'recharts';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { GradientStop } from '../running/runningAnalytics';
import { chartXAxis, type ChartXSpec } from './chartAxes';
import { NO_TOOLTIP_CONTENT, clearTrackHover, trackHover } from './chartHover';
import { CHART_GRID_PROPS, chartTick, yAxisLabel } from './chartStyle';
import { gradeGradientDefs } from './gradeGradientDefs';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';

/** Axe vertical d'un graphe de trace, à la couleur de sa série. */
export interface TrackYAxis {
  /** `yAxisId` de Recharts, que les séries et les repères nomment ; sans lui, l'axe par défaut. */
  id?: string;
  color: string;
  /** Unité couchée le long de l'axe ; aucune s'il manque. */
  unit?: string;
  domain: readonly [AxisDomainItem, AxisDomainItem];
  width: number;
  orientation?: 'left' | 'right';
  reversed?: boolean;
  hide?: boolean;
  allowDecimals?: boolean;
  tickFormatter?: (v: number) => string;
}

/** Série d'un graphe de trace : courbe, ou aire (pleine, ou colorée par un dégradé de pente). */
export interface TrackSeries<R> {
  kind: 'line' | 'area';
  key: keyof R & string;
  name: string;
  yAxisId?: string;
  color: string;
  width: number;
  /** Rayon du point survolé. */
  activeDotR: 5 | 4;
  fillOpacity?: number;
  /** Dégradé horizontal de la pente (`gradeGradientDefs`), pour trait et remplissage ; `id` unique dans la page. */
  gradient?: { id: string; stops: GradientStop[] };
}

const DEFAULT_MARGIN: Margin = { top: 5, right: 10, left: 0, bottom: 0 };

/**
 * Graphe d'une trace, zoomable (`ZoomableChart`), relié à la carte : chaque
 * ligne porte l'`index` de son point de trace, le survol le pose dans le
 * magasin (`trackHover`), la sortie de la souris l'efface. Abscisse de la
 * plage zoomée (`chartXAxis`), axes verticaux à la couleur de leur série,
 * grille, infobulle vide (la valeur se lit au-dessus, `ChartReadout`),
 * animations coupées. `children` : bandes, seuils et repères, posés tels quels
 * dans le graphe (Recharts ne voit pas un `ReferenceLine` rangé dans un
 * composant à lui), après les axes et avant les séries.
 */
export default function TrackChart<R extends { index: number }>({
  rows, zoom, x, yAxes, series, margin = DEFAULT_MARGIN, grid = true, syncId, showReset, onShowOnMap, style, children,
}: {
  rows: R[];
  zoom: ChartZoom;
  x: ChartXSpec;
  yAxes: readonly TrackYAxis[];
  series: readonly TrackSeries<R>[];
  margin?: Margin;
  /** Grille en pointillés derrière les courbes. */
  grid?: boolean;
  /** Graphes au survol lié (Recharts). */
  syncId?: string;
  /** « Tout voir » sur ce graphe (voir `ZoomableChart`). */
  showReset?: boolean;
  /** « Afficher » ou « +carte », zoomé ou non (voir `ZoomableChart`). */
  onShowOnMap?: () => void;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const onHover = trackHover(rows);
  return (
    <ZoomableChart zoom={zoom} onLeave={clearTrackHover} showReset={showReset} onShowOnMap={onShowOnMap} style={style}>
      <ResponsiveContainer>
        <ComposedChart data={rows} {...(syncId !== undefined ? { syncId } : {})} onMouseMove={onHover} onTouchMove={onHover} margin={margin}>
          <ChartZoomProbe />
          {grid && <CartesianGrid {...CHART_GRID_PROPS} />}
          {chartXAxis(zoom, x)}
          {yAxes.map((axis, k) => (
            <YAxis key={axis.id ?? `axe-${k}`}
              {...(axis.id !== undefined ? { yAxisId: axis.id } : {})}
              {...(axis.orientation !== undefined ? { orientation: axis.orientation } : {})}
              {...(axis.hide !== undefined ? { hide: axis.hide } : {})}
              domain={axis.domain}
              {...(axis.reversed !== undefined ? { reversed: axis.reversed } : {})}
              {...(axis.allowDecimals !== undefined ? { allowDecimals: axis.allowDecimals } : {})}
              {...(axis.tickFormatter !== undefined ? { tickFormatter: axis.tickFormatter } : {})}
              width={axis.width}
              tick={chartTick(axis.color)}
              {...(axis.unit !== undefined ? { label: yAxisLabel(axis.unit, axis.color, axis.orientation === 'right' ? 'insideRight' : 'insideLeft') } : {})} />
          ))}
          {children}
          <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
          {series.map((s) => {
            const yAxis = s.yAxisId !== undefined ? { yAxisId: s.yAxisId } : {};
            const paint = s.gradient ? `url(#${s.gradient.id})` : s.color;
            const dataKey: string = s.key;
            return s.kind === 'line' ? (
              <Line key={s.key} {...yAxis} type="monotone" name={s.name} dataKey={dataKey} stroke={paint} strokeWidth={s.width}
                dot={false} activeDot={{ r: s.activeDotR }} connectNulls={false} isAnimationActive={false} />
            ) : (
              <Fragment key={s.key}>
                {s.gradient && gradeGradientDefs(s.gradient.id, s.gradient.stops)}
                <Area {...yAxis} type="monotone" name={s.name} dataKey={dataKey} stroke={paint} strokeWidth={s.width}
                  fill={paint} {...(s.fillOpacity !== undefined ? { fillOpacity: s.fillOpacity } : {})}
                  dot={false} activeDot={{ r: s.activeDotR }} connectNulls={false} isAnimationActive={false} />
              </Fragment>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </ZoomableChart>
  );
}
