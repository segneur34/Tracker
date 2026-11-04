import type { SessionMark } from '../../core/sessionMarks';
import type { SportType } from '../../core/types';
import { describeImport, type ImportReport } from '../../library/importReport';
import { importRecordChoice } from '../../library/importEntry';
import { isBlankGpxText, isGpxFileName } from '../../library/record';
import { unbundleSessionGpx } from '../../library/sessionBundle';
import { readPickedBytes, readPickedFile } from '../../platform/files';
import { pickFolderToImport, type ImportEntry } from '../../platform/memoryFolder';
import type { IntervalSeries } from '../../recording/intervalTimer';
import type { SessionTest } from '../../recording/fitnessTest';
import { errorMessage } from '../../core/basics';
import { libraryState, reportError, setState, type LibraryState } from './store';
import { hasSessionMotion, lib } from './memory';
import { scheduleCacheUpdate } from './cache';
import { addGpx } from './addSession';

/**
 * Import de sessions et rangement d'un enregistrement (lot 113) : GPX choisis, dossier mémoire entier, session
 * qui vient d'être enregistrée.
 */

/**
 * Range une session qui vient d'être enregistrée, avec les séances du
 * compteur faites pendant elle, ses repères (`marks`), ses capteurs (`motion`, le contenu du
 * `.imu`), le foil de son activité (`foil`, `null` hors voile et surf) et son test guidé (`test`). Rend son nom dans la mémoire et, en clair, l'endroit où elle se
 * trouve. Ne lève d'erreur que si l'écriture échoue : l'enregistreur garde
 * alors son journal. Une session mise en attente faute de dossier y attend
 * avec ses capteurs et sa fiche (activité, foil, séances, repères, test),
 * rangées avec elle dès qu'un dossier est là (`flushPending`). Une session
 * déjà dans la mémoire (fiche coupée par un arrêt de l'application) reçoit
 * de l'enregistrement ce qui manque à sa fiche (`completeRecord`).
 */
export const saveRecordedSession = async (
  text: string,
  sport: SportType | null,
  activityId: string | null,
  intervals: IntervalSeries[] = [],
  motion: Uint8Array | null = null,
  marks: SessionMark[] = [],
  foil: boolean | null = null,
  test: SessionTest | null = null
): Promise<{ file: string | null; location: string }> => {
  await lib.opening;
  const result = await addGpx(text, 'enregistrement', {
    // Calcul inconnu (journal sans en-tête) : rien de deviné, la session est rangée « à classer ».
    sport, activityId: activityId ?? undefined, intervals, marks, motion: motion ?? undefined, foil: foil ?? undefined, test: test ?? undefined,
  });
  switch (result.status) {
    case 'added':
      return { file: result.file, location: libraryState().folderLabel ?? 'mémoire' };
    case 'duplicate':
      // Fiche de la session déjà rangée non relue ou en lecture seule : rien n'y est ajouté, l'enregistreur garde son journal.
      if (result.recordNotRead) throw new Error('session déjà dans la mémoire, mais sa fiche n\'a pas pu être relue pour la compléter');
      if (result.recordReadOnly) throw new Error('session déjà dans la mémoire, mais sa fiche y est en lecture seule (non lue, illisible ou plus récente)');
      return { file: result.file, location: 'déjà dans la mémoire' };
    case 'pending':
      return { file: null, location: 'en attente d\'un dossier mémoire (dossier privé de l\'application)' };
    case 'unsaved':
      return { file: null, location: 'non rangée, aucune mémoire accessible : à télécharger' };
    default:
      throw new Error(result.message ?? 'session illisible');
  }
};

/** Fichier choisi dans le navigateur, lu seulement au moment de le ranger. */
const pickedEntry = (file: File): ImportEntry => ({
  name: file.name,
  key: (file.webkitRelativePath || file.name).replace(/\.(gpx|json|imu)$/i, '').toLowerCase(),
  readText: () => readPickedFile(file),
  readBytes: () => readPickedBytes(file),
});

/**
 * Importe des fichiers : des GPX, ou un dossier mémoire entier, dont chaque
 * fiche accompagne son GPX (notes et support compris). Chaque session est lue
 * juste avant d'être rangée, GPX, fiche et capteurs, puis relâchée : un
 * dossier entier n'est jamais chargé d'un coup (E-B1). Une session déjà
 * présente n'est pas dupliquée ; si elle n'avait pas ses capteurs, elle reçoit
 * ceux du dossier (`.imu`). Un fichier qu'on ne peut lire ou ranger n'arrête
 * pas les autres : il est nommé, avec la raison, dans une erreur. Des capteurs
 * illisibles ne retiennent ni le GPX ni la fiche : comptés à part
 * (`motionFailed`), un nouvel import les ajoute (`motionAdded`). Sans
 * dossier mémoire, rien n'est rangé ni mis en attente (décision du 27/10).
 */
export const importEntries = async (entries: ImportEntry[]): Promise<ImportReport> => {
  setState({ importing: true });
  const report: ImportReport = {
    added: [], existing: [], duplicates: 0, invalid: [], ignored: [], unsaved: 0, failed: [], motionAdded: 0, motionFailed: [], recordCompleted: 0, recordNotRead: 0,
  };
  try {
    await lib.opening;
    const records = new Map<string, ImportEntry>();
    const motions = new Map<string, ImportEntry>();
    for (const entry of entries) {
      if (/\.json$/i.test(entry.name)) records.set(entry.key, entry);
      else if (/\.imu$/i.test(entry.name)) motions.set(entry.key, entry);
    }

    for (const entry of entries) {
      if (!isGpxFileName(entry.name)) continue;
      try {
        const text = await entry.readText();
        if (text === null) {
          report.failed.push(`${entry.name} : illisible`);
          continue;
        }
        // GPX vide : pas une session, ni illisible.
        if (isBlankGpxText(text)) {
          report.ignored.push(entry.name);
          continue;
        }
        // GPX complet (`library/sessionBundle.ts`) : la fiche et les capteurs qu'il porte servent
        // à défaut de fichiers posés à côté ; la mémoire range le GPX sans eux.
        const bundle = unbundleSessionGpx(text);
        const recordText = await records.get(entry.key)?.readText();
        // Fiche posée à côté, sinon celle du paquet ; gardée telle quelle si on ne sait pas la réécrire.
        const { record, unreadable, keepRecordText } = importRecordChoice(recordText, bundle);
        // Capteurs illisibles : la session est rangée sans eux, et comptée à part ; ceux du paquet les remplacent s'il en porte.
        let motionFailed = false;
        const sideMotion = await motions.get(entry.key)?.readBytes().catch(() => {
          motionFailed = true;
          return null;
        });
        const motion = sideMotion ?? bundle.motion ?? undefined;
        const result = await addGpx(bundle.gpx, 'import', { record, motion, unreadable, keepRecordText });
        if (result.status === 'added' && result.file) report.added.push(result.file);
        else if (result.status === 'duplicate') {
          report.duplicates += 1;
          if (result.file) report.existing.push(result.file);
          if (result.motionAdded) report.motionAdded += 1;
          if (result.recordCompleted) report.recordCompleted += 1;
          if (result.recordNotRead) report.recordNotRead += 1;
        }
        else if (result.status === 'invalid') report.invalid.push(entry.name);
        else report.unsaved += 1;
        // Une session qui a déjà ses capteurs n'a rien perdu.
        if (motionFailed && !motion && result.file && !hasSessionMotion(result.file)) report.motionFailed.push(entry.name);
      } catch (err) {
        report.failed.push(`${entry.name} : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    if (lib.folder) scheduleCacheUpdate(lib.folder);
    if (report.failed.length === 0) {
      setState({ message: describeImport(report) });
    } else {
      // Le compte rendu va avec l'échec : le bandeau d'erreur cacherait sinon le message.
      const n = report.failed.length;
      reportError(`${describeImport(report)} ${n} fichier${n > 1 ? 's' : ''} non rangé${n > 1 ? 's' : ''} (${report.failed.join(' ; ')})`);
    }
  } catch (err) {
    reportError(`Import interrompu : ${errorMessage(err, 'erreur inconnue')}`);
  } finally {
    setState({ importing: false });
  }
  return report;
};

/** Importe des fichiers choisis dans le navigateur (`importEntries`). */
export const importFiles = (files: File[]): Promise<ImportReport> => importEntries(files.map(pickedEntry));

/**
 * Sur le téléphone, ajoute les sessions d'un dossier que l'utilisateur désigne
 * (un dossier Tracker copié depuis le PC) : `importEntries` sur ses GPX, ses
 * fiches et ses capteurs, lus un par un. L'import est annoncé dès le
 * sélecteur, boutons grisés. `null` si l'utilisateur renonce.
 */
export const importFromFolder = async (): Promise<ImportReport | null> => {
  setState({ importing: true });
  let entries: ImportEntry[] | null;
  try {
    entries = await pickFolderToImport();
  } catch (err) {
    setState({ importing: false, message: `Lecture du dossier impossible : ${errorMessage(err, String(err))}` });
    return null;
  }
  if (!entries) {
    setState({ importing: false });
    return null;
  }
  return importEntries(entries);
};

/**
 * Peut-on importer : seulement dans une mémoire ouverte, où l'on peut écrire.
 * Sans dossier, un import est refusé plutôt que mis en attente (décision du
 * 27/10) : seuls les enregistrements attendent un dossier.
 */
export const canImportSessions = (s: Pick<LibraryState, 'status' | 'memoryReadOnly'>): boolean => s.status === 'ready' && !s.memoryReadOnly;
