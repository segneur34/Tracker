import type { ReactNode } from 'react';
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
