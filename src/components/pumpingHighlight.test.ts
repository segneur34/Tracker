import { describe, expect, it } from 'vitest';
import type { FlightSpan, PumpingSeries } from '../core/pumping';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import { FLIGHT_PODIUM_KEY, SERIES_PODIUM_KEY, flightKey, pumpingHighlightSpans, seriesKey } from './pumpingHighlight';

const flight = (n: number, start: number, end: number): FlightSpan => ({ n, start, end, startMs: start * 1000, endMs: end * 1000, durationS: end - start, distanceM: 100 });
const serie = (n: number, start: number, end: number): PumpingSeries => ({
  n, start, end, startMs: start * 1000, endMs: end * 1000, durationS: end - start, distanceM: 50, flight: 1,
  strokes: 12, strokesPerMin: 90, perStrokeM: 4, speedBeforeMs: 6, speedAfterMs: 5,
});

describe('surbrillance du pumping', () => {
  const flights = [flight(1, 0, 100), flight(2, 120, 160)];
  const series = [serie(1, 10, 20), serie(2, 40, 70), serie(3, 130, 140)];
  const seriesPodium = [series[1], series[0], series[2]];
  const spans = (key: string | null) => pumpingHighlightSpans(key, flights, flights, series, seriesPodium);

  it('montre une série seule en violet, ou un vol seul', () => {
    expect(spans(seriesKey(2))).toEqual([expect.objectContaining({ key: 'serie-2', start: 40, end: 70, color: HIGHLIGHT_SHOWN_COLOR })]);
    expect(spans(flightKey(2))).toEqual([expect.objectContaining({ key: 'vol-2', start: 120, end: 160, color: HIGHLIGHT_SHOWN_COLOR })]);
    expect(spans(seriesKey(2))[0].label).toMatch(/^Série 2 · .* · 30 s · 12 coups · 90 \/min$/);
  });

  it('montre un podium aux couleurs des tops, dans son ordre', () => {
    expect(spans(SERIES_PODIUM_KEY).map((s) => [s.key, s.color])).toEqual([
      ['serie-2', HIGHLIGHT_PODIUM_COLORS[0]], ['serie-1', HIGHLIGHT_PODIUM_COLORS[1]], ['serie-3', HIGHLIGHT_PODIUM_COLORS[2]],
    ]);
    expect(spans(FLIGHT_PODIUM_KEY).map((s) => s.key)).toEqual(['vol-1', 'vol-2']);
  });

  it('ne montre rien sans clé, ni pour une clé inconnue', () => {
    expect(spans(null)).toEqual([]);
    expect(spans('serie:9')).toEqual([]);
    expect(spans('podium')).toEqual([]);
  });
});
