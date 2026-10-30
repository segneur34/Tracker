import { memo, useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import type { SportFamily } from '../core/sportProfiles';
import { useMapBase } from '../hooks/useMapBase';
import { ColoredTrackPath } from './coloredTrackPath';
import { haloStyle } from './mapStyles';

/** Un trait de la trace : deux points consécutifs, ou une suite de points de même couleur (pente), et leur couleur. */
export interface TrackSegment {
  positions: ReadonlyArray<[number, number]>;
  color: string;
}

/**
 * Volet de la trace colorée, sous celui des autres tracés (`overlayPane`,
 * 400) : surbrillances, marqueurs et manœuvres restent au-dessus d'elle.
 */
const TRACE_PANE = 'trace';
const TRACE_PANE_Z_INDEX = '390';

/**
 * Trace colorée d'une carte, sur un canevas à elle, en une seule couche
 * (`ColoredTrackPath`) : une trace de 3 h à 5 Hz compte 54 000 traits, trop
 * pour autant d'éléments SVG, de composants React ou de couches Leaflet. Les
 * traits ne captent ni clic ni survol. Seul un nouveau tableau `segments`
 * (autre trace, autres bornes de couleur) les redessine : l'appelant le
 * mémorise, et un rendu de la page (survol d'un graphe, surbrillance) ne
 * touche pas à la trace. Le reste de la carte reste en SVG, par react-leaflet.
 *
 * Sur le fond satellite de `family` (`useMapBase`), un liseré blanc sous les
 * traits (`haloStyle`), d'un seul tracé : la trace reste lisible sur la mer,
 * la forêt ou les toits. Sans famille (vignettes de la bibliothèque), le plan,
 * sans liseré.
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
    const track = new ColoredTrackPath(segments, { weight, halo: halo ? haloStyle(weight) : null, renderer });
    // Rien à dessiner : ni couche ni canevas.
    if (track.isEmpty()) return undefined;
    track.addTo(map);
    return () => {
      track.remove();
      renderer.remove();
    };
  }, [map, segments, weight, halo]);
  return null;
}

export default memo(TrackSegmentsLayer);
