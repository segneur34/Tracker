import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { XRange } from '../core/chartZoom';
import { timeOfDayAxis, timeOfDayX } from '../components/chartAxes';
import { inChartView } from '../components/chartHover';
import { formatTimeOfDay } from '../core/units';
import { useChartZoom, type ChartZoom } from './useChartZoom';

/** Temps écoulé de chaque point, en minutes depuis le premier : l'axe des graphes sur le temps. */
export const trackMinutes = (track: ReadonlyArray<{ timeMs: number }>): number[] => {
  const t0 = track[0]?.timeMs ?? 0;
  return track.map((p) => (p.timeMs - t0) / 60_000);
};

/** Étendue entière de l'axe : de 0 à la dernière minute, ou `null` sous deux points. */
export const minutesFullRange = (minutes: ReadonlyArray<number>): XRange | null => (
  minutes.length > 1 ? { min: 0, max: minutes[minutes.length - 1] } : null
);

/**
 * Axe du temps des graphes d'une session : minutes depuis le premier point,
 * étendue entière, deux zooms (graphes empilés, courbe de « cardio »), axes
 * du temps et lectures au point survolé. « Tout voir » à chaque session
 * (`sessionKey`). Les modules qui tiennent d'autres zooms (distance, énergie,
 * test) les créent avec `fullRange`.
 */
export function useTimeChartAxis(track: ReadonlyArray<{ timeMs: number }>, sessionKey: unknown) {
  const minutes = useMemo(() => trackMinutes(track), [track]);
  const fullRange = useMemo(() => minutesFullRange(minutes), [minutes]);
  const zoom = useChartZoom(fullRange, sessionKey);
  const cardioZoom = useChartZoom(fullRange, sessionKey);
  const startMs = track[0]?.timeMs;
  return {
    minutes,
    fullRange,
    zoom,
    cardioZoom,
    /** Axe en heure du jour, à poser comme `XAxis`. */
    timeAxis: (z: ChartZoom): ReactElement => timeOfDayAxis(z, startMs),
    /** Abscisse en heure du jour d'un graphe de trace (`TrackChart`, `HeartRateChart`). */
    timeX: timeOfDayX(startMs),
    /** Le point `i` est dans la plage zoomée de `z` : sinon, rien à lire. */
    readable: (z: ChartZoom, i: number): boolean => minutes[i] !== undefined && inChartView(z.view, minutes[i]),
    /** Heure du jour du point `i`, abscisse d'une lecture. */
    readAt: (i: number): string => formatTimeOfDay(track[i].timeMs),
  };
}
