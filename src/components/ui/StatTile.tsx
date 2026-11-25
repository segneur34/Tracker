import type { ReactNode } from 'react';
import { IconChevronRight } from '../icons';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Précision grisée à la suite de la valeur (« 12:03 » après un record). */
  detail?: ReactNode;
  title?: string;
  /** Tuile qui se touche (onglet de « général », lot 234) : la racine devient un bouton, un chevron au bout du libellé. */
  onToggle?: () => void;
  /** Avec `onToggle` : l'onglet de la tuile est ouvert (`aria-expanded`), le toucher le refermera. */
  expanded?: boolean;
  /** Nom du bouton lu par l'accessibilité, avec `onToggle` : le chiffre et ce que fait le toucher. */
  ariaLabel?: string;
}

/**
 * Tuile de chiffre d'une analyse : libellé grisé, valeur, détail. Posée dans une grille `an-sheet__stats`.
 * Avec `onToggle`, un bouton à la même place que le bloc (grille et paires gardées).
 */
function StatTile({ label, value, detail, title, onToggle, expanded, ariaLabel }: StatTileProps) {
  const body = (
    <>
      <span className="an-sheet__stat-label">
        {label}
        {/* Point d'accroche sans largeur au bout du libellé : le chevron, posé dessus, ne passe jamais seul à la ligne. */}
        {onToggle && <span className="an-sheet__stat-chevron"><IconChevronRight size={10} /></span>}
      </span>
      <strong className="an-sheet__stat-value">
        {value}
        {detail && <span className="ui-muted ui-weight-normal ui-text-xs"> {detail}</span>}
      </strong>
    </>
  );
  if (onToggle) {
    return (
      <button type="button" className="an-sheet__stat an-sheet__stat--link" title={title} aria-label={ariaLabel}
        aria-expanded={expanded ?? false} onClick={onToggle}>
        {body}
      </button>
    );
  }
  return (
    <div className="an-sheet__stat" title={title}>
      {body}
    </div>
  );
}

export default StatTile;
