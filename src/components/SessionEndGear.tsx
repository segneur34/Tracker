import type { Activity } from '../core/activities';
import { addGearItem, useGearGroups } from '../hooks/useSportSettings';
import type { GearChoice } from '../library/notes';
import GearPicker from './GearPicker';

interface Props {
  /** Activité de la session terminée ; sans activité, rien n'est proposé. */
  activity: Activity | null;
  /** Pièces choisies, une par groupe au plus, dans l'ordre des groupes ; `null` : rien de choisi. */
  gear: GearChoice[] | null;
  onChange: (gear: GearChoice[] | null) => void;
}

/**
 * Matériel de la session, choisi à la fin de l'enregistrement, juste avant
 * « Analyser » (lot 143, 131) : le choix par groupe de l'onglet « matériel et
 * notes » (`GearPicker`), vide d'office, jamais repris d'une autre session
 * (DECISIONS §8). Rien n'est montré sans activité ou si l'activité n'a pas de
 * liste de matériel. Le choix est écrit dans la fiche par « Analyser ».
 */
export default function SessionEndGear({ activity, gear, onChange }: Props) {
  const groups = useGearGroups(activity);
  if (!activity || !groups || groups.length === 0) return null;
  const choose = (groupId: string, choice: GearChoice | null) => {
    const next = groups.flatMap((group): GearChoice[] => {
      const kept = group.id === groupId ? choice : gear?.find((c) => c.groupId === group.id) ?? null;
      return kept ? [kept] : [];
    });
    onChange(next.length > 0 ? next : null);
  };
  return (
    <div className="rec-end-gear" data-testid="rec-end-gear">
      <strong className="ui-subtitle rec-end-gear__title">Matériel</strong>
      {groups.map((group) => (
        <GearPicker key={group.id} group={group} choice={gear?.find((c) => c.groupId === group.id) ?? null}
          onChoose={(choice) => choose(group.id, choice)}
          onAddToList={(name) => addGearItem(activity.id, group.id, name)} />
      ))}
    </div>
  );
}
