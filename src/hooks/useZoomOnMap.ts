import { useMemo, useState } from 'react';
import { axisRangePath, type XRange } from '../core/chartZoom';
import { trackBounds, type TrackBounds } from '../core/displayConfig';
import type { ChartZoom } from './useChartZoom';
import type { MapHighlight } from './useMapHighlight';

/** Demande de cadrage de la carte (`AnalysisMap`, prop `focus`) : un objet neuf à chaque demande. */
export interface MapFocus {
  bounds: TrackBounds;
}

/** Graphe d'un onglet : son zoom, et la valeur de son axe en chaque point de la trace (distance affichée, minutes). */
export interface ZoomedChart {
  zoom: ChartZoom;
  axis: ArrayLike<number>;
}

export interface ZoomOnMap<P extends string> {
  /** Tronçon montré en violet : la partie vue du graphe montré (plage zoomée, ou toute la trace), vide sinon. */
  path: [number, number][];
  /** Dernier cadrage demandé, tant que le tronçon est montré. */
  focus: MapFocus | null;
  /** « +carte » ou « Afficher » du graphe de `panel` ; un second clic sur la même plage retire le tronçon. */
  show: (panel: P) => void;
  /** Onglet dont les graphes accompagnent la carte en plein écran (téléphone), sinon `null`. */
  companionPanel: P | null;
  /** À la fermeture du plein écran : la carte agrandie redevient seule. */
  closeCompanion: () => void;
}

/**
 * Partie d'un graphe vue sur la carte, dans les trois modules (23/10, revu
 * le 25/10). « Afficher » (ordinateur, et plein écran carte + graphes du
 * téléphone) allume en violet la partie vue du graphe, surbrillance unique de
 * son onglet (`MapHighlight.showZoom`) : la plage zoomée, ou toute la trace
 * s'il n'est pas zoomé ; le tronçon suit ensuite le zoom. Montré zoomé, il
 * s'efface quand le zoom revient à tout voir (« Tout voir », pincement, autre
 * session), sans revenir au zoom suivant ; montré entier, il revient à toute
 * la trace. Le bouton cadre la carte sur le tronçon ; un second clic sur la
 * même plage le retire, le zoom et le plein écran restent. Sur ordinateur, la
 * page remonte juste assez pour montrer la carte si elle n'est pas entière à
 * l'écran. Dans la page du téléphone, « +carte » ouvre la carte en plein
 * écran avec les graphes de l'onglet dessous (`companionPanel`), sur toute la
 * trace ; zoomé, il allume aussi le tronçon, et une carte entière à l'écran
 * (tout replié) se cadre sur place. Le retour d'Android referme le plein
 * écran (`AnalysisMap`).
 */
export const useZoomOnMap = <P extends string>({ highlight, points, charts, narrow, mapAnchorId, mapExpanded, openMap }: {
  highlight: MapHighlight<P>;
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
  const view = chart?.zoom.view ?? null;
  // Montré zoomé, zoom revenu à tout voir : le tronçon s'efface pendant ce rendu, comme dans `useMapHighlight`.
  if (panel !== null && view === null && !whole) highlight.show(panel, null);
  const range = view ?? (whole ? chart?.zoom.full ?? null : null);
  const axis = chart?.axis;
  const path = useMemo(
    () => (range && axis ? axisRangePath(points, axis, range) : []),
    [range, axis, points]
  );

  const show = (target: P) => {
    const c = charts[target];
    if (!c) return;
    const inPage = narrow && !mapExpanded;
    // Graphe entier, dans la page du téléphone : carte et graphes de l'onglet ensemble, sur toute la trace, sans tronçon.
    if (!c.zoom.view && inPage) {
      setCompanionPanel(target);
      openMap();
      return;
    }
    const shown = c.zoom.view ?? c.zoom.full;
    if (!shown) return;
    const isWhole = c.zoom.view === null;
    // Second clic sur la même plage : le tronçon se retire.
    if (panel === target && focus && focus.whole === isWhole && focus.range.min === shown.min && focus.range.max === shown.max) {
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
    const anchor = document.getElementById(mapAnchorId);
    const rect = anchor?.getBoundingClientRect();
    // Sa marge de défilement réserve la barre du haut, qui colle sur ordinateur et cache ce qui passe dessous.
    const topInset = anchor ? parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0 : 0;
    const onScreen = !rect || (rect.top >= topInset && rect.bottom <= window.innerHeight);
    if (onScreen) return;
    if (narrow) {
      setCompanionPanel(target);
      openMap();
    } else {
      anchor?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  };

  return {
    path: panel !== null ? path : [],
    focus: panel !== null ? focus : null,
    show,
    companionPanel: mapExpanded ? companionPanel : null,
    closeCompanion: () => setCompanionPanel(null),
  };
};
