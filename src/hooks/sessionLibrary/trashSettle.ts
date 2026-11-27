import { ROUTES_DIR, routePath, sessionPath } from '../../library/folderLayout';
import { imuFileName, recordFileName } from '../../library/record';
import { isBlankRecordText } from '../../library/recordText';
import { syncRouteId } from '../../library/syncRoutes';
import { returnedTrashGroups, trashFilePath, type TrashEntry } from '../../library/trash';
import { dropTrashEntries, readTrashIndex } from '../../library/trashFolder';
import { parseRouteRecord } from '../../planning/routeRecord';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { addGpx, type AddOptions } from './addSession';
import { findSessionAt, lib } from './memory';
import { writeRecordNow } from './recordWrites';
import { holdTrashDuring, recordOptionsFromText, reloadTrash, trashFolderOf } from './trash';

/**
 * Corbeilles jumelles (lot 242-1) : une session ou un itinéraire de la corbeille revenu dans la mémoire sans passer par
 * « Restaurer » (restauré sur l'autre appareil puis recopié ici par la synchronisation, ou revenu par un import) voit
 * son jumeau de la corbeille réglé : la copie complète la mémoire sans rien écraser (`completeFromTrash`), puis quitte
 * la corbeille si tout a été repris. Appelé à l'ouverture et à chaque relecture de la mémoire (`lifecycle.ts`), sous le
 * même verrou que les gestes de la corbeille et la synchronisation (`holdTrashDuring`) ; `completeFromTrash` est aussi la
 * pièce commune à « Restaurer » (`trashRestore.ts`).
 */

const sameBytes = (a: Uint8Array | null, b: Uint8Array): boolean => a !== null && a.byteLength === b.byteLength && a.every((byte, k) => byte === b[k]);

/** Ce qu'une copie de la corbeille a fait pour une session déjà dans la mémoire. */
export interface TrashCompletion {
  message: string;
  /**
   * Vrai seulement si la copie n'a plus rien que la mémoire ne tienne : la même trace, sa fiche lue et reçue (écrite
   * sur le disque quand elle a complété quelque chose), ses capteurs déjà là. Faux : elle doit rester dans la corbeille.
   */
  merged: boolean;
}

/**
 * Session déjà revenue dans la mémoire (par un import, par « Récupérer », par la synchronisation) : la copie de la
 * corbeille complète sa fiche et ses capteurs sans rien écraser (`addGpx`, comme un import), et dit si elle peut
 * quitter la corbeille sans rien perdre. `sameTrackOnly` (réglage automatique) : rien n'est fait si la session de la
 * mémoire n'a pas exactement la même trace (une autre session du même départ ne reçoit ni fiche ni capteurs) ;
 * « Restaurer », demandé par l'utilisateur, ne le demande pas.
 */
export const completeFromTrash = async (f: MemoryFolder, entry: TrashEntry, { sameTrackOnly = false } = {}): Promise<TrashCompletion> => {
  const gpx = await f.readText(trashFilePath(entry.dir, entry.main));
  if (gpx === null) throw new Error(`${entry.main} manque dans la corbeille.`);
  if (sameTrackOnly) {
    const here = entry.startMs === null ? undefined : findSessionAt(entry.startMs);
    if (!here || (await f.readText(sessionPath(here.file))) !== gpx) {
      return { message: `« ${entry.name} » : une autre trace du même instant est dans la mémoire, la copie reste dans la corbeille.`, merged: false };
    }
  }
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

/** Identité d'un itinéraire de la corbeille (`syncRouteId`), comme la synchronisation la lit. */
const routeIdOf = (entry: TrashEntry): string => syncRouteId(entry.createdAt, entry.routeBase ?? entry.main.replace(/\.json$/i, ''));

let settling: Promise<void> | null = null;

/**
 * Règle les lignes de la corbeille dont la session ou l'itinéraire est revenu dans la mémoire : chaque entrée d'une
 * session revenue, de la même trace, complète sa fiche et ses capteurs sans rien écraser, et ne quitte la corbeille que
 * si tout a été repris ; sinon elle attend ses 30 jours. Le jumeau d'un itinéraire revenu ne part que si sa fiche et
 * son GPX sont identiques à l'octet. Après la lecture de la mémoire ; toute la passe tient la corbeille
 * (`holdTrashDuring`) : elle ne croise ni une synchronisation ni un geste de Réglages. Une seule passe à la fois ; ne
 * lève pas.
 */
export const settleReturnedTrash = (): Promise<void> => {
  settling ??= (async () => {
    try {
      // La corbeille est tenue dès l'appel : ce qui est lancé ensuite (synchronisation, geste) attend toute la passe.
      await holdTrashDuring(settlePass);
    } catch {
      // Rien de perdu : les lignes restent dans la corbeille, réglées à la relecture suivante ou purgées à 30 jours.
    } finally {
      settling = null;
      await reloadTrash();
    }
  })();
  return settling;
};

/** Texte d'un fichier, `null` s'il manque ou ne se lit pas. */
const textOf = (f: MemoryFolder, path: string): Promise<string | null> => f.readText(path).catch(() => null);

/** Une passe de `settleReturnedTrash`, corbeille tenue. */
const settlePass = async (): Promise<void> => {
  await lib.opening;
  if (lib.scanCompletion) await lib.scanCompletion.catch(() => undefined);
  const f = trashFolderOf(lib.folder);
  if (!f) return;
  const entries = (await readTrashIndex(f)).entries;
  const inMemory = new Set(entries.flatMap((e) => (e.kind === 'session' && e.startMs !== null && findSessionAt(e.startMs) ? [e.startMs] : [])));
  const done: string[] = [];
  for (const group of returnedTrashGroups(entries, inMemory)) {
    for (const entry of group.entries) {
      const completion = await completeFromTrash(f, entry, { sameTrackOnly: true }).catch(() => null);
      if (completion?.merged) done.push(entry.dir);
    }
  }
  const routeEntries = entries.filter((e) => e.kind === 'itineraire');
  if (routeEntries.length > 0) {
    const inRoutes = new Map<string, { json: string; base: string }>();
    for (const e of await f.list(ROUTES_DIR)) {
      if (e.kind !== 'file' || !/\.json$/i.test(e.name)) continue;
      const text = await textOf(f, routePath(e.name));
      const record = text === null ? null : parseRouteRecord(text);
      const base = e.name.replace(/\.json$/i, '');
      if (text !== null && record) inRoutes.set(syncRouteId(record.createdAt, base), { json: text, base });
    }
    for (const entry of routeEntries) {
      const here = inRoutes.get(routeIdOf(entry));
      if (here === undefined || (await textOf(f, trashFilePath(entry.dir, entry.main))) !== here.json) continue;
      // Le GPX aussi, à l'octet : absent des deux côtés, ou le même ; sinon l'entrée attend ses 30 jours.
      const keptGpx = entry.files.find((file) => /\.gpx$/i.test(file.name));
      const theirs = keptGpx ? await textOf(f, trashFilePath(entry.dir, keptGpx.name)) : null;
      if (keptGpx && theirs === null) continue;
      if (theirs === (await textOf(f, routePath(`${here.base}.gpx`)))) done.push(entry.dir);
    }
  }
  if (done.length > 0 && f === lib.folder) await dropTrashEntries(f, done);
};
