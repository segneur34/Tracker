import { errorMessage } from '../../core/basics';
import { ROUTES_DIR, SESSIONS_DIR } from '../../library/folderLayout';
import { routeRestorePlan, sessionRestorePlan, trashGroupOf, type TrashEntry } from '../../library/trash';
import { copyFromTrash, dropTrashEntries, emptyTrash } from '../../library/trashFolder';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { refreshLibrary } from './lifecycle';
import { findSessionAt, lib } from './memory';
import { holdTrashDuring, reloadTrash, trashFolderOf, trashStore } from './trash';
import { completeFromTrash } from './trashSettle';

/**
 * Gestes de Réglages › Mémoire sur la corbeille de l'appareil (programme Windows ou téléphone) : restaurer une ligne,
 * la supprimer définitivement, vider la corbeille. Chacun rend la phrase à montrer, ou lève avec elle. « Supprimer
 * définitivement » et « Vider » ne valent que pour l'appareil où on les fait. Les sessions revenues d'elles-mêmes se
 * règlent à part (`trashSettle.ts`).
 */

/** Le dossier de la corbeille, à appeler dans un geste tenu (`holdTrashDuring`) : il n'en croise aucun autre. */
const openTrash = async (): Promise<MemoryFolder> => {
  await lib.opening;
  const f = trashFolderOf(lib.folder);
  if (!f) throw new Error("La corbeille n'est pas ouverte : le dossier mémoire ne répond pas.");
  return f;
};

/**
 * « Restaurer » une ligne de la corbeille (`groupedTrashEntries`) : la session revient dans `sessions/` (capteurs,
 * fiche, GPX en dernier, sous un nom libre), la mémoire est relue, puis chaque autre entrée de la ligne (la même
 * session supprimée une autre fois) complète sa fiche et ses capteurs sans rien écraser, et la ligne quitte la
 * corbeille ; déjà revenue, elle n'est que complétée. Une entrée qui ne peut pas compléter reste dans la corbeille.
 * Un itinéraire revient dans `itineraires/` sous une base libre. Rend la phrase du compte rendu ; lève en clair.
 */
export const restoreFromTrash = (entry: TrashEntry): Promise<string> => holdTrashDuring(() => restoreLine(entry));

const restoreLine = async (entry: TrashEntry): Promise<string> => {
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
export const deleteFromTrash = (entry: TrashEntry): Promise<void> => holdTrashDuring(async () => {
  const f = await openTrash();
  try {
    await dropTrashEntries(f, trashGroupOf(trashStore.get().entries, entry).entries.map((e) => e.dir));
  } finally {
    await reloadTrash();
  }
});

/** « Vider la corbeille ». */
export const emptyWholeTrash = (): Promise<void> => holdTrashDuring(async () => {
  const f = await openTrash();
  try {
    await emptyTrash(f);
  } finally {
    await reloadTrash();
  }
});
