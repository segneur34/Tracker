import { useMemo, useState } from 'react';
import { axisRangePath } from '../core/chartZoom';
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
  /** Tronçon montré en violet : la plage zoomée en cours du graphe montré, vide sinon. */
  path: [number, number][];
  /** Dernier cadrage demandé, tant que le tronçon est montré. */
  focus: MapFocus | null;
  /** « Sur la carte » du graphe de `panel`. */
  show: (panel: P) => void;
  /** Onglet dont les graphes accompagnent la carte en plein écran (téléphone), sinon `null`. */
  companionPanel: P | null;
  /** À la fermeture du plein écran : la carte agrandie redevient seule. */
  closeCompanion: () => void;
}

/**
 * « Sur la carte » d'un graphe zoomé, dans les trois modules (23/10). Le
 * tronçon de la plage zoomée s'allume, surbrillance unique de son onglet
 * (`MapHighlight.showZoom`), et suit le zoom ; il s'efface quand le zoom
 * revient à tout voir (« Tout voir », pincement, autre session), sans revenir
 * au zoom suivant. Le bouton cadre la carte sur le tronçon. Sur ordinateur,
 * la page remonte juste assez pour montrer la carte si elle n'est pas
 * entière à l'écran. Sur téléphone, une carte entière à l'écran (tout replié)
 * se cadre sur place ; sinon la carte s'ouvre en plein écran avec les
 * graphes de l'onglet dessous (`companionPanel`).
 */
export const useZoomOnMap = <P extends string>({ highlight, points, charts, narrow, mapAnchorId, mapExpanded, openMap }: {
  highlight: MapHighlight<P>;
  points: ReadonlyArray<{ lat: number; lon: number }>;
  /** Graphe zoomable de chaque onglet qui a « Sur la carte ». */
  charts: Partial<Record<P, ZoomedChart>>;
  narrow: boolean;
  /** Ancre du bloc de la carte (`AnalysisMap`, `anchorId`). */
  mapAnchorId: string;
  mapExpanded: boolean;
  /** Ouvre la carte en plein écran. */
  openMap: () => void;
}): ZoomOnMap<P> => {
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [companionPanel, setCompanionPanel] = useState<P | null>(null);
  const panel = highlight.zoomPanel;
  const chart = panel !== null ? charts[panel] : undefined;
  const view = chart?.zoom.view ?? null;
  // Zoom revenu à tout voir : le tronçon s'efface pendant ce rendu, comme dans `useMapHighlight`.
  if (panel !== null && view === null) highlight.show(panel, null);
  const axis = chart?.axis;
  const path = useMemo(
    () => (view && axis ? axisRangePath(points, axis, view) : []),
    [view, axis, points]
  );

  const show = (target: P) => {
    const c = charts[target];
    const range = c?.zoom.view;
    if (!c || !range) return;
    highlight.showZoom(target);
    const bounds = trackBounds(axisRangePath(points, c.axis, range).map(([lat, lon]) => ({ lat, lon })));
    if (!bounds) return;
    setFocus({ bounds });
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
