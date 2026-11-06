import type { ReactNode } from 'react';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Précision grisée à la suite de la valeur (« 12:03 » après un record). */
  detail?: ReactNode;
  title?: string;
}

/** Tuile de chiffre d'une analyse : libellé grisé, valeur, détail. Posée dans une grille `an-sheet__stats`. */
function StatTile({ label, value, detail, title }: StatTileProps) {
  return (
    <div className="an-sheet__stat" title={title}>
      <span className="an-sheet__stat-label">{label}</span>
      <strong className="an-sheet__stat-value">
        {value}
        {detail && <span className="ui-muted ui-weight-normal ui-text-xs"> {detail}</span>}
      </strong>
    </div>
  );
}

export default StatTile;
