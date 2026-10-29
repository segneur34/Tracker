import type { ReactNode } from 'react';
import { Polyline } from 'react-leaflet';
import type { LocatedMark } from '../core/sessionMarks';
import type { SportFamily } from '../core/sportProfiles';
import BaseTileLayer from './BaseTileLayer';
import { HoveredTrackMarker } from './HoverMarker';
import { SessionMarksLayer } from './SessionMarks';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';

/** Style des tronçons montrés en violet : zone cardiaque, partie vue d'un graphe zoomé. */
const SHOWN_PATH_OPTIONS = { color: HIGHLIGHT_SHOWN_COLOR, weight: 10, opacity: 0.8 };

/**
 * Couches de la carte communes aux analyses (voile, course, vélo, fractionné,
 * surf), dans leur ordre de pose, qui fait le dessus et le dessous : le fond
 * de carte, puis celles du sport (`children` : trace colorée, surbrillances
 * propres), la zone cardiaque montrée, le tronçon du graphe zoomé, les
 * fanions des repères et le point survolé des graphes, au-dessus de tout.
 */
function AnalysisBaseLayers({ family, track, zonePaths, zonePathsKey, zoomPath, marks, shownMark, children }: {
  family: SportFamily;
  /** Points de la trace : le point survolé des graphes s'y lit. */
  track: ReadonlyArray<{ lat: number; lon: number }>;
  /** Passages de la zone cardiaque montrée (onglet « cardio »), vides sinon. */
  zonePaths: [number, number][][];
  /** Zone montrée : change la clé de ses tracés. */
  zonePathsKey: number | null;
  /** Partie vue du graphe zoomé (`useZoomOnMap`), vide sinon. */
  zoomPath: [number, number][];
  marks: ReadonlyArray<Pick<LocatedMark, 'mark' | 'n'>>;
  shownMark: number | null;
  children?: ReactNode;
}) {
  return (
    <>
      <BaseTileLayer family={family} />
      {children}
      {zonePaths.map((path, idx) => (
        <Polyline key={`cardio-${zonePathsKey}-${idx}`} positions={path} pathOptions={SHOWN_PATH_OPTIONS} />
      ))}
      {zoomPath.length > 1 && <Polyline key="zoom" positions={zoomPath} pathOptions={SHOWN_PATH_OPTIONS} />}
      <SessionMarksLayer located={marks} shownMs={shownMark} />
      <HoveredTrackMarker points={track} />
    </>
  );
}

export default AnalysisBaseLayers;
