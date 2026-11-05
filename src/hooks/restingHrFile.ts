import { RESTING_HR_FILE } from '../library/folderLayout';
import {
  RESTING_HR_KEY, mergeRestingResults, parseRestingHrFile, readStoredRestingResults, restingHrFileText, sameRestingResults,
  type StoredRestingResult,
} from '../library/restingHrStore';
import type { MemoryFolder } from '../platform/memoryFolder';
import { jsonStore, storageStartupFailure } from '../platform/storage';

/**
 * Tests de FC repos dans le dossier mémoire (`fc-repos.json`, à la racine) : la sauvegarde Google est coupée, ce
 * fichier les fait suivre l'appareil. Lecture et écriture par l'interface du dossier (règle 12). Pont avant que
 * ces tests rejoignent les sessions (DECISIONS §5).
 *
 * Limite assumée : la fusion est une union sans mémoire des retraits (`mergeRestingResults`) ; un test retiré
 * sur un appareil peut revenir depuis un autre appareil du dossier qui l'a encore.
 */

/** Liste de l'appareil, relue de sa clé. */
export const readDeviceRestingResults = (): StoredRestingResult[] => readStoredRestingResults(jsonStore.read<unknown>(RESTING_HR_KEY));

/**
 * Écrit `results` dans le dossier, sauf en lecture seule ou si le fichier en place ne se lit pas (jamais écrasé).
 * Lève si l'écriture échoue : à l'appelant de ne pas en faire un obstacle.
 */
export const saveRestingHrFile = async (f: MemoryFolder, results: readonly StoredRestingResult[]): Promise<void> => {
  if (f.readOnly) return;
  if (parseRestingHrFile(await f.readText(RESTING_HR_FILE)) === null) return;
  await f.writeText(RESTING_HR_FILE, restingHrFileText(results));
};

/**
 * À l'ouverture du dossier : fusionne le fichier et la liste de l'appareil. La clé de l'appareil et le fichier ne
 * sont réécrits que si la fusion a changé quelque chose. Fichier illisible : rien n'est touché. Stockage de
 * l'appareil illisible au démarrage : sa liste n'est pas fiable, rien n'est écrit de son côté.
 */
export const syncRestingHrFile = async (f: MemoryFolder): Promise<void> => {
  const fromFile = parseRestingHrFile(await f.readText(RESTING_HR_FILE));
  if (fromFile === null || storageStartupFailure()) return;
  const local = readDeviceRestingResults();
  const merged = mergeRestingResults(local, fromFile);
  if (!sameRestingResults(merged, local)) jsonStore.write(RESTING_HR_KEY, merged);
  if (!f.readOnly && !sameRestingResults(merged, fromFile)) await f.writeText(RESTING_HR_FILE, restingHrFileText(merged));
};
