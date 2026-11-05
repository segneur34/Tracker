import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../core/basics';
import { jsonStore } from '../platform/storage';
import { MAX_STORED_RESTING_RESULTS, RESTING_HR_KEY, type StoredRestingResult } from '../library/restingHrStore';
import { readDeviceRestingResults, saveRestingHrFile } from './restingHrFile';
import { currentMemoryFolder, reportStartupError } from './useSessionLibrary';

/**
 * Tests de FC repos gardés sur l'appareil, du plus récent au plus ancien. Une
 * clé à part, hors des réglages recopiés dans le dossier mémoire : un test
 * sans GPS n'a pas encore de session (fiche ni GPX) où se ranger ; ce sera
 * celle du lot « Muscu ». En attendant, la liste est aussi recopiée dans
 * `fc-repos.json` du dossier (`restingHrFile.ts`), qui la fait suivre l'appareil.
 */

const readResults = readDeviceRestingResults;

export const useRestingHrResults = () => {
  const [results, setResults] = useState<StoredRestingResult[]>(readResults);

  // Une fusion arrivée après l'affichage (ouverture du dossier) écrit la clé : la page la voit.
  useEffect(() => {
    const reload = () => setResults(readResults());
    reload();
    return jsonStore.subscribeKey(RESTING_HR_KEY, reload);
  }, []);

  const persist = useCallback((next: StoredRestingResult[]) => {
    jsonStore.write(RESTING_HR_KEY, next);
    setResults(next);
    // Le test est déjà gardé sur l'appareil : une panne d'écriture du dossier est dite, sans rien défaire.
    void currentMemoryFolder()
      .then((folder) => (folder ? saveRestingHrFile(folder, next) : undefined))
      .catch((err: unknown) => reportStartupError(`Tests de FC repos non recopiés dans le dossier : ${errorMessage(err, 'erreur inconnue')}`));
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
