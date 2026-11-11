import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { librarySession, readLibraryState, removeSession } from '../hooks/useSessionLibrary';
import { DISCARD_HOLD_MS, discardFailureMessage } from '../library/discardOutcome';
import { plainError } from '../platform/errorText';
import { IconTrash } from './icons';
import Button from './ui/Button';
import Dialog from './ui/Dialog';
import HoldButton from './ui/HoldButton';

const getHoldMs = () => DISCARD_HOLD_MS;

/**
 * « Jeter la session », dernière entrée du menu « … » d'une analyse (lot 212) : un appui long d'une seconde
 * (`HoldButton`, l'anneau sous le doigt, rappel du geste sur un appui court), puis une confirmation. La
 * suppression est celle de la bibliothèque (`removeSession` : GPX, fiche, capteurs, dossier mémoire compris).
 * Elle réussit : `onGone` abandonne le brouillon de la session (sans quoi l'alerte « modifications non
 * enregistrées » se lèverait), et l'on repart en `backTo` en remplaçant l'entrée d'historique, pour que le
 * retour d'Android ne rouvre pas l'analyse jetée. Elle échoue : la fenêtre le dit et la session reste.
 */
function SessionDiscardEntry({ file, backTo, onGone }: { file: string; backTo: string; onGone: () => void }) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setAsking(false);
    setFailure(null);
  };

  const discard = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await removeSession(file);
      const message = discardFailureMessage(librarySession(file) !== undefined, readLibraryState().error);
      if (message !== null) {
        setFailure(message);
        return;
      }
      onGone();
      navigate(backTo, { replace: true });
    } catch (err) {
      setFailure(`Suppression impossible : ${plainError(err, 'erreur inconnue')}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <span className="ui-more__sep" role="separator" />
      {/* Le menu reste ouvert pendant l'appui : un clic de bouton le fermerait et couperait l'appui long. */}
      <span className="ui-more__keep" data-keep-open>
        <HoldButton onHold={() => setAsking(true)} getHoldMs={getHoldMs} label="Jeter la session" hintAction="jeter"
          lead={<IconTrash size={18} />} dialTitle="Jeter la session" color="var(--danger)" icon={<IconTrash size={48} />} />
      </span>
      {asking && (
        <Dialog title="Jeter cette session ?" onClose={close}>
          <p className="ui-hint">
            Son fichier, sa fiche et ses mesures de capteurs seront supprimés de la mémoire, sans retour possible.
          </p>
          {failure && <div role="alert" className="ui-alert ui-alert--danger">{failure}</div>}
          <div className="ui-dialog__actions">
            <Button variant="danger" disabled={busy} onClick={() => void discard()}>Jeter définitivement</Button>
            <Button variant="ghost" disabled={busy} onClick={close}>Garder</Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

export default SessionDiscardEntry;
