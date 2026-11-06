/**
 * Pièces des graphes de la voile, communes aux onglets « graphiques », « vent » et « vmg » et à la carte
 * en plein écran : couleurs, axes, séries, points des manœuvres, lectures du point survolé. Aucun composant ici,
 * des constantes et des fonctions (même forme que `fitnessTestChartParts.tsx`).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { DotItemDotProps } from 'recharts';
import { normalizeDeg } from '../../core/angles';
import { SPEED_UNIT_SYMBOL, commaDecimal, formatKnots, type SpeedUnit } from '../../core/units';
import type { PointData } from '../../sailing/pointData';
import type { VmgGraphPoint, WindGraphPoint, WindStats } from '../../sailing/sailingAnalytics';
import type { ChartZoom } from '../../hooks/useChartZoom';
import type { SessionHeartRate } from '../../hooks/useSessionHeartRate';
import type { TimeChartAxis } from '../../hooks/useTimeChartAxis';
import type { Readout } from '../ChartReadout';
import type { TrackSeries, TrackYAxis } from '../TrackChart';
import { heartRateReadout, speedReadout } from '../chartReadouts';
import { HEART_RATE_COLOR } from '../heartRateColors';
import { ALTITUDE_COLOR, SAILING_SPEED_COLOR } from '../chartStyle';

/** Graphes de l'onglet « graphiques » dépliés tant qu'on ne les replie pas. */
export const SAILING_GRAPH_FOLDS_DEFAULT = { vitesse: true, fc: true, polaire: true };
export type SailingGraphFold = keyof typeof SAILING_GRAPH_FOLDS_DEFAULT;
/** Nom de chaque graphe de « graphiques », à la couleur de sa courbe (règle commune des noms, Q37). */
export const SAILING_GRAPH_COLORS: Record<SailingGraphFold, string> = { vitesse: SAILING_SPEED_COLOR, fc: HEART_RATE_COLOR, polaire: ALTITUDE_COLOR };

/** Courbe du vent : le trait et les points des manœuvres partagent la couleur. */
export const WIND_COLOR = '#1565c0';
/** Graphe qui remplit son cadre (onglets « graphiques » et « vent »). */
export const FILL_STYLE: CSSProperties = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 };
/** Graphe sous la carte en plein écran (téléphone). */
export const COMPANION_CHART_STYLE: CSSProperties = { width: '100%', height: '200px', flex: 'none', marginBottom: '8px' };

/**
 * Point visible aux seules manœuvres : ailleurs la courbe du vent n'est qu'une
 * interpolation, et le graphe compte jusqu'à 500 points.
 */
const maneuverDot = (props: DotItemDotProps): ReactNode => {
  // Recharts ne type pas la ligne derrière le point : c'est un `WindGraphPoint`.
  const point: WindGraphPoint | undefined = props.payload;
  if (!point?.isManeuver) return null;
  return <circle cx={props.cx} cy={props.cy} r={3} fill={WIND_COLOR} stroke="var(--surface)" strokeWidth={1} />;
};

/** Courbe de la VMG. */
export const VMG_COLOR = '#00838f';
/** Point d'un morceau de la courbe de VMG réduit à une ligne, que le trait ne montre pas (longue session, vue entière). */
const vmgAloneDot = (props: DotItemDotProps): ReactNode => {
  // Recharts ne type pas la ligne derrière le point : c'est un `VmgGraphPoint`.
  const point: VmgGraphPoint | undefined = props.payload;
  if (!point?.alone) return null;
  return <circle cx={props.cx} cy={props.cy} r={1.5} fill={VMG_COLOR} />;
};

/** Curseur commun aux graphes de vitesse et de FC (Q38) : leurs lignes viennent des mêmes points. */
export const SAILING_SYNC_ID = 'sailing';
/** Graduations des axes de la voile : encre grasse, sans unité. */
const SAILING_TICK = { fill: 'var(--ink)', fontSize: 11, fontWeight: 700 };
/** Axe de la vitesse : la largeur garde le tracé où le posaient la marge de −25 et l'axe de 60 px. */
export const SPEED_AXES: TrackYAxis[] = [{ color: SAILING_SPEED_COLOR, domain: [0, 'auto'], width: 35, tick: SAILING_TICK }];
export const SPEED_SERIES: TrackSeries<{ vitesse: number }>[] = [
  { kind: 'line', key: 'vitesse', name: 'vitesse', color: SAILING_SPEED_COLOR, width: 2, activeDotR: 4 },
];
/** Axe du vent, en degrés : la largeur garde le tracé où le posaient la marge de −20 et l'axe de 60 px. */
export const WIND_AXES: TrackYAxis[] = [{
  color: WIND_COLOR, domain: ['dataMin - 15', 'dataMax + 15'], width: 40, tick: SAILING_TICK,
  tickFormatter: (val: number) => `${normalizeDeg(Math.round(val))}°`,
}];
export const WIND_SERIES: TrackSeries<WindGraphPoint>[] = [
  { kind: 'line', key: 'angle', name: 'angle', color: WIND_COLOR, width: 2, activeDotR: 6, dot: maneuverDot },
];
/** Axe de la VMG, de part et d'autre de zéro : le trait à 0 (`ifOverflow="extendDomain"`) le garde dans l'axe. */
export const VMG_AXES: TrackYAxis[] = [{ color: VMG_COLOR, domain: ['auto', 'auto'], width: 40, tick: SAILING_TICK, tickFormatter: commaDecimal }];
export const VMG_SERIES: TrackSeries<VmgGraphPoint>[] = [
  { kind: 'line', key: 'vmg', name: 'VMG', color: VMG_COLOR, width: 2, activeDotR: 4, dot: vmgAloneDot },
];

interface SailingReadersInput {
  trackData: PointData[];
  timeChart: TimeChartAxis;
  heart: SessionHeartRate;
  windStats: WindStats | null;
  vmgSeries: (number | null)[];
  speedUnit: SpeedUnit;
}

/**
 * Point survolé lu au-dessus des graphes de vitesse, de FC, du vent et de la VMG (`HoverReadout`), s'il est dans
 * la plage zoomée `z`. Refaites à chaque rendu du module, comme les lignes qu'elles lisent.
 */
export const sailingChartReaders = ({ trackData, timeChart, heart, windStats, vmgSeries, speedUnit }: SailingReadersInput) => {
  // Affichage dans l'unité de l'activité ; les analyses voile restent en nœuds (règle 5).
  const speedSymbol = SPEED_UNIT_SYMBOL[speedUnit];
  const showKn = (kn: number | string) => formatKnots(kn, speedUnit);
  const readAt = timeChart.readAt;
  const readSpeed = (z: ChartZoom) => (i: number): Readout | null => (timeChart.readable(z, i)
    ? speedReadout(`${showKn(trackData[i].smoothedSpeed)} ${speedSymbol}`, readAt(i), SAILING_SPEED_COLOR)
    : null);
  const readHeart = (z: ChartZoom) => (i: number): Readout | null => (timeChart.readable(z, i) ? heartRateReadout(heart.smoothed[i], readAt(i)) : null);
  const windReadout = (z: ChartZoom) => (i: number): Readout | null => {
    if (!timeChart.readable(z, i) || !windStats) return null;
    const direction = windStats.windAt(trackData[i].timeMs);
    return { values: [{ text: direction === null ? '—' : `${normalizeDeg(Math.round(direction))}°`, color: WIND_COLOR }], at: readAt(i) };
  };
  /** VMG du point survolé : la valeur, et de quel côté du vent. */
  const readVmg = (z: ChartZoom) => (i: number): Readout | null => {
    if (!timeChart.readable(z, i)) return null;
    const vmg = vmgSeries[i] ?? null;
    return {
      values: [{ text: vmg === null ? '—' : `${vmg < 0 ? 'portant' : 'près'} ${showKn(Math.abs(vmg))} ${speedSymbol}`, color: VMG_COLOR }],
      at: readAt(i),
    };
  };
  return { readSpeed, readHeart, windReadout, readVmg };
};

/** Lectures des graphes de la voile, telles que les rend `sailingChartReaders`. */
export type SailingChartReaders = ReturnType<typeof sailingChartReaders>;
