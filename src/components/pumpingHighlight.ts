import type { FlightSpan, PumpingSeries } from '../core/pumping';
import { formatShortDuration, formatTimeOfDay } from '../core/units';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import type { TrackSpanShown } from './TrackSpanLayer';

/**
 * Surbrillance de l'onglet du pumping (« pumping » en voile, « vols » en surf),
 * une seule à la fois (`useMapHighlight`) : une série de coups ou le podium des
 * séries, un vol ou le podium des vols.
 */
export type PumpingHighlightKey = `serie:${number}` | 'serie:podium' | `vol:${number}` | 'vol:podium';

export const SERIES_PODIUM_KEY: PumpingHighlightKey = 'serie:podium';
export const FLIGHT_PODIUM_KEY: PumpingHighlightKey = 'vol:podium';
export const seriesKey = (n: number): PumpingHighlightKey => `serie:${n}`;
export const flightKey = (n: number): PumpingHighlightKey => `vol:${n}`;

/** Bulle d'une série sur la carte : numéro, heure, durée, coups, cadence. */
export const seriesSpanLabel = (s: PumpingSeries): string =>
  `Série ${s.n} · ${formatTimeOfDay(s.startMs)} · ${formatShortDuration(s.durationS)} · ${s.strokes} coups · ${Math.round(s.strokesPerMin)} /min`;

/** Bulle d'un vol sur la carte : numéro, heure, durée, distance. */
export const flightSpanLabel = (f: FlightSpan): string =>
  `Vol ${f.n} · ${formatTimeOfDay(f.startMs)} · ${formatShortDuration(f.durationS)} · ${Math.round(f.distanceM)} m`;

/**
 * Passages montrés sur la carte pour la clé `key` de l'onglet (`null` : aucun) :
 * le podium aux couleurs des tops, un passage seul en violet.
 */
export const pumpingHighlightSpans = <F extends FlightSpan>(
  key: string | null,
  flights: readonly F[],
  flightPodium: readonly F[],
  series: readonly PumpingSeries[],
  seriesPodium: readonly PumpingSeries[],
  flightLabel: (f: F) => string = flightSpanLabel,
): TrackSpanShown[] => {
  const ofSeries = (s: PumpingSeries, color: string): TrackSpanShown => ({ key: `serie-${s.n}`, start: s.start, end: s.end, color, label: seriesSpanLabel(s) });
  const ofFlight = (f: F, color: string): TrackSpanShown => ({ key: `vol-${f.n}`, start: f.start, end: f.end, color, label: flightLabel(f) });
  if (key === SERIES_PODIUM_KEY) return seriesPodium.map((s, k) => ofSeries(s, HIGHLIGHT_PODIUM_COLORS[k]));
  if (key === FLIGHT_PODIUM_KEY) return flightPodium.map((f, k) => ofFlight(f, HIGHLIGHT_PODIUM_COLORS[k]));
  const s = series.find((x) => seriesKey(x.n) === key);
  if (s) return [ofSeries(s, HIGHLIGHT_SHOWN_COLOR)];
  const f = flights.find((x) => flightKey(x.n) === key);
  return f ? [ofFlight(f, HIGHLIGHT_SHOWN_COLOR)] : [];
};
