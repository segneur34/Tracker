import { describe, expect, it } from 'vitest';
import { toFixedNumber } from '../core/basics';
import { niceTicks } from '../core/chartZoom';
import { formatClockMinutes, formatTimeOfDay } from '../core/units';
import type { ChartZoom } from '../hooks/useChartZoom';
import { chartXAxis, distanceX, elapsedX, timeOfDayX } from './chartAxes';
import { CHART_TICK } from './chartStyle';

/** Formats d'avant le lot 60, recopiés tels quels (copie gelée). */
const oldDistance = (symbol: string) => (v: number) => `${toFixedNumber(v, 3)} ${symbol}`;
const oldElapsed = (v: number) => formatClockMinutes(v);
const oldTimeOfDay = (startMs: number | undefined) => (v: number) => (startMs !== undefined ? formatTimeOfDay(startMs + v * 60000).slice(0, 5) : '');

const VALUES = [0, 0.1, 1 / 3, 2.5, 12.3456789, 59.999, 61, 1234.5678, -0.5];

const zoomOf = (shown: { min: number; max: number } | null): ChartZoom => ({
  full: shown, view: shown, shown, minSpan: 0, set: () => undefined, reset: () => undefined,
});

describe('abscisses des graphes de trace', () => {
  it('distance : clé `dist`, texte inchangé', () => {
    for (const symbol of ['km', 'mi', 'NM']) {
      const spec = distanceX(symbol);
      expect(spec.key).toBe('dist');
      for (const v of VALUES) expect(spec.format(v)).toBe(oldDistance(symbol)(v));
    }
  });

  it('temps écoulé : clé `minutes`, texte inchangé', () => {
    const spec = elapsedX();
    expect(spec.key).toBe('minutes');
    for (const v of VALUES) expect(spec.format(v)).toBe(oldElapsed(v));
  });

  it('heure du jour : texte inchangé, vide sans trace', () => {
    const start = Date.UTC(2026, 9, 1, 8, 0, 0);
    const spec = timeOfDayX(start);
    expect(spec.key).toBe('minutes');
    for (const v of VALUES) expect(spec.format(v)).toBe(oldTimeOfDay(start)(v));
    expect(timeOfDayX(undefined).format(12)).toBe('');
  });
});

describe('chartXAxis', () => {
  it('zoomé : domaine et graduations rondes de la plage', () => {
    const shown = { min: 1.2, max: 7.9 };
    const props = chartXAxis(zoomOf(shown), distanceX('km')).props as Record<string, unknown>;
    expect(props.dataKey).toBe('dist');
    expect(props.type).toBe('number');
    expect(props.allowDataOverflow).toBe(true);
    expect(props.domain).toEqual([1.2, 7.9]);
    expect(props.ticks).toEqual(niceTicks(shown));
    expect(props.tick).toBe(CHART_TICK);
  });

  it('sans données : toute l’étendue, graduations de Recharts', () => {
    const props = chartXAxis(zoomOf(null), elapsedX()).props as Record<string, unknown>;
    expect(props.dataKey).toBe('minutes');
    expect(props.domain).toEqual(['dataMin', 'dataMax']);
    expect(props.ticks).toBeUndefined();
  });

  it('caché seulement si demandé', () => {
    expect((chartXAxis(zoomOf(null), elapsedX()).props as Record<string, unknown>).hide).toBeUndefined();
    expect((chartXAxis(zoomOf(null), { ...elapsedX(), hide: true }).props as Record<string, unknown>).hide).toBe(true);
  });
});
