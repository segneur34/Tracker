import type { SportFamily } from '../core/sportProfiles';
import { addGearItem } from '../hooks/useSportSettings';
import type { GearGroup } from '../library/notes';
import type { EditedPart } from '../library/sessionEdits';
import { RATINGS, WATER_STATES, WIND_LEVELS, type GearChoice, type SailingSessionNotes } from '../library/notes';
import GearPicker from './GearPicker';
import { IconFace } from './icons';
import type { GearField } from './gearFields';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';

interface Props {
  notes: SailingSessionNotes;
  setNotes: (patch: Partial<SailingSessionNotes>) => void;
  /** Famille de la session : couleur des boutons choisis. */
  family: SportFamily;
  gearFields: readonly GearField[];
  /**
   * Matériel enregistré de l'activité (Réglages) : un choix par groupe à la place
   * des champs de texte ; `null` : option coupée, les champs d'avant.
   */
  gearGroups: GearGroup[] | null;
  /** Activité de la session, dont la liste reçoit une pièce « Ajouter à la liste ». */
  activityId: string;
  /** Conditions : boutons vent et plan d'eau en voile, texte libre ailleurs. */
  conditions: 'voile' | 'libre';
  /** État du brouillon de la session (`useSessionDraft`). */
  draft: { savable: boolean; changed: readonly EditedPart[]; hasSavedNotes: boolean };
  open: boolean;
  onToggle: () => void;
}

/**
 * Contenu de l'onglet du matériel et des notes, commun à tous les modules :
 * matériel, conditions, appréciation de la séance et commentaire, et ce qu'il
 * en est de leur enregistrement. Posé dans le `ResizablePanel` du module (flex
 * en ligne), qui garde son identifiant.
 */
/**
 * Groupes montrés : ceux de la liste, puis ceux d'un choix dont le groupe a
 * disparu, sans pièce, pour que le choix reste lisible et puisse être retiré.
 */
const shownGroups = (groups: readonly GearGroup[], gear: readonly GearChoice[] | null): { group: GearGroup; listed: boolean }[] => [
  ...groups.map((group) => ({ group, listed: true })),
  ...(gear ?? []).filter((c) => !groups.some((g) => g.id === c.groupId))
    .map((c) => ({ group: { id: c.groupId, name: c.groupName, items: [] }, listed: false })),
];

/** Matériel avec ce choix pour ce groupe, dans l'ordre des groupes ; `null` s'il ne reste rien. */
const withChoice = (
  gear: readonly GearChoice[] | null, groups: readonly GearGroup[], groupId: string, choice: GearChoice | null
): GearChoice[] | null => {
  const rank = (c: GearChoice) => {
    const k = groups.findIndex((g) => g.id === c.groupId);
    return k < 0 ? groups.length : k;
  };
  const next = [...(gear ?? []).filter((c) => c.groupId !== groupId), ...(choice ? [choice] : [])].sort((a, b) => rank(a) - rank(b));
  return next.length > 0 ? next : null;
};

export default function SessionNotesPanel({ notes, setNotes, family, gearFields, gearGroups, activityId, conditions, draft, open, onToggle }: Props) {
  const accent = `var(--${family})`;
  const accentSoft = `var(--${family}-soft)`;
  const choiceStyle = (chosen: boolean) => ({
    padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: 'var(--text-xs)',
    backgroundColor: chosen ? accent : 'var(--surface)', color: chosen ? 'var(--on-accent)' : 'var(--ink)',
  });
  return (
    <>
      <div className="an-notes-col">
        <PanelHeading label="Matériel" open={open} onToggle={onToggle} helpKey={gearGroups ? 'analyse:materiel' : undefined} />
        {gearGroups ? (
          <>
            <HelpText helpKey="analyse:materiel" note>
              Une pièce par groupe, prise dans le matériel de l'activité (Réglages). « Ajouter à la liste » l'y range tout de suite, même si la session
              n'est pas enregistrée ensuite ; « Pour cette session » la garde pour elle seule.
            </HelpText>
            {shownGroups(gearGroups, notes.gear).map(({ group, listed }) => (
              <GearPicker key={group.id} group={group} choice={notes.gear?.find((c) => c.groupId === group.id) ?? null}
                onChoose={(choice) => setNotes({ gear: withChoice(notes.gear, gearGroups, group.id, choice) })}
                onAddToList={listed ? (name) => addGearItem(activityId, group.id, name) : undefined} />
            ))}
            {/* Texte saisi avant le matériel enregistré : montré tel quel, il reste dans la fiche. */}
            {gearFields.some(({ field }) => notes[field].trim() !== '') && (
              <div className="gear-picker__legacy">
                {gearFields.filter(({ field }) => notes[field].trim() !== '').map(({ field, label }) => `${label} : ${notes[field]}`).join(' · ')}
              </div>
            )}
          </>
        ) : gearFields.map(({ field, label, placeholder }) => (
          <label key={field} className="ui-field-row">
            <span className="an-notes-label">{label}</span>
            <input
              type="text"
              value={notes[field]}
              onChange={(e) => setNotes({ [field]: e.target.value })}
              placeholder={placeholder}
              className="an-notes-input" />
          </label>
        ))}
      </div>

      <div className="an-notes-col">
        <strong className="ui-subtitle ui-block ui-mb-10">Conditions</strong>
        {conditions === 'voile' ? (
          <>
            <div className="ui-mb-10">
              <span className="ui-block ui-text-s ui-mb-4">Vent</span>
              <div className="ui-row-6 ui-wrap">
                {WIND_LEVELS.map((w) => (
                  <button key={w.value} onClick={() => setNotes({ windLevel: notes.windLevel === w.value ? null : w.value })}
                    style={choiceStyle(notes.windLevel === w.value)}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="ui-block ui-text-s ui-mb-4">Plan d'eau</span>
              <div className="ui-row-6 ui-wrap">
                {WATER_STATES.map((s) => (
                  <button key={s.value} onClick={() => setNotes({ waterState: notes.waterState === s.value ? null : s.value })}
                    style={choiceStyle(notes.waterState === s.value)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <textarea
            value={notes.conditions}
            onChange={(e) => setNotes({ conditions: e.target.value })}
            placeholder="Météo, état du terrain…"
            aria-label="Conditions"
            rows={3}
            className="an-notes-text" />
        )}
      </div>

      <div className="an-notes-col">
        <strong className="ui-subtitle ui-block ui-mb-10">Appréciation de la séance</strong>
        <div className="ui-row-8 ui-wrap ui-mb-10">
          {RATINGS.map((r) => (
            <button key={r.value} onClick={() => setNotes({ rating: notes.rating === r.value ? null : r.value })}
              title={r.label} aria-label={r.label}
              aria-pressed={notes.rating === r.value}
              style={{ display: 'inline-flex', lineHeight: 1, padding: '6px', cursor: 'pointer', border: notes.rating === r.value ? `2px solid ${accent}` : '1px solid var(--line-strong)', borderRadius: '8px', backgroundColor: notes.rating === r.value ? accentSoft : 'var(--surface)', color: notes.rating === r.value ? accent : 'var(--muted)' }}>
              <IconFace mood={r.face} size={28} />
            </button>
          ))}
        </div>
        {notes.rating !== null && (
          <div className="ui-text-s ui-mb-8">{RATINGS.find((r) => r.value === notes.rating)?.label}</div>
        )}
        <textarea
          value={notes.comment}
          onChange={(e) => setNotes({ comment: e.target.value })}
          placeholder="Commentaire libre"
          rows={3}
          className="an-notes-text" />
        <div className="ui-muted ui-text-xs ui-mt-6">
          {!draft.savable
            ? 'Notes indisponibles : cette trace n\'est pas dans la mémoire.'
            : draft.changed.includes('notes')
              ? 'Non enregistrées : « Enregistrer la session », en haut de la page.'
              : draft.hasSavedNotes
                ? 'Enregistrées dans la fiche de la session, dans le dossier mémoire.'
                : 'Enregistrées avec la session, par « Enregistrer la session ».'}
        </div>
      </div>
    </>
  );
}
