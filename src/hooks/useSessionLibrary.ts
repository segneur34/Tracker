import { useRef, useSyncExternalStore } from 'react';
import type { LibrarySession } from '../library/record';
import { libraryState, subscribe, type LibraryState } from './sessionLibrary/store';
import { findSession, sessionOfFile } from './sessionLibrary/memory';

/**
 * Bibliothèque des sessions : la mémoire de l'application, tenue dans un
 * dossier qu'on copie pour la sauvegarder ou la déplacer
 * (`docs/ETAT_DU_PROJET.md` §6). Elle vit hors des composants, comme
 * l'enregistreur : les pages la lisent par `useSessionLibrary` et la pilotent
 * par les fonctions exportées.
 *
 * Au lancement (`openLibrary`) :
 * 1. le dossier mémoire est ouvert, et reçoit son marqueur et son
 *    `LISEZMOI.txt` s'ils manquent ;
 * 2. les réglages sont rapprochés de `reglages.json`, le plus récent
 *    l'emporte ;
 * 3. `sessions/` est lu en une fois et rapproché du cache des fiches :
 *    seules les fiches qui ont changé sont relues, et la liste s'affiche. Le
 *    cache ne garde que des fiches allégées (`lightRecord`) : une session qui
 *    en vient est `partial`, et sa fiche est relue en entier avant d'être
 *    écrite ou ouverte dans une analyse (`hydrateSession`) ;
 * 4. en tâche de fond, chaque GPX sans fiche en reçoit une, et chaque fiche
 *    dont le résumé est périmé est recalculée, notes intactes.
 *
 * « Mettre à jour » (`refreshLibrary`) refait les étapes 2 à 4 sans refermer
 * le dossier : sessions et itinéraires copiés depuis un autre appareil
 * pendant que l'application est ouverte.
 *
 * Les écritures d'une fiche (notes surtout, saisies lettre à lettre) sont
 * regroupées et différées, puis vidées dès que l'application passe en
 * arrière-plan.
 *
 * Ce fichier est le point d'entrée : les pages n'importent que lui. Le reste est
 * découpé par sujet sous `hooks/sessionLibrary/` (lot 113), en couches dont
 * chacune n'importe que les précédentes (`couches.test.ts`) : `store`,
 * `memory`, `summarySettings`, `recordWrites`, `cache`, `scan`,
 * `summaryQueue`, `deviceSettings`, `addSession`, `pending`, `importer`, `incoming`,
 * `sessionRecords`, `lifecycle`.
 */

export type { LibraryState, LibraryStatus } from './sessionLibrary/store';
export { dismissIncomingNotice, dismissLibraryMessage, dismissSettingsOffer, readLibraryState, reportStartupError } from './sessionLibrary/store';
export { hasSessionMotion } from './sessionLibrary/memory';
export { summarizeGpxText } from './sessionLibrary/summarySettings';
export { queueOutdatedRefresh } from './sessionLibrary/summaryQueue';
export { adoptSettingsFile, importSettingsFile, renameDevice, settingsUpgraded } from './sessionLibrary/deviceSettings';
export type { AddResult, AddStatus } from './sessionLibrary/addSession';
export { answerImportQuestion, canImportSessions, importEntries, importFiles, importFromFolder, saveRecordedSession } from './sessionLibrary/importer';
export { startIncomingFiles } from './sessionLibrary/incoming';
export {
  loadFullSession, loadSessionGpx, readSessionExport, readSessionGpx, readSessionMotion, removeSession,
  updateSessionRecord,
} from './sessionLibrary/sessionRecords';
export {
  canChooseMemoryFolder, chooseFolder, currentMemoryFolder, openLibrary, reconnectFolder, refreshLibrary,
  startLibraryUi, switchToBrowserMemory,
} from './sessionLibrary/lifecycle';
export type { SettingsFileInfo } from '../library/settingsFile';

/**
 * Quelques champs de l'état : le composant n'est rendu de nouveau que si l'un
 * d'eux change (ni le balayage ni les messages, s'il ne les lit pas).
 */
export const useLibraryFields = <K extends keyof LibraryState>(...keys: K[]): Pick<LibraryState, K> => {
  const last = useRef<Pick<LibraryState, K> | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const snapshot = libraryState();
    const prev = last.current;
    if (prev && keys.every((k) => prev[k] === snapshot[k])) return prev;
    const next = {} as Pick<LibraryState, K>;
    for (const k of keys) next[k] = snapshot[k];
    last.current = next;
    return next;
  });
};

/** Session d'un fichier, lue hors d'un composant, doublons compris. */
export const librarySession = (file: string): LibrarySession | undefined => findSession(file);

/** Session d'un fichier, ou `undefined` si la bibliothèque ne la connaît pas. */
export const findLibrarySession = (sessions: LibrarySession[], file: string | null): LibrarySession | undefined =>
  file === null ? undefined : sessionOfFile(sessions, file);

/**
 * Une partie de l'état de la bibliothèque : le composant n'est rendu de
 * nouveau que si elle change (une analyse ne suit pas le balayage ni les
 * messages). `select` doit rendre une valeur stable pour un même état : une
 * primitive, ou un objet déjà rangé dans l'état, jamais un objet neuf.
 */
export const useLibrarySelector = <T>(select: (s: LibraryState) => T): T =>
  useSyncExternalStore(subscribe, () => select(libraryState()));

/**
 * Session d'un fichier, `undefined` si la bibliothèque ne la connaît pas.
 * Elle garde son identité tant que sa fiche ne change pas.
 */
export const useLibrarySession = (file: string | null): LibrarySession | undefined =>
  useLibrarySelector((s) => findLibrarySession(s.sessions, file));

/** Nom donné par l'utilisateur à la session d'un fichier, `null` sans nom ou hors de la mémoire. */
export const useSessionName = (file: string | null): string | null =>
  useLibrarySelector((s) => findLibrarySession(s.sessions, file)?.record.name ?? null);
