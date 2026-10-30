import { useCallback, useMemo, useState } from 'react';
import {
  EDITED_PART_LABEL,
  changedParts,
  editsPatch,
  patchedDraft,
  rebaseDraft,
  savedEdits,
  type EditedPart,
  type SessionEdits,
} from '../library/sessionEdits';
import type { SailingSessionNotes } from '../library/notes';
import { useLeaveWarning } from './leaveGuard';
import { updateSessionRecord, useLibrarySession } from './useSessionLibrary';

/** Brouillon et état enregistré sur lequel il a été fait, pour le reporter si la fiche change (`rebaseDraft`). */
interface Draft {
  base: SessionEdits;
  edits: SessionEdits;
}

/**
 * Brouillon des changements faits sur une session (vent saisi, seuil
 * d'activité, allure, couleurs, seuil d'effort, notes) : l'analyse les suit tout de suite,
 * mais la fiche ne les reçoit qu'à `save`, et `cancel` revient à l'état
 * enregistré. Quitter la page avec un brouillon enregistrable demande
 * confirmation (`useLeaveWarning`).
 *
 * Le brouillon d'une session de la mémoire survit à un changement de page,
 * jusqu'à ce qu'on l'enregistre ou l'abandonne. Celui d'un GPX ouvert hors de
 * la mémoire (`file` à `null`) ne vit que le temps de la page : il ne peut pas
 * être enregistré. Si la fiche change sous lui (activité changée, relecture
 * du dossier), il la suit là où il ne la contredit pas (`rebaseDraft`).
 */
const drafts = new Map<string, Draft>();

export const useSessionDraft = (file: string | null) => {
  const session = useLibrarySession(file);
  const record = session?.record ?? null;
  const saved = useMemo(() => savedEdits(record), [record]);

  const key = file ?? '';
  const [stored, setStored] = useState<Draft | null>(() => drafts.get(key) ?? null);
  const [draftKey, setDraftKey] = useState(key);
  // Autre session : son propre brouillon. Comparaison pendant le rendu plutôt qu'un `useEffect`.
  let current = stored;
  if (key !== draftKey) {
    current = drafts.get(key) ?? null;
    setDraftKey(key);
    setStored(current);
  }
  // Fiche changée sous le brouillon (activité, relecture du dossier) : il la suit là où il ne la contredit pas.
  if (current && current.base !== saved) {
    current = { base: saved, edits: rebaseDraft(current.base, saved, current.edits) };
    if (file !== null) drafts.set(file, current);
    setStored(current);
  }
  const draft = current?.edits ?? null;

  const edits = draft ?? saved;
  const changed: EditedPart[] = useMemo(() => (draft ? changedParts(saved, draft) : []), [saved, draft]);

  /**
   * Change le brouillon à partir de celui du moment, relu à l'instant et non
   * figé au dernier rendu : deux changements d'un même geste se cumulent (A5).
   */
  const change = useCallback(
    (patch: (edits: SessionEdits) => Partial<SessionEdits>) => {
      const apply = (prev: Draft | null): Draft => {
        const prevEdits = prev ? (prev.base === saved ? prev.edits : rebaseDraft(prev.base, saved, prev.edits)) : null;
        return { base: saved, edits: patchedDraft(prevEdits, saved, patch) };
      };
      if (file === null) {
        setStored(apply);
        return;
      }
      const next = apply(drafts.get(file) ?? null);
      drafts.set(file, next);
      setStored(next);
    },
    [file, saved]
  );

  const update = useCallback((patch: Partial<SessionEdits>) => change(() => patch), [change]);

  const updateNotes = useCallback(
    (patch: Partial<SailingSessionNotes>) => change((edits) => ({ notes: { ...edits.notes, ...patch } })),
    [change]
  );

  const cancel = useCallback(() => {
    if (file !== null) drafts.delete(file);
    setStored(null);
  }, [file]);

  const savable = session !== undefined && !session.readOnly;

  const save = useCallback(() => {
    if (!draft || !record || !savable || file === null) return;
    updateSessionRecord(file, editsPatch(record, saved, draft, Date.now()));
    cancel();
  }, [draft, record, savable, file, saved, cancel]);

  const changedText = changed.map((part) => EDITED_PART_LABEL[part]).join(', ');
  const dirty = changed.length > 0;
  const leaveWarning = useMemo(
    () =>
      dirty && savable
        ? {
            message: `Modifications non enregistrées sur cette session (${changedText}). Quitter sans les enregistrer ?`,
            discard: cancel,
          }
        : null,
    [dirty, savable, cancel, changedText]
  );
  useLeaveWarning(leaveWarning);

  return {
    /** État affiché : le brouillon, sinon l'état enregistré. */
    edits,
    update,
    updateNotes,
    /** Parties changées depuis le dernier enregistrement. */
    changed,
    /** Parties changées, en clair : « vent, notes ». */
    changedText,
    dirty,
    save,
    cancel,
    /** Faux pour une session hors de la mémoire, ou dont la fiche ne peut pas être réécrite. */
    savable,
    /** Vrai si la fiche porte déjà des notes. */
    hasSavedNotes: record?.notes != null,
  };
};
