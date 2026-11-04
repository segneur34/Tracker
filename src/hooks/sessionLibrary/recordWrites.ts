import { sessionPath } from '../../library/folderLayout';
import { DAMAGED_RECORD_WARNING, FUTURE_RECORD_WARNING, isBlankRecordText } from '../../library/recordText';
import {
  carryRecordEdits, isWritableRecord, parseRecordWithRaw, recordFileName, sameJson, serializeRecord,
  type LibrarySession, type SessionRecord,
} from '../../library/record';
import { addRecordEdits, conflictLabels, mergeChangedRecord, sameStamp } from '../../library/recordMerge';
import { analyzeGpx, withSummary } from '../../library/summaryOptions';
import type { FileStat, MemoryFolder } from '../../platform/memoryFolder';
import { errorMessage } from '../../core/basics';
import { libraryState, reportError } from './store';
import {
  cacheDirty, findSession, findSessionAt, hydrateSession, lastEdit, lib, rememberUnreadable, removing, replaceSession,
  unreadableOf, unwritten,
} from './memory';
import { refreshFailed, sessionSummarySettings, summaryOutdatedTest } from './summarySettings';

/**
 * Écritures des fiches (lot 113) : différées et regroupées, une à la fois par fiche, fondues avec le disque si le
 * fichier a changé depuis sa lecture (`library/recordMerge.ts`) ; résumé refait après un changement de réglage
 * de la session, et saisies reportées dans un nouveau dossier.
 */

const RECORD_WRITE_DELAY_MS = 800;

export const recordTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Écritures en cours, par fiche. */
export const writing = new Map<string, number>();

/**
 * Ce qui a changé ici dans chaque fiche depuis sa dernière écriture (`library/recordMerge.ts`) : c'est tout ce
 * qu'on y garde contre le disque. Vidé à l'écriture réussie et au changement de dossier.
 */
export const recordEdits = new Map<string, Map<string, unknown>>();

const NO_EDITS: ReadonlyMap<string, unknown> = new Map();

export const noteRecordEdits = (file: string, before: SessionRecord, after: SessionRecord): void => {
  const edits = recordEdits.get(file) ?? new Map<string, unknown>();
  addRecordEdits(edits, before, after);
  if (edits.size > 0) recordEdits.set(file, edits);
};

/**
 * Écrit le texte d'une fiche et retient sa taille et sa date. Date illisible : plus de tampon, et la fiche
 * sera relue avant sa prochaine écriture.
 */
export const writeRecordFile = async (f: MemoryFolder, file: string, text: string): Promise<void> => {
  const path = sessionPath(recordFileName(file));
  await f.writeText(path, text);
  const stamp = await f.stat(path).catch(() => null);
  if (lib.folder !== f) return;
  if (stamp) lib.diskStamps.set(file, stamp);
  else lib.diskStamps.delete(file);
};

/**
 * Juste avant d'écrire une fiche : si son fichier a changé depuis qu'on l'a lu, il est relu et fondu avec
 * ce qui a été changé ici (`mergeChangedRecord`), silencieusement, sauf si un même champ a changé des deux
 * côtés. Rend `write` s'il reste à écrire la session en mémoire ; `same` si le disque a déjà tout ;
 * `stop` si rien n'est à écrire : relu illisible ou d'une version plus récente, la session passe en lecture seule, dit
 * par son avertissement. Une fiche disparue s'écrit, comme avant. Une lecture qui lève remonte : rien n'est écrit à l'aveugle.
 */
const reconcileWithDisk = async (f: MemoryFolder, file: string): Promise<'write' | 'same' | 'stop'> => {
  const path = sessionPath(recordFileName(file));
  let seen: FileStat | null = null;
  let statFailed = false;
  try {
    seen = await f.stat(path);
  } catch {
    statFailed = true;
  }
  if (!statFailed && seen === null) return 'write';
  if (sameStamp(lib.diskStamps.get(file), seen)) return 'write';
  const text = await f.readText(path);
  if (lib.folder !== f || removing.has(file)) return 'stop';
  if (text === null || isBlankRecordText(text)) return 'write';
  const current = findSession(file);
  if (!current || current.readOnly || current.partial) return 'stop';
  const quiet = libraryState().scanning !== null;
  const parsed = parseRecordWithRaw(text);
  if (!parsed || !isWritableRecord(parsed.parts)) {
    const warning = parsed ? FUTURE_RECORD_WARNING : DAMAGED_RECORD_WARNING;
    const record = parsed ? { ...parsed.parts, summary: parsed.parts.summary ?? current.record.summary, gpx: file } : current.record;
    replaceSession({ ...current, record, readOnly: true, warning }, quiet);
    if (recordEdits.delete(file)) reportError(`Changements de ${file} non enregistrés. ${warning}`);
    return 'stop';
  }
  rememberUnreadable(f, file, parsed.unreadable);
  if (seen) lib.diskStamps.set(file, seen);
  else lib.diskStamps.delete(file);
  const { record, conflicts } = mergeChangedRecord(parsed.parts, current.record, recordEdits.get(file) ?? NO_EDITS);
  if (!sameJson(record, current.record)) replaceSession({ ...current, record }, quiet);
  if (conflicts.length > 0) {
    reportError(`${file} a aussi changé sur un autre appareil (${conflictLabels(conflicts).join(', ')}) : la saisie la plus récente est gardée`);
  }
  // Réglages changés sur le disque, ou résumé d'un calcul plus récent gardé : la session est peut-être à refaire. Dans le
  // second cas, ce calcul-ci ne le remplacerait jamais : pas de nouvel essai avant la prochaine ouverture.
  if (summaryOutdatedTest()(record)) {
    const diskAhead = parsed.parts.summary !== null && parsed.parts.summary.calcVersion > current.record.summary.calcVersion;
    if (diskAhead) refreshFailed.add(file);
    else lib.onOutdated();
  }
  if (!sameJson(record, parsed.parts)) return 'write';
  recordEdits.delete(file);
  return 'same';
};

/**
 * Une écriture de fiche : voir `writeRecordNow`. Ce qui a été changé ici n'est oublié qu'une fois écrit ;
 * ce qui est changé pendant l'écriture reste à écrire.
 */
const writeRecordOnce = async (f: MemoryFolder, file: string): Promise<boolean> => {
  let session: LibrarySession | undefined;
  try {
    await hydrateSession(f, file);
    session = findSession(file);
    if (lib.folder !== f) return false;
    if (!session || session.readOnly) {
      // Fiche devenue impossible à écrire (version plus récente, illisible) : l'avertissement de la session le dit.
      unwritten.delete(file);
      return false;
    }
    if (removing.has(file) || session.partial) return false;
    const disk = await reconcileWithDisk(f, file);
    session = findSession(file);
    if (lib.folder !== f) return false;
    if (!session || session.readOnly) {
      unwritten.delete(file);
      return false;
    }
    if (removing.has(file) || session.partial) return false;
    if (disk === 'stop') return false;
    if (disk === 'same') {
      unwritten.delete(file);
      return true;
    }
    const edits = recordEdits.get(file);
    recordEdits.delete(file);
    try {
      await writeRecordFile(f, file, serializeRecord(session.record, unreadableOf(f, file)));
    } catch (err) {
      // Pas écrit : ce qui a été changé ici compte encore, avec ce qui a pu s'y ajouter entre-temps. Sur un même chemin, la
      // valeur d'avant la plus ancienne reste (`edits` en dernier), comme dans `addRecordEdits` : sinon un faux conflit.
      if (edits) recordEdits.set(file, new Map([...(recordEdits.get(file) ?? []), ...edits]));
      throw err;
    }
    if (lib.folder === f) unwritten.delete(file);
    return true;
  } catch (err) {
    // Écriture d'un dossier quitté entre-temps (son nom n'y désigne plus la même fiche) : rien n'est retenté
    // dans le nouveau, mais les saisies y sont reportées (`carryUnwritten`).
    if (lib.folder !== f) {
      if (session && !session.readOnly) void carryUnwritten([session]);
      return false;
    }
    unwritten.add(file);
    reportError(`Fiche de ${file} non enregistrée : ${errorMessage(err, 'erreur inconnue')}`);
    return false;
  } finally {
    // Fichier récrit, ou fiche qui n'entre plus dans le cache : son entrée est à refaire.
    cacheDirty.add(file);
  }
};

/** Dernière écriture demandée pour chaque fiche : une à la fois, chacune relit ce que la précédente a écrit. */
const writeQueue = new Map<string, Promise<boolean>>();

/**
 * Écrit la fiche telle qu'elle est en mémoire, fondue d'abord avec le disque si son fichier a changé
 * (`reconcileWithDisk`). Une fiche allégée est d'abord relue en entier : on n'écrit jamais une fiche
 * privée de son altitude, de ses voies ou de ses sauts. Rend vrai si la fiche est écrite (ou que le disque
 * l'a déjà) ; un échec est dit en clair.
 */
export const writeRecordNow = (file: string): Promise<boolean> => {
  recordTimers.delete(file);
  const f = lib.folder;
  if (!f || removing.has(file)) return Promise.resolve(false);
  if (!findSession(file)) {
    // Plus de session à écrire : rien à retenter.
    unwritten.delete(file);
    return Promise.resolve(false);
  }
  writing.set(file, (writing.get(file) ?? 0) + 1);
  const once = () => writeRecordOnce(f, file);
  const run: Promise<boolean> = (writeQueue.get(file) ?? Promise.resolve(true)).then(once, once).finally(() => {
    const left = (writing.get(file) ?? 1) - 1;
    if (left > 0) writing.set(file, left);
    else writing.delete(file);
    if (writeQueue.get(file) === run) writeQueue.delete(file);
  });
  writeQueue.set(file, run);
  return run;
};

export const scheduleRecordWrite = (file: string): void => {
  const timer = recordTimers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  recordTimers.set(file, setTimeout(() => void writeRecordNow(file), RECORD_WRITE_DELAY_MS));
};

export const cancelRecordWrite = (file: string): void => {
  const timer = recordTimers.get(file);
  if (timer !== undefined) clearTimeout(timer);
  recordTimers.delete(file);
};

/**
 * Résumé recalculé avec les réglages de la fiche, pris après la lecture du
 * GPX : un second changement fait pendant ce temps n'est pas recouvert par un
 * résumé calculé avant lui. La fiche est relue en entier d'abord : l'altitude
 * du terrain entre dans le dénivelé.
 */
export const resummarize = async (file: string): Promise<void> => {
  const f = lib.folder;
  if (!f || !findSession(file)) return;
  try {
    const text = await f.readText(sessionPath(file));
    await hydrateSession(f, file);
    const session = findSession(file);
    if (text === null || !session || session.readOnly || session.partial || lib.folder !== f) return;
    const analyzed = analyzeGpx(text, session.record.sport, session.record.analysis, sessionSummarySettings(session.record), session.record);
    if (!analyzed) return;
    const record = withSummary(session.record, analyzed.summary);
    noteRecordEdits(file, session.record, record);
    replaceSession({ ...session, record });
    scheduleRecordWrite(file);
  } catch {
    // Trace ou fiche illisible : le résumé précédent reste affiché.
  }
};

/**
 * Au changement de dossier (décision du 01/11) : les saisies des fiches qu'on n'avait pas pu écrire
 * dans l'ancien (`carried`) sont reportées sur la même session du nouveau, retrouvée par le début de
 * trace (`carryRecordEdits`), puis écrites. Une session absente du nouveau dossier, ou dont la fiche ne
 * s'y écrit pas (lecture seule), est dite. Sans dossier ouvert (accès refusé, dossier inutilisable),
 * elles restent de côté pour le prochain (`heldUnwritten`).
 */
export const carryUnwritten = async (carried: readonly LibrarySession[]): Promise<void> => {
  if (carried.length === 0) return;
  if (!lib.folder) {
    lib.heldUnwritten = [...carried, ...lib.heldUnwritten];
    return;
  }
  // Les GPX sans fiche du nouveau dossier n'entrent dans la liste qu'une fois leur fiche créée.
  if (lib.scanCompletion) await lib.scanCompletion.then(() => undefined, () => undefined);
  const missed: string[] = [];
  for (const old of carried) {
    const target = findSessionAt(old.record.summary.startMs);
    if (!target || target.readOnly) {
      missed.push(old.file);
      continue;
    }
    const { record, resummarize: stale } = carryRecordEdits(target.record, old.record);
    if (record === target.record) continue;
    lib.editCount += 1;
    lastEdit.set(target.file, lib.editCount);
    noteRecordEdits(target.file, target.record, record);
    replaceSession({ ...target, record });
    scheduleRecordWrite(target.file);
    if (stale) void resummarize(target.file);
  }
  if (missed.length > 0) {
    reportError(`Changements non reportés dans le nouveau dossier, la session n'y est pas ou sa fiche ne s'y écrit pas : ${missed.join(', ')}`);
  }
};
