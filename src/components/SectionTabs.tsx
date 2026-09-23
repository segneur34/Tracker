/**
 * Rangée de boutons qui ouvrent et ferment les sections d'un module. Chaque
 * bouton est indépendant : plusieurs sections peuvent être ouvertes à la fois.
 */

export interface SectionDefinition<K extends string> {
  key: K;
  label: string;
}

interface SectionTabsProps<K extends string> {
  sections: SectionDefinition<K>[];
  open: Record<K, boolean>;
  onToggle: (key: K) => void;
  /** Couleur du bouton actif, celle du module. */
  accent?: string;
}

function SectionTabs<K extends string>({ sections, open, onToggle, accent = '#1976d2' }: SectionTabsProps<K>) {
  return (
    <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid #ccc', paddingBottom: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
      {sections.map((section) => {
        const active = open[section.key];
        return (
          <button
            key={section.key}
            onClick={() => onToggle(section.key)}
            aria-pressed={active}
            style={{
              padding: '8px 16px', cursor: 'pointer', border: 'none', borderRadius: '4px',
              backgroundColor: active ? accent : '#e0e0e0',
              color: active ? 'white' : 'black', fontWeight: active ? 'bold' : 'normal',
              textTransform: 'uppercase',
            }}>
            {section.label}
          </button>
        );
      })}
    </div>
  );
}

export default SectionTabs;
