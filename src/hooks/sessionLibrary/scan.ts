import { SESSIONS_DIR, sessionPath } from '../../library/folderLayout';
import { uniqueSessionFileName } from '../../library/naming';
import {
  FUTURE_RECORD_WARNING, NOT_READ_RECORD_WARNING, READ_ONLY_MEMORY_WARNING, UNREADABLE_RECORD_WARNING,
  isBlankRecordText,
} from '../../library/recordText';
import {
  imuFileName, isWritableRecord, parseRecordWithRaw, recordFileName, type LibrarySession, type RecordWithoutSummary,
  type SessionRecord,
} from '../../library/record';
import { indexByRecordName, lowerRecordExtension, oddRecordExtensions, planReconcile } from '../../library/reconcile';
import type { FileStat, FolderEntry, MemoryFolder } from '../../platform/memoryFolder';
import { errorMessage } from '../../core/basics';
import { reportError, setState } from './store';
import { findSession, lastEdit, lib, publish, rememberUnreadable, unwritten } from './memory';
import { summaryOutdatedTest } from './summarySettings';
import { readCache } from './cache';

/**
 * Lecture de `sessions/` (lot 113) : rapprochée du cache, elle publie la liste et rend les fiches à créer ou à
 * recalculer, que la file des résumés (`summaryQueue.ts`) traite ensuite.
 */

export interface SummaryJob {
  file: string;
  /**
   * `create` : fiche à créer ; `refresh` : fiche existante dont seul le résumé
   * est à refaire, d'après la session telle qu'elle est au moment du calcul.
   */
  kind: 'create' | 'refresh';
  /** Vrai si la fiche existante ne doit pas être réécrite. */
  readOnly: boolean;
  warning: string | null;
  /** `create` d'une fiche lue dont seul le résumé est illisible : elle garde le reste. */
  base?: RecordWithoutSummary;
}

/** Vrai si la mémoire a de quoi écrire que le disque n'a pas : fiche pas encore écrite, ou saisie pendant une relecture. */
const memoryAhead = (file: string, editsBefore: number): boolean => unwritten.has(file) || (lastEdit.get(file) ?? 0) > editsBefore;

/**
 * Version en mémoire d'une session relue, quand elle doit l'emporter sur celle
 * du disque ou du cache : saisie pendant la relecture (après `editsBefore`),
 * ou déjà relue en entier alors que le cache n'en donne que la fiche allégée
 * d'un fichier inchangé. Sans cela, « Mettre à jour » perdrait une saisie, ou
 * rendrait partielle la session d'une analyse ouverte. Une fiche pas encore écrite (`unwritten`) garde
 * toujours sa version en mémoire : le disque n'a pas ses derniers changements.
 */
const keptInMemory = (read: LibrarySession, editsBefore: number): LibrarySession | undefined => {
  const current = findSession(read.file);
  if (!current) return undefined;
  if (memoryAhead(read.file, editsBefore)) return current;
  return read.partial && !current.partial ? current : undefined;
};

/**
 * Une fiche `X.JSON` (extension en majuscules) à côté de `X.gpx` est renommée `X.json` : toute la
 * suite relit et réécrit la fiche par `recordFileName(gpx)`, et sans cela une seconde fiche serait
 * créée à côté. Sur un système qui ignore la casse, l'écriture retombe sur le même fichier : on ne
 * supprime l'ancien nom que s'il figure encore, à côté du nouveau, dans la liste relue.
 */
const normalizeRecordExtensions = async (f: MemoryFolder, entries: FolderEntry[]): Promise<FolderEntry[]> => {
  if (f.readOnly) return entries;
  const odd = oddRecordExtensions(entries);
  if (odd.length === 0) return entries;
  for (const entry of odd) {
    try {
      const text = await f.readText(sessionPath(entry.name));
      if (text === null) continue;
      const target = lowerRecordExtension(entry.name);
      await f.writeText(sessionPath(target), text);
      const after = await f.list(SESSIONS_DIR);
      if (after.some((e) => e.name === target) && after.some((e) => e.name === entry.name)) await f.remove(sessionPath(entry.name));
    } catch (err) {
      reportError(`${entry.name} n'a pas pu être renommée en .json : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
  return f.list(SESSIONS_DIR);
};

/**
 * Lit `sessions/` et publie la liste. Rend les fiches à créer ou à
 * recalculer, que `completeScan` traite ensuite en tâche de fond.
 * `editsBefore` : numéro de la dernière saisie avant la relecture.
 */
export const scan = async (f: MemoryFolder, gen: number, editsBefore = lib.editCount): Promise<SummaryJob[]> => {
  let entries = await f.list(SESSIONS_DIR);
  entries = await normalizeRecordExtensions(f, entries);
  const rootEntries = await f.list('');
  const cache = readCache(f);
  let plan = planReconcile(entries, rootEntries, cache.entries);
  // Ceux de la racine ne se retrouvent pas au second rapprochement, qui ne relit que `sessions/`.
  const rootTooLarge = plan.tooLarge.filter((name) => !entries.some((e) => e.name === name));

  // Un GPX posé à la racine du dossier est rangé dans `sessions/`, avec la fiche posée à côté de lui (pas en lecture seule).
  if (plan.rootGpx.length > 0 && !f.readOnly) {
    const taken = new Set(entries.map((e) => e.name));
    for (const name of plan.rootGpx) {
      try {
        const text = await f.readText(name);
        if (text === null) continue;
        const target = uniqueSessionFileName(name, taken);
        const recordName = plan.rootRecords[name];
        const recordText = recordName ? await f.readText(recordName) : null;
        const motion = rootEntries.some((e) => e.name === imuFileName(name)) ? await f.readBytes(imuFileName(name)) : null;
        await f.writeText(sessionPath(target), text);
        taken.add(target);
        if (recordName && recordText !== null) {
          await f.writeText(sessionPath(recordFileName(target)), recordText);
          await f.remove(recordName);
        }
        if (motion) {
          await f.writeBytes(sessionPath(imuFileName(target)), motion);
          await f.remove(imuFileName(name));
        }
        await f.remove(name);
      } catch (err) {
        reportError(`${name} n'a pas pu être rangé dans sessions/ : ${errorMessage(err, 'erreur inconnue')}`);
      }
    }
    entries = await f.list(SESSIONS_DIR);
    plan = planReconcile(entries, [], cache.entries);
  }
  if (gen !== lib.generation) return [];
  setState({ tooLarge: [...new Set([...plan.tooLarge, ...rootTooLarge])].sort() });

  lib.knownNames = new Set(entries.map((e) => e.name));
  const jobs: SummaryJob[] = [];
  const found: LibrarySession[] = [];
  let publishedCount = 0;
  // Résumé à refaire : version du calcul dépassée, ou réglages changés depuis (empreinte, lot 37).
  const isOutdated = summaryOutdatedTest();
  const keep = (file: string, record: SessionRecord, partial: boolean) => {
    const future = !isWritableRecord(record);
    const readOnly = future || f.readOnly === true;
    found.push({
      file,
      record: { ...record, gpx: file },
      readOnly,
      warning: future ? FUTURE_RECORD_WARNING : readOnly ? READ_ONLY_MEMORY_WARNING : null,
      ...(partial ? { partial: true } : {}),
    });
    if (!readOnly && isOutdated(record)) jobs.push({ file, kind: 'refresh', readOnly: false, warning: null });
  };
  // Fiche pas encore écrite (`unwritten`) : la session en mémoire l'emporte sur le disque, qu'il porte une
  // fiche plus ancienne, vide ou illisible, ou aucune (fiche créée dont l'écriture a échoué).
  const held = (file: string): boolean => {
    const current = unwritten.has(file) ? findSession(file) : undefined;
    if (!current) return false;
    found.push(current);
    if (!current.readOnly && isOutdated(current.record)) jobs.push({ file, kind: 'refresh', readOnly: false, warning: null });
    return true;
  };

  for (const [file, record] of Object.entries(plan.reuse)) if (!held(file)) keep(file, record, cache.light);
  // Fiches à relire, par paquets lus ensemble. Mémoire encore vide (ouverture sans cache, téléphone
  // neuf) : la liste s'affiche par lots au fil de la lecture, au lieu d'attendre la dernière (E-O5).
  const progressive = lib.all.length === 0;
  const toRead = plan.read.filter((file) => !held(file));
  for (let from = 0; from < toRead.length; from += RECORD_READ_BATCH) {
    const batch = toRead.slice(from, from + RECORD_READ_BATCH);
    // Une fiche dont la lecture lève (accès refusé sur le téléphone) n'empêche pas d'ouvrir les autres.
    const texts = await Promise.all(batch.map((file) => f.readText(sessionPath(recordFileName(file))).catch((): typeof READ_FAILED => READ_FAILED)));
    batch.forEach((file, i) => {
      const text = texts[i];
      // Fiche non lue : laissée telle quelle, la session en lecture seule sur un résumé refait depuis le GPX ;
      // ses champs illisibles connus restent pour la prochaine lecture.
      if (text === READ_FAILED) {
        jobs.push({ file, kind: 'create', readOnly: true, warning: NOT_READ_RECORD_WARNING });
        return;
      }
      // Fiche vide : tenue pour absente, elle est refaite depuis le GPX.
      if (isBlankRecordText(text)) {
        rememberUnreadable(f, file, undefined);
        jobs.push({ file, kind: 'create', readOnly: false, warning: null });
        return;
      }
      const parsed = text === null ? null : parseRecordWithRaw(text);
      const parts = parsed?.parts ?? null;
      rememberUnreadable(f, file, parsed?.unreadable);
      if (parts?.summary) keep(file, { ...parts, summary: parts.summary }, false);
      // Résumé seul illisible : il se refait depuis le GPX, la fiche garde nom, notes et réglages.
      else if (parts && isWritableRecord(parts)) jobs.push({ file, kind: 'create', readOnly: false, warning: null, base: parts });
      else jobs.push({ file, kind: 'create', readOnly: true, warning: UNREADABLE_RECORD_WARNING });
    });
    if (gen !== lib.generation) return [];
    if (progressive && found.length - publishedCount >= PROGRESSIVE_PUBLISH_COUNT) {
      lib.all = [...found];
      publishedCount = found.length;
      publish();
    }
  }
  for (const file of plan.summarize) if (!held(file)) jobs.push({ file, kind: 'create', readOnly: false, warning: null });
  if (gen !== lib.generation) return [];

  lib.all = found.map((read) => keptInMemory(read, editsBefore) ?? read);
  // Tampons de la fiche lue, sauf là où la mémoire a de l'avance : sa base reste l'ancien, relu à l'écriture si le fichier a bougé.
  const listed = indexByRecordName(entries);
  const stamps = new Map<string, FileStat>();
  for (const { file } of found) {
    const entry = listed.get(recordFileName(file));
    const stamp = memoryAhead(file, editsBefore) ? lib.diskStamps.get(file) : entry;
    if (stamp) stamps.set(file, { size: stamp.size, mtimeMs: stamp.mtimeMs });
  }
  lib.diskStamps = stamps;
  publish();
  return jobs;
};

/** Fiches lues ensemble à l'ouverture : moins d'allers-retours avec le dossier. */
const RECORD_READ_BATCH = 8;

/** Lecture d'une fiche qui a levé, distincte d'une fiche absente (`null`). */
const READ_FAILED = Symbol('fiche non lue');

/** À l'ouverture d'une mémoire encore vide, la liste est publiée tous les tant de sessions lues. */
const PROGRESSIVE_PUBLISH_COUNT = 25;
