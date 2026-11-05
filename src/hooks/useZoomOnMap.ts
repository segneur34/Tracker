import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { axisRangePath, type XRange } from '../core/chartZoom';
import { trackBounds, type TrackBounds } from '../core/displayConfig';
import { currentZoomView, type ChartZoomSource } from './useChartZoom';
import type { HighlightKeys, MapHighlight } from './useMapHighlight';

/** Demande de cadrage de la carte (`AnalysisMap`, prop `focus`) : un objet neuf à chaque demande. */
export interface MapFocus {
  bounds: TrackBounds;
}

/** Graphe d'un onglet : son zoom, et la valeur de son axe en chaque point de la trace (distance affichée, minutes). */
export interface ZoomedChart {
  zoom: ChartZoomSource;
  axis: ArrayLike<number>;
}

/**
 * Tronçon montré en violet, à lire par la couche de la carte qui le trace
 * (`AnalysisBaseLayers`) : le zoom du graphe montré, son axe, la trace, et
 * s'il a été montré entier. La couche suit le zoom elle-même (HISTORIQUE, point 272) :
 * zoomer ne redessine pas le module, le tronçon suit quand même.
 */
export interface ZoomPathSource {
  zoom: ChartZoomSource;
  axis: ArrayLike<number>;
  points: ReadonlyArray<{ lat: number; lon: number }>;
  /** Montré sans zoom : sans zoom, le tronçon est toute la trace (`zoomPathRange`). */
  whole: boolean;
}

export interface ZoomOnMap<P extends string> {
  /** Tronçon montré en violet : la partie vue du graphe montré (plage zoomée, ou toute la trace), `null` sinon. */
  path: ZoomPathSource | null;
  /** Dernier cadrage demandé, tant que le tronçon est montré. */
  focus: MapFocus | null;
  /** « +carte » ou « Afficher » du graphe de `panel` ; un second clic sur la même plage retire le tronçon. */
  show: (panel: P) => void;
  /** Onglet dont les graphes accompagnent la carte en plein écran (téléphone), sinon `null`. */
  companionPanel: P | null;
  /** À la fermeture du plein écran : la carte agrandie redevient seule. */
  closeCompanion: () => void;
  /** Ramène la carte à l'écran (ordinateur), sous la barre du haut, si elle n'y est pas entière. */
  scrollToMap: () => void;
}

/**
 * Partie d'un graphe vue sur la carte, dans les trois modules (HISTORIQUE,
 * points 142 et 156). « Afficher » (ordinateur, et plein écran carte + graphes du
 * téléphone) allume en violet la partie vue du graphe, surbrillance unique de
 * son onglet (`MapHighlight.showZoom`) : la plage zoomée, ou toute la trace
 * s'il n'est pas zoomé ; le tronçon suit ensuite le zoom. Montré zoomé, il
 * s'efface quand le zoom revient à tout voir (« Tout voir », pincement, autre
 * session), sans revenir au zoom suivant ; montré entier, il revient à toute
 * la trace. Le bouton cadre la carte sur le tronçon ; un second clic sur la
 * même plage le retire, le zoom et le plein écran restent. Sur ordinateur, la
 * page remonte juste assez pour montrer la carte si elle n'est pas entière à
 * l'écran, et une carte à l'écran se cadre sur place. Dans la page du
 * téléphone, « +carte » ouvre toujours la carte en plein écran avec les
 * graphes de l'onglet dessous (`companionPanel`), zoomé ou non, carte à
 * l'écran ou non (HISTORIQUE, point 275, à la place du cadrage sur place) : sur
 * toute la trace sans zoom ; zoomé, il allume aussi le tronçon et la carte se
 * cadre dessus. Le retour d'Android referme le plein écran (`AnalysisMap`) ;
 * en sortir (`closeCompanion`) retire aussi le tronçon violet, le zoom reste.
 */
export const useZoomOnMap = <P extends string, T extends HighlightKeys<P> = Record<never, never>>({
  highlight, points, charts, narrow, mapAnchorId, mapExpanded, openMap,
}: {
  highlight: MapHighlight<P, T>;
  points: ReadonlyArray<{ lat: number; lon: number }>;
  /** Graphe zoomable de chaque onglet qui a « Afficher ». */
  charts: Partial<Record<P, ZoomedChart>>;
  narrow: boolean;
  /** Ancre du bloc de la carte (`AnalysisMap`, `anchorId`). */
  mapAnchorId: string;
  mapExpanded: boolean;
  /** Ouvre la carte en plein écran. */
  openMap: () => void;
}): ZoomOnMap<P> => {
  /** Dernier cadrage, avec la plage montrée et si elle était le graphe entier. */
  const [focus, setFocus] = useState<(MapFocus & { range: XRange; whole: boolean }) | null>(null);
  const [companionPanel, setCompanionPanel] = useState<P | null>(null);
  const panel = highlight.zoomPanel;
  const chart = panel !== null ? charts[panel] : undefined;
  const whole = focus?.whole === true;
  const zoom = chart?.zoom;
  const axis = chart?.axis;
  const { show: showHighlight } = highlight;
  // Montré zoomé, zoom revenu à tout voir (« Tout voir », pincement, autre session) : le tronçon s'efface.
  // Le zoom est hors de l'état du module : on l'écoute, et seul ce retour redessine le module (HISTORIQUE, point 272).
  useEffect(() => {
    if (panel === null || whole) return;
    const clearWhenWhole = () => {
      if (!zoom || currentZoomView(zoom) === null) showHighlight(panel, null);
    };
    clearWhenWhole();
    return zoom?.subscribe(clearWhenWhole);
  }, [panel, whole, zoom, showHighlight]);
  const path = useMemo(
    (): ZoomPathSource | null => (panel !== null && zoom && axis ? { zoom, axis, points, whole } : null),
    [panel, zoom, axis, points, whole]
  );

  /** Carte entière à l'écran, sous la barre du haut (sa marge de défilement) ? */
  const mapOnScreen = useCallback((): boolean => {
    const anchor = document.getElementById(mapAnchorId);
    const rect = anchor?.getBoundingClientRect();
    // Sa marge de défilement réserve la barre du haut, qui colle sur ordinateur et cache ce qui passe dessous.
    const topInset = anchor ? parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0 : 0;
    return !rect || (rect.top >= topInset && rect.bottom <= window.innerHeight);
  }, [mapAnchorId]);
  const scrollToMap = useCallback(() => {
    if (mapOnScreen()) return;
    document.getElementById(mapAnchorId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [mapOnScreen, mapAnchorId]);

  // Valeurs du dernier rendu, lues par `show` : le rappel reste le même d'un rendu à l'autre.
  const latest = useRef({ charts, narrow, mapExpanded, openMap, panel, focus, highlight, points, companionPanel });
  useLayoutEffect(() => {
    latest.current = { charts, narrow, mapExpanded, openMap, panel, focus, highlight, points, companionPanel };
  });

  const show = useCallback((target: P) => {
    const { charts, narrow, mapExpanded, openMap, panel, focus, highlight, points } = latest.current;
    const c = charts[target];
    if (!c) return;
    const inPage = narrow && !mapExpanded;
    // Plage vue à l'instant du clic : le zoom n'est pas dans l'état du module.
    const view = currentZoomView(c.zoom);
    // Graphe entier, dans la page du téléphone : carte et graphes de l'onglet ensemble, sur toute la trace, sans tronçon.
    if (!view && inPage) {
      setCompanionPanel(target);
      openMap();
      return;
    }
    const shown = view ?? c.zoom.full;
    if (!shown) return;
    const isWhole = view === null;
    // Second clic sur la même plage : le tronçon se retire (pas dans la page du téléphone, où le bouton ouvre le plein écran).
    if (!inPage && panel === target && focus && focus.whole === isWhole && focus.range.min === shown.min && focus.range.max === shown.max) {
      highlight.show(target, null);
      setFocus(null);
      return;
    }
    highlight.showZoom(target);
    const bounds = trackBounds(axisRangePath(points, c.axis, shown).map(([lat, lon]) => ({ lat, lon })));
    if (!bounds) return;
    setFocus({ bounds, range: shown, whole: isWhole });
    // Plein écran déjà ouvert : sa carte se recadre, rien de plus.
    if (mapExpanded) return;
    // Page du téléphone : toujours le plein écran carte + graphes, même carte entière à l'écran (HISTORIQUE, point 275).
    if (inPage) {
      setCompanionPanel(target);
      openMap();
      return;
    }
    scrollToMap();
  }, [scrollToMap]);
  const closeCompanion = useCallback(() => {
    const { companionPanel, panel, highlight } = latest.current;
    // Sortie du plein écran carte + graphes : la trace n'y reste pas colorée (le zoom du graphe, lui, reste).
    if (companionPanel !== null && panel !== null) {
      highlight.show(panel, null);
      setFocus(null);
    }
    setCompanionPanel(null);
  }, []);

  const shownFocus = panel !== null ? focus : null;
  const shownCompanion = mapExpanded ? companionPanel : null;
  return useMemo(
    () => ({ path, focus: shownFocus, show, scrollToMap, companionPanel: shownCompanion, closeCompanion }),
    [path, shownFocus, show, scrollToMap, shownCompanion, closeCompanion]
  );
};
