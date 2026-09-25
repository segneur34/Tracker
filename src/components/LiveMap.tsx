import { useEffect, useMemo, useRef, useState } from 'react';
import { divIcon, type Marker as LeafletMarker } from 'leaflet';
import { trackBounds } from '../core/displayConfig';
import { CircleMarker, MapContainer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { useCompassHeading } from '../hooks/useCompassHeading';
import type { LocationFix } from '../platform/location';
import { displayHeading, type TravelHeading } from '../recording/heading';
import OsmTileLayer from './OsmTileLayer';
import MapAutoResize from './MapAutoResize';
import Button from './ui/Button';

interface LiveMapProps {
  /** Trace enregistrée, un tableau par segment continu : une pause coupe le trait. */
  segments: LocationFix[][];
  /** Position du moment, suivie par la carte. */
  position: LocationFix | null;
  /** Couleur de la trace, celle de la famille du support. */
  color: string;
  height: string;
  /** Trace suivie, ce qu'il en reste : en pointillé sous la trace en cours. */
  guide?: ReadonlyArray<{ lat: number; lon: number }>;
  /** Partie déjà faite de la trace suivie, en gris. */
  guideDone?: ReadonlyArray<{ lat: number; lon: number }>;
  /** Cap de la marche, pour orienter la flèche de position. */
  travel?: TravelHeading;
}

/** Couleurs de la trace suivie, reste et partie faite (données de carte, donc en dur). */
const GUIDE_STYLE = { color: '#37474f', weight: 5, opacity: 0.6, dashArray: '8 8', interactive: false } as const;
const GUIDE_DONE_STYLE = { color: '#9e9e9e', weight: 4, opacity: 0.5, interactive: false } as const;

const ARROW_SIZE = 30;

/** Flèche de position, pointe vers le haut, tournée ensuite au cap. */
const arrowIcon = (color: string) => divIcon({
  className: '',
  iconSize: [ARROW_SIZE, ARROW_SIZE],
  iconAnchor: [ARROW_SIZE / 2, ARROW_SIZE / 2],
  html: `<svg class="live-arrow" width="${ARROW_SIZE}" height="${ARROW_SIZE}" viewBox="0 0 30 30" style="display:block">`
    + `<path d="M15 2 L26 27 L15 21 L4 27 Z" fill="${color}" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
});

/**
 * Position du moment : une flèche au cap affiché (marche, ou boussole à
 * l'arrêt), le rond sans cap connu. La flèche est tournée directement dans le
 * DOM, pour ne pas recréer l'icône à chaque mesure de la boussole.
 */
function PositionMarker({ position, color, travel }: { position: LocationFix; color: string; travel?: TravelHeading }) {
  const compass = useCompassHeading(true);
  const heading = travel ? displayHeading(travel, compass) : null;
  const icon = useMemo(() => arrowIcon(color), [color]);
  const marker = useRef<LeafletMarker>(null);
  useEffect(() => {
    const arrow = marker.current?.getElement()?.querySelector<SVGElement>('.live-arrow');
    if (arrow && heading !== null) arrow.style.transform = `rotate(${heading}deg)`;
  }, [heading, icon]);

  if (heading === null) {
    return (
      <CircleMarker center={[position.lat, position.lon]} radius={8}
        pathOptions={{ color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1 }} />
    );
  }
  return <Marker ref={marker} position={[position.lat, position.lon]} icon={icon} interactive={false} keyboard={false} />;
}

/** Recentre la carte sur la position tant que l'utilisateur ne l'a pas déplacée à la main. */
function FollowPosition({ position, following, onUserMove }: {
  position: LocationFix | null;
  following: boolean;
  onUserMove: () => void;
}) {
  const map = useMap();
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (following && position) map.panTo([position.lat, position.lon], { animate: false });
  }, [map, following, position]);
  return null;
}

/**
 * Carte de l'enregistrement en cours : la trace d'une seule couleur (un
 * dégradé demanderait un trait par point, trop lourd à redessiner) et la
 * position du moment (une flèche au cap, `PositionMarker`), et la trace
 * suivie s'il y en a une, la partie faite en gris. Sans position ni
 * trace, la carte s'ouvre cadrée sur la trace suivie. Sans réseau, le fond
 * manque mais traces et position restent.
 */
function LiveMap({ segments, position, color, height, guide, guideDone, travel }: LiveMapProps) {
  const [following, setFollowing] = useState(true);
  const start = position ?? segments[0]?.[0] ?? null;
  const guideBounds = !start && guide && guide.length > 1 ? trackBounds(guide) : null;
  if (!start && !guideBounds) return null;

  return (
    <div style={{ position: 'relative', height, borderRadius: 'var(--radius-m)', overflow: 'hidden', border: '1px solid var(--line-strong)', zIndex: 0 }}>
      <MapContainer
        {...(start ? { center: [start.lat, start.lon] as [number, number], zoom: 16 } : { bounds: guideBounds!, boundsOptions: { padding: [24, 24] } })}
        style={{ height: '100%', width: '100%' }}>
        <MapAutoResize />
        <OsmTileLayer />
        {guideDone && guideDone.length > 1 && (
          <Polyline positions={guideDone.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={GUIDE_DONE_STYLE} />
        )}
        {guide && guide.length > 1 && (
          <Polyline positions={guide.map((p) => [p.lat, p.lon] as [number, number])} pathOptions={GUIDE_STYLE} />
        )}
        {segments.map((segment, i) => {
          const positions = segment.map((f) => [f.lat, f.lon] as [number, number]);
          // Le dernier segment, recalculé moins souvent que la position, est prolongé jusqu'à elle.
          if (i === segments.length - 1 && position) positions.push([position.lat, position.lon]);
          return <Polyline key={i} positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />;
        })}
        {position && <PositionMarker position={position} color={color} travel={travel} />}
        <FollowPosition position={position} following={following} onUserMove={() => setFollowing(false)} />
      </MapContainer>
      {!following && (
        <Button variant="secondary" onClick={() => setFollowing(true)}
          style={{ position: 'absolute', right: 'var(--space-3)', bottom: 'var(--space-3)', zIndex: 1000 }}>
          Recentrer
        </Button>
      )}
    </div>
  );
}

export default LiveMap;
