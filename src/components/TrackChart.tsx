import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, YAxis, type AxisDomainItem, type DotItemDotProps, type Margin } from 'recharts';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { GradientStop } from '../running/runningAnalytics';
import { chartXAxis, type ChartXSpec } from './chartAxes';
import { NO_TOOLTIP_CONTENT, clearTrackHover, trackHover, type ChartHoverEvent } from './chartHover';
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
  /** Ce qui sort du domaine est coupé. */
  allowDataOverflow?: boolean;
  /** Graduations imposées ; sinon celles de Recharts. */
  ticks?: readonly number[];
  tickFormatter?: (v: number) => string;
  /** Style des graduations, s'il n'est pas celui de la série (`chartTick(color)`). */
  tick?: { fill: string; fontSize: number; fontWeight?: number };
}

/** Série d'un graphe de trace : courbe, marches (`stepAfter`), ou aire (pleine, ou colorée par un dégradé de pente). */
export interface TrackSeries<R> {
  kind: 'line' | 'area' | 'step';
  key: keyof R & string;
  name: string;
  yAxisId?: string;
  color: string;
  width: number;
  /** Rayon du point survolé ; `false` : aucun point. */
  activeDotR: number | false;
  /** Relie la courbe par-dessus les trous (par défaut, non). */
  connectNulls?: boolean;
  /** Point dessiné à chaque ligne (par défaut, aucun). */
  dot?: (props: DotItemDotProps) => ReactNode;
  fillOpacity?: number;
  /** Dégradé horizontal de la pente (`gradeGradientDefs`), pour trait et remplissage ; `id` unique dans la page. */
  gradient?: { id: string; stops: GradientStop[] };
}

const DEFAULT_MARGIN: Margin = { top: 5, right: 10, left: 0, bottom: 0 };

/** Ce que tous les graphes de trace reçoivent. */
interface TrackChartBase<R> {
  zoom: ChartZoom;
  x: ChartXSpec;
  yAxes: readonly TrackYAxis[];
  series: readonly TrackSeries<R>[];
  margin?: Margin;
  /** Grille en pointillés derrière les courbes ; `'horizontal'` : ses seuls traits horizontaux. */
  grid?: boolean | 'horizontal';
  /** Graphes au survol lié (Recharts). */
  syncId?: string;
  /** « Tout voir » sur ce graphe (voir `ZoomableChart`). */
  showReset?: boolean;
  /** « Afficher » ou « +carte », zoomé ou non (voir `ZoomableChart`). */
  onShowOnMap?: () => void;
  style?: CSSProperties;
  children?: ReactNode;
  /** Repères posés après les séries, par-dessus elles. */
  front?: ReactNode;
}

/**
 * Survol : sans `onHover`, chaque ligne porte l'`index` de son point de trace,
 * posé dans le magasin du survol (`trackHover`), que la sortie de la souris
 * efface. Un graphe dont les lignes ne renvoient pas à la trace, ou qui lit
 * son survol lui-même, donne `onHover` et `onLeave`.
 */
export type TrackChartProps<R> = TrackChartBase<R> & (
  | { rows: (R & { index: number })[]; onHover?: undefined; onLeave?: undefined }
  | { rows: R[]; onHover: (e: ChartHoverEvent) => void; onLeave?: () => void }
);

/**
 * Graphe d'une trace, zoomable (`ZoomableChart`), relié à la carte : chaque
 * ligne porte l'`index` de son point de trace, le survol le pose dans le
 * magasin (`trackHover`), la sortie de la souris l'efface. Abscisse de la
 * plage zoomée (`chartXAxis`), axes verticaux à la couleur de leur série,
 * grille, infobulle vide (la valeur se lit au-dessus, `ChartReadout`),
 * animations coupées. `children` : bandes, seuils et repères, posés tels quels
 * dans le graphe (Recharts ne voit pas un `ReferenceLine` rangé dans un
 * composant à lui), après les axes et avant les séries ; `front` : ceux qui
 * passent par-dessus les séries.
 */
export default function TrackChart<R>(props: TrackChartProps<R>) {
  const { zoom, x, yAxes, series, margin = DEFAULT_MARGIN, grid = true, syncId, showReset, onShowOnMap, style, children, front } = props;
  const rows: R[] = props.rows;
  const onHover = props.onHover === undefined ? trackHover(props.rows) : props.onHover;
  const onLeave = props.onHover === undefined ? clearTrackHover : props.onLeave;
  return (
    <ZoomableChart zoom={zoom} onLeave={onLeave} showReset={showReset} onShowOnMap={onShowOnMap} style={style}>
      <ResponsiveContainer>
        <ComposedChart data={rows} {...(syncId !== undefined ? { syncId } : {})} onMouseMove={onHover} onTouchMove={onHover} margin={margin}>
          <ChartZoomProbe />
          {grid === 'horizontal' ? <CartesianGrid {...CHART_GRID_PROPS} vertical={false} /> : grid && <CartesianGrid {...CHART_GRID_PROPS} />}
          {chartXAxis(zoom, x)}
          {yAxes.map((axis, k) => (
            <YAxis key={axis.id ?? `axe-${k}`}
              {...(axis.id !== undefined ? { yAxisId: axis.id } : {})}
              {...(axis.orientation !== undefined ? { orientation: axis.orientation } : {})}
              {...(axis.hide !== undefined ? { hide: axis.hide } : {})}
              domain={axis.domain}
              {...(axis.reversed !== undefined ? { reversed: axis.reversed } : {})}
              {...(axis.allowDecimals !== undefined ? { allowDecimals: axis.allowDecimals } : {})}
              {...(axis.allowDataOverflow !== undefined ? { allowDataOverflow: axis.allowDataOverflow } : {})}
              {...(axis.ticks !== undefined ? { ticks: [...axis.ticks] } : {})}
              {...(axis.tickFormatter !== undefined ? { tickFormatter: axis.tickFormatter } : {})}
              width={axis.width}
              tick={axis.tick ?? chartTick(axis.color)}
              {...(axis.unit !== undefined ? { label: yAxisLabel(axis.unit, axis.color, axis.orientation === 'right' ? 'insideRight' : 'insideLeft') } : {})} />
          ))}
          {children}
          <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
          {series.map((s) => {
            const yAxis = s.yAxisId !== undefined ? { yAxisId: s.yAxisId } : {};
            const paint = s.gradient ? `url(#${s.gradient.id})` : s.color;
            const dataKey: string = s.key;
            const activeDot = s.activeDotR === false ? false : { r: s.activeDotR };
            const dot = s.dot ?? false;
            const connectNulls = s.connectNulls ?? false;
            return s.kind === 'area' ? (
              <Fragment key={s.key}>
                {s.gradient && gradeGradientDefs(s.gradient.id, s.gradient.stops)}
                <Area {...yAxis} type="monotone" name={s.name} dataKey={dataKey} stroke={paint} strokeWidth={s.width}
                  fill={paint} {...(s.fillOpacity !== undefined ? { fillOpacity: s.fillOpacity } : {})}
                  dot={dot} activeDot={activeDot} connectNulls={connectNulls} isAnimationActive={false} />
              </Fragment>
            ) : (
              <Line key={s.key} {...yAxis} type={s.kind === 'step' ? 'stepAfter' : 'monotone'} name={s.name} dataKey={dataKey} stroke={paint} strokeWidth={s.width}
                dot={dot} activeDot={activeDot} connectNulls={connectNulls} isAnimationActive={false} />
            );
          })}
          {front}
        </ComposedChart>
      </ResponsiveContainer>
    </ZoomableChart>
  );
}
