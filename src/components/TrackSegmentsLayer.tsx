import { memo, useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { SportFamily } from '../core/sportProfiles';
import { useMapBase } from '../hooks/useMapBase';

/** Un trait de la trace : deux points consécutifs et leur couleur. */
export interface TrackSegment {
  positions: [[number, number], [number, number]];
  color: string;
}

/**
 * Volet de la trace colorée, sous celui des autres tracés (`overlayPane`,
 * 400) : surbrillances, marqueurs et manœuvres restent au-dessus d'elle.
 */
const TRACE_PANE = 'trace';
const TRACE_PANE_Z_INDEX = '390';

/** Liseré de la trace sur le fond satellite (donnée de carte, donc en dur). */
const HALO_COLOR = '#ffffff';

/**
 * Trace colorée d'une carte, un trait par paire de points, dessinée sur un
 * canevas à elle : une trace de 3 h à 1 Hz compte près de 11 000 traits, trop
 * pour autant d'éléments SVG et de composants React. Les traits ne captent ni
 * clic ni survol. Seul un nouveau tableau `segments` (autre trace, autres
 * bornes de couleur) les redessine : l'appelant le mémorise, et un rendu de la
 * page (survol d'un graphe, surbrillance) ne touche pas à la trace. Le reste
 * de la carte reste en SVG, par react-leaflet.
 *
 * Sur le fond satellite de `family` (`useMapBase`), un liseré blanc sous les
 * traits, d'un seul tracé : la trace reste lisible sur la mer, la forêt ou
 * les toits. Sans famille (vignettes de la bibliothèque), le plan, sans liseré.
 */
function TrackSegmentsLayer({ segments, weight, family }: {
  segments: ReadonlyArray<TrackSegment>;
  weight: number;
  family?: SportFamily;
}) {
  const map = useMap();
  const halo = useMapBase(family ?? null)[0] === 'satellite';
  useEffect(() => {
    if (!map.getPane(TRACE_PANE)) map.createPane(TRACE_PANE).style.zIndex = TRACE_PANE_Z_INDEX;
    const renderer = L.canvas({ pane: TRACE_PANE });
    const lines = segments.map((s) => L.polyline(s.positions, { color: s.color, weight, renderer, interactive: false }));
    const under = halo && segments.length > 0
      ? [L.polyline(segments.map((s) => s.positions), { color: HALO_COLOR, weight: weight + 3, opacity: 0.85, renderer, interactive: false })]
      : [];
    const group = L.layerGroup([...under, ...lines]).addTo(map);
    return () => {
      group.remove();
      renderer.remove();
    };
  }, [map, segments, weight, halo]);
  return null;
}

export default memo(TrackSegmentsLayer);
