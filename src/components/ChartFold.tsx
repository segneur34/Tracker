import type { CSSProperties, ReactNode } from 'react';
import { HoverReadout, type Readout } from './ChartReadout';
import { IconChevronRight } from './icons';

/**
 * Bouton qui replie ou montre une partie d'un panneau à sa place : un graphe
 * parmi d'autres (onglets « graphiques », « zones de pente »), le tableau des
 * zones de l'énergie ou de pente, les pastilles des statistiques. Chevron vers le haut quand la partie est montrée, vers
 * le bas quand elle est repliée. `color` teinte le nom, celle de la série du
 * graphe ; `aria-expanded` dit l'état (banc compris). Plus petit dans les
 * analyses (`--chart-name-size`, `analysisMobile.css`).
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
        padding: '3px 8px 3px 10px', cursor: 'pointer', border: 'none', borderRadius: '4px', fontSize: 'var(--chart-name-size, var(--text-xs))',
        backgroundColor: 'var(--surface-sunken)', color: color ?? 'var(--ink)', fontWeight: color ? 600 : undefined,
        letterSpacing: 'var(--title-spacing)', textTransform: 'uppercase',
        ...style,
      }}>
      {label}
      <IconChevronRight size={14} style={{ transform: `rotate(${open ? -90 : 90}deg)`, transition: 'transform 0.15s', color: 'var(--ink)' }} />
    </button>
  );
}

/**
 * Tête d'un graphe des analyses : son nom repliable (`ChartFold`) et, à
 * droite, la lecture au point survolé tant que le graphe est montré. Chaque
 * infobulle (`title`) est donnée par l'appelant, avec ses mots.
 */
export function GraphFoldHead({ label, color, open, onToggle, read, title, foldStyle, style }: {
  label: ReactNode;
  color?: string;
  open: boolean;
  onToggle: () => void;
  /** Lecture d'un indice de trace, sans nom ni couleur ; aucune lecture s'il manque. */
  read?: (index: number) => Readout | null;
  title?: string;
  /** Style du bouton du nom. */
  foldStyle?: CSSProperties;
  /** Style de la rangée. */
  style?: CSSProperties;
}) {
  return (
    <div className="chart-head" style={style}>
      <ChartFold label={label} color={color} open={open} onToggle={onToggle} title={title} style={foldStyle} />
      {read !== undefined && open && <HoverReadout read={read} />}
    </div>
  );
}

export default ChartFold;
