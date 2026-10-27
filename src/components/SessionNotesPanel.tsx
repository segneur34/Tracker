import type { SportFamily } from '../core/sportProfiles';
import type { EditedPart } from '../library/sessionEdits';
import { RATINGS, WATER_STATES, WIND_LEVELS, type SailingSessionNotes } from '../sailing/sessionNotes';
import PanelTitle from './PanelTitle';

/** Champ texte du matériel : clé dans les notes, intitulé, exemple. */
export interface GearField {
  field: 'foil' | 'mast' | 'wing' | 'gear1' | 'gear2';
  label: string;
  placeholder: string;
}

interface Props {
  notes: SailingSessionNotes;
  setNotes: (patch: Partial<SailingSessionNotes>) => void;
  /** Famille de la session : couleur des boutons choisis. */
  family: SportFamily;
  gearFields: readonly GearField[];
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
export default function SessionNotesPanel({ notes, setNotes, family, gearFields, conditions, draft, open, onToggle }: Props) {
  const accent = `var(--${family})`;
  const accentSoft = `var(--${family}-soft)`;
  const choiceStyle = (chosen: boolean) => ({
    padding: '5px 10px', cursor: 'pointer', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: 'var(--text-xs)',
    backgroundColor: chosen ? accent : 'var(--surface)', color: chosen ? 'var(--on-accent)' : 'var(--ink)',
  });
  return (
    <>
      <div style={{ flex: '1 1 260px' }}>
        <div style={{ marginBottom: '10px' }}>
          <PanelTitle label="Matériel" open={open} onToggle={onToggle} />
        </div>
        {gearFields.map(({ field, label, placeholder }) => (
          <label key={field} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontSize: 'var(--text-s)' }}>
            <span style={{ width: '90px' }}>{label}</span>
            <input
              type="text"
              value={notes[field]}
              onChange={(e) => setNotes({ [field]: e.target.value })}
              placeholder={placeholder}
              style={{ flex: 1, padding: '4px 6px' }} />
          </label>
        ))}
      </div>

      <div style={{ flex: '1 1 260px' }}>
        <strong className="ui-subtitle" style={{ display: 'block', marginBottom: '10px' }}>Conditions</strong>
        {conditions === 'voile' ? (
          <>
            <div style={{ marginBottom: '10px' }}>
              <span style={{ display: 'block', fontSize: 'var(--text-s)', marginBottom: '4px' }}>Vent</span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {WIND_LEVELS.map((w) => (
                  <button key={w.value} onClick={() => setNotes({ windLevel: notes.windLevel === w.value ? null : w.value })}
                    style={choiceStyle(notes.windLevel === w.value)}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span style={{ display: 'block', fontSize: 'var(--text-s)', marginBottom: '4px' }}>Plan d'eau</span>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
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
            style={{ width: '100%', padding: '6px', fontFamily: 'inherit', fontSize: 'var(--text-s)', boxSizing: 'border-box' }} />
        )}
      </div>

      <div style={{ flex: '1 1 260px' }}>
        <strong className="ui-subtitle" style={{ display: 'block', marginBottom: '10px' }}>Appréciation de la séance</strong>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {RATINGS.map((r) => (
            <button key={r.value} onClick={() => setNotes({ rating: notes.rating === r.value ? null : r.value })}
              title={r.label} aria-label={r.label}
              style={{ fontSize: '26px', lineHeight: 1, padding: '6px', cursor: 'pointer', border: notes.rating === r.value ? `2px solid ${accent}` : '1px solid var(--line-strong)', borderRadius: '8px', backgroundColor: notes.rating === r.value ? accentSoft : 'var(--surface)', opacity: notes.rating === null || notes.rating === r.value ? 1 : 0.5 }}>
              {r.emoji}
            </button>
          ))}
        </div>
        {notes.rating !== null && (
          <div style={{ fontSize: 'var(--text-s)', marginBottom: '8px' }}>{RATINGS.find((r) => r.value === notes.rating)?.label}</div>
        )}
        <textarea
          value={notes.comment}
          onChange={(e) => setNotes({ comment: e.target.value })}
          placeholder="Commentaire libre"
          rows={3}
          style={{ width: '100%', padding: '6px', fontFamily: 'inherit', fontSize: 'var(--text-s)', boxSizing: 'border-box' }} />
        <div style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px' }}>
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
