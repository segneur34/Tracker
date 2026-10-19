import { useState } from 'react';
import { useSettingsCollapsed } from './settingsHelpContext';
import { ACTIVITY_ICON_IDS, ACTIVITY_ICON_LABEL, type ActivityIconId } from '../core/activityIcons';
import { ACTIVITY_ICON } from './familyIcons';
import './IconPicker.css';

/**
 * Icône d'une activité : les seize dessins, à la couleur de l'activité. Celle
 * cochée est la choisie, ou à défaut celle devinée du nom (`activityIcon`).
 * Repliée au départ (19/10) : l'icône en cours et « Changer », qui déplie la
 * grille ; un choix la replie, « Tout réduire » de Réglages aussi.
 */
function IconPicker({
  value, color, onChange, label,
}: {
  value: ActivityIconId;
  color: string;
  onChange: (icon: ActivityIconId) => void;
  label: string;
}) {
  const collapsed = useSettingsCollapsed();
  /** Repère du « Tout réduire » au moment de l'ouverture ; un appui suivant le rend périmé, donc replié. */
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const open = openedAt === collapsed;
  const setOpen = (next: boolean) => setOpenedAt(next ? collapsed : null);
  const Current = ACTIVITY_ICON[value];
  return (
    <div className="icon-picker" role="group" aria-label={label}>
      <div className="icon-picker__head">
        <span className="icon-picker__current" style={{ color }} title={ACTIVITY_ICON_LABEL[value]}>
          <Current size={20} />
        </span>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--s" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Réduire' : 'Changer'}
        </button>
      </div>
      {open && (
        <div className="icon-picker__grid">
          {ACTIVITY_ICON_IDS.map((id) => {
            const Icon = ACTIVITY_ICON[id];
            return (
              <button key={id} type="button" className="icon-picker__choice" style={{ color }}
                aria-pressed={id === value} aria-label={ACTIVITY_ICON_LABEL[id]} title={ACTIVITY_ICON_LABEL[id]}
                onClick={() => { onChange(id); setOpen(false); }}>
                <Icon size={20} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default IconPicker;
