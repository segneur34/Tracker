import { describe, expect, it } from 'vitest';
import { MARKER_FILE, MEMORY_VERSION, markerText, sessionPath } from './folderLayout';
import { RECORD_VERSION, imuFileName, recordFileName, type StoredSessionNotes } from './record';
import { SYNC_DIR, emptySyncBase, readMarkerId, syncAncestorPath } from './syncBase';
import {
  SYNC_GUARD_MAX_REMOVALS, planSync, restrictSyncPlan, syncDeletionSide, syncListing, syncPair, syncRecordsToRead, syncSide, syncTrashedFrom,
  type SyncItem,
} from './syncPlan';
import type { TrashEntry } from './trash';
import { serializeRecord } from './record';
import { ROUTE_FORMAT, ROUTE_VERSION, serializeRouteRecord } from '../planning/routeRecord';
import { planRouteSync, restrictRouteSyncPlan, syncRouteListing, syncRouteSide } from './syncRoutes';
import type { SyncFirstReason } from './syncPlan';
import { sessionRecord } from '../test/record.fixture';
import {
  SYNC_TRASH_DIR, deleteSyncSession, editSyncRecord, hasSyncFiles, putSyncSession, readFixtureBase, readSyncRecord, restoreSyncSession,
  SYNC_NOW_MS, runFixtureSync, syncGpxName, syncMemoryFolder, syncSessionFiles, trashSyncSession,
  type SyncFolder, type SyncRun, type SyncRunOptions, type SyncSessionSetup,
} from '../test/syncFolder.fixture';

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const HOUR = 3_600_000;
/** Instant de départ de la session de rang `k`. */
const at = (k: number): number => T0 + k * HOUR;
/** Nom du GPX de la session de rang `k`, le même des deux côtés sauf mention contraire. */
const fileOf = (k: number): string => syncGpxName(at(k));

const notes = (patch: Partial<StoredSessionNotes>): StoredSessionNotes => ({
  foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: '', gear: null, comment: '', windLevel: null, waterState: null, rating: null, savedAt: 100, ...patch,
});

interface Pair {
  computer: SyncFolder;
  phone: SyncFolder;
}

/** Deux dossiers mémoire jamais synchronisés, aux horloges décalées. */
const pairOf = (): Pair => ({ computer: syncMemoryFolder({ clockMs: 1_800_000_000_000 }), phone: syncMemoryFolder({ phone: true, clockMs: 1_800_000_417_000 }) });

const sync = (pair: Pair, options?: SyncRunOptions): Promise<SyncRun> => runFixtureSync(pair.computer, pair.phone, options);

/** La même session des deux côtés, sans base : comme après une récupération par le câble. */
const putBoth = (pair: Pair, k: number, setup: SyncSessionSetup = {}, phoneSetup: SyncSessionSetup = setup): void => {
  putSyncSession(pair.computer, at(k), setup);
  putSyncSession(pair.phone, at(k), phoneSetup);
};

/** Une paire déjà synchronisée une fois, avec les sessions de rang 0 à `count - 1` des deux côtés. */
const syncedPair = async (count: number, setup: SyncSessionSetup = {}): Promise<Pair> => {
  const pair = pairOf();
  for (let k = 0; k < count; k++) putBoth(pair, k, setup);
  await sync(pair);
  return pair;
};

const opKinds = (run: SyncRun): string[] => (run.plan?.items ?? []).flatMap((item) => item.ops.map((op) => op.kind));
const itemAt = (run: SyncRun, k: number): SyncItem | undefined => run.plan?.items.find((item) => item.startMs === at(k));
const trashFiles = (pair: Pair): string[] => pair.computer.paths().filter((p) => p.startsWith(`${SYNC_TRASH_DIR}/`));
const baseStarts = (pair: Pair): number[] | undefined => readFixtureBase(pair.computer, pair.phone)?.sessions.map((s) => s.startMs);

describe('listage et paire', () => {
  it('le listage range fiche et capteurs avec leur GPX, met à part ceux qui n’en ont plus, ignore le reste', () => {
    const entry = (name: string, kind: 'file' | 'directory' = 'file') => ({ name, kind, size: 10, mtimeMs: 5 });
    const listing = syncListing([
      entry('a.gpx'), entry('a.json'), entry('A.imu'), entry('b.gpx'), entry('c.json'), entry('d.imu'),
      entry('e.gpx.tracker-new'), entry('f.json.tmp'), entry('notes.txt'), entry('vieux', 'directory'),
    ]);
    expect(listing.sessions.map((s) => [s.gpx.name, s.record?.name ?? null, s.imu?.name ?? null])).toEqual([['a.gpx', 'a.json', 'A.imu'], ['b.gpx', null, null]]);
    expect(listing.orphans.map((f) => f.name)).toEqual(['c.json', 'd.imu']);
    expect(listing.names).toHaveLength(10);
  });

  it('première rencontre tant que la base ne vaut pas pour ces deux dossiers, à ce chemin', () => {
    const base = { ...emptySyncBase('ordinateur-0001', 'telephone-0001', 'Documents/Tracker') };
    expect(syncPair(null, null, null, null, null)).toEqual({ first: 'noComputerId', base: null, newId: { computer: true, phone: true } });
    expect(syncPair('ordinateur-0001', null, null, base, null)).toEqual({ first: 'noPhoneId', base: null, newId: { computer: false, phone: true } });
    expect(syncPair('ordinateur-0001', 'ordinateur-0001', null, base, null)).toEqual({ first: 'sameId', base: null, newId: { computer: false, phone: true } });
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, null, null)).toMatchObject({ first: 'noBase', newId: { computer: false, phone: false } });
    expect(syncPair('ordinateur-0002', 'telephone-0001', null, base, null)).toMatchObject({ first: 'otherComputer', base: null });
    expect(syncPair('ordinateur-0001', 'telephone-0001', 'Download/Tracker', base, null)).toMatchObject({ first: 'otherPath', base: null });
    // Un chemin inconnu d'un côté ou de l'autre ne prouve rien.
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, base, null)).toEqual({ first: null, base, newId: { computer: false, phone: false } });
    expect(syncPair('ordinateur-0001', 'telephone-0001', 'Documents/Tracker', base, null).first).toBeNull();
  });

  it('copie plus ancienne : un passage plus petit que celui de la base, ou aucun, en fait une première rencontre', () => {
    const base = { ...emptySyncBase('ordinateur-0001', 'telephone-0001', 'Documents/Tracker'), phonePass: 7 };
    const older = { first: 'olderCopy', base: null, newId: { computer: false, phone: true } };
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, base, 6)).toEqual(older);
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, base, null)).toEqual(older);
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, base, 7)).toEqual({ first: null, base, newId: { computer: false, phone: false } });
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, base, 9).first).toBeNull();
    // Base d'une version qui ne posait pas de passage : le contrôle ne joue pas.
    expect(syncPair('ordinateur-0001', 'telephone-0001', null, { ...base, phonePass: null }, null).first).toBeNull();
  });
});

describe.each([1, 5])('réunion de deux dossiers jamais synchronisés, traces à %i Hz', (hz) => {
  it('sessions disjointes et communes : rien de supprimé, tout des deux côtés, base posée, puis plus rien à faire', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0), { hz, imuBytes: 64 });
    putBoth(pair, 1, { hz, record: { name: 'Mistral' } }, { hz, record: { notes: notes({ comment: 'belle session' }) } });
    putSyncSession(pair.phone, at(2), { hz, imuBytes: 32 });

    const run = await sync(pair);
    expect(run.refusal).toBeNull();
    expect(run.plan?.pair.first).toBe('noComputerId');
    expect(opKinds(run).filter((kind) => kind === 'trash' || kind === 'removeFromPhone')).toEqual([]);
    for (const folder of [pair.computer, pair.phone]) {
      expect(await syncSessionFiles(folder)).toEqual([fileOf(0), fileOf(1), fileOf(2)]);
      expect(readSyncRecord(folder, fileOf(1))).toMatchObject({ name: 'Mistral', notes: { comment: 'belle session' } });
    }
    // Les capteurs suivent leur session, et le GPX arrive à l'octet près.
    expect(pair.phone.text(sessionPath(imuFileName(fileOf(0))))).toHaveLength(64);
    expect(pair.computer.text(sessionPath(imuFileName(fileOf(2))))).toHaveLength(32);
    expect(pair.computer.text(sessionPath(fileOf(2)))).toBe(pair.phone.text(sessionPath(fileOf(2))));
    expect(trashFiles(pair)).toEqual([]);
    expect(baseStarts(pair)).toEqual([at(0), at(1), at(2)]);
    const ids = [readMarkerId(pair.computer.text(MARKER_FILE)), readMarkerId(pair.phone.text(MARKER_FILE))];
    expect(ids[0]).not.toBeNull();
    expect(ids[1]).not.toBeNull();
    expect(ids[0]).not.toBe(ids[1]);

    const phoneSteps = pair.phone.steps();
    const again = await sync(pair);
    expect(again.plan?.pair.first).toBeNull();
    expect(again.plan?.items).toEqual([]);
    expect(pair.phone.steps()).toBe(phoneSteps);
  });
});

describe('noms de fichiers', () => {
  it('même session sous deux noms (fuseaux) : reconnue à son instant, jamais doublée', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    putSyncSession(pair.phone, at(0), { file: syncGpxName(at(0), 1), record: { name: 'Mistral' } });
    const run = await sync(pair);
    expect(itemAt(run, 0)?.case).toBe('firstMeeting');
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
    expect(await syncSessionFiles(pair.phone)).toEqual([syncGpxName(at(0), 1)]);
    expect(readSyncRecord(pair.computer, fileOf(0))).toMatchObject({ name: 'Mistral', gpx: fileOf(0) });
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('nom déjà pris de l’autre côté par une autre session : la copie prend un nom libre, que sa fiche nomme', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(4), { file: 'meme-nom.gpx', record: { name: 'ordinateur' } });
    putSyncSession(pair.phone, at(3), { file: 'meme-nom.gpx', record: { name: 'téléphone' }, imuBytes: 16 });
    await sync(pair);
    for (const folder of [pair.computer, pair.phone]) expect(await syncSessionFiles(folder)).toEqual(['meme-nom-2.gpx', 'meme-nom.gpx']);
    expect(readSyncRecord(pair.computer, 'meme-nom-2.gpx')).toMatchObject({ name: 'téléphone', gpx: 'meme-nom-2.gpx', summary: { startMs: at(3) } });
    expect(readSyncRecord(pair.phone, 'meme-nom-2.gpx')).toMatchObject({ name: 'ordinateur', gpx: 'meme-nom-2.gpx', summary: { startMs: at(4) } });
    expect(pair.computer.text(sessionPath('meme-nom-2.imu'))).toHaveLength(16);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('deux fichiers de la même session d’un côté : un seul voyage, l’autre est signalé', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(0), { file: 'a.gpx' });
    putSyncSession(pair.phone, at(0), { file: 'b.gpx', record: { notes: notes({ comment: 'celle qui compte' }) } });
    const run = await sync(pair);
    expect(run.plan?.duplicates).toEqual([{ side: 'phone', file: 'a.gpx', startMs: at(0) }]);
    expect(await syncSessionFiles(pair.computer)).toEqual(['b.gpx']);
    expect(await syncSessionFiles(pair.phone)).toEqual(['a.gpx', 'b.gpx']);
  });
});

describe('fiches modifiées', () => {
  it('changée sur le téléphone seul : l’ordinateur la reçoit et garde son résumé ; champs inconnus et illisibles intacts', async () => {
    const pair = pairOf();
    putBoth(pair, 0, { summary: { distanceM: 25_100 }, extra: { mapBase: 'relief' } }, { summary: { distanceM: 24_900 } });
    await sync(pair);
    editSyncRecord(pair.phone, fileOf(0), (record) => ({ ...record, name: 'Mistral', futur: { a: 1 } }));
    const phoneSteps = pair.phone.steps();

    const run = await sync(pair);
    expect(itemAt(run, 0)).toMatchObject({ case: 'followed', conflicts: [] });
    expect(run.plan?.items[0].ops.map((op) => [op.kind, 'on' in op && op.on])).toEqual([['writeRecord', 'computer']]);
    expect(pair.phone.steps()).toBe(phoneSteps);
    expect(readSyncRecord(pair.computer, fileOf(0))).toMatchObject({ name: 'Mistral', futur: { a: 1 }, mapBase: 'relief', summary: { distanceM: 25_100 } });
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('changée des deux côtés : fondue, écrite des deux côtés, le conflit dit', async () => {
    const pair = await syncedPair(1);
    editSyncRecord(pair.computer, fileOf(0), (record) => ({ ...record, name: 'Ordinateur', mapBase: 'plan' }));
    editSyncRecord(pair.phone, fileOf(0), (record) => ({ ...record, name: 'Téléphone', notes: notes({ comment: 'belle session' }) }));
    const run = await sync(pair);
    expect(itemAt(run, 0)?.conflicts).toEqual(['name']);
    for (const folder of [pair.computer, pair.phone]) {
      expect(readSyncRecord(folder, fileOf(0))).toMatchObject({ name: 'Ordinateur', mapBase: 'plan', notes: { comment: 'belle session' } });
    }
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('résumé seul refait d’un côté : rien n’est recopié, et pas de va-et-vient', async () => {
    const pair = await syncedPair(1);
    editSyncRecord(pair.computer, fileOf(0), (record) => ({ ...record, summary: { ...record.summary, distanceM: 26_000, optionsKey: '[10]' } }));
    const phoneSteps = pair.phone.steps();
    const phoneText = pair.phone.text(sessionPath(recordFileName(fileOf(0))));

    const run = await sync(pair);
    expect(opKinds(run)).toEqual([]);
    expect(pair.phone.steps()).toBe(phoneSteps);
    expect(pair.phone.text(sessionPath(recordFileName(fileOf(0))))).toBe(phoneText);
    expect(readSyncRecord(pair.computer, fileOf(0))?.summary.distanceM).toBe(26_000);
    // La nouvelle date de la fiche est entrée dans la base : elle n'est même plus relue.
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('résumé refait qui date autrement le premier point : toujours la même session, ni supprimée ni doublée', async () => {
    const pair = await syncedPair(4);
    editSyncRecord(pair.computer, fileOf(1), (record) => ({ ...record, summary: { ...record.summary, startMs: at(1) + 2000 } }));
    const run = await sync(pair);
    expect(opKinds(run)).toEqual([]);
    expect(run.plan?.items.map((item) => item.case)).toEqual(['followed']);
    for (const folder of [pair.computer, pair.phone]) expect(await syncSessionFiles(folder)).toHaveLength(4);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('fiche perdue sur le téléphone puis recréée vide par son application : rien n’est effacé sur l’ordinateur, le téléphone retrouve ses saisies', async () => {
    const pair = await syncedPair(4, { record: { name: 'Mistral', notes: notes({ comment: 'belle session' }) } });
    editSyncRecord(pair.phone, fileOf(1), (record) => ({ ...record, name: null, notes: null, addedAt: '2026-11-20T09:00:00.000Z' }));
    await sync(pair);
    for (const folder of [pair.computer, pair.phone]) {
      expect(readSyncRecord(folder, fileOf(1))).toMatchObject({ name: 'Mistral', notes: { comment: 'belle session' } });
    }
  });

  it('une seule des deux fiches gardées a disparu : la session est fondue sans ancêtre, c’est dit, et elle est suivie de nouveau', async () => {
    const pair = await syncedPair(4, { record: { name: 'Mistral' } });
    const kept = syncAncestorPath(readMarkerId(pair.phone.text(MARKER_FILE)) as string, at(1), 'phone');
    pair.computer.drop(kept);
    editSyncRecord(pair.computer, fileOf(1), (record) => ({ ...record, mapBase: 'plan' }));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'followed', left: null, withoutAncestor: true });
    expect(readSyncRecord(pair.phone, fileOf(1))).toMatchObject({ name: 'Mistral', mapBase: 'plan' });
    expect(pair.computer.text(kept)).not.toBeNull();
    expect((await sync(pair)).plan?.items).toEqual([]);

    // Sans rien de changé non plus : la copie est reposée, la session n'attend pas pour toujours.
    pair.computer.drop(kept);
    expect(itemAt(await sync(pair), 1)).toMatchObject({ left: null, withoutAncestor: true, ops: [] });
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('capteurs présents d’un seul côté : recopiés de l’autre', async () => {
    const pair = pairOf();
    putBoth(pair, 0, {}, { imuBytes: 48 });
    await sync(pair);
    expect(pair.computer.text(sessionPath(imuFileName(fileOf(0))))).toHaveLength(48);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });
});

describe('suppressions', () => {
  it('supprimée sur le téléphone : la copie de l’ordinateur va à sa corbeille', async () => {
    const pair = await syncedPair(4, { imuBytes: 8 });
    deleteSyncSession(pair.phone, fileOf(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)?.case).toBe('deletedOnPhone');
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(2), fileOf(3)]);
    expect(trashFiles(pair)).toEqual([fileOf(1), imuFileName(fileOf(1)), recordFileName(fileOf(1))].map((name) => `${SYNC_TRASH_DIR}/${at(1)}/${name}`).sort());
    expect(pair.computer.text(sessionPath(recordFileName(fileOf(1))))).toBeNull();
    expect(baseStarts(pair)).toEqual([at(0), at(2), at(3)]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('supprimée sur l’ordinateur : retirée du téléphone, GPX, fiche et capteurs', async () => {
    const pair = await syncedPair(4, { imuBytes: 8 });
    trashSyncSession(pair.computer, at(1), fileOf(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', keep: 'none', moveTo: String(at(1)) }] });
    expect(pair.phone.paths().filter((p) => p.startsWith('sessions/') && p.includes(fileOf(1).replace('.gpx', '')))).toEqual([]);
    // Rien n'est effacé du téléphone : ses trois fichiers sont dans un dépôt de sa corbeille, GPX d'abord, après depose.json.
    const dir = `corbeille/${SYNC_NOW_MS}-${at(1)}`;
    expect([...pair.phone.aside().keys()]).toEqual([fileOf(1), recordFileName(fileOf(1)), imuFileName(fileOf(1))].map((name) => `${dir}/${name}`));
    expect(pair.phone.written().filter((p) => p.startsWith('corbeille/'))).toEqual([`${dir}/depose.json`]);
    expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(0), fileOf(2), fileOf(3)]);
    expect(baseStarts(pair)).toEqual([at(0), at(2), at(3)]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('supprimée sur le téléphone mais modifiée sur l’ordinateur depuis : gardée, elle revient sur le téléphone', async () => {
    const pair = await syncedPair(4, { imuBytes: 8 });
    editSyncRecord(pair.computer, fileOf(1), (record) => ({ ...record, name: 'Gardée' }));
    deleteSyncSession(pair.phone, fileOf(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'deletedOnPhone', revived: true, ops: [{ kind: 'copy', to: 'phone' }] });
    expect(syncDeletionSide(itemAt(run, 1) as SyncItem)).toBeNull();
    expect(trashFiles(pair)).toEqual([]);
    expect(readSyncRecord(pair.phone, fileOf(1))?.name).toBe('Gardée');
    expect(await syncSessionFiles(pair.phone)).toHaveLength(4);
    expect(baseStarts(pair)).toHaveLength(4);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('supprimée sur l’ordinateur mais modifiée sur le téléphone depuis : gardée, elle revient sur l’ordinateur', async () => {
    const pair = await syncedPair(4);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    editSyncRecord(pair.phone, fileOf(1), (record) => ({ ...record, notes: notes({ comment: 'écrit après coup' }) }));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'deletedOnComputer', revived: true, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(pair.phone.aside().size).toBe(0);
    expect(readSyncRecord(pair.computer, fileOf(1))?.notes?.comment).toBe('écrit après coup');
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('supprimée d’un côté, l’autre seulement recalculé (résumé refait) : la suppression passe, comme sans changement', async () => {
    const pair = await syncedPair(4);
    editSyncRecord(pair.computer, fileOf(1), (record) => ({ ...record, summary: { ...record.summary, distanceM: 999 } }));
    deleteSyncSession(pair.phone, fileOf(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'deletedOnPhone', ops: [{ kind: 'trash' }] });
    expect(itemAt(run, 1)?.revived).toBeUndefined();
    expect(await syncSessionFiles(pair.computer)).toHaveLength(3);
  });

  it('GPX effacé à la main sur l’ordinateur : la copie du téléphone passe par la corbeille avant d’en être retirée', async () => {
    const pair = await syncedPair(4, { imuBytes: 8 });
    deleteSyncSession(pair.computer, fileOf(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'all' }]);
    expect(trashFiles(pair)).toHaveLength(3);
    expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(0), fileOf(2), fileOf(3)]);
  });

  it('restaurée depuis la corbeille après la synchronisation : elle revient sur le téléphone', async () => {
    const pair = await syncedPair(4);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    await sync(pair);
    restoreSyncSession(pair.computer, at(1));
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'newOnComputer', restored: true });
    expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(0), fileOf(1), fileOf(2), fileOf(3)]);
    expect(baseStarts(pair)).toEqual([at(0), at(1), at(2), at(3)]);
  });

  it('restaurée avant toute synchronisation : rien ne bouge', async () => {
    const pair = await syncedPair(4);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    restoreSyncSession(pair.computer, at(1));
    const run = await sync(pair);
    expect(opKinds(run)).toEqual([]);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(4);
  });

  it('supprimée sur le téléphone puis restaurée sur l’ordinateur : elle revient sur le téléphone', async () => {
    const pair = await syncedPair(4);
    deleteSyncSession(pair.phone, fileOf(1));
    await sync(pair);
    restoreSyncSession(pair.computer, at(1));
    await sync(pair);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(4);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
  });

  it('remise exprès sur le téléphone après une suppression synchronisée : elle revient sur l’ordinateur', async () => {
    const pair = await syncedPair(4);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    await sync(pair);
    putSyncSession(pair.phone, at(1));
    const run = await sync(pair);
    // Restaurée sur le téléphone (sans ligne, dans `removed`) : recopiée sans question, et dite revenue.
    expect(itemAt(run, 1)).toMatchObject({ case: 'newOnPhone', left: null, restored: true });
    expect(run.plan?.guard.tripped).toBe(false);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
  });

  it('neuve sur le téléphone sans rien dans la base : pas « revenue »', async () => {
    const pair = await syncedPair(2);
    putSyncSession(pair.phone, at(5));
    const run = await sync(pair);
    expect(itemAt(run, 5)?.case).toBe('newOnPhone');
    expect(itemAt(run, 5)?.restored).toBe(false);
  });

  it('dans la corbeille de l’ordinateur et encore sur le téléphone, sans que la synchronisation l’y ait mise : ni ramenée ni supprimée', async () => {
    const pair = pairOf();
    putBoth(pair, 0);
    putBoth(pair, 1);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    for (let pass = 0; pass < 2; pass++) {
      const run = await sync(pair);
      expect(itemAt(run, 1)).toMatchObject({ case: 'newOnPhone', left: 'inTrash', ops: [] });
      expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
      expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(0), fileOf(1)]);
    }
    expect(baseStarts(pair)).toEqual([at(0)]);
    expect(readFixtureBase(pair.computer, pair.phone)?.held).toEqual([at(1)]);

    // La corbeille la purge : la base s'en souvient, elle ne revient pas en silence.
    for (const path of trashFiles(pair)) pair.computer.drop(path);
    const purged = await sync(pair);
    expect(itemAt(purged, 1)).toMatchObject({ case: 'newOnPhone', left: 'inTrash', ops: [] });
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
    expect(readFixtureBase(pair.computer, pair.phone)?.held).toEqual([at(1)]);

    // Supprimée aussi sur le téléphone : il n'y a plus rien à retenir.
    deleteSyncSession(pair.phone, fileOf(1));
    await sync(pair);
    expect(readFixtureBase(pair.computer, pair.phone)?.held).toEqual([]);
  });

  it('la même, si l’on choisit de la retirer du téléphone : retirée, et gardée d’abord à la corbeille quand celle-ci ne la tient plus', async () => {
    const pair = pairOf();
    for (let k = 0; k < 10; k++) putBoth(pair, k);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    trashSyncSession(pair.computer, at(2), fileOf(2));
    await sync(pair);
    for (const path of trashFiles(pair).filter((p) => p.includes(`/${at(2)}/`))) pair.computer.drop(path);
    const run = await sync(pair, { heldOnPhone: 'remove' });
    expect(itemAt(run, 1)).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', keep: 'all' }] });
    expect(itemAt(run, 2)).toMatchObject({ case: 'deletedOnComputer', ops: [{ kind: 'removeFromPhone', keep: 'all' }] });
    expect(await syncSessionFiles(pair.phone)).toHaveLength(8);
    expect(trashFiles(pair).filter((p) => p.endsWith(`du-telephone/${fileOf(2)}`))).toHaveLength(1);
    expect(readFixtureBase(pair.computer, pair.phone)?.held).toEqual([]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('deux traces différentes du même instant, supprimée sur l’ordinateur : la trace du téléphone passe par la corbeille', async () => {
    const pair = pairOf();
    for (let k = 0; k < 4; k++) putBoth(pair, k);
    putSyncSession(pair.computer, at(9), { seconds: 40 });
    putSyncSession(pair.phone, at(9), { seconds: 20 });
    await sync(pair);
    const phoneGpx = pair.phone.text(sessionPath(fileOf(9)));
    trashSyncSession(pair.computer, at(9), fileOf(9));
    const run = await sync(pair);
    expect(itemAt(run, 9)?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'all' }]);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(4);
    expect(pair.computer.text(`${SYNC_TRASH_DIR}/${at(9)}/du-telephone/${fileOf(9)}`)).toBe(phoneGpx);
    expect(pair.computer.text(`${SYNC_TRASH_DIR}/${at(9)}/${fileOf(9)}`)).not.toBe(phoneGpx);
  });

  it('capteurs que seul le téléphone avait (deux traces) : ils passent par la corbeille avant d’être retirés', async () => {
    const pair = pairOf();
    for (let k = 0; k < 4; k++) putBoth(pair, k);
    putSyncSession(pair.computer, at(9), { seconds: 40 });
    putSyncSession(pair.phone, at(9), { seconds: 20, imuBytes: 24 });
    await sync(pair);
    // La corbeille tient déjà un GPX de la taille de celui du téléphone, mais pas ses capteurs.
    trashSyncSession(pair.computer, at(9), fileOf(9));
    pair.computer.put(`${SYNC_TRASH_DIR}/${at(9)}/${fileOf(9)}`, pair.phone.text(sessionPath(fileOf(9))) as string);
    const run = await sync(pair);
    expect(itemAt(run, 9)?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'all' }]);
    expect(pair.computer.text(`${SYNC_TRASH_DIR}/${at(9)}/du-telephone/${imuFileName(fileOf(9))}`)).toHaveLength(24);
  });

  it('deux fichiers de la même session sur le téléphone, supprimée sur l’ordinateur : les deux partent, rien ne revient', async () => {
    const pair = pairOf();
    for (let k = 0; k < 6; k++) putBoth(pair, k);
    putSyncSession(pair.phone, at(9), { file: 'a.gpx' });
    putSyncSession(pair.phone, at(9), { file: 'b.gpx', record: { notes: notes({ comment: 'celle qui compte' }) } });
    await sync(pair);
    trashSyncSession(pair.computer, at(9), 'b.gpx');
    const run = await sync(pair);
    expect(itemAt(run, 9)?.ops.map((op) => op.kind === 'removeFromPhone' && [op.files[0].name, op.keep])).toEqual([['a.gpx', 'all'], ['b.gpx', 'none']]);
    expect(run.plan?.guard).toMatchObject({ fromPhone: 1, tripped: false });
    expect((await syncSessionFiles(pair.phone)).filter((name) => name.length < 6)).toEqual([]);
    expect(pair.computer.text(`${SYNC_TRASH_DIR}/${at(9)}/du-telephone/a.json`)).not.toBeNull();
    const again = await sync(pair);
    expect(again.plan?.items).toEqual([]);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(6);
  });

  it('deux fichiers de la même session sur l’ordinateur, supprimée sur le téléphone : les deux vont à la corbeille, rien ne repart', async () => {
    const pair = pairOf();
    for (let k = 0; k < 6; k++) putBoth(pair, k);
    putSyncSession(pair.computer, at(9), { file: 'a.gpx' });
    putSyncSession(pair.computer, at(9), { file: 'b.gpx', record: { notes: notes({ comment: 'celle qui compte' }) } });
    await sync(pair);
    deleteSyncSession(pair.phone, 'b.gpx');
    const run = await sync(pair);
    expect(itemAt(run, 9)?.ops.map((op) => op.kind === 'trash' && op.files[0].name)).toEqual(['a.gpx', 'b.gpx']);
    expect(run.plan?.guard).toMatchObject({ toTrash: 1, tripped: false });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(6);
    expect(trashFiles(pair).filter((p) => p.endsWith('.gpx'))).toHaveLength(2);
    expect((await sync(pair)).plan?.items).toEqual([]);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(6);
  });

  it('GPX du téléphone changé de taille et fiche perdue : la session n’est pas prise pour supprimée, elle attend', async () => {
    const pair = await syncedPair(4);
    pair.phone.put(sessionPath(fileOf(1)), `${pair.phone.text(sessionPath(fileOf(1)))}\n<!-- retouché -->\n`);
    pair.phone.drop(sessionPath(recordFileName(fileOf(1))));
    for (let pass = 0; pass < 2; pass++) {
      const run = await sync(pair);
      expect(itemAt(run, 1)).toMatchObject({ case: 'followed', left: 'changedGpx', ops: [], base: { kind: 'keep' } });
      expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
      expect(trashFiles(pair)).toEqual([]);
    }
    expect(baseStarts(pair)).toHaveLength(4);
  });

  it('GPX de l’ordinateur changé de taille et fiche illisible : rien n’est retiré du téléphone', async () => {
    const pair = await syncedPair(4);
    pair.computer.put(sessionPath(fileOf(1)), `${pair.computer.text(sessionPath(fileOf(1)))}\n<!-- retouché -->\n`);
    pair.computer.put(sessionPath(recordFileName(fileOf(1))), '{ coupé');
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ left: 'changedGpx', ops: [] });
    expect(await syncSessionFiles(pair.phone)).toHaveLength(4);
  });

  it('suppression coupée sur le téléphone après le GPX : la reprise retire la fiche et les capteurs restés', async () => {
    const pair = await syncedPair(6, { imuBytes: 8 });
    trashSyncSession(pair.computer, at(1), fileOf(1));
    // La fiche du dépôt (deux pas : provisoire, puis renommage), puis un pas par fichier : le GPX part, puis la liaison tombe.
    pair.phone.cutAfter(3);
    expect((await sync(pair)).cut).toBe(true);
    expect(pair.phone.text(sessionPath(recordFileName(fileOf(1))))).not.toBeNull();
    pair.phone.cutAfter(null);
    const run = await sync(pair);
    expect(itemAt(run, 1)?.case).toBe('deletedOnBoth');
    expect(pair.phone.paths().filter((p) => p.startsWith('sessions/'))).toHaveLength(15);
    expect(baseStarts(pair)).toHaveLength(5);
  });

  it('une seule suppression sur deux sessions dépasse le quart : elle attend la confirmation', async () => {
    const pair = await syncedPair(2);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    expect((await sync(pair)).held).toBe(true);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(2);
  });
});

describe('suppressions refusées (`keep`)', () => {
  it('supprimée sur le téléphone, refusée : recopiée sur le téléphone, sa ligne reposée, rien à la corbeille', async () => {
    const pair = await syncedPair(8, { imuBytes: 8 });
    deleteSyncSession(pair.phone, fileOf(1));
    const run = await sync(pair, { keep: [at(1)] });
    expect(itemAt(run, 1)).toMatchObject({ case: 'newOnComputer', left: null, ops: [{ kind: 'copy', to: 'phone' }], base: { kind: 'set' } });
    expect(run.plan?.guard).toMatchObject({ tripped: false, toTrash: 0, fromPhone: 0 });
    expect(await syncSessionFiles(pair.phone)).toHaveLength(8);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(8);
    expect(pair.phone.text(sessionPath(imuFileName(fileOf(1))))).not.toBeNull();
    expect(trashFiles(pair)).toEqual([]);
    expect(baseStarts(pair)).toHaveLength(8);
    expect(readFixtureBase(pair.computer, pair.phone)?.removed).toEqual([]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('supprimée sur l’ordinateur, refusée : recopiée du téléphone sur l’ordinateur, même si la corbeille la tient', async () => {
    const pair = await syncedPair(8);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    editSyncRecord(pair.phone, fileOf(1), (record) => ({ ...record, notes: notes({ comment: 'écrit après coup' }) }));
    const run = await sync(pair, { keep: [at(1)] });
    expect(itemAt(run, 1)).toMatchObject({ case: 'newOnPhone', left: null, ops: [{ kind: 'copy', to: 'computer' }], base: { kind: 'set' } });
    expect(await syncSessionFiles(pair.phone)).toHaveLength(8);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(8);
    expect(readSyncRecord(pair.computer, fileOf(1))?.notes?.comment).toBe('écrit après coup');
    expect(baseStarts(pair)).toHaveLength(8);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('dans la corbeille de l’ordinateur et encore sur le téléphone, gardée : elle revient sur l’ordinateur et n’est plus retenue', async () => {
    const pair = pairOf();
    putBoth(pair, 0);
    putBoth(pair, 1);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    await sync(pair);
    expect(readFixtureBase(pair.computer, pair.phone)?.held).toEqual([at(1)]);
    const run = await sync(pair, { keep: [at(1)] });
    expect(itemAt(run, 1)).toMatchObject({ case: 'newOnPhone', left: null, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(1)]);
    expect(readFixtureBase(pair.computer, pair.phone)).toMatchObject({ held: [], removed: [] });
    expect(baseStarts(pair)).toEqual([at(0), at(1)]);
    // Même avec « retirer du téléphone » demandé pour les autres, celle-là n'est pas retirée.
    const other = pairOf();
    for (let k = 0; k < 10; k++) putBoth(other, k);
    trashSyncSession(other.computer, at(1), fileOf(1));
    trashSyncSession(other.computer, at(2), fileOf(2));
    await sync(other);
    const mixed = await sync(other, { heldOnPhone: 'remove', keep: [at(1)] });
    expect(itemAt(mixed, 1)?.case).toBe('newOnPhone');
    expect(itemAt(mixed, 2)?.case).toBe('deletedOnComputer');
    expect(await syncSessionFiles(other.phone)).toHaveLength(9);
    expect(await syncSessionFiles(other.computer)).toContain(fileOf(1));
  });

  it('`keep` n’agit que sur une suppression : une session suivie, neuve ou inconnue suit le plan ordinaire, et une autre suppression reste comptée', async () => {
    const pair = await syncedPair(8);
    putSyncSession(pair.computer, at(20));
    editSyncRecord(pair.phone, fileOf(3), (record) => ({ ...record, name: 'Renommée' }));
    deleteSyncSession(pair.phone, fileOf(1));
    deleteSyncSession(pair.phone, fileOf(2));
    const run = await sync(pair, { keep: [at(1), at(3), at(20), at(99)] });
    expect(itemAt(run, 1)?.case).toBe('newOnComputer');
    expect(itemAt(run, 2)?.case).toBe('deletedOnPhone');
    expect(itemAt(run, 3)?.case).toBe('followed');
    expect(itemAt(run, 20)?.case).toBe('newOnComputer');
    expect(itemAt(run, 99)).toBeUndefined();
    expect(run.plan?.guard).toMatchObject({ toTrash: 1, fromPhone: 0 });
    expect(await syncSessionFiles(pair.computer)).not.toContain(fileOf(2));
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
  });

  it('restes d’une session absente des deux côtés : ni comptés par le garde-fou, ni tenus pour une suppression', async () => {
    const pair = await syncedPair(3, { imuBytes: 8 });
    // Supprimée sur le téléphone, et sur l'ordinateur à la main, GPX seul : sa fiche et ses capteurs sont restés.
    deleteSyncSession(pair.phone, fileOf(1));
    pair.computer.drop(sessionPath(fileOf(1)));
    const withheld = await sync(pair, { scope: { computer: true, phone: true, deletions: false } });
    expect(itemAt(withheld, 1)).toMatchObject({ case: 'deletedOnBoth', left: 'outOfScope' });
    const whole = await sync(pair);
    expect(itemAt(whole, 1)?.ops.map((op) => op.kind)).toEqual(['trash']);
    expect(syncDeletionSide(itemAt(whole, 1) as SyncItem)).toBeNull();
    expect(whole.plan?.guard).toMatchObject({ tripped: false, toTrash: 0, fromPhone: 0 });
    expect(whole.held).toBe(false);
  });
});

describe('un appareil vidé ne vide jamais l’autre', () => {
  /** Vide le dossier mémoire, que l'application recrée ensuite : marqueur sans identifiant. */
  const wipe = (folder: SyncFolder): void => {
    for (const path of folder.paths()) folder.drop(path);
    folder.put(MARKER_FILE, markerText());
  };

  it('téléphone vidé en entier : première rencontre, rien à la corbeille, il reçoit de nouveau les sessions', async () => {
    const pair = await syncedPair(6);
    wipe(pair.phone);
    const run = await sync(pair);
    expect(run.plan?.pair.first).toBe('noPhoneId');
    expect(run.held).toBe(false);
    expect(trashFiles(pair)).toEqual([]);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(6);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(6);
  });

  it('ordinateur vidé en entier : rien n’est retiré du téléphone', async () => {
    const pair = await syncedPair(6);
    wipe(pair.computer);
    const run = await sync(pair);
    expect(run.plan?.pair.first).toBe('noComputerId');
    expect(opKinds(run).every((kind) => kind === 'copy')).toBe(true);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(6);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(6);
  });

  it('téléphone vidé à moitié, marqueur resté : rien n’est supprimé sans confirmation', async () => {
    const pair = await syncedPair(8);
    for (let k = 0; k < 5; k++) deleteSyncSession(pair.phone, fileOf(k));
    putSyncSession(pair.computer, at(20));
    const run = await sync(pair);
    expect(run.held).toBe(true);
    expect(trashFiles(pair)).toEqual([]);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(9);
    // Copies et fusions ne sont pas bloquées ; les suppressions attendent, la base les garde.
    expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(5), fileOf(6), fileOf(7), fileOf(20)].sort());
    expect(itemAt(run, 0)).toMatchObject({ case: 'deletedOnPhone', ops: [], left: 'outOfScope', base: { kind: 'keep' } });
    expect(baseStarts(pair)).toHaveLength(9);

    const confirmed = await sync(pair, { confirmDeletions: true });
    expect(confirmed.held).toBe(false);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
    expect(baseStarts(pair)).toHaveLength(4);
  });

  it('ordinateur vidé à moitié sans passer par sa corbeille : avec confirmation, chaque session retirée du téléphone y passe d’abord', async () => {
    const pair = await syncedPair(8);
    for (let k = 0; k < 5; k++) deleteSyncSession(pair.computer, fileOf(k));
    expect((await sync(pair)).held).toBe(true);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(8);
    await sync(pair, { confirmDeletions: true });
    expect(await syncSessionFiles(pair.phone)).toHaveLength(3);
    expect(trashFiles(pair).filter((p) => p.endsWith('.gpx'))).toHaveLength(5);
  });
});

describe('dossiers et fiches qui ne se synchronisent pas tels quels', () => {
  it('dossier sans marqueur, ou d’une version plus récente : refus, rien n’est écrit', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    pair.phone.drop(MARKER_FILE);
    expect((await sync(pair)).refusal).toBe('phoneNoMarker');
    pair.phone.put(MARKER_FILE, JSON.stringify({ format: 'tracker-memoire', version: MEMORY_VERSION + 1 }));
    expect((await sync(pair)).refusal).toBe('phoneNewer');
    expect(pair.computer.steps() + pair.phone.steps()).toBe(0);
  });

  it('téléphone qui porte l’identifiant de l’ordinateur (dossier recopié) : il en reçoit un autre, et rien ne se supprime', async () => {
    const pair = await syncedPair(3);
    const computerId = readMarkerId(pair.computer.text(MARKER_FILE));
    pair.phone.put(MARKER_FILE, pair.computer.text(MARKER_FILE) as string);
    deleteSyncSession(pair.phone, fileOf(0));
    const run = await sync(pair);
    expect(run.plan?.pair.first).toBe('sameId');
    expect(readMarkerId(pair.computer.text(MARKER_FILE))).toBe(computerId);
    expect(readMarkerId(pair.phone.text(MARKER_FILE))).not.toBe(computerId);
    expect(trashFiles(pair)).toEqual([]);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(3);
  });

  it('autre chemin sur le téléphone que celui de la base (vieille copie) : première rencontre, rien à la corbeille', async () => {
    const pair = pairOf();
    for (let k = 0; k < 3; k++) putBoth(pair, k);
    await sync(pair, { phonePath: 'Documents/Tracker' });
    deleteSyncSession(pair.phone, fileOf(0));
    const run = await sync(pair, { phonePath: 'Download/Tracker' });
    expect(run.plan?.pair.first).toBe('otherPath');
    expect(trashFiles(pair)).toEqual([]);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(3);
  });

  it('base d’une version plus récente : refus, elle n’est pas réécrite', async () => {
    const pair = await syncedPair(1);
    const path = pair.computer.paths().find((p) => p.startsWith(`${SYNC_DIR}/`) && !p.includes('/fiches/')) as string;
    const text = JSON.stringify({ ...JSON.parse(pair.computer.text(path) as string), version: 99 });
    pair.computer.put(path, text);
    deleteSyncSession(pair.phone, fileOf(0));
    expect((await sync(pair)).refusal).toBe('newerBase');
    expect(pair.computer.text(path)).toBe(text);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(1);
  });

  it('fiche d’une version plus récente : jamais fondue ni réécrite ; changée seule, recopiée à l’octet', async () => {
    const pair = pairOf();
    putBoth(pair, 0, { record: { name: 'Ordinateur' } }, { record: { version: RECORD_VERSION + 1, name: 'Téléphone' }, extra: { futur: [1, 2] } });
    const recordPath = sessionPath(recordFileName(fileOf(0)));
    const phoneText = pair.phone.text(recordPath);
    const first = await sync(pair);
    expect(opKinds(first)).toEqual([]);
    expect(pair.phone.text(recordPath)).toBe(phoneText);
    expect(readSyncRecord(pair.computer, fileOf(0))?.name).toBe('Ordinateur');
    expect(baseStarts(pair)).toEqual([at(0)]);

    // Changée sur l'ordinateur : elle ne peut pas passer dans une fiche qu'on ne réécrit pas.
    editSyncRecord(pair.computer, fileOf(0), (record) => ({ ...record, name: 'Autre' }));
    const second = await sync(pair);
    expect(itemAt(second, 0)).toMatchObject({ left: 'futureRecord', ops: [] });
    expect(pair.phone.text(recordPath)).toBe(phoneText);
    editSyncRecord(pair.computer, fileOf(0), (record) => ({ ...record, name: 'Ordinateur' }));

    // Changée sur le téléphone seul : l'ordinateur la reçoit telle quelle.
    pair.phone.put(recordPath, (phoneText as string).replace('"Téléphone"', '"Renommée"'));
    const third = await sync(pair);
    expect(opKinds(third)).toEqual(['copyRecord']);
    expect(pair.computer.text(recordPath)).toBe(pair.phone.text(recordPath));
    expect((await sync(pair)).plan?.items).toEqual([]);
  });
});

describe('garde-fou de masse', () => {
  const COUNT = 44;

  it(`${SYNC_GUARD_MAX_REMOVALS} suppressions passent`, async () => {
    const pair = await syncedPair(COUNT);
    for (let k = 0; k < SYNC_GUARD_MAX_REMOVALS; k++) deleteSyncSession(pair.phone, fileOf(k));
    const run = await sync(pair);
    expect(run.held).toBe(false);
    expect(run.plan?.guard).toMatchObject({ tripped: false, toTrash: SYNC_GUARD_MAX_REMOVALS, fromPhone: 0, count: { computer: COUNT, phone: COUNT - SYNC_GUARD_MAX_REMOVALS } });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(COUNT - SYNC_GUARD_MAX_REMOVALS);
  });

  it(`${SYNC_GUARD_MAX_REMOVALS + 1} suppressions s’arrêtent, des deux côtés confondus`, async () => {
    const pair = await syncedPair(COUNT);
    for (let k = 0; k < 6; k++) deleteSyncSession(pair.phone, fileOf(k));
    for (let k = 10; k < 15; k++) trashSyncSession(pair.computer, at(k), fileOf(k));
    const run = await sync(pair);
    expect(run.held).toBe(true);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(COUNT - 5);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(COUNT - 6);
    await sync(pair, { confirmDeletions: true });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(COUNT - 11);
    expect(await syncSessionFiles(pair.phone)).toHaveLength(COUNT - 11);
  });

  it('plus du quart d’un côté s’arrête aussi, même en petit nombre', async () => {
    const pair = await syncedPair(8);
    for (let k = 0; k < 2; k++) deleteSyncSession(pair.phone, fileOf(k));
    expect((await sync(pair)).held).toBe(false);
    for (let k = 2; k < 4; k++) deleteSyncSession(pair.phone, fileOf(k));
    // 2 sur les 6 qui restent : un tiers.
    expect((await sync(pair)).held).toBe(true);
  });

  it('listage en retard : la session que le listage ne montre plus est revue par stat, et rien n’est supprimé', async () => {
    const pair = await syncedPair(8);
    pair.phone.lag([fileOf(1), recordFileName(fileOf(1))].map(sessionPath));
    const run = await sync(pair);
    expect(itemAt(run, 1)?.case).toBe('deletedOnPhone');
    expect(run.skipped.map((item) => item.startMs)).toEqual([at(1)]);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(8);
    expect(trashFiles(pair)).toEqual([]);
    expect(baseStarts(pair)).toHaveLength(8);
    pair.phone.lag([]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });
});

describe('sessions pas finies de ranger sur le téléphone', () => {
  it('GPX sans fiche : laissé, puis recopié quand sa fiche est là', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(0), { withRecord: false });
    const run = await sync(pair);
    expect(run.plan?.unknown).toEqual([{ side: 'phone', file: fileOf(0), reason: 'noRecord' }]);
    expect(await syncSessionFiles(pair.computer)).toEqual([]);
    putSyncSession(pair.phone, at(0));
    await sync(pair);
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
  });

  it('GPX non fini : laissé, puis recopié une fois fini', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(0));
    const whole = pair.phone.text(sessionPath(fileOf(0))) as string;
    pair.phone.put(sessionPath(fileOf(0)), whole.slice(0, whole.length - 30));
    const run = await sync(pair);
    expect(itemAt(run, 0)).toMatchObject({ case: 'newOnPhone', left: 'unfinishedGpx', ops: [] });
    expect(await syncSessionFiles(pair.computer)).toEqual([]);
    pair.phone.put(sessionPath(fileOf(0)), whole);
    await sync(pair);
    expect(pair.computer.text(sessionPath(fileOf(0)))).toBe(whole);
  });

  it('fiche devenue illisible sur le téléphone : la session attend, rien n’est supprimé ni réécrit', async () => {
    const pair = await syncedPair(4);
    pair.phone.put(sessionPath(recordFileName(fileOf(1))), '{ coupé');
    const run = await sync(pair);
    expect(itemAt(run, 1)).toMatchObject({ case: 'followed', left: 'unreadableRecord', ops: [], base: { kind: 'keep' } });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
    expect(pair.phone.text(sessionPath(recordFileName(fileOf(1))))).toBe('{ coupé');
  });

  it('remplacement coupé sur le téléphone : le temporaire resté seul vaut le fichier, la session n’est pas vue supprimée', async () => {
    const pair = await syncedPair(4);
    const gpx = sessionPath(fileOf(1));
    pair.phone.put(`${gpx}.tracker-tmp`, pair.phone.text(gpx) as string);
    pair.phone.drop(gpx);
    pair.phone.put(`${sessionPath(fileOf(9))}.tracker-new`, 'copie en cours');
    const run = await sync(pair);
    expect(opKinds(run)).toEqual([]);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(4);
  });
});

describe.each([1, 5])('deux traces différentes du même instant, à %i Hz', (hz) => {
  it('aucun GPX remplacé, capteurs non mêlés, seuls les champs saisis fondus', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0), { hz, seconds: 40, record: { name: 'Montre' } });
    putSyncSession(pair.phone, at(0), { hz, seconds: 20, imuBytes: 24, record: { notes: notes({ comment: 'du téléphone' }) } });
    const gpx = { computer: pair.computer.text(sessionPath(fileOf(0))), phone: pair.phone.text(sessionPath(fileOf(0))) };
    const run = await sync(pair);
    expect(itemAt(run, 0)).toMatchObject({ case: 'firstMeeting', twoTracks: true });
    expect(pair.computer.text(sessionPath(fileOf(0)))).toBe(gpx.computer);
    expect(pair.phone.text(sessionPath(fileOf(0)))).toBe(gpx.phone);
    expect(pair.computer.text(sessionPath(imuFileName(fileOf(0))))).toBeNull();
    for (const folder of [pair.computer, pair.phone]) {
      expect(readSyncRecord(folder, fileOf(0))).toMatchObject({ name: 'Montre', notes: { comment: 'du téléphone' } });
    }
    expect(readSyncRecord(pair.computer, fileOf(0))?.summary.endMs).toBe(at(0) + 40_000);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });
});

describe('plan restreint à une moitié', () => {
  const COMPUTER_ONLY = { computer: true, phone: false, deletions: false };

  it('ordinateur seul : il reçoit ce qui est neuf sur le téléphone, rien ne s’écrit sur le téléphone, rien ne se supprime ni ne revient', async () => {
    const pair = await syncedPair(4);
    putSyncSession(pair.phone, at(10));
    putSyncSession(pair.computer, at(11));
    trashSyncSession(pair.computer, at(1), fileOf(1));
    deleteSyncSession(pair.phone, fileOf(2));
    editSyncRecord(pair.computer, fileOf(3), (record) => ({ ...record, name: 'Ordinateur' }));
    editSyncRecord(pair.phone, fileOf(3), (record) => ({ ...record, notes: notes({ comment: 'du téléphone' }) }));
    const phoneSteps = pair.phone.steps();

    const run = await sync(pair, { scope: COMPUTER_ONLY });
    expect(pair.phone.steps()).toBe(phoneSteps);
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(2), fileOf(3), fileOf(10), fileOf(11)].sort());
    expect(readSyncRecord(pair.computer, fileOf(3))).toMatchObject({ name: 'Ordinateur', notes: { comment: 'du téléphone' } });
    expect(trashFiles(pair).filter((p) => p.endsWith('.gpx'))).toHaveLength(1);
    // La base ne change pas : une ligne posée sans que le téléphone reçoive un passage neuf échapperait à la
    // reconnaissance d'une copie de son dossier. Chaque session garde sa ligne telle quelle, ou n'en a pas encore.
    expect(baseStarts(pair)).toEqual([at(0), at(1), at(2), at(3)]);
    expect(run.plan?.saveBase).toBe(false);
    expect(run.plan?.items.filter((item) => item.left === 'outOfScope').map((item) => item.startMs)).toEqual([at(1), at(2), at(3), at(11)]);
    expect(itemAt(run, 3)?.base).toEqual({ kind: 'keep' });

    // La synchronisation entière finit ce qui attendait, sans rien refaire de faux.
    await sync(pair);
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(3), fileOf(10), fileOf(11)].sort());
    expect(await syncSessionFiles(pair.phone)).toEqual([fileOf(0), fileOf(3), fileOf(10), fileOf(11)].sort());
    expect(readSyncRecord(pair.phone, fileOf(3))).toMatchObject({ name: 'Ordinateur', notes: { comment: 'du téléphone' } });
    expect(baseStarts(pair)).toEqual([at(0), at(3), at(10), at(11)]);
    expect((await sync(pair)).plan?.items).toEqual([]);
  });

  it('téléphone sans identifiant, qu’on ne peut pas écrire : les sessions arrivent, la base ne s’écrit pas', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(0));
    putBoth(pair, 1);
    trashSyncSession(pair.computer, at(1), fileOf(1));
    const run = await sync(pair, { scope: COMPUTER_ONLY });
    expect(run.plan?.saveBase).toBe(false);
    expect(hasSyncFiles(pair.computer)).toBe(false);
    expect(pair.phone.steps()).toBe(0);
    // La session supprimée sur l'ordinateur ne revient pas pour autant.
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
  });

  it('« sans rien supprimer » : copies et fusions seules, les suppressions restent à faire', () => {
    const pair = syncPair('ordinateur-0001', 'telephone-0001', null, {
      ...emptySyncBase('ordinateur-0001', 'telephone-0001', null),
      sessions: [{
        startMs: at(0),
        computer: { gpx: { name: 'a.gpx', size: 10, mtimeMs: 1 }, record: { name: 'a.json', size: 5, mtimeMs: 1 }, imu: null },
        phone: { gpx: { name: 'a.gpx', size: 10, mtimeMs: 2 }, record: { name: 'a.json', size: 5, mtimeMs: 2 }, imu: null },
      }],
    }, null);
    const computer = syncListing([{ name: 'a.gpx', kind: 'file', size: 10, mtimeMs: 1 }, { name: 'a.json', kind: 'file', size: 5, mtimeMs: 1 }]);
    expect(syncRecordsToRead(computer, pair.base, 'computer', () => true)).toEqual([]);
    // La copie gardée de ce côté manque : la fiche est lue, pour être fondue sans ancêtre.
    expect(syncRecordsToRead(computer, pair.base, 'computer', (_startMs, side) => side !== 'computer')).toEqual(['a.json']);
    expect(syncRecordsToRead(computer, pair.base, 'computer', (_startMs, side) => side !== 'phone')).toEqual([]);
    expect(syncRecordsToRead(computer, null, 'computer', () => true)).toEqual(['a.json']);
    const plan = planSync({ pair, computer: syncSide(computer, new Map()), phone: syncSide(syncListing([]), new Map()), ancestors: new Map([[at(0), { computer: '{}', phone: '{}' }]]), trash: [] });
    expect(plan.guard).toMatchObject({ tripped: true, toTrash: 1 });
    const kept = restrictSyncPlan(plan, { computer: true, phone: true, deletions: false });
    expect(kept.guard.tripped).toBe(false);
    expect(kept.items).toMatchObject([{ case: 'deletedOnPhone', ops: [], base: { kind: 'keep' }, left: 'outOfScope' }]);
  });
});

describe('coupure à chaque pas, puis reprise', () => {
  /** Un cas de chaque sorte : copies dans les deux sens, fusion des deux côtés, suppression de chaque côté. */
  const scenario = async (): Promise<Pair> => {
    const pair = await syncedPair(4, { imuBytes: 8 });
    putSyncSession(pair.computer, at(10), { imuBytes: 16 });
    putSyncSession(pair.phone, at(11), { imuBytes: 16, record: { notes: notes({ comment: 'neuve' }) } });
    // Deux sessions différentes sous le même nom, une de chaque côté : chacune arrive en face sous un nom « -2 ».
    putSyncSession(pair.phone, at(12), { file: fileOf(10), imuBytes: 24, record: { name: 'homonyme' } });
    editSyncRecord(pair.computer, fileOf(0), (record) => ({ ...record, name: 'Ordinateur' }));
    editSyncRecord(pair.phone, fileOf(0), (record) => ({ ...record, notes: notes({ comment: 'du téléphone' }) }));
    trashSyncSession(pair.computer, at(1), fileOf(1));
    deleteSyncSession(pair.phone, fileOf(2));
    return pair;
  };

  /** Ce que l'application de chaque appareil lirait : ses sessions, leurs fiches, et la corbeille de l'ordinateur. */
  const snapshot = async (pair: Pair): Promise<unknown> => {
    const side = async (folder: SyncFolder) => {
      const sessions = await syncSessionFiles(folder);
      return Promise.all(sessions.map(async (file) => {
        const record = JSON.parse((await folder.readText(sessionPath(recordFileName(file))))!);
        return { file, name: record.name, notes: record.notes?.comment ?? null, imu: (await folder.stat(sessionPath(imuFileName(file))))?.size ?? null };
      }));
    };
    // Tous les noms de `sessions/` aussi : aucun reste (fiche ou capteurs seuls, nom « -3 ») ne doit traîner.
    const names = async (folder: SyncFolder) => (await folder.list('sessions')).map((e) => e.name).sort();
    return {
      computer: await side(pair.computer), phone: await side(pair.phone), trash: trashFiles(pair), base: baseStarts(pair),
      names: { computer: await names(pair.computer), phone: await names(pair.phone) },
      // Ce qui a quitté le téléphone, et sous quel nom : rien de déplacé deux fois, rien de perdu.
      // Un dépôt coupé avant ses fichiers est refait sous un nom neuf (`-2`) : seul compte ce qui y est arrivé.
      phoneAside: [...pair.phone.aside().keys()].map((p) => p.replace(/^(corbeille\/\d{13}-\d+)-\d+\//, '$1/')).sort(),
    };
  };

  /** Aucun GPX visible sans sa fiche : l'application n'en fabriquerait pas une neuve à la place d'une fiche saisie. */
  const expectNoBareGpx = async (folder: SyncFolder): Promise<void> => {
    const names = new Set((await folder.list('sessions')).map((e) => e.name));
    for (const name of names) {
      if (name.endsWith('.gpx')) expect(names.has(recordFileName(name)), `${name} sans fiche`).toBe(true);
    }
  };

  it.each(['computer', 'phone'] as const)('liaison coupée côté %s après chaque pas : aucune session sans fiche, et la reprise finit dans le même état', async (side) => {
    const reference = await scenario();
    const before = reference[side].steps();
    await sync(reference);
    const total = reference[side].steps() - before;
    const expected = await snapshot(reference);
    expect(total).toBeGreaterThan(10);

    for (let n = 0; n < total; n++) {
      const pair = await scenario();
      pair[side].cutAfter(n);
      const run = await sync(pair);
      expect(run.cut, `coupure après ${n} pas`).toBe(true);
      await expectNoBareGpx(pair.computer);
      await expectNoBareGpx(pair.phone);
      pair[side].cutAfter(null);
      await sync(pair);
      expect(await snapshot(pair), `reprise après ${n} pas`).toEqual(expected);
      expect((await sync(pair)).plan?.items, `repos après ${n} pas`).toEqual([]);
    }
  });
});

describe('ce que Tracker range de plus', () => {
  /** GPX d'une séance sans position (muscu, nuit de FC) : l'heure et la FC seules. */
  const positionless = (startMs: number): string => {
    const points = Array.from({ length: 21 }, (_, i) => `<trkpt><time>${new Date(startMs + i * 1000).toISOString()}</time><extensions><hr>60</hr></extensions></trkpt>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="essai"><trk><trkseg>\n${points.join('\n')}\n</trkseg></trk></gpx>\n`;
  };

  it('séance de muscu et nuit de FC, sans position : copiées comme les autres, jamais prises pour des restes', async () => {
    const pair = await syncedPair(1);
    const muscu = putSyncSession(pair.phone, at(5), { record: { sport: 'muscu', activityId: 'muscu' } });
    pair.phone.put(sessionPath(muscu), positionless(at(5)));
    const night = putSyncSession(pair.computer, at(6), { file: syncGpxName(at(6)).replace('wingfoil', 'night-hr') });
    pair.computer.put(sessionPath(night), positionless(at(6)));
    const run = await sync(pair);
    expect(run.plan?.unknown).toEqual([]);
    expect(itemAt(run, 5)).toMatchObject({ case: 'newOnPhone', left: null });
    expect(itemAt(run, 6)).toMatchObject({ case: 'newOnComputer', left: null });
    expect(await syncSessionFiles(pair.computer)).toEqual(await syncSessionFiles(pair.phone));
    expect(readSyncRecord(pair.computer, muscu)?.sport).toBe('muscu');
    // Supprimée sur le téléphone, elle part à la corbeille comme une autre.
    deleteSyncSession(pair.phone, muscu);
    expect(itemAt(await sync(pair, { confirmDeletions: true }), 5)).toMatchObject({ case: 'deletedOnPhone' });
    expect(trashFiles(pair).some((p) => p.endsWith(muscu))).toBe(true);
  });

  it('les seuils du garde-fou sont des paramètres : abaissés, il s’arrête plus tôt', async () => {
    const pair = await syncedPair(20);
    for (let k = 0; k < 2; k++) deleteSyncSession(pair.phone, fileOf(k));
    const run = await sync(pair, { guardLimits: { maxRemovals: 1, maxShare: 1 } });
    expect(run.held).toBe(true);
    // Le plan rendu est déjà restreint : il ne compte plus les suppressions retenues, mais garde les seuils.
    expect(run.plan?.guard).toMatchObject({ tripped: false, limits: { maxRemovals: 1, maxShare: 1 }, toTrash: 0 });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(20);
    expect((await sync(pair)).held).toBe(false);
    expect(await syncSessionFiles(pair.computer)).toHaveLength(18);
  });

  it('la corbeille de l’ordinateur se lit dans son index : sessions et restes, de toute origine, pas les itinéraires', () => {
    const entry = (patch: Partial<TrashEntry>): TrashEntry => ({
      dir: 'd', kind: 'session', startMs: 10, routeBase: null, createdAt: null, name: 'n', deletedAtMs: 1, origin: 'ordinateur', reason: 'supprimee',
      main: 'a.gpx', files: [{ name: 'a.gpx', size: 5 }], ...patch,
    });
    expect(syncTrashedFrom([
      entry({}), entry({ kind: 'restes', startMs: 20, origin: 'telephone', files: [{ name: 'b.json', size: 3 }] }),
      entry({ kind: 'itineraire', startMs: null, routeBase: 'Tour' }),
    ])).toEqual([{ startMs: 10, files: [{ name: 'a.gpx', size: 5 }] }, { startMs: 20, files: [{ name: 'b.json', size: 3 }] }]);
  });
});

describe('première rencontre : rien ne se retire, d’aucun côté, quel que soit le choix', () => {
  const REASONS: SyncFirstReason[] = ['noComputerId', 'noPhoneId', 'sameId', 'noBase', 'otherComputer', 'otherPath', 'olderCopy'];
  const file = 'a.gpx';
  const recordText = serializeRecord(sessionRecord({ gpx: file }, { startMs: at(0), endMs: at(0) + 20_000 }));
  const entry = (name: string, size: number) => ({ name, kind: 'file' as const, size, mtimeMs: 5 });
  const routeText = serializeRouteRecord({
    format: ROUTE_FORMAT, version: ROUTE_VERSION, name: 'Tour', activityId: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z',
    waypoints: [{ lat: 43.5, lon: 3.9 }, { lat: 43.51, lon: 3.91 }], legs: [],
  });

  it.each(REASONS)('%s : la session et l’itinéraire de la corbeille encore sur le téléphone sont laissés, même avec « retirer »', (first) => {
    const phoneListing = syncListing([entry(file, 900), entry('a.json', recordText.length)]);
    const plan = planSync({
      pair: { first, base: null, newId: { computer: false, phone: false } },
      computer: syncSide(syncListing([]), new Map()),
      phone: { ...syncSide(phoneListing, new Map([['a.json', recordText]])), sessions: syncSide(phoneListing, new Map([['a.json', recordText]])).sessions.map((x) => ({ ...x, gpxComplete: true })) },
      ancestors: new Map(),
      trash: [{ startMs: at(0), files: [{ name: file, size: 900 }] }],
      heldOnPhone: 'remove',
    });
    const removals = (p: typeof plan) => p.items.flatMap((i) => i.ops).filter((op) => op.kind === 'removeFromPhone' || op.kind === 'trash');
    expect(removals(plan)).toEqual([]);
    expect(plan.items).toMatchObject([{ startMs: at(0), left: 'inTrash', base: { kind: 'hold' } }]);
    expect(removals(restrictSyncPlan(plan, { computer: true, phone: true, deletions: true }))).toEqual([]);

    const routeListing = syncRouteListing([entry('Tour.json', routeText.length)]);
    const routes = planRouteSync({
      base: null, computer: syncRouteSide(syncRouteListing([]), new Map()), phone: syncRouteSide(routeListing, new Map([['Tour.json', routeText]])),
      trash: [{ id: '2026-11-01T10:00:00.000Z', text: routeText }], heldOnPhone: 'remove',
    });
    const routeRemovals = (p: typeof routes) => p.items.flatMap((i) => i.ops).filter((op) => op.kind === 'removeFromPhone' || op.kind === 'trash');
    expect(routeRemovals(routes)).toEqual([]);
    expect(routes.items).toMatchObject([{ left: 'inTrash' }]);
    expect(routeRemovals(restrictRouteSyncPlan(routes, { computer: true, phone: true, deletions: true }))).toEqual([]);
  });

  it('sur le vrai chemin : supprimée sur l’ordinateur avant toute synchronisation, « retirer » ne la retire pas la première fois', async () => {
    const pair = pairOf();
    putBoth(pair, 0);
    putSyncSession(pair.computer, at(1));
    putSyncSession(pair.phone, at(1));
    trashSyncSession(pair.computer, at(1), fileOf(1));
    const run = await sync(pair, { heldOnPhone: 'remove' });
    expect(run.plan?.pair.first).not.toBeNull();
    expect(opKinds(run).filter((k) => k === 'removeFromPhone' || k === 'trash')).toEqual([]);
    expect(pair.phone.aside().size).toBe(0);
    expect(itemAt(run, 1)).toMatchObject({ left: 'inTrash' });
  });
});
