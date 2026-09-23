import { useCallback, useEffect, useRef } from 'react';
import { EMPTY_NOTES, type SailingSessionNotes } from '../sailing/sessionNotes';
import { useStoredRecord } from './useStoredRecord';

const NAMESPACE = 'tracker.sailingNotes';

type StoredNotes = SailingSessionNotes & { savedAt?: number };

/**
 * Notes d'une session à voile, persistées par session.
 *
 * Quand une session n'a encore aucune note, le matériel de la dernière
 * session notée est proposé par défaut : on change rarement de foil entre
 * deux sorties.
 */
export const useSessionNotes = (sessionKey: string | null) => {
  const { value, update, loaded, readLatest } = useStoredRecord<StoredNotes>(
    NAMESPACE,
    sessionKey,
    EMPTY_NOTES
  );
  const prefilledFor = useRef<string | null>(null);

  useEffect(() => {
    if (!loaded || sessionKey === null || prefilledFor.current === sessionKey) return;
    prefilledFor.current = sessionKey;
    if (value.savedAt !== undefined) return;

    const latest = readLatest();
    if (latest && (latest.foil || latest.mast || latest.wing)) {
      update({ foil: latest.foil, mast: latest.mast, wing: latest.wing });
    }
  }, [loaded, sessionKey, value.savedAt, readLatest, update]);

  const setNotes = useCallback(
    (patch: Partial<SailingSessionNotes>) => update({ ...patch, savedAt: Date.now() }),
    [update]
  );

  return {
    notes: value as SailingSessionNotes,
    setNotes,
    isSaved: value.savedAt !== undefined,
  };
};
