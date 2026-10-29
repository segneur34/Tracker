/**
 * Abscisse des graphes d'une trace : la clé des lignes et le format de ses
 * graduations (`ChartXSpec`), et la seule fabrique de leur `XAxis`
 * (`chartXAxis`) : axe numérique, domaine et graduations rondes de la plage
 * zoomée (`niceTicks`). Distance à pied et à vélo, temps écoulé (énergie,
 * « cardio »), heure du jour (voile, surf).
 */
import { createElement, type ReactElement } from 'react';
import { XAxis } from 'recharts';
import { toFixedNumber } from '../core/basics';
import { niceTicks } from '../core/chartZoom';
import { formatClockMinutes, formatTimeOfDay } from '../core/units';
import type { ChartZoom } from '../hooks/useChartZoom';
import { CHART_TICK } from './chartStyle';

/** Abscisse d'un graphe : la clé des lignes qui la porte et le texte d'une graduation. */
export interface ChartXSpec {
  key: string;
  format: (v: number) => string;
  /** Axe caché : un graphe empilé au-dessus d'un autre au même axe (test guidé). */
  hide?: boolean;
}

/** Distance dans l'unité de l'activité (« 2.5 km ») : lignes à clé `dist`. */
export const distanceX = (symbol: string): ChartXSpec => ({
  key: 'dist',
  format: (v: number) => `${toFixedNumber(v, 3)} ${symbol}`,
});

/** Temps écoulé depuis le départ (« 12:30 ») : lignes à clé `minutes`. */
export const elapsedX = (): ChartXSpec => ({
  key: 'minutes',
  format: (v: number) => formatClockMinutes(v),
});

/** Heure du jour (« 14:05 ») : `startMs` est l'instant du premier point ; vide sans trace. */
export const timeOfDayX = (startMs: number | undefined): ChartXSpec => ({
  key: 'minutes',
  format: (v: number) => (startMs !== undefined ? formatTimeOfDay(startMs + v * 60000).slice(0, 5) : ''),
});

/** `XAxis` d'un graphe de trace, sur la plage zoomée de `zoom`. */
export const chartXAxis = (zoom: ChartZoom, spec: ChartXSpec): ReactElement => createElement(XAxis, {
  dataKey: spec.key,
  type: 'number',
  allowDataOverflow: true,
  domain: zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax'],
  ticks: zoom.shown ? niceTicks(zoom.shown) : undefined,
  tickFormatter: spec.format,
  tick: CHART_TICK,
  ...(spec.hide ? { hide: true } : {}),
});

