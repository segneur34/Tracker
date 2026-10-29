import { toFixedNumber } from '../core/basics';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { niceTicks } from '../core/chartZoom';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { GradientStop } from '../running/runningAnalytics';
import { HoverReadout, type Readout } from './ChartReadout';
import { gradeGradientDefs } from './gradeGradientDefs';
import { NO_TOOLTIP_CONTENT, clearTrackHover, trackHover } from './chartHover';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import { ALTITUDE_COLOR, CHART_GRID_PROPS, CHART_TICK, chartTick } from './chartStyle';

/** Une ligne du profil : `index` renvoie au point de trace, `dist` dans l'unité de l'activité. */
export interface ElevationProfileRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

/** Hauteur du profil par défaut, en px. */
const PROFILE_HEIGHT_PX = 130;

/**
 * Profil d'altitude compact de l'onglet « général », à pied et à vélo (22/10) :
 * coloré par la pente, sans repères ni grille (sauf `grid`). Comme les graphes de
 * « graphiques » (25/10) : son nom et la valeur lue au-dessus de lui, zoom
 * propre (double-clic, zone tirée, deux doigts), « +carte » toujours
 * là, zoomé ou non ; le survol déplace le repère sur la carte. Les lignes sont celles de
 * la plage zoomée, chacune avec son `index` de trace. Repris par la page
 * Itinéraires pour le profil de son bloc Général, plus haut, avec sa grille,
 * sans « +carte » (la carte est déjà au-dessus).
 */
function ElevationProfileMini({
  rows, stops, gradientId, distanceSymbol, zoom, read, onShowOnMap, height = PROFILE_HEIGHT_PX, grid = false,
}: {
  rows: ElevationProfileRow[];
  stops: GradientStop[];
  /** Identifiant du dégradé, unique dans la page. */
  gradientId: string;
  distanceSymbol: string;
  zoom: ChartZoom;
  /** Lecture d'un indice de trace (ou de ligne du profil), lue dans le magasin du survol (`HoverReadout`) ; `null` hors de la plage zoomée. */
  read: (index: number) => Readout | null;
  /** « +carte » ou « Afficher » ; aucun bouton s'il manque. */
  onShowOnMap?: () => void;
  /** Hauteur du graphe, en px. */
  height?: number;
  /** Grille en pointillés derrière la courbe. */
  grid?: boolean;
}) {
  const onHover = trackHover(rows);
  return (
    <div style={{ marginTop: '10px' }}>
      <HoverReadout line read={read} label="Altitude" color={ALTITUDE_COLOR} />
      <ZoomableChart zoom={zoom} onLeave={clearTrackHover} onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${height}px` }}>
        <ResponsiveContainer>
          <AreaChart data={rows} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <ChartZoomProbe />
            {grid && <CartesianGrid {...CHART_GRID_PROPS} />}
            {gradeGradientDefs(gradientId, stops)}
            <XAxis dataKey="dist" type="number" allowDataOverflow
              domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
              ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
              tickFormatter={(v: number) => `${toFixedNumber(v, 3)} ${distanceSymbol}`} tick={CHART_TICK} />
            <YAxis domain={['auto', 'auto']} width={38} tickFormatter={(v) => `${v}`} tick={chartTick(ALTITUDE_COLOR)} />
            <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
            <Area type="monotone" dataKey="altitude" stroke={`url(#${gradientId})`} strokeWidth={2} fill={`url(#${gradientId})`} fillOpacity={0.35}
              dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ZoomableChart>
    </div>
  );
}

export default ElevationProfileMini;
