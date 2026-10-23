import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import { DEFAULT_MAP_CENTER, type TrackBounds } from '../core/displayConfig';
import { NARROW_QUERY } from '../hooks/useNarrowScreen';
import MapAutoResize from './MapAutoResize';
import ResizablePanel from './ResizablePanel';

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
  /**
   * Légende de la couleur de la trace, posée sur la carte : celle de la
   * vitesse (`SpeedGradientLegend`) ou de la pente (`GradeGradientLegend`) ;
   * `null` sans trace, ou quand la trace a d'autres couleurs (revêtement).
   */
  legend: ReactNode | null;
  /** Hauteur par défaut du bloc. */
  defaultHeight: number;
  /** Style propre au module ; la largeur, elle, est commune (`--analysis-map-width`, `analysisMobile.css`). */
  style?: CSSProperties;
  /**
   * Outil posé sur la carte, dans la carte et dans sa vue agrandie (réglage du
   * vent de la voile) : transparent aux gestes hors de ses pièces, marquées
   * `an-map-tool` pour qu'un toucher sur elles n'agrandisse pas la carte.
   */
  overlay?: ReactNode;
  /** Vue agrandie pilotée par le module (téléphone) ; sinon, la carte la tient seule. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

/** Cadrage initial : sur la trace s'il y en a une, sinon sur le centre par défaut. */
const initialView = (bounds: TrackBounds | null) =>
  bounds
    ? { bounds, boundsOptions: { padding: [24, 24] as [number, number], maxZoom: 18 } }
    : { center: DEFAULT_MAP_CENTER, zoom: 14 };

/**
 * Contrôle Leaflet du coin bas droit qui porte `children`. Leaflet place un
 * contrôle du bas avant ceux qui y sont déjà : posé après la mention OSM, il
 * se range à sa gauche, le coin étant mis en ligne par `analysisMobile.css`
 * (`.an-map-corner`).
 */
function MapCornerControl({ children }: { children: ReactNode }) {
  const map = useMap();
  const [container] = useState(() => L.DomUtil.create('div', 'an-map-legend'));
  useEffect(() => {
    const control = new L.Control({ position: 'bottomright' });
    control.onAdd = () => container;
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, container]);
  return createPortal(children, container);
}

/**
 * Carte d'une page d'analyse, avec sa légende de couleur posée dessus, en bas
 * à droite, à gauche de la mention OSM. Sur ordinateur, en haut de la page,
 * centrée, plus étroite que la page et redimensionnable en hauteur ; sur
 * téléphone, pleine largeur en tête de page, et un toucher l'ouvre en plein
 * écran. Commune à tous les modules
 * (`docs/MISE_EN_PAGE.md`).
 */
function AnalysisMap({ panelId, anchorId, sessionKey, bounds, layers, legend, defaultHeight, style, overlay, expanded: expandedProp, onExpandedChange }: AnalysisMapProps) {
  /** Carte agrandie en plein écran (toucher sur la carte compacte, écran étroit seulement). */
  const [ownExpanded, setOwnExpanded] = useState(false);
  const expanded = expandedProp ?? ownExpanded;
  const setExpanded = (next: boolean) => {
    if (expandedProp === undefined) setOwnExpanded(next);
    onExpandedChange?.(next);
  };
  const legendControl = legend && <MapCornerControl>{legend}</MapCornerControl>;
  const tools = overlay && <div className="an-map-tools">{overlay}</div>;

  return (
    <>
      {/* En hauteur seulement : la largeur suit la page, et une largeur mémorisée sous l'ancienne disposition est ignorée. */}
      <ResizablePanel id={panelId} anchorId={anchorId} defaultHeight={defaultHeight} minHeight={240} direction="vertical"
        className="an-map-panel"
        style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 0, ...style }}>
        <div
          className="an-map-frame an-map-corner"
          onClick={(e) => {
            if ((e.target as Element).closest('.leaflet-control, .an-map-tool')) return;
            if (window.matchMedia(NARROW_QUERY).matches) setExpanded(true);
          }}
          style={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden', borderRadius: '8px', border: '1px solid var(--line-strong)' }}>
          <MapContainer key={sessionKey ?? 'empty'} {...initialView(bounds)} style={{ height: '100%', width: '100%' }}>
            <MapAutoResize />
            {layers}
            {legendControl}
          </MapContainer>
          {tools}
        </div>
      </ResizablePanel>

      {expanded && (
        <div className="an-map-overlay" onClick={() => setExpanded(false)}>
          <button type="button" className="an-map-overlay__close" onClick={() => setExpanded(false)} aria-label="Fermer la carte">×</button>
          <div className="an-map-overlay__map an-map-corner" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <MapContainer key={`expanded-${sessionKey ?? 'empty'}`} {...initialView(bounds)} style={{ height: '100%', width: '100%' }}>
              <MapAutoResize />
              {layers}
              {legendControl}
            </MapContainer>
            {tools}
          </div>
        </div>
      )}
    </>
  );
}

export default AnalysisMap;
