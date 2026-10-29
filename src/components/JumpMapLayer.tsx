import { useMemo } from 'react';
import { jumpTrackSpan, type SessionJump } from '../core/jumps';
import { formatTimeOfDay } from '../core/units';
import HighlightSpan from './HighlightSpan';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from './highlightColors';

/**
 * Sauts sur la carte d'une analyse (voile, course, vélo) : celui choisi en
 * violet, ou le podium des trois plus hauts aux couleurs des tops ; un trait
 * sur la trace du vol (`jumpTrackSpan`) et un point au décollage.
 */
function JumpMapLayer({ track, jumps, shownJump, podiumShown }: {
  track: ReadonlyArray<{ lat: number; lon: number; timeMs: number }>;
  /** Sauts montrés dans l'onglet. */
  jumps: SessionJump[];
  /** Saut choisi, par l'heure de son décollage. */
  shownJump: number | null;
  podiumShown: boolean;
}) {
  return useMemo(() => {
    const byHeight = [...jumps].sort((a, b) => b.heightM - a.heightM);
    const drawn = podiumShown
      ? byHeight.slice(0, 3).map((j, k) => ({ jump: j, color: HIGHLIGHT_PODIUM_COLORS[k] }))
      : jumps.filter((j) => j.takeoffMs === shownJump).map((j) => ({ jump: j, color: HIGHLIGHT_SHOWN_COLOR }));
    return (
      <>
        {drawn.map(({ jump, color }) => {
          const span = jumpTrackSpan(track, jump);
          if (!span) return null;
          const path = track.slice(span.from, span.to + 1).map((p) => [p.lat, p.lon] as [number, number]);
          const start = track[span.start];
          return (
            <HighlightSpan key={`jump-${jump.takeoffMs}`} path={path} start={[start.lat, start.lon]} color={color}>
              Saut de {formatTimeOfDay(jump.takeoffMs)} · {jump.heightM.toFixed(2)} m · {jump.flightS.toFixed(2)} s de vol
            </HighlightSpan>
          );
        })}
      </>
    );
  }, [track, jumps, shownJump, podiumShown]);
}

export default JumpMapLayer;
