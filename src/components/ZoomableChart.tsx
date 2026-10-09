import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type MouseEvent, type ReactNode, type TouchEvent,
} from 'react';
import { usePlotArea } from 'recharts';
import { pinchRange, pxSelectionRange, type XRange } from '../core/chartZoom';
import type { ChartZoom } from '../hooks/useChartZoom';
import Button from './ui/Button';
import './ZoomableChart.css';

/**
 * Graphe zoomable sur l'axe des abscisses (`useChartZoom`). Sur téléphone,
 * deux doigts : écarter zoome, pincer dézoome, glisser déplace ; un seul
 * doigt garde le survol, qui déplace le repère sur la carte. Sur ordinateur,
 * tirer une zone à la souris zoome dessus ; un double-clic revient à tout
 * voir, comme le bouton « Tout voir » qui paraît une fois zoomé. La souris
 * qui sort du graphe appelle `onLeave`, qui efface le repère ; au doigt, il
 * reste où on l'a laissé.
 *
 * Le graphe Recharts va dedans, avec `ChartZoomProbe` parmi ses enfants :
 * elle lit la zone de tracé (`usePlotArea`), qui convertit les positions à
 * l'écran en valeurs de l'axe. `touch-action: pan-y` laisse défiler la page
 * d'un doigt, mais empêche le navigateur de zoomer la page à deux doigts.
 */

interface PlotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PlotAreaContext = createContext<((area: PlotArea | null) => void) | null>(null);

/** À placer dans le graphe : transmet sa zone de tracé à `ZoomableChart`. Ne dessine rien. */
export function ChartZoomProbe() {
  const area = usePlotArea();
  const report = useContext(PlotAreaContext);
  const x = area?.x;
  const y = area?.y;
  const width = area?.width;
  const height = area?.height;
  useLayoutEffect(() => {
    report?.(x !== undefined && y !== undefined && width !== undefined && height !== undefined ? { x, y, width, height } : null);
  }, [report, x, y, width, height]);
  return null;
}

/** Écart minimal, en pixels, d'une sélection à la souris : en deçà, c'est un clic. */
const MIN_SELECTION_PX = 8;

interface Pinch {
  ids: [number, number];
  startPx: [number, number];
  start: XRange;
}

function ZoomableChart({ zoom, showReset = true, onLeave, className, style, children }: {
  zoom: ChartZoom;
  /** Souris sortie du graphe. */
  onLeave?: () => void;
  /** Bouton « Tout voir » sur ce graphe ; à retirer sur le second de deux graphes superposés. */
  showReset?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<PlotArea | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<XRange | null>(null);
  /** Sélection à la souris, en pixels de la zone de tracé, avec la zone lue au début. */
  const [drag, setDrag] = useState<{ from: number; to: number; area: PlotArea } | null>(null);
  const reportPlot = useCallback((area: PlotArea | null) => {
    plot.current = area;
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  /** Position horizontale depuis le bord gauche de la zone de tracé, en pixels. */
  const plotPx = (clientX: number): number | null => {
    const rect = box.current?.getBoundingClientRect();
    return rect && plot.current ? clientX - rect.left - plot.current.x : null;
  };

  /** Une mise à jour par image au plus : le graphe se recalcule à chaque changement de plage. */
  const schedule = (next: XRange | null) => {
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      zoom.set(pending.current);
    });
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !zoom.shown) {
      if (e.touches.length > 2) pinch.current = null;
      return;
    }
    const a = plotPx(e.touches[0].clientX);
    const b = plotPx(e.touches[1].clientX);
    if (a === null || b === null) return;
    pinch.current = { ids: [e.touches[0].identifier, e.touches[1].identifier], startPx: [a, b], start: zoom.shown };
  };

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const p = pinch.current;
    if (!p || !zoom.full || !plot.current) return;
    const touches = Array.from(e.touches);
    const first = touches.find((t) => t.identifier === p.ids[0]);
    const second = touches.find((t) => t.identifier === p.ids[1]);
    if (!first || !second) return;
    const a = plotPx(first.clientX);
    const b = plotPx(second.clientX);
    if (a === null || b === null) return;
    schedule(pinchRange(p.start, p.startPx, [a, b], plot.current.width, zoom.full, zoom.minSpan));
  };

  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length < 2) pinch.current = null;
  };

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !zoom.shown || (e.target as HTMLElement).closest('button')) return;
    const px = plotPx(e.clientX);
    if (px !== null && plot.current) setDrag({ from: px, to: px, area: plot.current });
  };

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!drag) return;
    const px = plotPx(e.clientX);
    if (px !== null) setDrag({ ...drag, to: px });
  };

  const onMouseUp = () => {
    if (drag && zoom.shown && Math.abs(drag.to - drag.from) >= MIN_SELECTION_PX) {
      zoom.set(pxSelectionRange(drag.from, drag.to, zoom.shown, drag.area.width));
    }
    setDrag(null);
  };

  const selection = drag ? (() => {
    const { area } = drag;
    const lo = Math.max(0, Math.min(drag.from, drag.to));
    const hi = Math.min(area.width, Math.max(drag.from, drag.to));
    return { left: area.x + lo, width: Math.max(0, hi - lo), top: area.y, height: area.height };
  })() : null;

  return (
    <div
      ref={box}
      className={['zoom-chart', className].filter(Boolean).join(' ')}
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setDrag(null);
        onLeave?.();
      }}
      onDoubleClick={() => zoom.reset()}>
      <PlotAreaContext.Provider value={reportPlot}>{children}</PlotAreaContext.Provider>
      {selection && <div className="zoom-chart__selection" style={selection} />}
      {showReset && zoom.view && (
        <Button size="s" className="zoom-chart__reset" onClick={zoom.reset}>Tout voir</Button>
      )}
    </div>
  );
}

export default ZoomableChart;
