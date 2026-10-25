import type { ReactNode } from 'react';
import { formatSessionDate } from '../core/units';
import { HelpToggle } from './Help';
import { IconChevronRight } from './icons';

/**
 * Titre d'un panneau d'analyse, cliquable pour le refermer sans remonter à la
 * rangée d'onglets : utile quand le panneau ouvert dépasse l'écran, surtout
 * sur téléphone. Le nom en capitales espacées, comme les titres de l'accueil ;
 * `extra` (date, mention) garde sa casse. Plus petit dans les analyses
 * (`--panel-title-size`, `analysisMobile.css`). `helpKey` pose le « ? » de
 * l'aide du panneau à droite du titre, une fois ouvert ; son texte (`HelpText`
 * en `note`) se place juste sous le titre.
 */
function PanelTitle({ label, extra, open, onToggle, helpKey }: {
  label: ReactNode;
  extra?: ReactNode;
  open: boolean;
  onToggle: () => void;
  helpKey?: string;
}) {
  return (
    <strong
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--panel-title-size, var(--text-m))', cursor: 'pointer', userSelect: 'none' }}>
      <IconChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s', flexShrink: 0 }} />
      <span style={{ fontFamily: 'var(--font-title)', fontWeight: 'var(--title-weight)', letterSpacing: 'var(--title-spacing)', textTransform: 'uppercase' }}>
        {label}
      </span>
      {extra}
      {helpKey && open && <HelpToggle helpKey={helpKey} label={typeof label === 'string' ? label : 'ce panneau'} size="s" />}
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
