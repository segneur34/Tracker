import { useMemo, type ReactNode } from 'react';
import Popup from './map/Popup';
import { CircleMarker } from './map/paths';
import HighlightPath from './HighlightPath';
import { HIGHLIGHT_SPAN_OPACITY, highlightDotOptions } from './highlightColors';

/** Tête d'un passage dans une autre couleur : ses points de `path` jusqu'à l'index `end` (le départ d'une vague). */
export interface HighlightLead {
  end: number;
  color: string;
}

/**
 * Passage de la trace montré sur la carte, avec son point de départ : saut,
 * vague, vol ou remontée. Un trait de surbrillance sur `path`, un point plein
 * en `start`, et sa bulle (`children`). Poser une `key` à chaque passage.
 * Avec `lead`, la tête du passage et le point de départ prennent la couleur de
 * `lead`, le reste celle du passage.
 */
export default function HighlightSpan({ path, start, color, lead, children }: {
  path: [number, number][];
  start: [number, number];
  color: string;
  lead?: HighlightLead;
  children: ReactNode;
}) {
  const leadEnd = lead?.end ?? 0;
  const [head, body] = useMemo(() => (
    leadEnd > 0 && leadEnd < path.length ? [path.slice(0, leadEnd + 1), path.slice(leadEnd)] : [null, path]
  ), [path, leadEnd]);
  const dotColor = head && lead ? lead.color : color;
  return (
    <>
      {head && lead && <HighlightPath positions={head} color={lead.color} opacity={HIGHLIGHT_SPAN_OPACITY} />}
      {(head === null || body.length > 1) && <HighlightPath positions={body} color={color} opacity={HIGHLIGHT_SPAN_OPACITY} />}
      <CircleMarker center={start} radius={7} pathOptions={highlightDotOptions(dotColor)}>
        <Popup>{children}</Popup>
      </CircleMarker>
    </>
  );
}
