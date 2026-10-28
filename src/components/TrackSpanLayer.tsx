import { useMemo } from 'react';
import { CircleMarker, Polyline, Popup } from 'react-leaflet';

/** Un passage de la trace à montrer : vague, vol ou remontée, entre deux index de points. */
export interface TrackSpanShown {
  key: string;
  start: number;
  end: number;
  color: string;
  /** Texte de la bulle du point de départ. */
  label: string;
}

/**
 * Passages d'une trace sur la carte, en surf (vague, vol, remontée) et en voile
 * (vol du pumping) : celui choisi en violet, ou un podium aux couleurs des
 * tops ; un trait sur la trace et un point au départ, comme les sauts
 * (`JumpMapLayer`). Les index sont ceux de la trace dessinée.
 */
function TrackSpanLayer({ track, spans }: {
  track: ReadonlyArray<{ lat: number; lon: number }>;
  spans: TrackSpanShown[];
}) {
  return useMemo(() => (
    <>
      {spans.map((span) => {
        const path = track.slice(span.start, span.end + 1).map((p) => [p.lat, p.lon] as [number, number]);
        const first = track[span.start];
        if (path.length < 2 || !first) return null;
        return (
          <span key={span.key}>
            <Polyline positions={path} pathOptions={{ color: span.color, weight: 10, opacity: 0.85 }} />
            <CircleMarker center={[first.lat, first.lon]} radius={7} pathOptions={{ color: span.color, fillColor: span.color, fillOpacity: 1, weight: 2 }}>
              <Popup>{span.label}</Popup>
            </CircleMarker>
          </span>
        );
      })}
    </>
  ), [track, spans]);
}

export default TrackSpanLayer;
