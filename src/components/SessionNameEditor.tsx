import { useState } from 'react';
import { librarySession, updateSessionRecord, useSessionName } from '../hooks/useSessionLibrary';
import Button from './ui/Button';

/**
 * Nom d'une session de la mémoire, en tête de son analyse, et son bouton
 * « Renommer ». Le nom est écrit dans la fiche dès sa validation, comme un
 * changement de support (la bibliothèque offre le même renommage). Rien pour
 * un GPX ouvert hors de la mémoire ; pas de bouton pour une fiche en lecture seule.
 */
function SessionNameEditor({ file }: { file: string | null }) {
  const name = useSessionName(file);
  /** Nom en cours de saisie ; `null` hors renommage. */
  const [draft, setDraft] = useState<string | null>(null);
  const session = file === null ? undefined : librarySession(file);
  if (!session || file === null) return null;

  const save = () => {
    if (draft === null) return;
    updateSessionRecord(file, { name: draft });
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-1)' }}>
        <input
          className="ui-field ui-field--s"
          value={draft}
          autoFocus
          maxLength={80}
          placeholder="Nom de la session"
          aria-label="Nom de la session"
          style={{ flex: '1 1 180px', minWidth: 0, maxWidth: '360px' }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            else if (e.key === 'Escape') setDraft(null);
          }} />
        <Button size="s" onClick={save}>Valider</Button>
        <Button size="s" variant="ghost" onClick={() => setDraft(null)}>Annuler</Button>
      </span>
    );
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {name
        ? <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{name}</span>
        : <span>Sans nom</span>}
      {!session.readOnly && (
        <Button size="s" variant="ghost" onClick={() => setDraft(name ?? '')}>Renommer</Button>
      )}
    </span>
  );
}

export default SessionNameEditor;
