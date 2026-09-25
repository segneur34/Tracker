import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { LocationFix } from '../platform/location';
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
 * position du moment. Sans réseau, le fond manque mais trace et position
 * restent.
 */
function LiveMap({ segments, position, color, height }: LiveMapProps) {
  const [following, setFollowing] = useState(true);
  const start = position ?? segments[0]?.[0] ?? null;
  if (!start) return null;

  return (
    <div style={{ position: 'relative', height, borderRadius: 'var(--radius-m)', overflow: 'hidden', border: '1px solid var(--line-strong)', zIndex: 0 }}>
      <MapContainer center={[start.lat, start.lon]} zoom={16} style={{ height: '100%', width: '100%' }}>
        <MapAutoResize />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {segments.map((segment, i) => {
          const positions = segment.map((f) => [f.lat, f.lon] as [number, number]);
          // Le dernier segment, recalculé moins souvent que la position, est prolongé jusqu'à elle.
          if (i === segments.length - 1 && position) positions.push([position.lat, position.lon]);
          return <Polyline key={i} positions={positions} pathOptions={{ color, weight: 4, opacity: 0.9 }} />;
        })}
        {position && (
          <CircleMarker center={[position.lat, position.lon]} radius={8}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1 }} />
        )}
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
