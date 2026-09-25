import type { useSessionDraft } from '../hooks/useSessionDraft';
import Button from './ui/Button';

interface SessionSaveBarProps {
  draft: ReturnType<typeof useSessionDraft>;
  /**
   * Ce que la fiche garde, dit quand rien n'attend : « vent, notes… sont
   * gardés dans sa fiche ». Sans lui, la barre n'apparaît que pendant un brouillon.
   */
  kept?: string;
}

/**
 * Barre « Enregistrer la session » d'une page d'analyse : ce qui a changé
 * depuis le dernier enregistrement, Annuler et Enregistrer. Rien pour une
 * session hors de la mémoire, dont la fiche ne peut pas être écrite.
 */
function SessionSaveBar({ draft, kept }: SessionSaveBarProps) {
  if (!draft.savable || (!draft.dirty && kept === undefined)) return null;
  return (
    <div className={`ui-savebar${draft.dirty ? ' ui-savebar--dirty' : ''}`}>
      {draft.dirty ? (
        <>
          <span><strong>Non enregistré</strong> : {draft.changedText}.</span>
          <span className="ui-savebar__actions">
            <Button onClick={draft.cancel}>Annuler</Button>
            <Button variant="primary" onClick={draft.save}>Enregistrer la session</Button>
          </span>
        </>
      ) : (
        <span>Session enregistrée : {kept}.</span>
      )}
    </div>
  );
}

export default SessionSaveBar;
