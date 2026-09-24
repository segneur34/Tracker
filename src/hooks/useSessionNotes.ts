import { useCallback, useMemo } from 'react';
import type { StoredSessionNotes } from '../library/record';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';
import { findLibrarySession, updateSessionRecord, useSessionLibrary } from './useSessionLibrary';

/**
 * Notes d'une session à voile, gardées dans sa fiche du dossier mémoire : elles
 * suivent la session quand on copie le dossier.
 *
 * Quand une session n'a encore aucune note, le matériel de la dernière
 * session notée est proposé par défaut : on change rarement de foil entre
 * deux sorties. Il n'est écrit qu'à la première saisie.
 */
export const useSessionNotes = (file: string | null) => {
  const { sessions } = useSessionLibrary();
  const session = findLibrarySession(sessions, file);
  const stored = session?.record.notes ?? null;

  const latestGear = useMemo(() => {
    let latest: StoredSessionNotes | null = null;
    for (const s of sessions) {
      const n = s.record.notes;
      if (n && (n.foil || n.mast || n.wing) && (!latest || n.savedAt > latest.savedAt)) latest = n;
    }
    return latest;
  }, [sessions]);

  const notes: SailingSessionNotes = useMemo(() => {
    if (stored) return stored;
    if (!latestGear) return EMPTY_NOTES;
    return { ...EMPTY_NOTES, foil: latestGear.foil, mast: latestGear.mast, wing: latestGear.wing };
  }, [stored, latestGear]);

  const setNotes = useCallback(
    (patch: Partial<SailingSessionNotes>) => {
      if (file === null) return;
      updateSessionRecord(file, { notes: { ...notes, ...patch, savedAt: Date.now() } });
    },
    [file, notes]
  );

  return {
    notes,
    setNotes,
    isSaved: stored !== null,
    /** Faux pour une session hors de la mémoire, ou dont la fiche ne peut pas être réécrite. */
    available: session !== undefined && !session.readOnly,
  };
};
