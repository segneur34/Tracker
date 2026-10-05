import type { CSSProperties, ReactNode } from 'react';
import { WAY_TYPES, type WayType } from '../planning/brouterProfile';
import { WAY_TYPE_HINT, WAY_TYPE_LABEL } from '../planning/route';

/**
 * Cases des types de voie (Sentier, Piste, Route, Grande route), qui se
 * cochent ensemble : en planification, pour tout l'itinéraire et pour un
 * tronçon ; dans Réglages, pour les types cochés d'office d'une activité.
 * `children` s'ajoute après les types (la ligne droite, en planification).
 */
export default function WayTypeTabs({ checked, onToggle, label, compact = false, className, style, children }: {
  checked: ReadonlyArray<WayType>;
  onToggle: (type: WayType) => void;
  label: string;
  /** Onglets resserrés, sans le trait sous la rangée. */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={['ui-tabs', compact ? 'ui-tabs--compact' : '', className ?? ''].filter(Boolean).join(' ')} role="group" aria-label={label}
      style={style}>
      {WAY_TYPES.map((t) => (
        <button key={t} type="button" className="ui-tab" aria-pressed={checked.includes(t)} title={WAY_TYPE_HINT[t]} onClick={() => onToggle(t)}>
          {WAY_TYPE_LABEL[t]}
        </button>
      ))}
      {children}
    </div>
  );
}
