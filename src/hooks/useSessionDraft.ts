import { useCallback, useMemo, useState } from 'react';
import {
  changedParts,
  editsPatch,
  latestGearNotes,
  savedEdits,
  type EditedPart,
  type SessionEdits,
} from '../library/sessionEdits';
import type { SailingSessionNotes } from '../sailing/sessionNotes';
import { findLibrarySession, updateSessionRecord, useSessionLibrary } from './useSessionLibrary';

/**
 * Brouillon des changements faits sur une session (vent saisi, seuil
 * d'activité, notes) : l'analyse les suit tout de suite, mais la fiche ne les
 * reçoit qu'à `save`, et `cancel` revient à l'état enregistré.
 *
 * Le brouillon d'une session de la mémoire survit à un changement de page,
 * jusqu'à ce qu'on l'enregistre ou l'abandonne. Celui d'un GPX ouvert hors de
 * la mémoire (`file` à `null`) ne vit que le temps de la page : il ne peut pas
 * être enregistré.
 */
const drafts = new Map<string, SessionEdits>();

export const useSessionDraft = (file: string | null) => {
  const { sessions } = useSessionLibrary();
  const session = findLibrarySession(sessions, file);
  const record = session?.record ?? null;
  const gear = useMemo(() => latestGearNotes(sessions.map((s) => s.record)), [sessions]);
  const saved = useMemo(() => savedEdits(record, gear), [record, gear]);

  const key = file ?? '';
  const [draft, setDraft] = useState<SessionEdits | null>(() => drafts.get(key) ?? null);
  const [draftKey, setDraftKey] = useState(key);
  // Autre session : son propre brouillon. Comparaison pendant le rendu plutôt qu'un `useEffect`.
  if (key !== draftKey) {
    setDraftKey(key);
    setDraft(drafts.get(key) ?? null);
  }

  const edits = draft ?? saved;
  const changed: EditedPart[] = useMemo(() => (draft ? changedParts(saved, draft) : []), [saved, draft]);

  const update = useCallback(
    (patch: Partial<SessionEdits>) => {
      const next = { ...edits, ...patch };
      if (file !== null) drafts.set(file, next);
      setDraft(next);
    },
    [edits, file]
  );

  const updateNotes = useCallback(
    (patch: Partial<SailingSessionNotes>) => update({ notes: { ...edits.notes, ...patch } }),
    [update, edits.notes]
  );

  const cancel = useCallback(() => {
    if (file !== null) drafts.delete(file);
    setDraft(null);
  }, [file]);

  const savable = session !== undefined && !session.readOnly;

  const save = useCallback(() => {
    if (!draft || !record || !savable || file === null) return;
    updateSessionRecord(file, editsPatch(record, saved, draft, Date.now()));
    cancel();
  }, [draft, record, savable, file, saved, cancel]);

  return {
    /** État affiché : le brouillon, sinon l'état enregistré. */
    edits,
    update,
    updateNotes,
    /** Parties changées depuis le dernier enregistrement. */
    changed,
    dirty: changed.length > 0,
    save,
    cancel,
    /** Faux pour une session hors de la mémoire, ou dont la fiche ne peut pas être réécrite. */
    savable,
    /** Vrai si la fiche porte déjà des notes. */
    hasSavedNotes: record?.notes != null,
  };
};
