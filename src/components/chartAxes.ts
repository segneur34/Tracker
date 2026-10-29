/**
 * Axes du temps communs aux graphes sur le temps écoulé (en minutes depuis le
 * premier point). Posés comme `xAxis` des graphes de la page ; graduations
 * rondes une fois zoomé (`niceTicks`).
 */
import { createElement, type ReactElement } from 'react';
import { XAxis } from 'recharts';
import { niceTicks } from '../core/chartZoom';
import { formatClockMinutes, formatTimeOfDay } from '../core/units';
import type { ChartZoom } from '../hooks/useChartZoom';
import { CHART_TICK } from './chartStyle';

const timeAxisOf = (zoom: ChartZoom, tickFormatter: (v: number) => string): ReactElement => createElement(XAxis, {
  dataKey: 'minutes',
  type: 'number',
  allowDataOverflow: true,
  domain: zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax'],
  ticks: zoom.shown ? niceTicks(zoom.shown) : undefined,
  tickFormatter,
  tick: CHART_TICK,
});

/** Axe en heure du jour (« 14:05 ») : `startMs` est l'instant du premier point ; vide sans trace. */
export const timeOfDayAxis = (zoom: ChartZoom, startMs: number | undefined): ReactElement => timeAxisOf(
  zoom,
  (v: number) => (startMs !== undefined ? formatTimeOfDay(startMs + v * 60000).slice(0, 5) : '')
);

/** Axe en temps écoulé depuis le départ (« 12:30 »). */
export const elapsedMinutesAxis = (zoom: ChartZoom): ReactElement => timeAxisOf(zoom, (v: number) => formatClockMinutes(v));
