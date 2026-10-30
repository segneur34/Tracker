import { useCallback, useState } from 'react';
import { jsonStore } from '../platform/storage';
import { MAX_STORED_RESTING_RESULTS, readStoredRestingResults, type StoredRestingResult } from '../library/restingHrStore';

/**
 * Tests de FC repos gardés sur l'appareil, du plus récent au plus ancien. Une
 * clé à part, hors des réglages recopiés dans le dossier mémoire : un test
 * sans GPS n'a pas encore de session (fiche ni GPX) où se ranger ; ce sera
 * celle du lot « Muscu ».
 */
const KEY = 'tracker.restingHr';

const readResults = (): StoredRestingResult[] => readStoredRestingResults(jsonStore.read<unknown>(KEY));

export const useRestingHrResults = () => {
  const [results, setResults] = useState<StoredRestingResult[]>(readResults);

  const persist = useCallback((next: StoredRestingResult[]) => {
    jsonStore.write(KEY, next);
    setResults(next);
  }, []);

  /** Ajoute un test (relit la liste avant : un autre onglet a pu en ajouter). */
  const add = useCallback(
    (result: StoredRestingResult) => {
      const without = readResults().filter((r) => r.startedAtMs !== result.startedAtMs);
      persist([result, ...without].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, MAX_STORED_RESTING_RESULTS));
    },
    [persist]
  );

  const remove = useCallback((startedAtMs: number) => persist(readResults().filter((r) => r.startedAtMs !== startedAtMs)), [persist]);

  return { results, add, remove };
};
