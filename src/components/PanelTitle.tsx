import type { ReactNode } from 'react';
import { formatSessionDate } from '../core/units';
import { IconChevronRight } from './icons';

/**
 * Titre d'un panneau d'analyse, cliquable pour le refermer sans remonter à la
 * rangée d'onglets : utile quand le panneau ouvert dépasse l'écran, surtout
 * sur téléphone.
 */
function PanelTitle({ label, extra, open, onToggle }: { label: ReactNode; extra?: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <strong
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '16px', cursor: 'pointer', userSelect: 'none' }}>
      <IconChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s', flexShrink: 0 }} />
      {label}
      {extra}
    </strong>
  );
}

export default PanelTitle;

/** Date et heure de départ d'une session, en petit à droite du titre « Général ». */
export function SessionDate({ track }: { track: readonly { timeMs: number }[] }) {
  if (track.length === 0) return null;
  return (
    <span style={{ marginLeft: '6px', fontSize: 'var(--text-s)', fontWeight: 400, color: 'var(--muted)' }}>
      {formatSessionDate(track[0].timeMs)}
    </span>
  );
}
