import { ReferenceLine } from 'recharts';
import type { LocatedMark } from '../core/sessionMarks';
import { HIGHLIGHT_SHOWN_COLOR, MARK_FLAG_COLOR } from './highlightColors';

/**
 * Traits verticaux des repères sur un graphe Recharts, à poser parmi ses
 * enfants (`{markReferenceLines(...)}`) : Recharts ne voit pas un
 * `ReferenceLine` rangé dans un composant à lui. `xOf` : abscisse du repère
 * dans l'axe du graphe (distance ou minutes). `yAxisId` : celui d'un axe du
 * graphe, s'il les nomme ; sans lui, Recharts ne dessine pas le trait.
 */
export const markReferenceLines = (
  located: LocatedMark[],
  xOf: (m: LocatedMark) => number,
  shownMs: number | null = null,
  yAxisId?: string
) =>
  located.map((m) => (
    <ReferenceLine key={`note-${m.mark.timeMs}`} x={xOf(m)} ifOverflow="hidden" {...(yAxisId ? { yAxisId } : {})}
      stroke={m.mark.timeMs === shownMs ? HIGHLIGHT_SHOWN_COLOR : MARK_FLAG_COLOR} strokeWidth={1} strokeDasharray="3 3"
      label={{ value: String(m.n), position: 'insideTopLeft', fontSize: 10, fill: m.mark.timeMs === shownMs ? HIGHLIGHT_SHOWN_COLOR : MARK_FLAG_COLOR }} />
  ));
