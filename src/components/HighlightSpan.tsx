import type { ReactNode } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import HighlightPath from './HighlightPath';
import { HIGHLIGHT_SPAN_OPACITY, highlightDotOptions } from './highlightColors';

/**
 * Passage de la trace montré sur la carte, avec son point de départ : saut,
 * vague, vol ou remontée. Un trait de surbrillance sur `path`, un point plein
 * en `start`, et sa bulle (`children`). Poser une `key` à chaque passage.
 */
export default function HighlightSpan({ path, start, color, children }: {
  path: [number, number][];
  start: [number, number];
  color: string;
  children: ReactNode;
}) {
  return (
    <>
      <HighlightPath positions={path} color={color} opacity={HIGHLIGHT_SPAN_OPACITY} />
      <CircleMarker center={start} radius={7} pathOptions={highlightDotOptions(color)}>
        <Popup>{children}</Popup>
      </CircleMarker>
    </>
  );
}
