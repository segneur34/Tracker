import { FAMILY_LABEL, activitiesOfFamily, type Activity } from '../core/activities';
import { SPORT_FAMILIES, type SportFamily } from '../core/sportProfiles';

/**
 * Choix d'une activité, groupées par famille (Voile, Course à pied, Vélo) : classer
 * une session, changer l'activité d'un enregistrement en cours ou d'une
 * session analysée. Passer d'une famille à l'autre change le module qui
 * analyse la session : c'est à l'appelant d'en tirer les conséquences.
 */


interface ActivitySelectProps {
  activities: Activity[];
  /** Identifiant de l'activité choisie ; `null` : `placeholder`, en option désactivée. */
  value: string | null;
  onChange: (activity: Activity) => void;
  /** Activité hors de la liste à proposer quand même (l'activité de base d'un calcul). */
  extra?: Activity | null;
  /** Familles proposées ; toutes par défaut. */
  families?: SportFamily[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

function ActivitySelect({
  activities, value, onChange, extra, families = SPORT_FAMILIES, placeholder, disabled, className = 'ui-field ui-field--s', label,
}: ActivitySelectProps) {
  const list = extra && !activities.some((a) => a.id === extra.id) ? [...activities, extra] : activities;
  const groups = families
    .map((family) => ({ family, items: activitiesOfFamily(list, family) }))
    .filter((g) => g.items.length > 0);
  const options = (items: Activity[]) => items.map((a) => <option key={a.id} value={a.id}>{a.name}</option>);
  return (
    <select
      className={className}
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const chosen = list.find((a) => a.id === e.target.value);
        if (chosen) onChange(chosen);
      }}>
      {value === null && <option value="" disabled>{placeholder ?? 'Choisir…'}</option>}
      {/* Une seule famille : pas de groupe, la liste suffit. */}
      {groups.length === 1
        ? options(groups[0].items)
        : groups.map((g) => <optgroup key={g.family} label={FAMILY_LABEL[g.family]}>{options(g.items)}</optgroup>)}
    </select>
  );
}

export default ActivitySelect;
