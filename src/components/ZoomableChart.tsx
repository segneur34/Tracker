import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type MouseEvent, type ReactNode, type TouchEvent,
} from 'react';
import { usePlotArea } from 'recharts';
import { pinchRange, pxSelectionRange, zoomAtRange, type XRange } from '../core/chartZoom';
import { CHART_TAP_ZOOM_FACTOR } from '../core/displayConfig';
import type { ChartZoom } from '../hooks/useChartZoom';
import { useNarrowScreen } from '../hooks/useNarrowScreen';
import { MapOverlayContext } from './mapOverlayContext';
import Button from './ui/Button';
import { SPEED_COLOR } from './chartStyle';
import './ZoomableChart.css';

/**
 * Graphe zoomable sur l'axe des abscisses (`useChartZoom`). Sur téléphone,
 * deux doigts : écarter zoome, pincer dézoome, glisser déplace ; un seul
 * doigt garde le survol, qui déplace le repère sur la carte. Sur ordinateur,
 * tirer une zone à la souris zoome dessus. Un double-clic, ou deux touchers
 * rapprochés, zooment ×2 autour du point visé (23/10). Une fois zoomé
 * paraît « Tout voir », qui revient à toute l'étendue. Si le module le branche
 * (`onShowOnMap`), un bouton est toujours là, zoomé ou non, sur la ligne du
 * nom au-dessus du graphe (25/10) : « Afficher », qui montre sur la carte la
 * partie vue du graphe, sur ordinateur et sous la carte en plein écran ;
 * « +carte », qui ouvre carte + graphes, dans la page du téléphone. La souris
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

/** Toucher bref : moins de 300 ms, et moins de 10 px de mouvement. */
const TAP_MAX_MS = 300;
const TAP_MAX_MOVE_PX = 10;
/** Double toucher, comme sur Android : le second commence moins de 300 ms après la fin du premier, à moins de 30 px. */
const DOUBLE_TAP_MAX_GAP_MS = 300;
const DOUBLE_TAP_MAX_DISTANCE_PX = 30;
/** Un double-clic qui suit de si près un toucher vient de lui (Android) : il est déjà compté. */
const TOUCH_MOUSE_GUARD_MS = 800;

interface Pinch {
  ids: [number, number];
  startPx: [number, number];
  start: XRange;
}

interface Tap {
  x: number;
  y: number;
  timeMs: number;
}

function ZoomableChart({ zoom, showReset = true, onShowOnMap, onLeave, style, children }: {
  zoom: ChartZoom;
  /** Souris sortie du graphe. */
  onLeave?: () => void;
  /** « Tout voir » sur ce graphe ; à retirer sur les graphes suivants d'une pile au zoom commun. « +carte » reste sur chacun. */
  showReset?: boolean;
  /**
   * « Afficher » ou « +carte », sur la ligne du nom du graphe, collé à
   * droite, zoomé ou non : montre la partie vue sur la carte, ou, dans la page
   * du téléphone, ouvre la carte avec les graphes de l'onglet (25/10).
   */
  onShowOnMap?: () => void;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<PlotArea | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef<XRange | null>(null);
  /** Toucher d'un doigt en cours, tant qu'il peut être bref ; dernier toucher bref ; fin du dernier toucher. */
  const tapStart = useRef<Tap | null>(null);
  const lastTap = useRef<(Tap & { endMs: number }) | null>(null);
  const lastTouchMs = useRef(-Infinity);
  /** Sélection à la souris, en pixels de la zone de tracé, avec la zone lue au début. */
  const [drag, setDrag] = useState<{ from: number; to: number; area: PlotArea } | null>(null);
  const narrow = useNarrowScreen();
  const inOverlay = useContext(MapOverlayContext);
  const openMap = narrow && !inOverlay;
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

  /** Zoom ×2 autour de la position `clientX` (double-clic, double toucher). */
  const zoomAt = (clientX: number) => {
    const px = plotPx(clientX);
    if (px === null || !plot.current || !zoom.shown || !zoom.full) return;
    zoom.set(zoomAtRange(zoom.shown, px, plot.current.width, CHART_TAP_ZOOM_FACTOR, zoom.full, zoom.minSpan));
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const onButton = (e.target as HTMLElement).closest('button') !== null;
    tapStart.current = e.touches.length === 1 && !onButton
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY, timeMs: e.timeStamp }
      : null;
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
    const start = tapStart.current;
    if (start && e.touches.length === 1
      && Math.hypot(e.touches[0].clientX - start.x, e.touches[0].clientY - start.y) > TAP_MAX_MOVE_PX) {
      tapStart.current = null;
    }
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
    if (e.touches.length > 0) return;
    lastTouchMs.current = e.timeStamp;
    const start = tapStart.current;
    tapStart.current = null;
    if (!start || e.timeStamp - start.timeMs > TAP_MAX_MS) return;
    const previous = lastTap.current;
    if (previous && start.timeMs - previous.endMs < DOUBLE_TAP_MAX_GAP_MS
      && Math.hypot(start.x - previous.x, start.y - previous.y) < DOUBLE_TAP_MAX_DISTANCE_PX) {
      lastTap.current = null;
      // Ni clic ni double-clic émulés derrière : le zoom est fait.
      e.preventDefault();
      zoomAt(start.x);
      return;
    }
    lastTap.current = { ...start, endMs: e.timeStamp };
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

  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.timeStamp - lastTouchMs.current < TOUCH_MOUSE_GUARD_MS || (e.target as HTMLElement).closest('button')) return;
    zoomAt(e.clientX);
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
      className="zoom-chart"
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        pinch.current = null;
        tapStart.current = null;
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={() => {
        setDrag(null);
        onLeave?.();
      }}
      onDoubleClick={onDoubleClick}>
      <PlotAreaContext.Provider value={reportPlot}>{children}</PlotAreaContext.Provider>
      {selection && <div className="zoom-chart__selection" style={{ ...selection, '--zoom-selection': SPEED_COLOR } as CSSProperties} />}
      {onShowOnMap && (
        <Button size="s" className="zoom-chart__map" onClick={onShowOnMap}
          aria-label={openMap ? 'Ouvrir la carte et les graphes' : 'Afficher sur la carte'}>{openMap ? '+carte' : 'Afficher'}</Button>
      )}
      {showReset && zoom.view && (
        <div className="zoom-chart__actions">
          <Button size="s" className="zoom-chart__reset" onClick={zoom.reset}>Tout voir</Button>
        </div>
      )}
    </div>
  );
}

export default ZoomableChart;
