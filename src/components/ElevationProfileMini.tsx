import type { ChartZoom } from '../hooks/useChartZoom';
import type { GradientStop } from '../core/grade';
import { HoverReadout, type Readout } from './ChartReadout';
import { distanceX } from './chartAxes';
import { ALTITUDE_COLOR } from './chartStyle';
import TrackChart, { type TrackYAxis } from './TrackChart';

/** Une ligne du profil : `index` renvoie au point de trace, `dist` dans l'unité de l'activité. */
export interface ElevationProfileRow {
  index: number;
  dist: number;
  altitude: number | null;
  grade: number | null;
}

/** Hauteur du profil par défaut, en px. */
const PROFILE_HEIGHT_PX = 130;

/** Axe de l'altitude, sans unité couchée : le profil est étroit. */
const PROFILE_AXIS: TrackYAxis[] = [{ color: ALTITUDE_COLOR, domain: ['auto', 'auto'], width: 38, tickFormatter: (v) => `${v}` }];

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
  return (
    <div style={{ marginTop: '10px' }}>
      <HoverReadout line read={read} label="Altitude" color={ALTITUDE_COLOR} />
      <TrackChart rows={rows} zoom={zoom} x={distanceX(distanceSymbol)} yAxes={PROFILE_AXIS}
        series={[{ kind: 'area', key: 'altitude', name: 'Altitude', color: ALTITUDE_COLOR, width: 2, activeDotR: 4, fillOpacity: 0.35, gradient: { id: gradientId, stops } }]}
        margin={{ top: 4, right: 6, left: 0, bottom: 0 }} grid={grid}
        onShowOnMap={onShowOnMap} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
}

export default ElevationProfileMini;
