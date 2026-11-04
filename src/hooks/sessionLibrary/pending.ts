import { decodeImuHeader } from '../../core/imuFile';
import { isBlankRecordText } from '../../library/recordText';
import { imuFileName, isBlankGpxText, isGpxFileName, isWritableRecord, parseRecordWithRaw, recordFileName } from '../../library/record';
import { isCompleteGpxText, planPendingTemps } from '../../library/pendingTemps';
import { pendingFolder, type MemoryFolder } from '../../platform/memoryFolder';
import { errorMessage } from '../../core/basics';
import { reportError } from './store';
import { lib } from './memory';
import { scheduleCacheUpdate } from './cache';
import { addGpx, countPending, pendingWriting, type AddOptions, type AddResult } from './addSession';

/**
 * Sessions enregistrées en attente d'un dossier mémoire (téléphone ; lot 113), rangées dès qu'il y en a un, avec
 * leur fiche et leurs capteurs ; reprise des temporaires d'une écriture interrompue.
 */

/**
 * Capteurs d'une session en attente, `null` s'ils n'y sont pas. Là mais illisibles : lève, et la session
 * reste en attente avec eux, comme pour sa fiche, plutôt que d'être rangée sans (`flushPending`).
 */
const readPendingImu = async (pending: MemoryFolder, name: string): Promise<Uint8Array | null> => {
  try {
    return await pending.readBytes(name);
  } catch (err) {
    throw new Error(`capteurs illisibles, session laissée en attente (${errorMessage(err, 'erreur inconnue')})`);
  }
};

/** Capteurs temporaires lus, s'ils commencent par un en-tête lisible ; `null` sinon. */
const readPendingImuTemp = async (pending: MemoryFolder, name: string | null): Promise<Uint8Array | null> => {
  if (!name) return null;
  const bytes = await readPendingImu(pending, name);
  return bytes && decodeImuHeader(bytes) ? bytes : null;
};

/** Fiche d'une session en attente, lue à côté de son GPX pour être rangée avec lui. */
interface PendingRecord {
  /** Son nom dans le dossier en attente, `null` si la session n'en a pas (attente d'avant le lot 116). */
  name: string | null;
  /** Ce qu'elle apporte à `addGpx` : rien si elle est illisible. */
  options: Pick<AddOptions, 'record' | 'unreadable'>;
  /** Fiche là mais illisible : la session est rangée sans elle, et c'est dit. */
  unreadable: boolean;
}

/**
 * Fiche d'une session en attente (`name`, `null` sans fiche). `null` si elle est là mais que sa
 * lecture échoue : la session reste alors en attente, avec elle, plutôt que d'être rangée sans.
 */
const readPendingRecord = async (pending: MemoryFolder, name: string | null): Promise<PendingRecord | null> => {
  if (name === null) return { name: null, options: {}, unreadable: false };
  const text = await pending.readText(name);
  if (text === null) return null;
  const parsed = isBlankRecordText(text) ? null : parseRecordWithRaw(text);
  return parsed && isWritableRecord(parsed.parts)
    ? { name, options: { record: parsed.parts, unreadable: parsed.unreadable }, unreadable: false }
    : { name, options: {}, unreadable: true };
};

/** Fiche d'une session en attente rangée sans elle, illisible. */
const reportPendingRecordUnreadable = (gpx: string): void =>
  reportError(`Fiche de la session en attente ${gpx} illisible : session rangée sans son activité, ses repères, ses séances ni son test`);

/**
 * Session en attente déjà dans la mémoire, dont la fiche n'a pas pu être complétée (non relue, ou en
 * lecture seule) : laissée en attente avec sa propre fiche, retentée au prochain rangement.
 */
const reportPendingNotCompleted = (gpx: string, result: AddResult): void =>
  reportError(result.recordReadOnly
    ? `Session en attente ${gpx} déjà dans la mémoire, mais sa fiche y est en lecture seule (non lue, illisible ou plus récente) : laissée en attente`
    : `Session en attente ${gpx} déjà dans la mémoire, mais sa fiche n'a pas pu être relue pour la compléter : laissée en attente`);

/** Vrai si la session était déjà là et que sa fiche n'a pas reçu celle apportée (non relue, lecture seule). */
const notCompleted = (result: AddResult): boolean => result.recordNotRead === true || result.recordReadOnly === true;

/**
 * Sessions enregistrées sur le téléphone faute de dossier, rangées dès qu'il
 * y en a un, avec la fiche écrite à côté de chacune (activité, foil, séances,
 * repères, test). Une session qu'on ne peut ranger reste en attente, sans
 * retenir les autres, et l'échec est dit ; une fiche illisible ne la retient
 * pas : elle est rangée sans, et c'est dit ; des capteurs là mais illisibles la
 * retiennent (`readPendingImu`). Mémoire en lecture seule : tout reste en
 * attente d'un dossier où ranger. Les temporaires d'une écriture
 * interrompue par un plantage (`planPendingTemps`) : un GPX complet est rangé
 * comme les autres, puis effacé ; un temporaire tronqué ou illisible est
 * effacé, et dit ; celui dont la cible est là, effacé sans rien dire, comme
 * une fiche restée sans GPX.
 */
export const flushPending = async (): Promise<void> => {
  const pending = pendingFolder();
  if (!pending) return;
  if (lib.folder?.readOnly) {
    await countPending();
    return;
  }
  let names: string[];
  try {
    names = (await pending.list('')).filter((e) => e.kind === 'file').map((e) => e.name);
  } catch (err) {
    reportError(`Sessions en attente illisibles : ${errorMessage(err, 'erreur inconnue')}`);
    return;
  }
  const temps = planPendingTemps(names, pendingWriting);
  for (const name of temps.stale) await pending.remove(name).catch(() => undefined);
  for (const name of temps.orphanRecords) await pending.remove(name).catch(() => undefined);
  for (const name of temps.orphanImuTemps) {
    await pending.remove(name).catch(() => undefined);
    reportError(`Capteurs en attente ${name} sans leur trace (écriture interrompue), effacés`);
  }
  const listed = new Set(names);
  let ranged = false;
  for (const name of names.filter(isGpxFileName)) {
    try {
      const text = await pending.readText(name);
      if (text === null) continue;
      const record = await readPendingRecord(pending, listed.has(recordFileName(name)) ? recordFileName(name) : null);
      if (!record) {
        reportError(`Session en attente ${name} laissée en attente : sa fiche n'a pas pu être lue`);
        continue;
      }
      const imuTemp = temps.imuTemps[name] ?? null;
      // Sans capteurs à côté, rien à lire : leur absence n'a pas à se prouver par une erreur de lecture.
      const imu = listed.has(imuFileName(name)) ? await readPendingImu(pending, imuFileName(name)) : null;
      const fromTemp = imu ? null : await readPendingImuTemp(pending, imuTemp);
      const motion = imu ?? fromTemp;
      const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined, ...record.options });
      if (notCompleted(result)) {
        reportPendingNotCompleted(name, result);
      } else if (result.status === 'added' || result.status === 'duplicate') {
        ranged = true;
        // Le GPX d'abord : une coupure ensuite laisse une fiche seule, effacée au prochain passage.
        await pending.remove(name);
        if (record.name) await pending.remove(record.name);
        // Seuls les capteurs lus et rangés avec la session sont effacés.
        if (imu) await pending.remove(imuFileName(name));
        if (fromTemp && imuTemp) await pending.remove(imuTemp);
        if (record.unreadable) reportPendingRecordUnreadable(name);
      } else if (result.status === 'invalid') {
        reportError(`Session en attente ${name} illisible, laissée en attente : ${result.message ?? 'GPX illisible'}`);
      }
    } catch (err) {
      reportError(`Session en attente ${name} non rangée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }

  for (const session of temps.sessions) {
    const drop = async (why: string) => {
      await pending.remove(session.temp);
      if (session.imuTemp) await pending.remove(session.imuTemp);
      if (session.record) await pending.remove(session.record);
      reportError(`Session en attente ${session.gpx} ${why}, effacée`);
    };
    try {
      const text = await pending.readText(session.temp);
      // Lecture en échec : rien n'est effacé, le temporaire sera repris au prochain dossier ouvert.
      if (text === null) continue;
      if (isBlankGpxText(text)) {
        await drop('vide (écriture interrompue)');
        continue;
      }
      if (!isCompleteGpxText(text)) {
        await drop('incomplète (écriture interrompue)');
        continue;
      }
      const record = await readPendingRecord(pending, session.record);
      // Fiche là mais non lue : rien n'est effacé, le temporaire sera repris au prochain dossier ouvert.
      if (!record) {
        reportError(`Session en attente ${session.gpx} laissée en attente : sa fiche n'a pas pu être lue`);
        continue;
      }
      const imu = session.imu ? await readPendingImu(pending, session.imu) : null;
      const fromTemp = imu ? null : await readPendingImuTemp(pending, session.imuTemp);
      const motion = imu ?? fromTemp;
      const result = await addGpx(text, 'enregistrement', { motion: motion ?? undefined, ...record.options });
      if (notCompleted(result)) {
        reportPendingNotCompleted(session.gpx, result);
      } else if (result.status === 'added' || result.status === 'duplicate') {
        ranged = true;
        await pending.remove(session.temp);
        if (record.name) await pending.remove(record.name);
        // Seuls les capteurs lus et rangés avec la session sont effacés : une lecture en échec les laisse.
        if (imu && session.imu) await pending.remove(session.imu);
        if (fromTemp && session.imuTemp) await pending.remove(session.imuTemp);
        if (record.unreadable) reportPendingRecordUnreadable(session.gpx);
      } else if (result.status === 'pending') {
        // Plus de dossier entre-temps : la session est de nouveau en attente, sous son nom cette fois.
        await pending.remove(session.temp);
        if (fromTemp && session.imuTemp) await pending.remove(session.imuTemp);
      } else if (result.status === 'invalid') {
        await drop(`illisible (${result.message ?? 'GPX illisible'})`);
      }
    } catch (err) {
      reportError(`Session en attente ${session.gpx} non rangée : ${errorMessage(err, 'erreur inconnue')}`);
    }
  }
  // Rangées après le balayage, qui a déjà refait le cache des fiches : leurs entrées y sont ajoutées.
  if (ranged && lib.folder) scheduleCacheUpdate(lib.folder);
  await countPending();
};
