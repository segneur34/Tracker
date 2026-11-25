import { useMemo } from 'react';
import HighlightSpan from './HighlightSpan';

/** Un passage de la trace à montrer : vague, vol ou remontée, entre deux index de points. */
export interface TrackSpanShown {
  key: string;
  start: number;
  end: number;
  color: string;
  /** Texte de la bulle du point de départ. */
  label: string;
  /**
   * Tête du passage dans une autre couleur, de `start` à l'index `end` de la
   * trace (le départ d'une vague montrée seule) ; le point de départ la prend.
   */
  lead?: { end: number; color: string };
}

/**
 * Passages d'une trace sur la carte, en surf (vague, vol, série de pumping,
 * remontée) et en voile (vol ou série du pumping, `pumpingHighlight.ts`) :
 * celui choisi en violet, ou un podium aux couleurs des
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
        const lead = span.lead && span.lead.end > span.start ? { end: span.lead.end - span.start, color: span.lead.color } : undefined;
        return (
          <HighlightSpan key={span.key} path={path} start={[first.lat, first.lon]} color={span.color} lead={lead}>{span.label}</HighlightSpan>
        );
      })}
    </>
  ), [track, spans]);
}

export default TrackSpanLayer;
