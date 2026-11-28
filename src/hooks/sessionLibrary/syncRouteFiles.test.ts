import { describe, expect, it } from 'vitest';
import { routePath } from '../../library/folderLayout';
import { parseSyncBase, readMarkerId, syncBasePath, type SyncBase } from '../../library/syncBase';
import { describeSync, describeSyncQuestion } from '../../library/syncReport';
import { syncRouteListing } from '../../library/syncRoutes';
import { DEPOSIT_FILE, TRASH_INDEX_PATH, parseDeposit, parseTrashIndex, trashFilePath, type TrashEntry } from '../../library/trash';
import { dropTrashEntries, emptyTrash, stashInTrash } from '../../library/trashFolder';
import { ROUTE_FORMAT, ROUTE_VERSION, parseRouteRecord, serializeRouteRecord } from '../../planning/routeRecord';
import { putSyncSession, syncMemoryFolder, type SyncFolder } from '../../test/syncFolder.fixture';
import { executeSync, type SyncOptions, type SyncOutcome, type SyncRouteDeletionKey } from './sync';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
/** Date ISO du jour de rang `k`. */
const iso = (k: number): string => new Date(T0 + k * DAY).toISOString();

interface Pair {
  computer: SyncFolder;
  phone: SyncFolder;
}

const pairOf = (): Pair => ({
  computer: syncMemoryFolder({ clockMs: 1_800_000_000_000 }), phone: syncMemoryFolder({ phone: true, clockMs: 1_800_000_417_000, cable: true }),
});

let ids = 0;
const run = (pair: Pair, options: SyncOptions = {}): Promise<SyncOutcome> =>
  executeSync(pair.computer, pair.phone, { now: () => NOW, newFolderId: () => `dossier-route-${String(++ids).padStart(4, '0')}`, phoneRoutes: true, ...options });

const recordText = (createdAt: string, updatedAt: string, { lat = 43.5, version = ROUTE_VERSION } = {}): string =>
  serializeRouteRecord({
    format: ROUTE_FORMAT, version, name: '', activityId: null, createdAt, updatedAt,
    waypoints: [{ lat, lon: 3.9 }, { lat: lat + 0.01, lon: 3.91 }], legs: [],
  });

/** Range un itinéraire comme l'application de l'appareil : GPX puis fiche. */
const putRoute = (folder: SyncFolder, base: string, createdAt: string, updatedAt: string, options: { lat?: number; version?: number } = {}): void => {
  folder.put(routePath(`${base}.gpx`), `<gpx>${base} ${updatedAt} ${options.lat ?? 43.5}</gpx>`);
  folder.put(routePath(`${base}.json`), recordText(createdAt, updatedAt, options));
};

const dropRoute = (folder: SyncFolder, base: string): void => {
  folder.drop(routePath(`${base}.json`));
  folder.drop(routePath(`${base}.gpx`));
};

/** Supprime un itinéraire sur l'ordinateur comme l'application : copie à la corbeille, puis fiche et GPX retirés. */
const trashOnComputer = async (pair: Pair, base: string): Promise<void> => {
  const record = parseRouteRecord(pair.computer.text(routePath(`${base}.json`)) as string);
  const paths = [routePath(`${base}.json`), routePath(`${base}.gpx`)];
  await stashInTrash(pair.computer, { kind: 'itineraire', paths, main: paths[0], routeBase: base, createdAt: record?.createdAt, name: base }, NOW - 1000);
  dropRoute(pair.computer, base);
};

const routesOf = async (folder: SyncFolder): Promise<string[]> => syncRouteListing(await folder.list('itineraires')).routes.map((r) => r.base).sort();
const updatedOf = (folder: SyncFolder, base: string): string | undefined => parseRouteRecord(folder.text(routePath(`${base}.json`)) ?? '')?.updatedAt;
const trashOf = (pair: Pair): TrashEntry[] => parseTrashIndex(pair.computer.text(TRASH_INDEX_PATH)).entries;
const baseOf = (pair: Pair): SyncBase | null => {
  const id = readMarkerId(pair.phone.text('tracker.json'));
  const read = id ? parseSyncBase(pair.computer.text(syncBasePath(id))) : null;
  return read?.state === 'ok' ? read.base : null;
};
const REMOVED_ONE_ROUTE = "Supprimé : 1 itinéraire supprimé sur l'ordinateur, retiré du téléphone : il est dans la corbeille des deux appareils pour 30 jours";

/** Ce que dit le compte rendu : ses phrases, ses lignes (« geste : ce qu'il a touché ») et ses exceptions. */
const said = (outcome: SyncOutcome): string[] => {
  const report = describeSync(outcome);
  return [...report.paragraphs, ...report.rows.map((row) => `${row.label} : ${row.text}`), ...report.notes.map((note) => note.text)];
};

/** Une paire synchronisée avec les itinéraires `r0`… des deux côtés. */
const syncedPair = async (count: number): Promise<Pair> => {
  const pair = pairOf();
  for (let k = 0; k < count; k++) putRoute(pair.computer, `r${k}`, iso(k), iso(k));
  expect((await run(pair)).complete).toBe(true);
  return pair;
};

describe('synchronisation des itinéraires, de bout en bout', () => {
  it('première rencontre : chaque appareil reçoit ce qui lui manque, la base retient les deux', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'tour du cap', iso(0), iso(0));
    putRoute(pair.phone, 'baie', iso(1), iso(1));
    const outcome = await run(pair);
    expect(outcome.complete).toBe(true);
    expect(await routesOf(pair.computer)).toEqual(['baie', 'tour du cap']);
    expect(await routesOf(pair.phone)).toEqual(['baie', 'tour du cap']);
    expect(pair.phone.text(routePath('tour du cap.json'))).toBe(pair.computer.text(routePath('tour du cap.json')));
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(0), iso(1)]);
    expect(said(outcome)).toEqual(expect.arrayContaining(['Reçu du téléphone : 1 itinéraire', 'Envoyé au téléphone : 1 itinéraire']));
    expect(outcome.phoneChanged).toBe(true);
    expect((await run(pair)).routes.done).toEqual([]);
  });

  it('créé sur le téléphone puis modifié sur l’ordinateur : le téléphone reçoit la nouvelle version', async () => {
    const pair = pairOf();
    putRoute(pair.phone, 'r0', iso(0), iso(0));
    await run(pair);
    putRoute(pair.computer, 'r0', iso(0), iso(3), { lat: 44 });
    const outcome = await run(pair);
    expect(updatedOf(pair.phone, 'r0')).toBe(iso(3));
    expect(pair.phone.text(routePath('r0.gpx'))).toBe(pair.computer.text(routePath('r0.gpx')));
    expect(said(outcome)).toContain("Modifié : 1 itinéraire, recopié sur l'autre appareil");
  });

  it('supprimé sur le téléphone : la copie de l’ordinateur va à sa corbeille', async () => {
    const pair = await syncedPair(2);
    dropRoute(pair.phone, 'r1');
    // Une suppression sur deux itinéraires dépasse la part que le garde-fou laisse passer : confirmée d'avance.
    const outcome = await run(pair, { confirmDeletions: true });
    expect(await routesOf(pair.computer)).toEqual(['r0']);
    const entry = trashOf(pair).find((e) => e.kind === 'itineraire');
    expect(entry).toMatchObject({ routeBase: 'r1', createdAt: iso(1), origin: 'ordinateur', main: 'r1.json' });
    expect(entry?.files.map((f) => f.name).sort()).toEqual(['r1.gpx', 'r1.json']);
    expect(said(outcome)).toContain("Supprimé : 1 itinéraire supprimé sur le téléphone : il est dans la corbeille des deux appareils pour 30 jours");
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(0)]);
  });

  it('supprimé sur l’ordinateur : retiré du téléphone, sans copie de plus quand la corbeille tient la même fiche', async () => {
    const pair = await syncedPair(2);
    await trashOnComputer(pair, 'r0');
    const outcome = await run(pair, { confirmDeletions: true });
    expect(await routesOf(pair.phone)).toEqual(['r1']);
    expect(trashOf(pair).filter((e) => e.kind === 'itineraire')).toHaveLength(1);
    expect(said(outcome)).toContain(REMOVED_ONE_ROUTE);
    // Déposé dans la corbeille du téléphone : sa fiche de dépôt d'abord, puis GPX, puis fiche de l'itinéraire.
    const dir = `${NOW}-r0`;
    expect([...pair.phone.aside().keys()]).toEqual([trashFilePath(dir, 'r0.gpx'), trashFilePath(dir, 'r0.json')]);
    expect(pair.phone.written().filter((p) => p.startsWith('corbeille/'))).toEqual([trashFilePath(dir, DEPOSIT_FILE)]);
    expect(parseDeposit(pair.phone.text(trashFilePath(dir, DEPOSIT_FILE)))).toMatchObject({ kind: 'itineraire', routeBase: 'r0', createdAt: iso(0) });
  });

  // Le nom de fichier d'un itinéraire vient de son nom affiché : un itinéraire créé au même lieu le même jour, sans
  // nom saisi, reprend celui d'un itinéraire supprimé juste avant. La suppression ne doit pas l'en empêcher.
  it('supprimé sur l’ordinateur puis un autre rangé sous le même nom : retiré du téléphone, le neuf copié, puis plus rien à faire', async () => {
    const pair = await syncedPair(1);
    await trashOnComputer(pair, 'r0');
    putRoute(pair.computer, 'r0', iso(5), iso(5), { lat: 44 });
    const outcome = await run(pair, { confirmDeletions: true });
    expect(outcome.routes.skipped).toEqual([]);
    expect(outcome.complete).toBe(true);
    expect(await routesOf(pair.phone)).toEqual(['r0-2']);
    expect(pair.phone.text(routePath('r0-2.json'))).toBe(pair.computer.text(routePath('r0.json')));
    expect(said(outcome)).toContain(REMOVED_ONE_ROUTE);
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(5)]);
    const next = await run(pair);
    expect([next.routes.done, next.routes.skipped]).toEqual([[], []]);
    expect(await routesOf(pair.phone)).toEqual(['r0-2']);
    expect(await routesOf(pair.computer)).toEqual(['r0']);
  });

  it('supprimé sur le téléphone puis un autre rangé sous le même nom : à la corbeille de l’ordinateur, le neuf copié, puis plus rien à faire', async () => {
    const pair = await syncedPair(1);
    dropRoute(pair.phone, 'r0');
    putRoute(pair.phone, 'r0', iso(5), iso(5), { lat: 44 });
    const outcome = await run(pair, { confirmDeletions: true });
    expect(outcome.routes.skipped).toEqual([]);
    expect(outcome.complete).toBe(true);
    expect(await routesOf(pair.computer)).toEqual(['r0-2']);
    expect(pair.computer.text(routePath('r0-2.json'))).toBe(pair.phone.text(routePath('r0.json')));
    expect(trashOf(pair).find((e) => e.kind === 'itineraire')).toMatchObject({ createdAt: iso(0), origin: 'ordinateur' });
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(5)]);
    const next = await run(pair);
    expect([next.routes.done, next.routes.skipped]).toEqual([[], []]);
    expect(await routesOf(pair.computer)).toEqual(['r0-2']);
    expect(await routesOf(pair.phone)).toEqual(['r0']);
  });

  it('listage en retard : le même itinéraire encore là sous ce nom, ou une fiche illisible, retient la suppression', async () => {
    const back = await syncedPair(1);
    await trashOnComputer(back, 'r0');
    // Remis sur l'ordinateur juste après le listage, le même itinéraire n'est pas retiré du téléphone.
    const kept = await run(back, { confirmDeletions: true, onPlanned: () => putRoute(back.computer, 'r0', iso(0), iso(0)) });
    expect(kept.routes.skipped.map((i) => i.id)).toEqual([iso(0)]);
    expect(await routesOf(back.phone)).toEqual(['r0']);

    const unreadable = await syncedPair(1);
    await trashOnComputer(unreadable, 'r0');
    const held = await run(unreadable, { confirmDeletions: true, onPlanned: () => unreadable.computer.put(routePath('r0.json'), '{ pas une fiche') });
    expect(held.routes.skipped.map((i) => i.id)).toEqual([iso(0)]);
    expect(await routesOf(unreadable.phone)).toEqual(['r0']);

    const mirror = await syncedPair(1);
    dropRoute(mirror.phone, 'r0');
    const stays = await run(mirror, { confirmDeletions: true, onPlanned: () => putRoute(mirror.phone, 'r0', iso(0), iso(0)) });
    expect(stays.routes.skipped.map((i) => i.id)).toEqual([iso(0)]);
    expect(await routesOf(mirror.computer)).toEqual(['r0']);
  });

  it('supprimé sur l’ordinateur mais changé sur le téléphone depuis : la modification revient', async () => {
    const pair = await syncedPair(1);
    await trashOnComputer(pair, 'r0');
    putRoute(pair.phone, 'r0', iso(0), iso(4), { lat: 45 });
    await run(pair);
    expect(updatedOf(pair.computer, 'r0')).toBe(iso(4));
    expect(await routesOf(pair.phone)).toEqual(['r0']);
  });

  it('modifié des deux côtés : la plus récente gagne, l’autre est dans la corbeille', async () => {
    const pair = await syncedPair(1);
    putRoute(pair.computer, 'r0', iso(0), iso(2), { lat: 44 });
    putRoute(pair.phone, 'r0', iso(0), iso(5), { lat: 46 });
    const outcome = await run(pair);
    expect(updatedOf(pair.computer, 'r0')).toBe(iso(5));
    const loser = trashOf(pair).find((e) => e.kind === 'itineraire');
    expect(loser?.origin).toBe('ordinateur');
    expect(parseRouteRecord(pair.computer.text(trashFilePath(loser?.dir as string, 'r0.json')) as string)?.updatedAt).toBe(iso(2));
    expect(said(outcome).some((s) => /^1 itinéraire modifié sur les deux appareils : la version la plus récente est gardée/.test(s))).toBe(true);
  });

  it('une fiche d’une version plus récente n’est jamais écrasée', async () => {
    const pair = await syncedPair(1);
    putRoute(pair.phone, 'r0', iso(0), iso(1), { version: ROUTE_VERSION + 1 });
    putRoute(pair.computer, 'r0', iso(0), iso(2), { lat: 44 });
    const outcome = await run(pair);
    expect(parseRouteRecord(pair.phone.text(routePath('r0.json')) as string)?.version).toBe(ROUTE_VERSION + 1);
    expect(said(outcome)).toContain("1 itinéraire n'a pas été touché : il vient d'une version plus récente de Tracker. Installez la dernière version de ce programme.");
  });

  it('un itinéraire changé sur le téléphone pendant la synchronisation est laissé pour la fois suivante', async () => {
    const pair = await syncedPair(1);
    putRoute(pair.computer, 'r0', iso(0), iso(2), { lat: 44 });
    // Le téléphone range une autre version juste après le listage : le remplacement ne se fait pas.
    const outcome = await run(pair, {
      onPlanned: () => putRoute(pair.phone, 'r0', iso(0), iso(3), { lat: 47 }),
    });
    expect(outcome.routes.skipped.map((i) => i.id)).toEqual([iso(0)]);
    expect(updatedOf(pair.phone, 'r0')).toBe(iso(3));
    expect(outcome.complete).toBe(false);
  });

  it('sans listage des itinéraires, rien n’est touché, et le compte rendu le dit', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'r0', iso(0), iso(0));
    putRoute(pair.phone, 'r1', iso(1), iso(1));
    const waiting = await run(pair, { phoneRoutes: false });
    expect(await routesOf(pair.phone)).toEqual(['r1']);
    expect(await routesOf(pair.computer)).toEqual(['r0']);
    const routesWaiting = "Les itinéraires n'ont pas été échangés : Tracker est trop ancien sur l'un des deux appareils. Installez sa dernière version.";
    expect(said(waiting)).toContain(routesWaiting);
    expect(said(await run(pair, { phoneRoutes: undefined }))).not.toContain(routesWaiting);
    expect(baseOf(pair)?.routes).toEqual([]);
  });

  it('garde-fou : une seule question pour les sessions et les itinéraires, qui ne vaut que pour ce qu’elle a montré', async () => {
    const pair = await syncedPair(12);
    putSyncSession(pair.computer, T0);
    putSyncSession(pair.phone, T0);
    await run(pair);
    for (let k = 0; k < 11; k++) await trashOnComputer(pair, `r${k}`);
    const held = await run(pair);
    expect(held.deletions).toBe('awaitingConfirmation');
    expect(await routesOf(pair.phone)).toHaveLength(12);
    const question = describeSyncQuestion(held);
    expect(question?.routes).toHaveLength(11);
    expect(question?.routes.every((r) => r.side === 'phone')).toBe(true);
    const shown = question!.routes.map((r) => ({ id: r.id, side: r.side }));
    // Une suppression de plus depuis la question : rien n'est supprimé, la question revient.
    await trashOnComputer(pair, 'r11');
    const again = await run(pair, { confirmDeletions: true, confirmedDeletions: [], confirmedRouteDeletions: shown });
    expect(again.deletions).toBe('awaitingConfirmation');
    expect(await routesOf(pair.phone)).toHaveLength(12);
    const all = describeSyncQuestion(again)!.routes.map((r) => ({ id: r.id, side: r.side }));
    const confirmed = await run(pair, { confirmDeletions: true, confirmedDeletions: [], confirmedRouteDeletions: all });
    expect(confirmed.deletions).toBe('made');
    expect(await routesOf(pair.phone)).toEqual([]);
  });

  it('itinéraire de la corbeille encore sur le téléphone, sans ligne de base : joint à la question, retiré sur réponse', async () => {
    const pair = pairOf();
    putRoute(pair.computer, 'r0', iso(0), iso(0));
    await trashOnComputer(pair, 'r0');
    putRoute(pair.phone, 'r0', iso(0), iso(0));
    const first = await run(pair);
    expect(await routesOf(pair.phone)).toEqual(['r0']);
    const question = describeSyncQuestion(first);
    expect(question?.kind).toBe('inTrash');
    expect(question?.routes.map((r) => r.label)).toEqual(['r0']);
    // Un autre itinéraire de la corbeille apparu depuis la question : aucun n'est retiré.
    putRoute(pair.computer, 'r1', iso(1), iso(1));
    await trashOnComputer(pair, 'r1');
    putRoute(pair.phone, 'r1', iso(1), iso(1));
    await run(pair, { heldOnPhone: 'remove', heldToRemove: [], heldRoutesToRemove: [iso(0)], confirmDeletions: true });
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
    // Retirer tout ce qu'a le téléphone passe le garde-fou : sa question suit, ici confirmée d'avance.
    const removing = await run(pair, { heldOnPhone: 'remove', heldToRemove: [], heldRoutesToRemove: [iso(0), iso(1)] });
    expect(describeSyncQuestion(removing)?.kind).toBe('guard');
    await run(pair, { heldOnPhone: 'remove', heldToRemove: [], heldRoutesToRemove: [iso(0), iso(1)], confirmDeletions: true });
    expect(await routesOf(pair.phone)).toEqual([]);
    // La corbeille tenait déjà ces mêmes fiches : rien de plus n'y est rangé.
    expect(trashOf(pair).filter((e) => e.kind === 'itineraire')).toHaveLength(2);
  });

  it('restauré après une suppression synchronisée : dit restauré, recopié sur le téléphone, nommé par ses fichiers', async () => {
    const pair = await syncedPair(4);
    await trashOnComputer(pair, 'r1');
    const removed = await run(pair);
    expect(removed.complete).toBe(true);
    expect(baseOf(pair)?.removedRoutes).toEqual([iso(1)]);
    expect(removed.names.routes).toEqual({ [iso(1)]: 'r1' });
    expect(removed.routes.done.map((i) => i.restored)).toEqual([false]);
    putRoute(pair.computer, 'r1', iso(1), iso(1));
    const back = await run(pair);
    expect(back.routes.done.map((i) => [i.id, i.case, i.restored])).toEqual([[iso(1), 'newOnComputer', true]]);
    expect(back.names.routes).toEqual({ [iso(1)]: 'r1' });
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1', 'r2', 'r3']);
  });
});

/** Les suppressions d'itinéraires qu'une passe a retenues, telles que la question les montre. */
const refusedRoutesOf = (outcome: SyncOutcome): SyncRouteDeletionKey[] =>
  outcome.routes.withheldDeletions.map((item) => ({ id: item.id, side: item.case === 'deletedOnPhone' ? 'computer' : 'phone' }));

const createdOf = (folder: SyncFolder, base: string): string | undefined => parseRouteRecord(folder.text(routePath(`${base}.json`)) ?? '')?.createdAt;

describe('réponses définitives pour les itinéraires : « Tout garder » et « Les garder »', () => {
  it('« Tout garder » : supprimé sur le téléphone, il y retourne ; supprimé sur l’ordinateur, il sort de sa corbeille, ou revient du téléphone si elle ne l’a plus', async () => {
    const pair = await syncedPair(4);
    dropRoute(pair.phone, 'r0');
    await trashOnComputer(pair, 'r1');
    await trashOnComputer(pair, 'r2');
    const asked = await run(pair);
    expect(asked.deletions).toBe('awaitingConfirmation');
    expect(refusedRoutesOf(asked)).toEqual([{ id: iso(0), side: 'computer' }, { id: iso(1), side: 'phone' }, { id: iso(2), side: 'phone' }]);
    // Avant la réponse, « r2 » est supprimé définitivement de la corbeille.
    await dropTrashEntries(pair.computer, trashOf(pair).filter((e) => e.routeBase === 'r2').map((e) => e.dir));
    const kept = await run(pair, { keepRefused: { routes: refusedRoutesOf(asked) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true });
    expect(kept.routes.withheldDeletions).toEqual([]);
    expect(kept.kept).toEqual({ sessions: [], routes: [iso(0), iso(1), iso(2)], fromTrash: { sessions: [], routes: [iso(1)] } });
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(trashOf(pair).filter((e) => e.kind === 'itineraire')).toEqual([]);
    expect(baseOf(pair)).toMatchObject({ removedRoutes: [], heldRoutes: [] });
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(0), iso(1), iso(2), iso(3)]);
    const after = await run(pair);
    expect(after).toMatchObject({ deletions: 'made', complete: true });
    expect(after.routes.done).toEqual([]);
  });

  it('« Tout garder », son nom repris depuis par un autre itinéraire : il sort de la corbeille sous un nom libre, et rien n’est retiré du téléphone', async () => {
    const pair = await syncedPair(1);
    await trashOnComputer(pair, 'r0');
    putRoute(pair.computer, 'r0', iso(5), iso(5), { lat: 44 });
    const asked = await run(pair);
    expect(refusedRoutesOf(asked)).toEqual([{ id: iso(0), side: 'phone' }]);
    const kept = await run(pair, { keepRefused: { routes: refusedRoutesOf(asked) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true });
    expect(kept.kept.fromTrash.routes).toEqual([iso(0)]);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r0-2']);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r0-2']);
    expect([createdOf(pair.computer, 'r0'), createdOf(pair.computer, 'r0-2')]).toEqual([iso(5), iso(0)]);
    expect([createdOf(pair.phone, 'r0'), createdOf(pair.phone, 'r0-2')]).toEqual([iso(0), iso(5)]);
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(0), iso(5)]);
    expect(trashOf(pair).filter((e) => e.kind === 'itineraire')).toEqual([]);
    const after = await run(pair);
    expect(after).toMatchObject({ deletions: 'made', complete: true });
    expect(after.routes.done).toEqual([]);
  });

  it('« Les garder » : seuls les itinéraires montrés reviennent, de la corbeille si elle les tient encore, sinon du téléphone', async () => {
    const pair = pairOf();
    for (const k of [0, 1]) {
      putRoute(pair.computer, `r${k}`, iso(k), iso(k));
      await trashOnComputer(pair, `r${k}`);
      putRoute(pair.phone, `r${k}`, iso(k), iso(k));
    }
    await run(pair);
    expect(baseOf(pair)?.heldRoutes).toEqual([iso(0), iso(1)]);
    const kept = await run(pair, { heldOnPhone: 'keep', heldToKeep: [], heldRoutesToKeep: [iso(0)] });
    expect(kept.kept).toEqual({ sessions: [], routes: [iso(0)], fromTrash: { sessions: [], routes: [iso(0)] } });
    expect(await routesOf(pair.computer)).toEqual(['r0']);
    expect(baseOf(pair)).toMatchObject({ heldRoutes: [iso(1)] });
    expect(baseOf(pair)?.routes.map((r) => r.id)).toEqual([iso(0)]);
    // L'autre, la corbeille vidée depuis : sans liste, tous ceux qui restent sont gardés, et il revient du téléphone.
    await emptyTrash(pair.computer);
    const all = await run(pair, { heldOnPhone: 'keep' });
    expect(all.kept).toEqual({ sessions: [], routes: [iso(1)], fromTrash: { sessions: [], routes: [] } });
    expect(all.complete).toBe(true);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1']);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
    expect(baseOf(pair)).toMatchObject({ heldRoutes: [], removedRoutes: [] });
  });

  it('réponse périmée : un itinéraire supprimé depuis la question n’est pas supprimé, la question revient pour lui seul', async () => {
    const pair = await syncedPair(3);
    dropRoute(pair.phone, 'r0');
    const asked = await run(pair);
    dropRoute(pair.phone, 'r1');
    const stale = await run(pair, { keepRefused: { routes: [...refusedRoutesOf(asked), { id: iso(1), side: 'phone' }] } });
    expect(stale.deletions).toBe('awaitingConfirmation');
    expect(stale.kept.routes).toEqual([iso(0)]);
    expect(refusedRoutesOf(stale)).toEqual([{ id: iso(1), side: 'computer' }]);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1', 'r2']);
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r2']);
    expect(trashOf(pair)).toEqual([]);
  });

  it('« Tout garder » avec un téléphone qui ne s’écrit pas : l’itinéraire reste sur l’ordinateur et attend le téléphone, la question ne revient pas', async () => {
    const pair = await syncedPair(2);
    dropRoute(pair.phone, 'r1');
    const asked = await run(pair);
    expect(refusedRoutesOf(asked)).toEqual([{ id: iso(1), side: 'computer' }]);
    const steps = pair.phone.steps();
    const kept = await run(pair, { phoneWritable: false, keepRefused: { routes: refusedRoutesOf(asked) } });
    expect(pair.phone.steps()).toBe(steps);
    expect(kept.deletions).toBe('made');
    expect(kept.routes.withheldDeletions).toEqual([]);
    expect(kept.routes.withheldForPhone.map((i) => i.id)).toEqual([iso(1)]);
    expect(await routesOf(pair.computer)).toEqual(['r0', 'r1']);
    expect(trashOf(pair)).toEqual([]);
    const again = await run(pair, { phoneWritable: false });
    expect(again.deletions).toBe('made');
    expect(again.routes.withheldDeletions).toEqual([]);
    expect(trashOf(pair)).toEqual([]);
    const whole = await run(pair);
    expect(whole).toMatchObject({ deletions: 'made', complete: true });
    expect(await routesOf(pair.phone)).toEqual(['r0', 'r1']);
  });
});
