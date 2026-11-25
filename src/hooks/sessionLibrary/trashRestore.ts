import { errorMessage } from '../../core/basics';
import { ROUTES_DIR, SESSIONS_DIR, sessionPath } from '../../library/folderLayout';
import { imuFileName, recordFileName } from '../../library/record';
import { isBlankRecordText } from '../../library/recordText';
import { routeRestorePlan, sessionRestorePlan, trashFilePath, trashGroupOf, type TrashEntry } from '../../library/trash';
import { copyFromTrash, dropTrashEntries, emptyTrash } from '../../library/trashFolder';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { addGpx, type AddOptions } from './addSession';
import { refreshLibrary } from './lifecycle';
import { findSessionAt, lib } from './memory';
import { writeRecordNow } from './recordWrites';
import { recordOptionsFromText, reloadTrash, trashFolderOf, trashStore } from './trash';

/**
 * Gestes de Réglages › Mémoire sur la corbeille du programme Windows : restaurer une ligne, la supprimer
 * définitivement, vider la corbeille. Chacun rend la phrase à montrer, ou lève avec elle.
 */

const openTrash = async (): Promise<MemoryFolder> => {
  await lib.opening;
  const f = trashFolderOf(lib.folder);
  if (!f) throw new Error("La corbeille n'est pas ouverte : le dossier mémoire ne répond pas.");
  return f;
};

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.byteLength === b.byteLength && a.every((byte, k) => byte === b[k]);

/** Ce qu'une copie de la corbeille a fait pour une session déjà dans la mémoire. */
interface TrashCompletion {
  message: string;
  /**
   * Vrai seulement si la copie n'a plus rien que la mémoire ne tienne : la même trace, sa fiche lue et reçue (écrite
   * sur le disque quand elle a complété quelque chose), ses capteurs déjà là. Faux : elle doit rester dans la corbeille.
   */
  merged: boolean;
}

/**
 * Session déjà revenue dans la mémoire (par un import, par « Récupérer ») : la copie de la corbeille complète sa
 * fiche et ses capteurs sans rien écraser (`addGpx`, comme un import), et dit si elle peut quitter la corbeille sans
 * rien perdre.
 */
const completeFromTrash = async (f: MemoryFolder, entry: TrashEntry): Promise<TrashCompletion> => {
  const gpx = await f.readText(trashFilePath(entry.dir, entry.main));
  if (gpx === null) throw new Error(`${entry.main} manque dans la corbeille.`);
  const recordText = await f.readText(trashFilePath(entry.dir, recordFileName(entry.main)));
  const options: Pick<AddOptions, 'record' | 'unreadable' | 'keepRecordText'> = recordOptionsFromText(recordText);
  const motion = await f.readBytes(trashFilePath(entry.dir, imuFileName(entry.main)));
  const source = options.record?.source ?? options.keepRecordText?.parts?.source ?? 'import';
  // `fromTrash` vide : la corbeille est déjà ce qu'on lit, `addGpx` n'a pas à la consulter.
  const result = await addGpx(gpx, source, { ...options, motion: motion ?? undefined, fromTrash: [] });
  if (result.status !== 'duplicate' || result.file === null) {
    // GPX illisible ou trop court, ou relu comme une autre session : rien n'a été repris.
    return { message: result.message ?? `« ${entry.name} » était déjà dans la mémoire : rien à reprendre de la corbeille.`, merged: false };
  }
  const file = result.file;
  // Une fiche gardée telle quelle, ou dont un champ ne se lit pas, n'a pas pu être reprise en entier.
  const recordWhole = recordText === null || isBlankRecordText(recordText)
    || (options.record !== null && Object.keys(options.unreadable ?? {}).length === 0);
  const recordTaken = recordWhole && !result.recordNotRead && !result.recordReadOnly && (!result.recordCompleted || (await writeRecordNow(file)));
  const sameTrack = (await f.readText(sessionPath(file))) === gpx;
  const motionHeld = motion === null || result.motionAdded === true || sameBytes(await f.readBytes(sessionPath(imuFileName(file))), motion);
  const message = result.recordCompleted || result.motionAdded
    ? `« ${entry.name} » était déjà dans la mémoire : sa fiche a reçu ce qui lui manquait.`
    : `« ${entry.name} » était déjà dans la mémoire : rien à reprendre de la corbeille.`;
  return { message, merged: sameTrack && recordTaken && motionHeld };
};

/**
 * « Restaurer » une ligne de la corbeille (`groupedTrashEntries`) : la session revient dans `sessions/` (capteurs,
 * fiche, GPX en dernier, sous un nom libre), la mémoire est relue, puis chaque autre entrée de la ligne (la même
 * session supprimée une autre fois) complète sa fiche et ses capteurs sans rien écraser, et la ligne quitte la
 * corbeille ; déjà revenue, elle n'est que complétée. Une entrée qui ne peut pas compléter reste dans la corbeille.
 * Un itinéraire revient dans `itineraires/` sous une base libre. Rend la phrase du compte rendu ; lève en clair.
 */
export const restoreFromTrash = async (entry: TrashEntry): Promise<string> => {
  const f = await openTrash();
  try {
    if (entry.kind === 'itineraire') {
      const plan = routeRestorePlan(entry, (await f.list(ROUTES_DIR)).map((e) => e.name));
      await copyFromTrash(f, plan.copies);
      await dropTrashEntries(f, [entry.dir]);
      return `« ${entry.name} » est revenu dans les itinéraires.`;
    }
    const startMs = entry.startMs;
    if (startMs === null) throw new Error('entrée de corbeille sans instant de départ.');
    // Première lecture du dossier en cours : la session n'est peut-être pas encore publiée.
    if (!findSessionAt(startMs) && lib.scanCompletion) await lib.scanCompletion.then(() => undefined, () => undefined);
    const [first, ...others] = trashGroupOf(trashStore.get().entries, entry).entries;
    let message: string;
    const done: string[] = [];
    if (findSessionAt(startMs)) {
      const completion = await completeFromTrash(f, first);
      message = completion.message;
      if (completion.merged) done.push(first.dir);
    } else {
      const plan = sessionRestorePlan(first, (await f.list(SESSIONS_DIR)).map((e) => e.name));
      await copyFromTrash(f, plan.copies);
      await refreshLibrary();
      message = `« ${first.name} » est revenue dans la mémoire.`;
      done.push(first.dir);
    }
    for (const other of others) {
      // Seule une copie fondue sans reste part avec la ligne : une autre trace du même instant, une copie illisible
      // ou qui n'a pas pu tout donner reste dans la corbeille, rien n'est perdu. Sans la session publiée dans la
      // mémoire, la copie y entrerait comme une seconde session : elle attend.
      const completion = findSessionAt(startMs) ? await completeFromTrash(f, other).catch(() => null) : null;
      if (completion?.merged) done.push(other.dir);
    }
    await dropTrashEntries(f, done);
    return done.length === others.length + 1
      ? message
      : `${message} Une autre copie de cette session reste dans la corbeille : elle n'a pas pu compléter sa fiche.`;
  } catch (err) {
    throw new Error(`Restauration impossible : ${errorMessage(err, 'erreur inconnue')}`);
  } finally {
    await reloadTrash();
  }
};

/** « Supprimer définitivement » la ligne qui tient `entry`, toutes ses entrées : l'index d'abord, puis leurs fichiers. */
export const deleteFromTrash = async (entry: TrashEntry): Promise<void> => {
  const f = await openTrash();
  try {
    await dropTrashEntries(f, trashGroupOf(trashStore.get().entries, entry).entries.map((e) => e.dir));
  } finally {
    await reloadTrash();
  }
};

/** « Vider la corbeille ». */
export const emptyWholeTrash = async (): Promise<void> => {
  const f = await openTrash();
  try {
    await emptyTrash(f);
  } finally {
    await reloadTrash();
  }
};
