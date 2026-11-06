import { Fragment, type ReactNode } from 'react';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';
import HighlightPath from './HighlightPath';
import { HIGHLIGHT_PODIUM_COLORS, PODIUM_RANKS, podiumColor } from './highlightColors';
import type { TopSegment, TopTarget } from '../core/types';
import { SPEED_UNIT_LABEL, type SpeedUnit } from '../core/units';
import MapToggle from './ui/MapToggle';

interface Props {
  /** Cibles du calcul, en temps puis en distance. */
  targets: readonly TopTarget[];
  /** Trois meilleurs passages par cible (`computeAllTopSegments`), dans `unit`. */
  tops: Record<string, TopSegment[]>;
  unit: SpeedUnit;
  /** Cible montrée sur la carte, ou `null`. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Couleur du bouton « Masquer », celle du module. */
  accent: string;
  open: boolean;
  onToggle: () => void;
  /** Sous le tableau : les tranches par kilomètre, à pied et à vélo (`KilometerSplitsTable`). */
  children?: ReactNode;
}

/**
 * Onglet « tops » : les trois meilleurs passages sur chaque durée ou distance
 * du calcul, et le podium sur la carte (`TopsHighlight`). Partagé par la
 * voile, la course, le vélo et le surf ; posé dans le `ResizablePanel` du module.
 */
export default function TopsPanel({ targets, tops, unit, selected, onSelect, accent, open, onToggle, children }: Props) {
  return (
    <>
      <PanelHeading label="Meilleurs segments" open={open} onToggle={onToggle} helpKey="analyse:tops" />
      <HelpText helpKey="analyse:tops" note>
        Vitesse moyenne du meilleur passage sur chaque durée ou distance, sans chevauchement, pauses comprises.
      </HelpText>
      <table className="ui-table">
        <thead>
          <tr className="ui-sunken">
            <th className="ui-cell ui-cell--left">Sur</th>
            {PODIUM_RANKS.map((rank, idx) => (
              <th key={rank} style={{ padding: '0.4em 0.6em', color: HIGHLIGHT_PODIUM_COLORS[idx] }}>{rank} ({SPEED_UNIT_LABEL[unit]})</th>
            ))}
            <th className="ui-cell">Carte</th>
          </tr>
        </thead>
        <tbody>
          {(['time', 'distance'] as const).map((kind) => (
            <Fragment key={kind}>
              {targets.filter((t) => t.kind === kind).map((target) => {
                const values = tops[target.key] ?? [];
                const reached = values.some((v) => v.path.length > 1);
                const shown = selected === target.key;
                return (
                  <tr key={target.key} className={reached ? 'ui-table__row' : 'ui-table__row ui-table__row--empty'}>
                    <td className="ui-cell ui-cell--bold">{target.label}</td>
                    {[0, 1, 2].map((idx) => (
                      <td key={idx} style={{ padding: '0.4em 0.6em', textAlign: 'center', fontWeight: idx === 0 ? 'bold' : 'normal' }}>{values[idx]?.val ?? '-'}</td>
                    ))}
                    <td className="ui-cell ui-cell--center">
                      <MapToggle shown={shown} disabled={!reached} color={accent} onClick={() => onSelect(shown ? null : target.key)} />
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
      {children}
    </>
  );
}

/**
 * Podium d'une cible sur la carte, aux couleurs du podium ; rien sans cible
 * montrée. Les podiums de VMG (près, portant) s'y rangent comme les tops de vitesse.
 */
export function TopsHighlight({ tops, selected }: { tops: Record<string, readonly Pick<TopSegment, 'path'>[]> | null; selected: string | null }) {
  if (selected === null || !tops) return null;
  return (tops[selected] ?? []).map((top, idx) => top.path.length > 1 && (
    <HighlightPath key={`top-${selected}-${idx}`} positions={top.path} color={podiumColor(idx)} />
  ));
}
