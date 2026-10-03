import { useCallback, useMemo, useState } from 'react';
import { clampRange, type XRange } from '../core/chartZoom';
import { CHART_ZOOM_MIN_FRACTION } from '../core/displayConfig';

/** Zoom d'un graphe, tel que `ZoomableChart` le lit et le change. */
export interface ChartZoom {
  /** Étendue complète de l'axe, `null` sans données. */
  full: XRange | null;
  /** Plage zoomée, ou `null` : tout voir. */
  view: XRange | null;
  /** Plage affichée : la plage zoomée, sinon l'étendue. */
  shown: XRange | null;
  /** Largeur minimale d'une plage, dans l'unité de l'axe. */
  minSpan: number;
  set: (next: XRange | null) => void;
  reset: () => void;
}

/**
 * Plage visible de l'axe des abscisses d'un graphe (ou de plusieurs graphes
 * qui partagent leur axe). Elle reste dans l'étendue quand celle-ci change
 * (point ajouté à un itinéraire) et revient à « tout voir » quand `resetKey`
 * change (autre session).
 */
export const useChartZoom = (full: XRange | null, resetKey?: unknown): ChartZoom => {
  const [stored, setStored] = useState<{ key: unknown; range: XRange | null }>({ key: resetKey, range: null });
  const minSpan = full ? (full.max - full.min) * CHART_ZOOM_MIN_FRACTION : 0;
  const fullMin = full?.min;
  const fullMax = full?.max;

  const view = useMemo(() => {
    if (stored.key !== resetKey || !stored.range || fullMin === undefined || fullMax === undefined) return null;
    return clampRange(stored.range, { min: fullMin, max: fullMax }, minSpan);
  }, [stored, resetKey, fullMin, fullMax, minSpan]);

  const set = useCallback(
    (next: XRange | null) => {
      const range = next && fullMin !== undefined && fullMax !== undefined
        ? clampRange(next, { min: fullMin, max: fullMax }, minSpan)
        : null;
      setStored({ key: resetKey, range });
    },
    [resetKey, fullMin, fullMax, minSpan]
  );
  const reset = useCallback(() => setStored({ key: resetKey, range: null }), [resetKey]);

  return { full, view, shown: view ?? full, minSpan, set, reset };
};
