import type { CSSProperties, ReactNode } from 'react';

/**
 * Rangée de boutons qui ouvrent et ferment les sections d'un module. Chaque
 * bouton est indépendant : plusieurs sections peuvent être ouvertes à la fois.
 */

export interface SectionDefinition<K extends string> {
  key: K;
  label: string;
}

interface SectionTabsProps<K extends string> {
  sections: ReadonlyArray<SectionDefinition<K>>;
  open: Record<K, boolean>;
  onToggle: (key: K) => void;
  /** Couleur du bouton actif, celle du module (une variable de la DA). */
  accent?: string;
  /** Élément ajouté en fin de rangée (la flèche qui cache la barre, `CollapsibleSectionTabs`). */
  trailing?: ReactNode;
  /** Classe ajoutée à la rangée (la rangée « avancé » des analyses). */
  className?: string;
}

function SectionTabs<K extends string>({ sections, open, onToggle, accent = 'var(--voile)', trailing, className }: SectionTabsProps<K>) {
  return (
    <div className={className ? `ui-tabs ${className}` : 'ui-tabs'} style={{ '--tab-accent': accent } as CSSProperties}>
      {sections.map((section) => (
        <button
          key={section.key}
          type="button"
          className="ui-tab"
          onClick={() => onToggle(section.key)}
          aria-pressed={open[section.key]}>
          {section.label}
        </button>
      ))}
      {trailing}
    </div>
  );
}

export default SectionTabs;
