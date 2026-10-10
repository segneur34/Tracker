import { useEffect, useState } from 'react';
import { librarySession, readSessionGpx, updateSessionRecord, useSessionName } from '../hooks/useSessionLibrary';
import { safeFileName, saveToDownloads } from '../platform/files';
import { IconDownload } from './icons';
import Button from './ui/Button';
import MoreMenu from './ui/MoreMenu';

/** Durée d'affichage du compte rendu d'un téléchargement. */
const DOWNLOAD_NOTE_MS = 4000;

/**
 * Nom d'une session de la mémoire, en tête de son analyse, son bouton
 * « Renommer » et son menu « … » (« Télécharger le GPX », dans
 * Téléchargements). Le nom est écrit dans la fiche dès sa validation, comme un
 * changement de support (la bibliothèque offre le même renommage). Rien pour
 * un GPX ouvert hors de la mémoire ; pas de renommage pour une fiche en
 * lecture seule, qui se télécharge quand même.
 */
function SessionNameEditor({ file }: { file: string | null }) {
  const name = useSessionName(file);
  /** Nom en cours de saisie ; `null` hors renommage. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Compte rendu du dernier téléchargement, effacé après quelques secondes. */
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), DOWNLOAD_NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);
  const session = file === null ? undefined : librarySession(file);
  if (!session || file === null) return null;

  const save = () => {
    if (draft === null) return;
    updateSessionRecord(file, { name: draft });
    setDraft(null);
  };

  /** Le GPX tel que rangé, sous le nom de la session s'il en a un. */
  const download = async () => {
    try {
      const gpx = await readSessionGpx(file);
      if (gpx === null) throw new Error('GPX illisible dans la mémoire.');
      const named = name ? safeFileName(name) : '';
      await saveToDownloads(named ? `${named}.gpx` : file, gpx);
      setNote({ text: 'GPX enregistré dans Téléchargements.', error: false });
    } catch (err) {
      setNote({ text: `Téléchargement impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`, error: true });
    }
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
      <MoreMenu label="Plus d'actions sur la session">
        <Button onClick={() => void download()}>
          <IconDownload size={18} />
          Télécharger le GPX
        </Button>
      </MoreMenu>
      {note && (
        <span role="status" style={{ flexBasis: '100%', fontSize: 'var(--text-s)', color: note.error ? 'var(--recording)' : 'var(--muted)' }}>
          {note.text}
        </span>
      )}
    </span>
  );
}

export default SessionNameEditor;
