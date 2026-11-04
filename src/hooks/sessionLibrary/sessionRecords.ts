import { sessionPath } from '../../library/folderLayout';
import { isBlankRecordText, recordToKeep } from '../../library/recordText';
import {
  applyRecordPatch, imuFileName, mergeLightRecord, parseRecordWithRaw, recordFileName, type LibrarySession,
  type RecordPatch, type RecordUnreadable, type SessionRecord,
} from '../../library/record';
import { READ_ONLY_MEMORY_MESSAGE, type MemoryFolder } from '../../platform/memoryFolder';
import { errorMessage } from '../../core/basics';
import { reportError, setState } from './store';
import {
  cacheDirty, findSession, hasSessionMotion, hydrateSession, lastEdit, lib, publish, rememberUnreadable, removing,
  replaceSession, unreadableOf, unwritten,
} from './memory';
import { cancelRecordWrite, noteRecordEdits, recordEdits, resummarize, scheduleRecordWrite } from './recordWrites';
import { scheduleCacheUpdate } from './cache';
import type { AddOptions } from './addSession';

/**
 * Une session de la mémoire (lot 113) : son GPX, sa fiche entière, ses capteurs, le changement de sa fiche et sa
 * suppression ; sa fiche à recopier dans un autre dossier.
 */

/** Contenu du GPX d'une session, `null` s'il n'est pas lisible. */
export const readSessionGpx = async (file: string): Promise<string | null> => {
  await lib.opening;
  return lib.folder ? lib.folder.readText(sessionPath(file)) : null;
};

/**
 * Relit en entier la fiche d'une session tirée du cache allégé : altitude du
 * terrain, voies et sauts rangés. Sans effet sur une fiche déjà entière ; un
 * échec est dit, et la session reste partielle.
 */
export const loadFullSession = async (file: string): Promise<void> => {
  await lib.opening;
  const f = lib.folder;
  if (!f) return;
  try {
    await hydrateSession(f, file);
    // Déjà relue par le balayage de fond, pas encore publiée : l'analyse la voit entière tout de suite.
    if (lib.publishPending) publish();
  } catch (err) {
    reportError(`Fiche de ${file} non relue : ${errorMessage(err, 'erreur inconnue')}`);
  }
};

/**
 * GPX d'une session à ouvrir dans une analyse, `null` s'il n'est pas
 * lisible. Sa fiche est d'abord relue en entier (`loadFullSession`) : la trace
 * n'existe qu'une fois l'altitude, les voies et les sauts rangés connus, et
 * l'analyse ne les redemande pas.
 */
export const loadSessionGpx = async (file: string): Promise<string | null> => {
  await loadFullSession(file);
  return readSessionGpx(file);
};

/**
 * GPX complet d'une session, pour « Télécharger la session » : le GPX tel que
 * rangé, sa fiche entière, avec ses champs illisibles à la lecture, et ses
 * capteurs (`library/sessionBundle.ts`).
 * `null` si le GPX n'est pas lisible.
 */
export const readSessionExport = async (
  file: string
): Promise<{ gpx: string; record: SessionRecord; unreadable: RecordUnreadable | undefined; motion: Uint8Array | null } | null> => {
  await lib.opening;
  const f = lib.folder;
  const session = findSession(file);
  if (!f || !session) return null;
  const gpx = await f.readText(sessionPath(file));
  if (gpx === null) return null;
  const { record, unreadable } = await fullRecordIn(f, session);
  return { gpx, record, unreadable, motion: await readSessionMotion(file) };
};

/** Capteurs d'une session (`.imu`), `null` si elle n'en a pas ou hors de la mémoire. */
export const readSessionMotion = async (file: string): Promise<Uint8Array | null> => {
  await lib.opening;
  return lib.folder && hasSessionMotion(file) ? lib.folder.readBytes(sessionPath(imuFileName(file))) : null;
};

/**
 * Modifie la fiche d'une session (`applyRecordPatch`) : support, activité,
 * nom, notes, réglages d'analyse, nombre de manœuvres. La liste suit tout de
 * suite ; le fichier est écrit un instant plus tard, et le résumé recalculé
 * si le changement le demande.
 */
export const updateSessionRecord = (file: string, patch: RecordPatch): void => {
  const session = findSession(file);
  if (!session || session.readOnly) return;
  const { record, resummarize: stale } = applyRecordPatch(session.record, patch);
  if (record === session.record) return;
  lib.editCount += 1;
  lastEdit.set(file, lib.editCount);
  noteRecordEdits(file, session.record, record);
  replaceSession({ ...session, record });
  scheduleRecordWrite(file);
  if (stale) void resummarize(file);
};

/**
 * Supprime une session : son GPX, sa fiche et ses capteurs, ainsi que les copies de la même
 * trace sous un autre nom, qui sans cela prendraient sa place dans la liste. Elles quittent
 * la liste avant les suppressions sur le disque, et restent dans `removing` jusqu'à la fin :
 * un recalcul de fond qui les traite ne les y remet pas (E-B4, 27/10).
 */
export const removeSession = async (file: string): Promise<void> => {
  const f = lib.folder;
  const session = findSession(file);
  if (!f || !session) return;
  if (f.readOnly) {
    setState({ error: READ_ONLY_MEMORY_MESSAGE });
    return;
  }
  const files = lib.all.filter((s) => s.record.summary.startMs === session.record.summary.startMs).map((s) => s.file);
  for (const name of files) {
    removing.add(name);
    cancelRecordWrite(name);
    unwritten.delete(name);
  }
  lib.all = lib.all.filter((s) => !files.includes(s.file));
  publish();
  try {
    for (const name of files) {
      // Le GPX d'abord : il fait l'identité. Un échec ensuite laisse une fiche ou des capteurs orphelins,
      // ignorés, et non un GPX sans fiche qui reviendrait, sans ses notes, au lancement suivant.
      await f.remove(sessionPath(name));
      await f.remove(sessionPath(recordFileName(name)));
      await f.remove(sessionPath(imuFileName(name)));
      rememberUnreadable(f, name, undefined);
      lib.diskStamps.delete(name);
      recordEdits.delete(name);
      lib.knownNames.delete(name);
      lib.knownNames.delete(recordFileName(name));
      lib.knownNames.delete(imuFileName(name));
    }
  } catch (err) {
    setState({ error: `Suppression incomplète : ${errorMessage(err, 'erreur inconnue')}` });
  } finally {
    for (const name of files) removing.delete(name);
  }
  lib.all = lib.all.filter((s) => !files.includes(s.file));
  publish();
  for (const name of files) cacheDirty.add(name);
  scheduleCacheUpdate(f);
};

/**
 * Fiche entière d'une session de la mémoire `f`, pour la recopier ailleurs :
 * une fiche allégée est complétée par celle du disque. Avec ses champs
 * illisibles à la lecture (`RecordUnreadable`), à réécrire tels quels.
 */
const fullRecordIn = async (
  f: MemoryFolder, session: LibrarySession
): Promise<{ record: SessionRecord; unreadable: RecordUnreadable | undefined }> => {
  if (!session.partial) return { record: session.record, unreadable: unreadableOf(f, session.file) };
  const text = await f.readText(sessionPath(recordFileName(session.file)));
  const parsed = text === null ? null : parseRecordWithRaw(text);
  const summary = parsed?.parts.summary;
  return parsed && summary
    ? { record: mergeLightRecord({ ...parsed.parts, summary }, session.record), unreadable: parsed.unreadable }
    : { record: session.record, unreadable: undefined };
};

/**
 * Fiche d'une session de la mémoire `f` à recopier dans une autre : entière (`fullRecordIn`), sauf celle
 * d'une session en lecture seule, relue sur le disque et rangée telle quelle si on ne sait pas la
 * réécrire (version plus récente, illisible : `keepRecordText`).
 */
export const recordToCopy = async (f: MemoryFolder, session: LibrarySession): Promise<Pick<AddOptions, 'record' | 'unreadable' | 'keepRecordText'>> => {
  if (!session.readOnly) return fullRecordIn(f, session);
  const text = await f.readText(sessionPath(recordFileName(session.file)));
  if (text === null || isBlankRecordText(text)) return { record: null };
  const parsed = parseRecordWithRaw(text);
  const keepRecordText = recordToKeep(text, parsed);
  return keepRecordText ? { record: null, keepRecordText } : { record: parsed?.parts ?? null, unreadable: parsed?.unreadable };
};
