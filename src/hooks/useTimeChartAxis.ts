import { useCallback, useMemo } from 'react';
import type { XRange } from '../core/chartZoom';
import { timeOfDayX } from '../components/chartAxes';
import { inChartView } from '../components/chartHover';
import { formatTimeOfDay } from '../core/units';
import { useChartZoomSource, type ChartZoom } from './useChartZoom';

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
 * étendue entière, deux zooms (graphes empilés, courbe de « cardio »),
 * abscisse en heure du jour et lectures au point survolé. « Tout voir » à chaque session
 * (`sessionKey`). Les zooms sont des sources (`useChartZoomSource`), lues au
 * plus près des graphes (`ZoomView`) : zoomer ne redessine pas le module. Les
 * modules qui tiennent d'autres zooms (distance, test) les créent avec
 * `fullRange`. Rendu stable tant que la trace et la session ne changent pas.
 */
export function useTimeChartAxis(track: ReadonlyArray<{ timeMs: number }>, sessionKey: unknown) {
  const minutes = useMemo(() => trackMinutes(track), [track]);
  const fullRange = useMemo(() => minutesFullRange(minutes), [minutes]);
  const zoom = useChartZoomSource(fullRange, sessionKey);
  const cardioZoom = useChartZoomSource(fullRange, sessionKey);
  const startMs = track[0]?.timeMs;
  /** Abscisse en heure du jour d'un graphe de trace (`TrackChart`, `HeartRateChart`). */
  const timeX = useMemo(() => timeOfDayX(startMs), [startMs]);
  /** Le point `i` est dans la plage zoomée de `z` : sinon, rien à lire. */
  const readable = useCallback(
    (z: Pick<ChartZoom, 'view'>, i: number): boolean => minutes[i] !== undefined && inChartView(z.view, minutes[i]),
    [minutes]
  );
  /** Heure du jour du point `i`, abscisse d'une lecture. */
  const readAt = useCallback((i: number): string => formatTimeOfDay(track[i].timeMs), [track]);
  return useMemo(
    () => ({ minutes, fullRange, zoom, cardioZoom, timeX, readable, readAt }),
    [minutes, fullRange, zoom, cardioZoom, timeX, readable, readAt]
  );
}

/** Axe du temps d'une session, tel que le rend `useTimeChartAxis` : passé aux pièces qui lisent ses graphes. */
export type TimeChartAxis = ReturnType<typeof useTimeChartAxis>;
