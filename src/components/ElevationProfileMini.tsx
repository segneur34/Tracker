import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { niceTicks } from '../core/chartZoom';
import type { ChartZoom } from '../hooks/useChartZoom';
import type { GradientStop } from '../running/runningAnalytics';
import ChartReadout, { HoverReadout, type Readout } from './ChartReadout';
import { gradeGradientDefs } from './gradeGradientDefs';
import { NO_TOOLTIP_CONTENT, hoveredTrackIndex, type ChartHoverEvent } from './chartHover';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';

/** Une ligne du profil : `index` renvoie au point de trace, `dist` dans l'unité de l'activité. */
export interface ElevationProfileRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

/** Hauteur du profil par défaut, en px. */
const PROFILE_HEIGHT_PX = 130;
/** Altitude : l'orange des autres graphes. */
const ALTITUDE_COLOR = '#e64a19';

/**
 * Profil d'altitude compact de l'onglet « général », à pied et à vélo (22/10) :
 * coloré par la pente, sans repères ni grille (sauf `grid`). Comme les graphes de
 * « graphiques » (25/10) : son nom et la valeur lue au-dessus de lui, zoom
 * propre (double-clic, zone tirée, deux doigts), « +carte » une fois
 * zoomé ; le survol déplace le repère sur la carte. Les lignes sont celles de
 * la plage zoomée, chacune avec son `index` de trace. Repris par la page
 * Itinéraires pour le profil de son bloc Général, plus haut, avec sa grille,
 * sans « +carte » (la carte est déjà au-dessus).
 */
function ElevationProfileMini({
  rows, stops, gradientId, distanceSymbol, zoom, readout, read, onHoverIndex, onLeave, onShowOnMap, height = PROFILE_HEIGHT_PX, grid = false,
}: {
  rows: ElevationProfileRow[];
  stops: GradientStop[];
  /** Identifiant du dégradé, unique dans la page. */
  gradientId: string;
  distanceSymbol: string;
  zoom: ChartZoom;
  /** Lecture au point survolé, `null` hors de la plage zoomée (page qui tient son survol : Itinéraires). */
  readout?: Readout | null;
  /** Lecture d'un indice de trace, lue dans le magasin du survol (`HoverReadout`) : les analyses. */
  read?: (index: number) => Readout | null;
  onHoverIndex: (index: number) => void;
  onLeave: () => void;
  /** « +carte » ou « Afficher » ; aucun bouton s'il manque. */
  onShowOnMap?: () => void;
  /** Hauteur du graphe, en px. */
  height?: number;
  /** Grille en pointillés derrière la courbe. */
  grid?: boolean;
}) {
  const onHover = (e: ChartHoverEvent) => {
    const index = hoveredTrackIndex(e, rows);
    if (index !== null) onHoverIndex(index);
  };
  return (
    <div style={{ marginTop: '10px' }}>
      {read
        ? <HoverReadout line read={read} label="Altitude" color={ALTITUDE_COLOR} />
        : <ChartReadout line readout={readout ?? null} label="Altitude" color={ALTITUDE_COLOR} />}
      <ZoomableChart zoom={zoom} onLeave={onLeave} onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${height}px` }}>
        <ResponsiveContainer>
          <AreaChart data={rows} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <ChartZoomProbe />
            {grid && <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />}
            {gradeGradientDefs(gradientId, stops)}
            <XAxis dataKey="dist" type="number" allowDataOverflow
              domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
              ticks={zoom.shown ? niceTicks(zoom.shown) : undefined}
              tickFormatter={(v: number) => `${parseFloat(v.toFixed(3))} ${distanceSymbol}`} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
            <YAxis domain={['auto', 'auto']} width={38} tickFormatter={(v) => `${v}`} tick={{ fill: ALTITUDE_COLOR, fontSize: 11 }} />
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
