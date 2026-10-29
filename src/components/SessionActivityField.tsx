import type { Activity } from '../core/activities';
import { hasPositions, type SportFamily } from '../core/sportProfiles';
import ActivitySelect from './ActivitySelect';

/**
 * Champ « Activité » de l'onglet réglages d'une analyse, le même dans les
 * quatre modules : une session avec trace ne change que vers une activité avec
 * positions, une session sans trace (muscu) que vers une activité sans. Les
 * familles proposées sont celles du module, toutes pour une session de la mémoire.
 */
export default function SessionActivityField({ activities, activity, withPositions, families, onChange }: {
  /** Toutes les activités de l'utilisateur ; le champ garde celles qui conviennent. */
  activities: Activity[];
  /** Activité de la session. */
  activity: Activity;
  /** La session a des positions (tout sauf la muscu). */
  withPositions: boolean;
  families?: SportFamily[];
  onChange: (next: Activity) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-s)' }}>
      <strong>Activité :</strong>
      <ActivitySelect
        activities={activities.filter((a) => hasPositions(a.base) === withPositions)}
        value={activity.id}
        extra={activity}
        families={families}
        onChange={onChange} />
    </label>
  );
}
