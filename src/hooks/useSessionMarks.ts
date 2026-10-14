import { useCallback, useMemo } from 'react';
import { locateMarks, type LocatedMark, type SessionMark } from '../core/sessionMarks';
import type { useSessionDraft } from './useSessionDraft';

type SessionDraft = ReturnType<typeof useSessionDraft>;

export interface SessionMarksView {
  /** Repères du brouillon, placés sur la trace, dans l'ordre du temps. */
  located: LocatedMark[];
  /** Nomme un repère ; un nom vide le retire. */
  rename: (mark: SessionMark, label: string) => void;
  remove: (mark: SessionMark) => void;
  /** Faux pour une session hors de la mémoire : la liste se lit sans se changer. */
  editable: boolean;
}

/**
 * Repères du bouton « Note » d'une session, pour son analyse : ceux du
 * brouillon (`useSessionDraft`), placés sur la trace (`locateMarks`).
 * Nommer et supprimer passent par le brouillon, écrit par « Enregistrer la
 * session ». Commun aux trois modules.
 */
export const useSessionMarks = (
  draft: SessionDraft,
  track: ReadonlyArray<{ timeMs: number }>,
  cumDist: readonly number[]
): SessionMarksView => {
  const marks = draft.edits.marks;
  const located = useMemo(() => locateMarks(track, cumDist, marks), [track, cumDist, marks]);
  const { update } = draft;
  const rename = useCallback(
    (mark: SessionMark, label: string) =>
      update({ marks: marks.map((m) => (m === mark ? { ...m, label: label === '' ? null : label } : m)) }),
    [update, marks]
  );
  const remove = useCallback((mark: SessionMark) => update({ marks: marks.filter((m) => m !== mark) }), [update, marks]);
  return { located, rename, remove, editable: draft.savable };
};
