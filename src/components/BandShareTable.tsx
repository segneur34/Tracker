import type { ReactNode } from 'react';
import { formatShortDuration } from '../core/units';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import MapToggle from './ui/MapToggle';
import ShareBar from './ui/ShareBar';
import Swatch from './ui/Swatch';

/** Une tranche du tableau : sa couleur, son intitulé, sa plage (colonne facultative) et le temps passé. */
export interface BandShareRow {
  color: string;
  label: ReactNode;
  /** Plage de la tranche, dans la colonne `detailHead`. */
  detail?: string;
  timeS: number;
}

const cell = { padding: '0.4em 0.6em', textAlign: 'center' } as const;

/**
 * Tableau du temps passé par tranche (zones cardiaques, pas par minute) : le
 * temps, la barre de part du total et, avec `onSelect`, le bouton « Voir » qui
 * montre les passages de la tranche sur la carte (`selected`, 0 pour la
 * première). Une tranche sans temps est grisée et son bouton éteint.
 */
export default function BandShareTable({ head, detailHead, rows, selected, onSelect, shareWidth, marginTop, nowrapLabel = false }: {
  /** Titre de la première colonne. */
  head: string;
  /** Titre de la colonne des plages ; sans lui, pas de colonne. */
  detailHead?: string;
  rows: readonly BandShareRow[];
  selected: number | null;
  /** Choix de la tranche à montrer sur la carte ; sans lui, pas de colonne « Carte » (session sans trace). */
  onSelect?: (band: number | null) => void;
  /** Largeur de la colonne « Part ». */
  shareWidth: string;
  marginTop: string;
  /** Intitulé sur une seule ligne. */
  nowrapLabel?: boolean;
}) {
  const total = rows.reduce((sum, row) => sum + row.timeS, 0);
  return (
    <table className="ui-table" style={{ marginTop }}>
      <thead>
        <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
          <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>{head}</th>
          {detailHead && <th style={{ ...cell, fontWeight: 'normal', color: 'var(--muted)' }}>{detailHead}</th>}
          <th style={cell}>Temps</th>
          <th style={{ ...cell, width: shareWidth }}>Part</th>
          {onSelect && <th style={cell}>Carte</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, band) => {
          const shown = selected === band;
          return (
            <tr key={band} className={row.timeS > 0 ? 'ui-table__row' : 'ui-table__row ui-table__row--empty'}>
              <td style={{ padding: '0.4em 0.6em', fontWeight: 700, ...(nowrapLabel ? { whiteSpace: 'nowrap' } : {}) }}>
                <Swatch color={row.color} gap />
                {row.label}
              </td>
              {detailHead && <td style={{ ...cell, color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>{row.detail}</td>}
              <td style={cell}>{formatShortDuration(row.timeS)}</td>
              <td style={cell}><ShareBar share={total > 0 ? row.timeS / total : 0} color={row.color} /></td>
              {onSelect && (
                <td style={cell}>
                  <MapToggle shown={shown} disabled={row.timeS <= 0} color={HIGHLIGHT_SHOWN_COLOR} onClick={() => onSelect(shown ? null : band)} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
