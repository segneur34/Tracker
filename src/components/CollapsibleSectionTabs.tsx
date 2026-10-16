import SectionTabs, { type SectionDefinition } from './SectionTabs';
import { IconChevronDown, IconChevronUp } from './icons';
import { useStoredRecord } from '../hooks/useStoredRecord';

/**
 * Barre d'onglets d'une analyse, sous la carte, qu'une flèche en fin de
 * rangée cache. Cachée, il ne reste qu'un bouton fin « onglets » qui la
 * ramène et disparaît. Seule la barre se cache : les panneaux ouverts restent.
 * Un seul état pour toutes les analyses, retenu sur l'appareil.
 */

const BAR_DEFAULTS = { cachee: false };

interface CollapsibleSectionTabsProps<K extends string> {
  sections: SectionDefinition<K>[];
  open: Record<K, boolean>;
  onToggle: (key: K) => void;
  accent?: string;
}

function CollapsibleSectionTabs<K extends string>({ sections, open, onToggle, accent }: CollapsibleSectionTabsProps<K>) {
  const { value, update } = useStoredRecord('tracker.sections', 'analyses-barre', BAR_DEFAULTS);

  if (value.cachee) {
    return (
      <button type="button" className="an-tabs-reveal" onClick={() => update({ cachee: false })} aria-label="Montrer les onglets">
        onglets <IconChevronDown size={14} />
      </button>
    );
  }
  return (
    <SectionTabs sections={sections} open={open} onToggle={onToggle} accent={accent}
      trailing={(
        <button type="button" className="an-tabs-hide" onClick={() => update({ cachee: true })}
          aria-label="Cacher les onglets" title="Cacher les onglets">
          <IconChevronUp size={16} />
        </button>
      )} />
  );
}

export default CollapsibleSectionTabs;
