import { useMemo, type ReactNode } from 'react';
import { axisRangePath, zoomPathRange } from '../core/chartZoom';
import type { LocatedMark } from '../core/sessionMarks';
import type { SportFamily } from '../core/sportProfiles';
import { useZoomState } from '../hooks/useChartZoom';
import { MapBaseSessionContext } from '../hooks/useMapBase';
import type { ZoomPathSource } from '../hooks/useZoomOnMap';
import BaseTileLayer from './BaseTileLayer';
import { HoveredTrackMarker } from './HoverMarker';
import { SessionMarksLayer } from './SessionMarks';
import HighlightPath from './HighlightPath';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';

/**
 * Tronçon du graphe montré, en violet : il suit le zoom de ce graphe (§2,
 * « le violet suit le zoom ») en ne redessinant que lui, pas le module ni
 * ses autres couches (lot 127).
 */
function ZoomPathLayer({ source }: { source: ZoomPathSource }) {
  const { view, full } = useZoomState(source.zoom);
  const range = zoomPathRange(view, full, source.whole);
  const { points, axis } = source;
  const path = useMemo(() => (range ? axisRangePath(points, axis, range) : []), [range, points, axis]);
  return path.length > 1 ? <HighlightPath positions={path} color={HIGHLIGHT_SHOWN_COLOR} /> : null;
}

/**
 * Couches de la carte communes aux analyses (voile, course, vélo, fractionné,
 * surf), dans leur ordre de pose, qui fait le dessus et le dessous : le fond
 * de carte, puis celles du sport (`children` : trace colorée, surbrillances
 * propres), la zone cardiaque montrée, le tronçon du graphe zoomé, les
 * fanions des repères et le point survolé des graphes, au-dessus de tout.
 */
function AnalysisBaseLayers({ family, file, track, zonePaths, zonePathsKey, zoomPath, marks, shownMark, children }: {
  family: SportFamily;
  /** Fichier de la session dans la mémoire (`null` : GPX hors de la mémoire) : son fond de carte est celui de sa fiche. */
  file: string | null;
  /** Points de la trace : le point survolé des graphes s'y lit. */
  track: ReadonlyArray<{ lat: number; lon: number }>;
  /** Passages de la zone cardiaque montrée (onglet « cardio »), vides sinon. */
  zonePaths: [number, number][][];
  /** Zone montrée : change la clé de ses tracés. */
  zonePathsKey: number | null;
  /** Partie vue du graphe montré (`useZoomOnMap`), `null` sinon. */
  zoomPath: ZoomPathSource | null;
  marks: ReadonlyArray<Pick<LocatedMark, 'mark' | 'n'>>;
  shownMark: number | null;
  children?: ReactNode;
}) {
  return (
    <MapBaseSessionContext.Provider value={file}>
      <BaseTileLayer family={family} />
      {children}
      {zonePaths.map((path, idx) => (
        <HighlightPath key={`cardio-${zonePathsKey}-${idx}`} positions={path} color={HIGHLIGHT_SHOWN_COLOR} />
      ))}
      {zoomPath && <ZoomPathLayer source={zoomPath} />}
      <SessionMarksLayer located={marks} shownMs={shownMark} />
      <HoveredTrackMarker points={track} />
    </MapBaseSessionContext.Provider>
  );
}

export default AnalysisBaseLayers;
