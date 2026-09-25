import { useState, type CSSProperties, type ComponentProps, type ReactNode } from 'react';
import { MapContainer } from 'react-leaflet';
import { DEFAULT_MAP_CENTER, type TrackBounds } from '../core/displayConfig';
import { NARROW_QUERY } from '../hooks/useNarrowScreen';
import MapAutoResize from './MapAutoResize';
import ResizablePanel from './ResizablePanel';
import SpeedGradientLegend from './SpeedGradientLegend';

interface AnalysisMapProps {
  /** Identifiant du bloc redimensionnable, clé de sa taille mémorisée : ne pas le renommer. */
  panelId: string;
  /** Ancre HTML du bloc, cible des boutons qui ramènent à la carte. */
  anchorId?: string;
  /** Identité de la trace chargée : une nouvelle trace remonte la carte. */
  sessionKey: string | null;
  /** Emprise de la trace, où la carte se cadre à l'ouverture ; `null` sans trace. */
  bounds: TrackBounds | null;
  /** Couches propres au module (fond, trace, repères), rendues dans la carte et dans sa vue agrandie. */
  layers: ReactNode;
  /** Légende de la couleur de la trace, sous la carte ; `null` sans trace. */
  legend: ComponentProps<typeof SpeedGradientLegend> | null;
  /** Hauteur par défaut du bloc, légende comprise. */
  defaultHeight: number;
  /** Place du bloc dans sa rangée, sur ordinateur (60 % de large). */
  style?: CSSProperties;
}

/** Cadrage initial : sur la trace s'il y en a une, sinon sur le centre par défaut. */
const initialView = (bounds: TrackBounds | null) =>
  bounds
    ? { bounds, boundsOptions: { padding: [24, 24] as [number, number], maxZoom: 18 } }
    : { center: DEFAULT_MAP_CENTER, zoom: 14 };

/**
 * Carte d'une page d'analyse et sa légende, collée dessous. Sur ordinateur,
 * un bloc redimensionnable ; sur téléphone, pleine largeur en tête de page,
 * et un toucher l'ouvre en plein écran. Commune à tous les modules
 * (`docs/MISE_EN_PAGE.md`).
 */
function AnalysisMap({ panelId, anchorId, sessionKey, bounds, layers, legend, defaultHeight, style }: AnalysisMapProps) {
  /** Carte agrandie en plein écran (toucher sur la carte compacte, écran étroit seulement). */
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <ResizablePanel id={panelId} anchorId={anchorId} defaultHeight={defaultHeight} minHeight={240}
        className="an-map-panel"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 0, ...style }}>
        <div
          className="an-map-frame"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.leaflet-control')) return;
            if (window.matchMedia(NARROW_QUERY).matches) setExpanded(true);
          }}
          style={{ flex: '1 1 auto', minHeight: 0, overflow: 'hidden', borderRadius: '8px', border: '1px solid var(--line-strong)' }}>
          <MapContainer key={sessionKey ?? 'empty'} {...initialView(bounds)} style={{ height: '100%', width: '100%' }}>
            <MapAutoResize />
            {layers}
          </MapContainer>
        </div>
        {legend && (
          <div style={{ flexShrink: 0 }}>
            <SpeedGradientLegend {...legend} />
          </div>
        )}
      </ResizablePanel>

      {expanded && (
        <div className="an-map-overlay" onClick={() => setExpanded(false)}>
          <button type="button" className="an-map-overlay__close" onClick={() => setExpanded(false)} aria-label="Fermer la carte">×</button>
          <div className="an-map-overlay__map" onClick={(e) => e.stopPropagation()}>
            <MapContainer key={`expanded-${sessionKey ?? 'empty'}`} {...initialView(bounds)} style={{ height: '100%', width: '100%' }}>
              <MapAutoResize />
              {layers}
            </MapContainer>
          </div>
        </div>
      )}
    </>
  );
}

export default AnalysisMap;
