import { useRef, useState } from 'react';
import { dayMonthYear } from '../core/calendar';
import { errorMessage } from '../core/basics';
import { formatSessionDate } from '../core/units';
import { groupedTrashEntries, trashCounts, trashSummaryText, type TrashEntry, type TrashGroup } from '../library/trash';
import { deleteTrashEntry, emptyTrash, restoreTrashEntry, useTrash } from '../hooks/useTrash';
import { IconChevronRight, IconTrash, IconUndo } from './icons';
import Button from './ui/Button';
import './TrashZone.css';

/**
 * Corbeille du programme Windows, dans Réglages › Mémoire (élément 217, sous-lot 3a) : une ligne « Corbeille : n
 * sessions, gardées 30 jours » qui se déplie sur la liste (nom, date de la session, date de suppression), une ligne
 * par session ou itinéraire, avec « Restaurer » et « Supprimer définitivement », puis « Vider la corbeille ». Les
 * deux gestes qui effacent demandent une confirmation sur place (jamais la fenêtre du navigateur), comme la
 * suppression d'un itinéraire. Rien quand elle est vide, ni hors du programme Windows, où elle l'est toujours.
 */

/** Date montrée d'une ligne : celle de la session, rien pour un itinéraire. */
const entryDate = (entry: TrashEntry): string | null => (entry.startMs !== null ? formatSessionDate(entry.startMs) : null);

/** Date d'entrée dans la corbeille de la ligne (la plus récente de ses entrées), accordée à ce qu'elle garde. */
const deletedOn = ({ entry, deletedAtMs }: TrashGroup): string => {
  const date = dayMonthYear(deletedAtMs);
  return entry.kind === 'session' ? `session supprimée le ${date}` : `itinéraire supprimé le ${date}`;
};

function TrashZone() {
  const { entries, error } = useTrash();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  /** Ligne dont la suppression définitive attend sa confirmation (son sous-dossier), ou `vider` pour toute la corbeille. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Un geste à la fois : les boutons sont grisés aussitôt, le verrou suit aussi un rendu en retard (`ref`). */
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const summary = trashSummaryText(trashCounts(entries));

  const run = async (action: () => Promise<string>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNote(null);
    setConfirming(null);
    try {
      setNote({ text: await action(), failed: false });
    } catch (err) {
      setNote({ text: errorMessage(err, 'erreur inconnue'), failed: true });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const restore = (entry: TrashEntry) => void run(() => restoreTrashEntry(entry));

  const remove = (entry: TrashEntry) => void run(async () => {
    await deleteTrashEntry(entry);
    return `Supprimé définitivement : « ${entry.name} ».`;
  });

  const empty = () => void run(async () => {
    await emptyTrash();
    return 'Corbeille vidée.';
  });

  if (summary === null && error === null && note === null) return null;

  return (
    <section className="trash-zone" aria-label="Corbeille">
      {summary !== null && (
        <button type="button" className="trash-zone__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <IconChevronRight size={14} className={open ? 'trash-zone__chevron trash-zone__chevron--open' : 'trash-zone__chevron'} />
          <span>{summary}</span>
        </button>
      )}
      {open && summary !== null && (
        <>
          <ul className="trash-zone__list">
            {groupedTrashEntries(entries).map((group) => (
              <li key={group.entry.dir} className="trash-zone__row">
                <span className="trash-zone__what">
                  <strong className="trash-zone__name">{group.entry.name}</strong>
                  <span className="trash-zone__when num">
                    {[entryDate(group.entry), deletedOn(group)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="trash-zone__actions">
                  {confirming === group.entry.dir ? (
                    <>
                      <Button size="s" variant="danger" disabled={busy} onClick={() => remove(group.entry)}>Supprimer définitivement</Button>
                      <Button size="s" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Garder</Button>
                    </>
                  ) : (
                    <>
                      <Button size="s" disabled={busy} onClick={() => restore(group.entry)}>
                        <IconUndo size={16} /> Restaurer
                      </Button>
                      <Button size="s" variant="ghost" disabled={busy} onClick={() => setConfirming(group.entry.dir)}
                        aria-label={`Supprimer définitivement « ${group.entry.name} »`}>
                        <IconTrash size={16} /> Supprimer définitivement
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {confirming === 'vider' ? (
            <div className="trash-zone__confirm">
              <p className="trash-zone__text">Vider la corbeille ? Tout ce qu'elle garde est supprimé définitivement, sans retour possible.</p>
              <span className="trash-zone__actions">
                <Button size="s" variant="danger" disabled={busy} onClick={empty}>Vider la corbeille</Button>
                <Button size="s" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>Garder</Button>
              </span>
            </div>
          ) : (
            <span className="trash-zone__actions">
              <Button size="s" variant="danger" disabled={busy} onClick={() => setConfirming('vider')}>
                <IconTrash size={16} /> Vider la corbeille
              </Button>
            </span>
          )}
        </>
      )}
      {error !== null && <p className="trash-zone__text trash-zone__text--muted">{error}</p>}
      {note !== null && (
        <p className={note.failed ? 'trash-zone__text trash-zone__text--failed' : 'trash-zone__text trash-zone__text--muted'} aria-live="polite">
          {note.text}
        </p>
      )}
    </section>
  );
}

export default TrashZone;
