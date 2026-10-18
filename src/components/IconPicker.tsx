import { ACTIVITY_ICON_IDS, ACTIVITY_ICON_LABEL, type ActivityIconId } from '../core/activityIcons';
import { ACTIVITY_ICON } from './familyIcons';
import './IconPicker.css';

/**
 * Icône d'une activité : les seize dessins, à la couleur de l'activité. Celle
 * cochée est la choisie, ou à défaut celle devinée du nom (`activityIcon`).
 */
function IconPicker({
  value, color, onChange, label,
}: {
  value: ActivityIconId;
  color: string;
  onChange: (icon: ActivityIconId) => void;
  label: string;
}) {
  return (
    <div className="icon-picker" role="group" aria-label={label}>
      {ACTIVITY_ICON_IDS.map((id) => {
        const Icon = ACTIVITY_ICON[id];
        return (
          <button key={id} type="button" className="icon-picker__choice" style={{ color }}
            aria-pressed={id === value} aria-label={ACTIVITY_ICON_LABEL[id]} title={ACTIVITY_ICON_LABEL[id]}
            onClick={() => onChange(id)}>
            <Icon size={20} />
          </button>
        );
      })}
    </div>
  );
}

export default IconPicker;
