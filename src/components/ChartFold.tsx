import type { CSSProperties, ReactNode } from 'react';
import { IconChevronRight } from './icons';

/**
 * Bouton qui replie ou montre une partie d'un panneau à sa place : un graphe
 * parmi d'autres (onglets « graphiques », « zones de pente »), le tableau des
 * zones de l'énergie ou de pente, les pastilles des statistiques. Chevron vers le haut quand la partie est montrée, vers
 * le bas quand elle est repliée. `color` teinte le nom, celle de la série du
 * graphe ; `aria-expanded` dit l'état (banc compris).
 */
function ChartFold({ label, open, onToggle, color, title, style }: {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  color?: string;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} data-chart-fold=""
      title={title ?? (open ? 'Replier' : 'Montrer')}
      style={{
        alignSelf: 'flex-start', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px',
        padding: '3px 8px 3px 10px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: 'var(--text-xs)',
        backgroundColor: 'var(--surface-sunken)', color: color ?? 'var(--ink)', fontWeight: color ? 600 : undefined,
        letterSpacing: 'var(--title-spacing)', textTransform: 'uppercase',
        ...style,
      }}>
      {label}
      <IconChevronRight size={14} style={{ transform: `rotate(${open ? -90 : 90}deg)`, transition: 'transform 0.15s', color: 'var(--ink)' }} />
    </button>
  );
}

export default ChartFold;
