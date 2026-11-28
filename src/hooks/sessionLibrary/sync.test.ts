import { describe, expect, it } from 'vitest';
import { sessionPath } from '../../library/folderLayout';
import { restingHrFileText, type StoredRestingResult } from '../../library/restingHrStore';
import { buildSettingsFile, serializeSettingsFile } from '../../library/settingsFile';
import { imuFileName, recordFileName, type SessionRecord, type StoredSessionNotes } from '../../library/record';
import { parseSyncBase, readMarkerId, readMarkerPass, readMarkerSync, syncBasePath } from '../../library/syncBase';
import { describeSync, describeSyncQuestion } from '../../library/syncReport';
import {
  DEPOSIT_FILE, TRASH_DIR, TRASH_INDEX_PATH, parseDeposit, parseTrashIndex, returnedTrashGroups, sessionRestorePlan, sessionTrashEntries,
  shownTrashEntries, type TrashEntry,
} from '../../library/trash';
import { adoptDeposits, copyFromTrash, dropTrashEntries, emptyTrash, stashInTrash, type TrashFolder } from '../../library/trashFolder';
import type { MemoryFolder } from '../../platform/memoryFolder';
import {
  SyncCutError, deleteSyncSession, editSyncRecord, putSyncSession, readSyncRecord, syncGpxName, syncMemoryFolder, syncSessionFiles,
  type SyncFolder,
} from '../../test/syncFolder.fixture';
import { SYNC_RUNNING_PATH, executeSync, type SyncDeletionKey, type SyncOptions, type SyncOutcome, type SyncRemote } from './sync';

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const at = (k: number): number => T0 + k * HOUR;
const fileOf = (k: number): string => syncGpxName(at(k));

const notes = (patch: Partial<StoredSessionNotes>): StoredSessionNotes => ({
  foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: '', gear: null, comment: '', windLevel: null, waterState: null, rating: null, savedAt: 100, ...patch,
});

interface Pair {
  computer: SyncFolder;
  phone: SyncFolder;
}

/** `cable` : le téléphone répond comme par le câble, `stat` et lectures d'après son dernier listage (par défaut). */
const pairOf = (cable = true): Pair => ({
  computer: syncMemoryFolder({ clockMs: 1_800_000_000_000 }), phone: syncMemoryFolder({ phone: true, clockMs: 1_800_000_417_000, cable }),
});

let ids = 0;
const run = (pair: Pair, options: SyncOptions = {}, phone: SyncRemote = pair.phone, computer: MemoryFolder = pair.computer): Promise<SyncOutcome> =>
  executeSync(computer, phone, { now: () => NOW, newFolderId: () => `dossier-sync-${String(++ids).padStart(4, '0')}`, ...options });

/** Opérations élémentaires de l'écriture du marqueur du téléphone (`.tracker-new`, puis `mv -f`), où chaque passage qui l'écrit pose son compteur. */
const MARKER_STEPS = 2;

const putBoth = (pair: Pair, k: number, imuBytes?: number): void => {
  putSyncSession(pair.computer, at(k), { imuBytes });
  putSyncSession(pair.phone, at(k), { imuBytes });
};

const syncedPair = async (count: number): Promise<Pair> => {
  const pair = pairOf();
  for (let k = 0; k < count; k++) putBoth(pair, k);
  expect((await run(pair)).complete).toBe(true);
  return pair;
};

const trashOf = (pair: Pair): TrashEntry[] => parseTrashIndex(pair.computer.text(TRASH_INDEX_PATH)).entries;

/** Supprime une session sur l'ordinateur comme l'application : copie à la corbeille, puis retrait, GPX d'abord. */
const trashOnComputer = async (pair: Pair, k: number): Promise<void> => {
  const names = [fileOf(k), recordFileName(fileOf(k)), imuFileName(fileOf(k))].map(sessionPath);
  await stashInTrash(pair.computer, { kind: 'session', paths: names, main: names[0], startMs: at(k), name: `session ${k}` }, NOW - 1000);
  for (const path of names) pair.computer.drop(path);
};

/** « Restaurer » comme Réglages › Mémoire : les fichiers reviennent dans `sessions/`, puis les entrées quittent la corbeille. */
const restoreOnComputer = async (pair: Pair, k: number): Promise<void> => {
  const entries = sessionTrashEntries(trashOf(pair), at(k));
  const plan = sessionRestorePlan(entries[0], await syncSessionFiles(pair.computer));
  await copyFromTrash(pair.computer, plan.copies);
  await dropTrashEntries(pair.computer, entries.map((e) => e.dir));
};

const baseOf = (pair: Pair) => {
  const id = readMarkerId(pair.phone.text('tracker.json'));
  const read = id ? parseSyncBase(pair.computer.text(syncBasePath(id))) : null;
  return read?.state === 'ok' ? read.base : null;
};

/** Chaque GPX que l'application d'un côté verrait a sa fiche : rien qui recevrait une fiche neuve. */
const everyGpxHasRecord = async (folder: SyncFolder): Promise<void> => {
  for (const gpx of await syncSessionFiles(folder)) expect(await folder.readText(sessionPath(recordFileName(gpx))), gpx).not.toBeNull();
};

describe('exécutant de la synchronisation', () => {
  it('première rencontre : chaque côté reçoit ce qui lui manque, rien n’est supprimé, la base et les identifiants sont posés', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0), { imuBytes: 40 });
    putSyncSession(pair.phone, at(1), { hz: 5 });
    putBoth(pair, 2);
    const outcome = await run(pair);
    expect(outcome).toMatchObject({ refusal: null, first: 'noComputerId', complete: true, interrupted: false, linkLost: null, error: null });
    for (const side of [pair.computer, pair.phone]) expect(await syncSessionFiles(side)).toEqual([fileOf(0), fileOf(1), fileOf(2)]);
    expect(pair.phone.text(sessionPath(imuFileName(fileOf(0))))).not.toBeNull();
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(1), at(2)]);
    expect(pair.computer.text(SYNC_RUNNING_PATH)).toBeNull();
    // Rien de plus à faire.
    const again = await run(pair);
    expect(again.plan?.items.flatMap((i) => i.ops)).toEqual([]);
  });

  it('refuse un ordinateur sans corbeille ou dont la corbeille ne se lit pas, sans rien écrire', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    const browser = { ...pair.computer, kind: 'browser' as const };
    expect((await run(pair, {}, pair.phone, browser)).refusal).toBe('noTrash');
    pair.computer.put(TRASH_INDEX_PATH, '{abîmé');
    expect((await run(pair)).refusal).toBe('trashLocked');
    expect(await syncSessionFiles(pair.phone)).toEqual([]);
    expect(pair.phone.steps()).toBe(0);
  });

  it('supprimée sur le téléphone : la copie de l’ordinateur passe à sa corbeille, d’origine « ordinateur »', async () => {
    const pair = await syncedPair(3);
    deleteSyncSession(pair.phone, fileOf(1));
    // Une sur trois : plus du quart, le garde-fou retient la suppression tant qu'elle n'est pas confirmée.
    const held = await run(pair);
    expect(held).toMatchObject({ deletions: 'awaitingConfirmation', complete: false });
    expect(held.withheldDeletions.map((i) => i.startMs)).toEqual([at(1)]);
    // « Sans rien supprimer » demandé : écartées, pas en attente de confirmation.
    expect(await run(pair, { withoutDeletions: true })).toMatchObject({ deletions: 'excluded', complete: false });
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(1), fileOf(2)]);
    const outcome = await run(pair, { confirmDeletions: true });
    expect(outcome.complete).toBe(true);
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0), fileOf(2)]);
    expect(trashOf(pair).map((e) => [e.startMs, e.origin, e.main])).toEqual([[at(1), 'ordinateur', fileOf(1)]]);
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(2)]);
  });

  it('restaurée de la corbeille : revient sur le téléphone ; restaurée avant toute synchronisation : rien ne bouge', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    expect((await run(pair)).complete).toBe(true);
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(1));
    await restoreOnComputer(pair, 1);
    await run(pair);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toContain(at(1));

    await trashOnComputer(pair, 2);
    await restoreOnComputer(pair, 2);
    const steps = pair.phone.steps();
    const quiet = await run(pair);
    expect(pair.phone.steps()).toBe(steps + MARKER_STEPS);
    expect(quiet.plan?.items.flatMap((i) => i.ops)).toEqual([]);
    expect(trashOf(pair)).toEqual([]);
  });

  it('réimportée après suppression : revient des deux côtés', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 3);
    await run(pair);
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(3));
    putSyncSession(pair.computer, at(3));
    await run(pair);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(3));
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(3));
  });

  it('second téléphone : une suppression faite sur le premier atteint le second, par la corbeille de l’ordinateur', async () => {
    const pair = await syncedPair(5);
    const second = syncMemoryFolder({ phone: true, clockMs: 1_800_000_900_000 });
    expect((await run(pair, {}, second)).complete).toBe(true);
    expect(await syncSessionFiles(second)).toEqual(await syncSessionFiles(pair.phone));
    deleteSyncSession(pair.phone, fileOf(2));
    await run(pair);
    const outcome = await run(pair, {}, second);
    expect(outcome.done.find((i) => i.startMs === at(2))?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'none' }]);
    expect(await syncSessionFiles(second)).not.toContain(fileOf(2));
    expect(trashOf(pair).map((e) => e.origin)).toEqual(['ordinateur']);
  });

  it('un fichier du téléphone qui change entre le plan et le retrait : la session reste, puis part avec sa fiche gardée', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    let lists = 0;
    const changing: SyncRemote = {
      ...pair.phone,
      list: async (dir) => {
        const entries = await pair.phone.list(dir);
        // Juste après le listage du plan, le téléphone réécrit la fiche (l’application y était ouverte).
        if (dir === 'sessions' && ++lists === 1) editSyncRecord(pair.phone, fileOf(1), (r) => ({ ...r, notes: notes({ comment: 'écrit pendant la synchronisation' }) }));
        return entries;
      },
    };
    const outcome = await run(pair, {}, changing);
    expect(outcome.skipped.map((i) => i.startMs)).toEqual([at(1)]);
    expect(outcome.complete).toBe(false);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toContain(at(1));
    // La fois suivante : supprimée sur l'ordinateur mais modifiée sur le téléphone depuis, elle est gardée et revient
    // sur l'ordinateur (règle du moteur de Tracker, `revived`), rien n'est retiré du téléphone.
    const next = await run(pair);
    expect(next.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'deletedOnComputer', revived: true, ops: [{ kind: 'copy', to: 'computer' }] });
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    expect(readSyncRecord(pair.computer, fileOf(1))?.notes?.comment).toBe('écrit pendant la synchronisation');
  });

  it('une fiche du téléphone enregistrée pendant la synchronisation n’est pas écrasée : la session est sautée, puis fondue', async () => {
    const pair = await syncedPair(3);
    editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Nom de l’ordinateur' }));
    const outcome = await run(pair, {
      // Juste après le plan, une note est enregistrée sur le téléphone (l’application y était ouverte).
      onPlanned: () => editSyncRecord(pair.phone, fileOf(1), (r) => ({ ...r, notes: notes({ comment: 'note du téléphone' }) })),
    });
    expect(outcome.plan?.items.find((i) => i.startMs === at(1))?.ops.map((op) => op.kind)).toEqual(['writeRecord']);
    expect(outcome.skipped.map((i) => i.startMs)).toEqual([at(1)]);
    expect(outcome.complete).toBe(false);
    expect(readSyncRecord(pair.phone, fileOf(1))?.notes?.comment).toBe('note du téléphone');
    // La fois suivante, les deux saisies se rejoignent des deux côtés.
    expect((await run(pair)).complete).toBe(true);
    for (const side of [pair.computer, pair.phone]) {
      const record = readSyncRecord(side, fileOf(1));
      expect([record?.name, record?.notes?.comment]).toEqual(['Nom de l’ordinateur', 'note du téléphone']);
    }
  });

  it('listage en retard : une session que le téléphone liste absente mais qui y est encore n’est pas mise à la corbeille', async () => {
    // Un canal qui liste en retard mais dont `stat` voit juste (transfert de fichiers) ; le câble, lui, ne liste pas en retard.
    const pair = pairOf(false);
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await run(pair);
    pair.phone.lag([`sessions/${fileOf(2)}`, `sessions/${recordFileName(fileOf(2))}`]);
    const outcome = await run(pair);
    expect(outcome.skipped.map((i) => i.startMs)).toEqual([at(2)]);
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(2));
    expect(trashOf(pair)).toEqual([]);
  });

  it('keep « all » : la copie du téléphone est rangée à part de celle de l’ordinateur, sous le même nom, d’origine « telephone »', async () => {
    const pair = await syncedPair(8);
    // La corbeille vidée à la main entre-temps pour la session 3 : elle ne tient plus rien d’elle.
    await trashOnComputer(pair, 3);
    await dropTrashEntries(pair.computer, sessionTrashEntries(trashOf(pair), at(3)).map((e) => e.dir));
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(3))?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'all' }]);
    expect(outcome.keptFromPhone).toEqual([at(3)]);
    expect(sessionTrashEntries(trashOf(pair), at(3)).map((e) => [e.origin, e.files.length])).toEqual([['telephone', 2]]);
    expect(await syncSessionFiles(pair.phone)).toEqual([0, 1, 2, 4, 5, 6, 7].map(fileOf));
    // Rien n'est effacé du téléphone : la copie y est aussi déposée dans sa corbeille.
    expect([...pair.phone.aside().keys()].filter((p) => p.includes(fileOf(3).replace(/.gpx$/, '')))).toHaveLength(2);
  });

  it('une session qui échoue au milieu sur l’ordinateur garde sa ligne de base intacte ; les autres continuent', async () => {
    const pair = await syncedPair(4);
    editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Ordinateur' }));
    editSyncRecord(pair.phone, fileOf(1), (r) => ({ ...r, notes: notes({ comment: 'téléphone' }) }));
    putSyncSession(pair.computer, at(6));
    const before = baseOf(pair)?.sessions.find((s) => s.startMs === at(1));
    const failing: SyncRemote = {
      ...pair.computer,
      writeBytes: async (path, bytes) => {
        if (path === sessionPath(recordFileName(fileOf(1)))) throw new Error('disque plein');
        return pair.computer.writeBytes(path, bytes);
      },
    };
    const outcome = await run(pair, {}, pair.phone, failing);
    expect(outcome.failed.map((f) => [f.item.startMs, f.detail])).toEqual([[at(1), 'disque plein']]);
    expect(outcome.complete).toBe(false);
    expect(baseOf(pair)?.sessions.find((s) => s.startMs === at(1))).toEqual(before);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(6));
    // La fois suivante, sans panne, tout finit d’accord.
    expect((await run(pair)).complete).toBe(true);
    expect(readSyncRecord(pair.computer, fileOf(1))?.notes?.comment).toBe('téléphone');
    expect(readSyncRecord(pair.phone, fileOf(1))?.name).toBe('Ordinateur');
  });

  it('même champ changé des deux côtés : conflit dit, la version de l’ordinateur passe aux deux, rien à la corbeille', async () => {
    const pair = await syncedPair(3);
    editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Ordinateur' }));
    editSyncRecord(pair.phone, fileOf(1), (r) => ({ ...r, name: 'Téléphone' }));
    const outcome = await run(pair);
    expect(outcome.complete).toBe(true);
    expect(outcome.done.find((i) => i.startMs === at(1))?.conflicts).toEqual(['name']);
    for (const folder of [pair.computer, pair.phone]) expect(readSyncRecord(folder, fileOf(1))?.name).toBe('Ordinateur');
    expect(trashOf(pair)).toEqual([]);
    expect(describeSync(outcome).notes.some((n) => n.text.includes("La version de l'ordinateur a été gardée sur les deux."))).toBe(true);
  });

  it('supprimée sur l’ordinateur avant toute synchronisation : laissée sur le téléphone, retenue par la base, jamais ramenée', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(2))).toMatchObject({ left: 'inTrash', base: { kind: 'hold' }, ops: [] });
    expect(baseOf(pair)?.held).toEqual([at(2)]);
    // La corbeille purgée ensuite ne la fait pas revenir sur l'ordinateur.
    await dropTrashEntries(pair.computer, trashOf(pair).map((e) => e.dir));
    await run(pair);
    expect(await syncSessionFiles(pair.computer)).not.toContain(fileOf(2));
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(2));
  });

  it('« sans rien supprimer » : aucun retrait d’aucun côté, la base garde leurs lignes, les suppressions reviennent ensuite', async () => {
    const pair = await syncedPair(8);
    deleteSyncSession(pair.phone, fileOf(1));
    await trashOnComputer(pair, 2);
    putSyncSession(pair.phone, at(9));
    const steps = pair.phone.steps();
    const outcome = await run(pair, { withoutDeletions: true });
    expect(outcome).toMatchObject({ deletions: 'excluded', complete: false });
    expect(outcome.withheldDeletions.map((i) => i.startMs)).toEqual([at(1), at(2)]);
    expect(await syncSessionFiles(pair.computer)).toEqual([0, 1, 3, 4, 5, 6, 7, 9].map(fileOf));
    expect(await syncSessionFiles(pair.phone)).toEqual([0, 2, 3, 4, 5, 6, 7, 9].map(fileOf));
    expect(pair.phone.steps()).toBe(steps + MARKER_STEPS);
    expect(trashOf(pair).map((e) => e.startMs)).toEqual([at(2)]);
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9].map(at));
    const after = await run(pair);
    expect(after).toMatchObject({ deletions: 'made', complete: true });
    expect(after.done.filter((i) => i.ops.length > 0).map((i) => i.case)).toEqual(['deletedOnPhone', 'deletedOnComputer']);
    expect(await syncSessionFiles(pair.phone)).toEqual(await syncSessionFiles(pair.computer));
  });

  it('téléphone qu’on ne peut pas écrire : le garde-fou ignore les retraits du téléphone, les mises à la corbeille se font', async () => {
    const pair = await syncedPair(20);
    for (let k = 0; k < 12; k++) await trashOnComputer(pair, k);
    deleteSyncSession(pair.phone, fileOf(15));
    const steps = pair.phone.steps();
    const half = await run(pair, { phoneWritable: false });
    expect(half).toMatchObject({ deletions: 'made', withheldDeletions: [] });
    expect(describeSyncQuestion(half)).toBeNull();
    expect(pair.phone.steps()).toBe(steps);
    expect(await syncSessionFiles(pair.computer)).not.toContain(fileOf(15));
    expect(trashOf(pair).some((e) => e.startMs === at(15))).toBe(true);
    expect(half.withheldForPhone).toHaveLength(12);
    expect(describeSync(half).notes.map((n) => n.text)).toContain("Ce programme n'a rien pu écrire sur le téléphone : installez sa dernière version.");
    // Par le câble, les douze retraits du téléphone dépassent le garde-fou.
    const whole = await run(pair);
    expect(whole).toMatchObject({ deletions: 'awaitingConfirmation' });
    expect(whole.withheldDeletions).toHaveLength(12);
  });

  it('téléphone qu’on ne peut pas écrire : rien n’y est écrit ni retiré, la base reste juste, la synchronisation entière finit le travail', async () => {
    const pair = await syncedPair(8);
    putSyncSession(pair.computer, at(10));
    putSyncSession(pair.phone, at(11));
    editSyncRecord(pair.phone, fileOf(3), (r) => ({ ...r, name: 'Du téléphone' }));
    editSyncRecord(pair.computer, fileOf(4), (r) => ({ ...r, name: 'De l’ordinateur' }));
    await trashOnComputer(pair, 5);
    const steps = pair.phone.steps();
    const half = await run(pair, { phoneWritable: false });
    expect(half).toMatchObject({ phoneWritable: false, complete: false });
    expect(pair.phone.steps()).toBe(steps);
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(11));
    expect(readSyncRecord(pair.computer, fileOf(3))?.name).toBe('Du téléphone');
    expect(half.withheldDeletions).toEqual([]);
    expect(half.withheldForPhone.map((i) => i.startMs)).toContain(at(5));
    // Sans passage neuf dans le marqueur du téléphone, la base ne change pas : la copie reçue n'y a pas de ligne.
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(at));
    const whole = await run(pair);
    expect(whole.complete).toBe(true);
    expect(await syncSessionFiles(pair.phone)).toEqual(await syncSessionFiles(pair.computer));
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(5));
    expect(readSyncRecord(pair.phone, fileOf(4))?.name).toBe('De l’ordinateur');
  });

  it('la corbeille vidée entre le plan et le retrait : la copie du téléphone y est rangée avant de partir', async () => {
    const pair = await syncedPair(8);
    await trashOnComputer(pair, 1);
    let lists = 0;
    const emptying: SyncRemote = {
      ...pair.phone,
      list: async (dir) => {
        const entries = await pair.phone.list(dir);
        // Le deuxième listage est celui que l'exécutant refait juste avant le retrait, le plan étant fait.
        if (dir === 'sessions' && ++lists === 2) await emptyTrash(pair.computer);
        return entries;
      },
    };
    const outcome = await run(pair, {}, emptying);
    expect(outcome.done.find((i) => i.startMs === at(1))?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'none' }]);
    expect(outcome.keptFromPhone).toEqual([at(1)]);
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(1));
    expect(trashOf(pair).map((e) => [e.startMs, e.origin, e.files.length])).toEqual([[at(1), 'telephone', 2]]);
  });

  it('la corbeille qui ne s’écrit pas avant le premier retrait : rien ne part du téléphone', async () => {
    const pair = await syncedPair(8);
    await trashOnComputer(pair, 1);
    await dropTrashEntries(pair.computer, trashOf(pair).map((e) => e.dir));
    const failing: SyncRemote = {
      ...pair.computer,
      writeBytes: async (path, bytes) => {
        if (path.startsWith('corbeille/')) throw new Error('disque plein');
        return pair.computer.writeBytes(path, bytes);
      },
    };
    const steps = pair.phone.steps();
    const outcome = await run(pair, {}, pair.phone, failing);
    expect(outcome.failed.map((f) => f.item.startMs)).toEqual([at(1)]);
    expect(pair.phone.steps()).toBe(steps + MARKER_STEPS);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toContain(at(1));
  });

  it('des restes sans GPX vont avec l’entrée de la même session sans rien y écraser, sinon dans une entrée de restes cachée', async () => {
    const pair = await syncedPair(8);
    // Une mise à la corbeille coupée après le GPX : la fiche et les capteurs sont restés.
    putSyncSession(pair.computer, at(9), { imuBytes: 12 });
    putSyncSession(pair.phone, at(9), { imuBytes: 12 });
    await run(pair);
    const names = [fileOf(9), recordFileName(fileOf(9)), imuFileName(fileOf(9))].map(sessionPath);
    await stashInTrash(pair.computer, { kind: 'session', paths: names, main: names[0], startMs: at(9), name: 's9' }, NOW - 1000);
    pair.computer.drop(names[0]);
    deleteSyncSession(pair.phone, fileOf(9));
    await run(pair);
    expect(trashOf(pair).filter((e) => e.startMs === at(9)).map((e) => [e.kind, e.files.length])).toEqual([['session', 3]]);
    expect(pair.computer.text(names[1])).toBeNull();
    // Restes d’une autre session, dont la fiche a changé depuis son entrée : rien d’écrasé, une entrée de restes à part.
    await trashOnComputer(pair, 3);
    putSyncSession(pair.computer, at(3), { record: { name: 'Fiche changée depuis' } });
    pair.computer.drop(sessionPath(fileOf(3)));
    await run(pair, { confirmDeletions: true });
    const three = trashOf(pair).filter((e) => e.startMs === at(3));
    expect(three.map((e) => e.kind).sort()).toEqual(['restes', 'session']);
    expect(shownTrashEntries(three).map((e) => e.kind)).toEqual(['session']);
    // La session de la corbeille se restaure telle qu’elle était, sa fiche d’origine comprise.
    await restoreOnComputer(pair, 3);
    expect(readSyncRecord(pair.computer, fileOf(3))?.name).not.toBe('Fiche changée depuis');
  });

  it('liaison perdue : tout s’arrête, le témoin reste, la reprise le dit', async () => {
    const pair = await syncedPair(2);
    putSyncSession(pair.computer, at(5));
    pair.phone.cutAfter(0);
    const cut = await run(pair);
    expect(cut.linkLost).not.toBeNull();
    expect(pair.computer.text(SYNC_RUNNING_PATH)).not.toBeNull();
    pair.phone.cutAfter(null);
    const resumed = await run(pair);
    expect(resumed).toMatchObject({ interrupted: true, complete: true });
    expect(pair.computer.text(SYNC_RUNNING_PATH)).toBeNull();
  });
});

describe('ce que la couche du bouton reçoit', () => {
  it('copie de sécurité : appelée à la première rencontre, avant toute écriture, et seulement là', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(1));
    const calls: string[] = [];
    const outcome = await run(pair, {
      beforeWrites: async (first) => {
        calls.push(`copie ${first} ${pair.computer.text(SYNC_RUNNING_PATH) === null && readMarkerId(pair.phone.text('tracker.json')) === null}`);
        return 'C:\\Documents\\Tracker-copies\\2026-11-21 12-00-00';
      },
    });
    expect(calls).toEqual(['copie noComputerId true']);
    expect(outcome).toMatchObject({ complete: true, safetyCopy: 'C:\\Documents\\Tracker-copies\\2026-11-21 12-00-00' });
    // Paire suivie : plus de copie.
    expect((await run(pair, { beforeWrites: async () => (calls.push('encore'), null) })).safetyCopy).toBeNull();
    expect(calls).toHaveLength(1);
    // Téléphone qu'on ne peut pas écrire : l'ordinateur va recevoir, la copie est faite quand même, avant lui.
    const lone = pairOf();
    putSyncSession(lone.phone, at(1));
    const half = await run(lone, {
      phoneWritable: false,
      beforeWrites: async () => {
        calls.push(`sans écriture ${(await syncSessionFiles(lone.computer)).length}`);
        return 'copie';
      },
    });
    expect(calls).toEqual(['copie noComputerId true', 'sans écriture 0']);
    expect(half.safetyCopy).toBe('copie');
    expect(await syncSessionFiles(lone.computer)).toEqual([fileOf(1)]);
    // Copie en échec : l'ordinateur ne reçoit rien non plus.
    const refused = pairOf();
    putSyncSession(refused.phone, at(1));
    const stopped = await run(refused, { phoneWritable: false, beforeWrites: async () => { throw new Error('disque plein'); } });
    expect(stopped.refusal).toBe('safetyCopy');
    expect(await syncSessionFiles(refused.computer)).toEqual([]);
  });

  it('coupure après la copie de sécurité : la reprise ne la refait pas, et redit son dossier', async () => {
    for (const n of [0, 1]) {
      const pair = pairOf();
      putSyncSession(pair.computer, at(0));
      putSyncSession(pair.phone, at(1));
      let copies = 0;
      const beforeWrites = async (): Promise<string> => `C:\\copies\\${++copies}`;
      pair.phone.cutAfter(n);
      expect((await run(pair, { beforeWrites })).linkLost, `coupure après ${n}`).not.toBeNull();
      pair.phone.cutAfter(null);
      const resumed = await run(pair, { beforeWrites, safetyCopyExists: async () => true });
      expect(resumed, `coupure après ${n}`).toMatchObject({ interrupted: true, complete: true, safetyCopy: 'C:\\copies\\1' });
      expect(copies).toBe(1);
    }
  });

  it('coupure après la copie de sécurité : une copie effacée depuis, ou dont on ne peut rien dire, est refaite', async () => {
    for (const exists of [async () => false, undefined]) {
      const pair = pairOf();
      putSyncSession(pair.computer, at(0));
      putSyncSession(pair.phone, at(1));
      let copies = 0;
      const asked: string[] = [];
      const beforeWrites = async (): Promise<string> => `copies/${++copies}`;
      pair.phone.cutAfter(1);
      expect((await run(pair, { beforeWrites })).linkLost).not.toBeNull();
      pair.phone.cutAfter(null);
      const resumed = await run(pair, { beforeWrites, safetyCopyExists: exists && (async (path) => (asked.push(path), exists())) });
      expect(resumed).toMatchObject({ interrupted: true, complete: true, safetyCopy: 'copies/2' });
      expect(copies).toBe(2);
      if (exists) expect(asked).toEqual(['copies/1']);
    }
  });

  it('coupure en pleine copie, base déjà écrite : la reprise, paire suivie, redit le dossier de la copie sans la refaire', async () => {
    let suivies = 0;
    for (let n = 0; n < 40; n++) {
      const pair = pairOf();
      for (const k of [0, 1, 2]) putSyncSession(pair.computer, at(k));
      for (const k of [3, 4, 5]) putSyncSession(pair.phone, at(k));
      let copies = 0;
      const beforeWrites = async (): Promise<string> => `C:\\copies\\${++copies}`;
      pair.phone.cutAfter(n);
      const cut = await run(pair, { beforeWrites });
      pair.phone.cutAfter(null);
      if (cut.linkLost === null) break;
      const id = readMarkerId(pair.phone.text('tracker.json'));
      if (id === null || pair.computer.text(syncBasePath(id)) === null) continue;
      suivies++;
      const resumed = await run(pair, { beforeWrites, safetyCopyExists: async () => true });
      expect(resumed, `coupure après ${n}`).toMatchObject({ interrupted: true, complete: true, safetyCopy: 'C:\\copies\\1' });
      expect(copies, `coupure après ${n}`).toBe(1);
    }
    expect(suivies).toBeGreaterThan(0);
  });

  it('coupure après la copie de sécurité : la copie n’est reprise que si elle est récente, sur une horloge avancée ou reculée aussi', async () => {
    const cases: [string, number, number][] = [['une demi-heure plus tard', HOUR / 2, 1], ['deux heures plus tard', 2 * HOUR, 2], ['des mois plus tard', 90 * 24 * HOUR, 2], ['horloge reculée de deux heures', -2 * HOUR, 2]];
    for (const [label, shift, expectedCopies] of cases) {
      const pair = pairOf();
      putSyncSession(pair.computer, at(0));
      putSyncSession(pair.phone, at(1));
      let copies = 0;
      const beforeWrites = async (): Promise<string> => `copies/${++copies}`;
      pair.phone.cutAfter(1);
      expect((await run(pair, { beforeWrites })).linkLost, label).not.toBeNull();
      pair.phone.cutAfter(null);
      const resumed = await run(pair, { beforeWrites, now: () => NOW + shift, safetyCopyExists: async () => true });
      expect(resumed, label).toMatchObject({ interrupted: true, complete: true, safetyCopy: `copies/${expectedCopies}` });
      expect(copies, label).toBe(expectedCopies);
    }
  });

  it('coupure après la copie de sécurité : un témoin sans l’instant de la copie (ancienne forme) la fait refaire', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    putSyncSession(pair.phone, at(1));
    let copies = 0;
    const beforeWrites = async (): Promise<string> => `copies/${++copies}`;
    pair.phone.cutAfter(1);
    expect((await run(pair, { beforeWrites })).linkLost).not.toBeNull();
    pair.phone.cutAfter(null);
    const witness = JSON.parse(pair.computer.text(SYNC_RUNNING_PATH) as string) as Record<string, unknown>;
    expect(witness.safetyCopyAtMs).toBe(NOW);
    delete witness.safetyCopyAtMs;
    pair.computer.put(SYNC_RUNNING_PATH, JSON.stringify(witness));
    expect(await run(pair, { beforeWrites })).toMatchObject({ interrupted: true, complete: true, safetyCopy: 'copies/2' });
    expect(copies).toBe(2);
  });

  it('copie de sécurité en échec : refus, rien n’est écrit d’aucun côté', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    putSyncSession(pair.phone, at(1));
    const outcome = await run(pair, { beforeWrites: async () => Promise.reject(new Error('disque plein')) });
    expect(outcome).toMatchObject({ refusal: 'safetyCopy', error: 'disque plein', first: 'noComputerId', complete: false });
    expect(pair.phone.steps()).toBe(0);
    expect(pair.computer.text(SYNC_RUNNING_PATH)).toBeNull();
    expect(readMarkerId(pair.computer.text('tracker.json'))).toBeNull();
    expect(await syncSessionFiles(pair.computer)).toEqual([fileOf(0)]);
  });

  it('le plan est annoncé avant la première copie ; l’avancement compte les fichiers jusqu’au total', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0), { imuBytes: 40 });
    putSyncSession(pair.phone, at(1));
    const seen: string[] = [];
    await run(pair, {
      onPlanned: (plan, first) => seen.push(`plan ${plan.items.length} ${first} ${pair.phone.text(sessionPath(fileOf(0))) === null ? 'rien de copié' : 'déjà copié'}`),
      onProgress: (done, total) => seen.push(`${done}/${total}`),
    });
    // GPX, fiche et capteurs vers le téléphone ; GPX et fiche vers l'ordinateur.
    expect(seen).toEqual(['plan 2 noComputerId rien de copié', '0/5', '3/5', '5/5', '5/5']);
  });

  it('session de la corbeille encore sur le téléphone : la première passe la laisse et la question se pose ; « Retirer du téléphone » la retire', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    const first = await run(pair);
    const question = describeSyncQuestion(first);
    expect(question).toMatchObject({ kind: 'inTrash', sessions: [{ startMs: at(2), side: 'phone', file: fileOf(2) }] });
    // Sans réponse : rien ne change, la question revient.
    expect(describeSyncQuestion(await run(pair))?.kind).toBe('inTrash');
    const second = await run(pair, { heldOnPhone: 'remove' });
    expect(second.done.find((i) => i.startMs === at(2))?.case).toBe('deletedOnComputer');
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(2));
    expect(trashOf(pair).some((e) => e.startMs === at(2))).toBe(true);
    expect(describeSyncQuestion(second)).toBeNull();
    expect(describeSync(second).rows).toContainEqual(expect.objectContaining({ label: 'Supprimé', text: expect.stringMatching(/sur l'ordinateur, retirée du téléphone/) }));
    // Rien n'est effacé du téléphone : la session est dans un dépôt de sa corbeille.
    expect([...pair.phone.aside().keys()].some((p) => p.startsWith(`${TRASH_DIR}/${NOW}-${at(2)}/`) && p.endsWith(fileOf(2)))).toBe(true);
  });

  it('« Retirer du téléphone » d’une session déjà dans la corbeille : une seule entrée si les fichiers sont les mêmes, la copie du téléphone à part sinon', async () => {
    const pair = pairOf();
    // Dix sessions : deux retraits restent sous le garde-fou.
    for (let k = 0; k < 10; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    await trashOnComputer(pair, 3);
    await run(pair);
    // Fiche changée sur le téléphone pour la session 3 : ses fichiers ne sont plus ceux de la corbeille.
    editSyncRecord(pair.phone, fileOf(3), (r) => ({ ...r, name: 'Renommée sur le téléphone, plus longue' }));
    await run(pair, { heldOnPhone: 'remove' });
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(2));
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(3));
    const origins = (k: number): string[] => trashOf(pair).filter((e) => e.startMs === at(k)).map((e) => e.origin).sort();
    expect(origins(2)).toEqual(['ordinateur']);
    expect(origins(3)).toEqual(['ordinateur', 'telephone']);
  });

  it('keep « all » : une fiche du téléphone de même longueur que celle de la corbeille mais au contenu changé est rangée à part, pas perdue', async () => {
    const pair = pairOf();
    for (let k = 0; k < 10; k++) putBoth(pair, k);
    const rename = (name: string) => (r: SessionRecord): SessionRecord => ({ ...r, name });
    editSyncRecord(pair.computer, fileOf(3), rename('Version A'));
    editSyncRecord(pair.phone, fileOf(3), rename('Version A'));
    await trashOnComputer(pair, 3);
    await run(pair);
    // Sur le téléphone, la fiche change sans changer de longueur : « A » devient « B ».
    editSyncRecord(pair.phone, fileOf(3), rename('Version B'));
    const outcome = await run(pair, { heldOnPhone: 'remove' });
    expect(outcome.done.find((i) => i.startMs === at(3))?.ops).toMatchObject([{ kind: 'removeFromPhone', keep: 'all' }]);
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(3));
    const entries = sessionTrashEntries(trashOf(pair), at(3));
    expect(entries.map((e) => e.origin).sort()).toEqual(['ordinateur', 'telephone']);
    const names = entries.map((e) => JSON.parse(pair.computer.text(`corbeille/${e.dir}/${recordFileName(e.main)}`) ?? '{}').name).sort();
    expect(names).toEqual(['Version A', 'Version B']);
  });

  it('« Retirer du téléphone » ne retire que les sessions montrées : une autre apparue depuis les fait toutes laisser', async () => {
    const pair = pairOf();
    for (let k = 0; k < 10; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    expect(describeSyncQuestion(await run(pair))?.sessions.map((s) => s.startMs)).toEqual([at(2)]);
    // Depuis la question, une autre session de la corbeille de l'ordinateur se trouve sur le téléphone.
    putSyncSession(pair.computer, at(12));
    putSyncSession(pair.phone, at(12));
    await trashOnComputer(pair, 12);
    const stale = await run(pair, { heldOnPhone: 'remove', heldToRemove: [at(2)] });
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(2));
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(12));
    expect(describeSyncQuestion(stale)?.sessions.map((s) => s.startMs)).toEqual([at(2), at(12)]);
    await run(pair, { heldOnPhone: 'remove', heldToRemove: [at(2), at(12)] });
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(2));
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(12));
  });

  it('la confirmation du garde-fou ne vaut que pour les suppressions montrées : une de plus, rien n’est supprimé et la question revient', async () => {
    const pair = await syncedPair(20);
    for (let k = 0; k < 8; k++) deleteSyncSession(pair.phone, fileOf(k));
    const shown = describeSyncQuestion(await run(pair));
    expect(shown).toMatchObject({ kind: 'guard' });
    expect(shown?.sessions).toHaveLength(8);
    const keys = (shown?.sessions ?? []).map((s) => ({ startMs: s.startMs, side: s.side }));
    // La fenêtre attend ; une session de plus est supprimée sur le téléphone avant la réponse.
    deleteSyncSession(pair.phone, fileOf(8));
    const stale = await run(pair, { confirmDeletions: true, confirmedDeletions: keys });
    expect(stale.deletions).toBe('awaitingConfirmation');
    expect(await syncSessionFiles(pair.computer)).toHaveLength(20);
    expect(describeSyncQuestion(stale)).toMatchObject({ kind: 'guard' });
    expect(describeSyncQuestion(stale)?.sessions).toHaveLength(9);
    // Les mêmes, ou moins que ce qui a été montré : elle part.
    const all = [...keys, { startMs: at(8), side: 'computer' as const }, { startMs: at(9), side: 'computer' as const }];
    const made = await run(pair, { confirmDeletions: true, confirmedDeletions: all });
    expect(made.deletions).toBe('made');
    expect(await syncSessionFiles(pair.computer)).toHaveLength(11);
  });

  it('téléphone qu’on ne peut pas écrire : pas de question sur la corbeille, ce qui l’attend est dit', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    putSyncSession(pair.computer, at(7));
    const half = await run(pair, { phoneWritable: false });
    expect(describeSyncQuestion(half)).toBeNull();
    expect(half.withheldForPhone.map((i) => i.startMs)).toEqual([at(7)]);
    expect(describeSync(half).notes.map((n) => n.text)).toContain("Ce programme n'a rien pu écrire sur le téléphone : installez sa dernière version.");
  });
});

/** Les suppressions qu'une passe a retenues, telles que la question les montre : la session, et le côté d'où elle partirait. */
const refusedOf = (outcome: SyncOutcome): SyncDeletionKey[] =>
  outcome.withheldDeletions.map((item) => ({ startMs: item.startMs, side: item.case === 'deletedOnPhone' ? 'computer' : 'phone' }));

/** Les sessions de la corbeille de l'ordinateur encore sur le téléphone, laissées par cette passe. */
const heldOf = (outcome: SyncOutcome): number[] => (outcome.plan?.items ?? []).filter((i) => i.left === 'inTrash').map((i) => i.startMs);

const bothSides = async (pair: Pair): Promise<string[][]> => [await syncSessionFiles(pair.computer), await syncSessionFiles(pair.phone)];

const NOTHING_KEPT = { sessions: [], routes: [], fromTrash: { sessions: [], routes: [] } };

describe('réponses définitives : « Tout garder » et « Les garder »', () => {
  it('« Tout garder », supprimée sur le téléphone : recopiée sur le téléphone et suivie de nouveau, la question ne revient pas', async () => {
    const pair = await syncedPair(3);
    deleteSyncSession(pair.phone, fileOf(1));
    const asked = await run(pair);
    expect(asked.kept).toEqual(NOTHING_KEPT);
    expect(refusedOf(asked)).toEqual([{ startMs: at(1), side: 'computer' }]);
    const kept = await run(pair, { keepRefused: { sessions: refusedOf(asked) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true, withheldDeletions: [] });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(1)] });
    expect(kept.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'newOnComputer', ops: [{ kind: 'copy', to: 'phone' }] });
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
    expect(baseOf(pair)).toMatchObject({ removed: [], held: [] });
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(1), at(2)]);
    const after = await run(pair);
    expect(after).toMatchObject({ deletions: 'made', complete: true });
    expect(after.plan?.items.flatMap((i) => i.ops)).toEqual([]);
  });

  it('« Tout garder », supprimée sur l’ordinateur : sortie de sa corbeille, les deux fiches fondues, rien n’est retiré du téléphone', async () => {
    const pair = await syncedPair(3);
    editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Nom ordinateur' }));
    await trashOnComputer(pair, 1);
    // (Une note saisie depuis sur le téléphone ferait revenir la session d'elle-même, sans question : règle `revived`.)
    const asked = await run(pair);
    expect(refusedOf(asked)).toEqual([{ startMs: at(1), side: 'phone' }]);
    const kept = await run(pair, { keepRefused: { sessions: refusedOf(asked) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true, keptFromPhone: [], withheldDeletions: [] });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(1)], fromTrash: { sessions: [at(1)], routes: [] } });
    // Suivie comme avant, avec ses fiches gardées : ce que chaque appareil a saisi depuis passe à l'autre.
    expect(kept.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'followed', withoutAncestor: false, conflicts: [] });
    for (const side of [pair.computer, pair.phone]) {
      expect(readSyncRecord(side, fileOf(1))).toMatchObject({ name: 'Nom ordinateur' });
    }
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(1), at(2)]);
    expect((await run(pair)).plan?.items.flatMap((i) => i.ops)).toEqual([]);
  });

  it('« Tout garder », supprimée sur l’ordinateur, corbeille vidée depuis : la base l’oublie et elle revient du téléphone', async () => {
    const pair = await syncedPair(3);
    await trashOnComputer(pair, 1);
    const asked = await run(pair);
    await emptyTrash(pair.computer);
    const kept = await run(pair, { keepRefused: { sessions: refusedOf(asked) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true, keptFromPhone: [] });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(1)] });
    expect(kept.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'newOnPhone', ops: [{ kind: 'copy', to: 'computer' }] });
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(1), at(2)]);
    expect(trashOf(pair)).toEqual([]);
  });

  it('« Les garder » : la session sort de la corbeille, les fiches se complètent, elle est suivie et n’est plus retenue', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    editSyncRecord(pair.computer, fileOf(2), (r) => ({ ...r, name: 'Nom ordinateur' }));
    await trashOnComputer(pair, 2);
    const first = await run(pair);
    expect(heldOf(first)).toEqual([at(2)]);
    expect(baseOf(pair)?.held).toEqual([at(2)]);
    const kept = await run(pair, { heldOnPhone: 'keep', heldToKeep: heldOf(first) });
    expect(kept).toMatchObject({ deletions: 'made', complete: true });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(2)], fromTrash: { sessions: [at(2)], routes: [] } });
    expect(heldOf(kept)).toEqual([]);
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3, 4].map(fileOf), [0, 1, 2, 3, 4].map(fileOf)]);
    expect(readSyncRecord(pair.phone, fileOf(2))?.name).toBe('Nom ordinateur');
    expect(trashOf(pair)).toEqual([]);
    expect(baseOf(pair)).toMatchObject({ held: [], removed: [] });
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toContain(at(2));
    const after = await run(pair);
    expect(heldOf(after)).toEqual([]);
    expect(after.plan?.items.flatMap((i) => i.ops)).toEqual([]);
  });

  it('« Les garder », corbeille vidée depuis : sans réponse la question revient ; gardée, la session revient du téléphone', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    await run(pair);
    await emptyTrash(pair.computer);
    expect(heldOf(await run(pair))).toEqual([at(2)]);
    const kept = await run(pair, { heldOnPhone: 'keep' });
    expect(kept.complete).toBe(true);
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(2)] });
    expect(kept.done.find((i) => i.startMs === at(2))).toMatchObject({ case: 'newOnPhone', left: null });
    expect(await syncSessionFiles(pair.computer)).toEqual([0, 1, 2, 3, 4].map(fileOf));
    expect(baseOf(pair)).toMatchObject({ held: [], removed: [] });
    expect(heldOf(await run(pair))).toEqual([]);
  });

  it('« Les garder » ne garde que les sessions montrées : une autre apparue depuis reste laissée, et la question revient pour elle', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    const first = await run(pair);
    putBoth(pair, 7);
    await trashOnComputer(pair, 7);
    const kept = await run(pair, { heldOnPhone: 'keep', heldToKeep: heldOf(first) });
    expect(kept.kept.sessions).toEqual([at(2)]);
    expect(heldOf(kept)).toEqual([at(7)]);
    expect(await syncSessionFiles(pair.computer)).toEqual([0, 1, 2, 3, 4].map(fileOf));
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(7));
    expect(baseOf(pair)?.held).toEqual([at(7)]);
  });

  it('« Les garder » dès la première rencontre, sans base encore : la session sort de la corbeille et les deux appareils se réunissent', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    const kept = await run(pair, { heldOnPhone: 'keep' });
    expect(kept).toMatchObject({ first: 'noComputerId', complete: true });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(2)], fromTrash: { sessions: [at(2)], routes: [] } });
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3, 4].map(fileOf), [0, 1, 2, 3, 4].map(fileOf)]);
    expect(baseOf(pair)).toMatchObject({ held: [], removed: [] });
    expect(baseOf(pair)?.sessions).toHaveLength(5);
    expect(trashOf(pair)).toEqual([]);
  });

  it('« Retirer du téléphone » puis « Tout garder » à la question du garde-fou : la session revient de la corbeille, rien n’est retiré', async () => {
    const pair = pairOf();
    for (let k = 0; k < 3; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    const first = await run(pair);
    // Un retrait sur trois sessions du téléphone dépasse le garde-fou : sa question suit la première réponse.
    const removing = await run(pair, { heldOnPhone: 'remove', heldToRemove: heldOf(first) });
    expect(removing.deletions).toBe('awaitingConfirmation');
    expect(refusedOf(removing)).toEqual([{ startMs: at(2), side: 'phone' }]);
    const kept = await run(pair, { heldOnPhone: 'remove', heldToRemove: heldOf(first), keepRefused: { sessions: refusedOf(removing) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true, keptFromPhone: [] });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(2)], fromTrash: { sessions: [at(2)], routes: [] } });
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(baseOf(pair)).toMatchObject({ held: [], removed: [] });
    expect(trashOf(pair)).toEqual([]);
  });

  it('réponse périmée : une suppression apparue depuis la question n’est pas faite, la question revient pour elle seule', async () => {
    const pair = await syncedPair(3);
    deleteSyncSession(pair.phone, fileOf(1));
    const asked = await run(pair);
    // La fenêtre attend ; une autre session est supprimée sur le téléphone avant la réponse. Des clés qui ne valent
    // pas (mauvais côté, session toujours des deux côtés) sont sans effet.
    deleteSyncSession(pair.phone, fileOf(2));
    const stale = await run(pair, {
      keepRefused: { sessions: [...refusedOf(asked), { startMs: at(2), side: 'phone' }, { startMs: at(0), side: 'computer' }] },
    });
    expect(stale.deletions).toBe('awaitingConfirmation');
    expect(stale.kept.sessions).toEqual([at(1)]);
    expect(refusedOf(stale)).toEqual([{ startMs: at(2), side: 'computer' }]);
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
    const kept = await run(pair, { keepRefused: { sessions: refusedOf(stale) } });
    expect(kept).toMatchObject({ deletions: 'made', complete: true });
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
  });

  it('deux supprimées, puis une, puis une sur le téléphone : chaque question ne compte que ce qui est nouveau', async () => {
    const pair = await syncedPair(3);
    await trashOnComputer(pair, 0);
    await trashOnComputer(pair, 1);
    const first = await run(pair);
    expect(refusedOf(first)).toEqual([{ startMs: at(0), side: 'phone' }, { startMs: at(1), side: 'phone' }]);
    // Fermer la fenêtre ne décide rien : la question revient, avec les mêmes.
    expect(refusedOf(await run(pair))).toEqual(refusedOf(first));
    expect((await run(pair, { keepRefused: { sessions: refusedOf(first) } })).complete).toBe(true);
    await trashOnComputer(pair, 2);
    const second = await run(pair);
    expect(refusedOf(second)).toEqual([{ startMs: at(2), side: 'phone' }]);
    expect((await run(pair, { keepRefused: { sessions: refusedOf(second) } })).complete).toBe(true);
    deleteSyncSession(pair.phone, fileOf(0));
    const third = await run(pair);
    expect(refusedOf(third)).toEqual([{ startMs: at(0), side: 'computer' }]);
    expect((await run(pair, { keepRefused: { sessions: refusedOf(third) } })).complete).toBe(true);
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
    expect(baseOf(pair)).toMatchObject({ removed: [], held: [] });
    expect(describeSyncQuestion(await run(pair))).toBeNull();
  });

  it('restes sans GPX d’une session absente des deux côtés : ni comptés ni montrés, et la confirmation de ce qui est montré suffit', async () => {
    const pair = pairOf();
    for (let k = 0; k < 3; k++) putBoth(pair, k, 12);
    await run(pair);
    // Supprimée sur le téléphone, et à la main sur l'ordinateur, GPX seul : sa fiche et ses capteurs y sont restés.
    deleteSyncSession(pair.phone, fileOf(2));
    pair.computer.drop(sessionPath(fileOf(2)));
    // Une vraie suppression à côté : une session sur les deux qui restent, le garde-fou demande.
    deleteSyncSession(pair.phone, fileOf(1));
    const asked = await run(pair);
    expect(asked.deletions).toBe('awaitingConfirmation');
    expect(asked.withheldDeletions.map((i) => i.startMs)).toEqual([at(1)]);
    expect(pair.computer.text(sessionPath(recordFileName(fileOf(2))))).not.toBeNull();
    const made = await run(pair, { confirmDeletions: true, confirmedDeletions: refusedOf(asked) });
    expect(made).toMatchObject({ deletions: 'made', complete: true });
    expect(trashOf(pair).map((e) => `${e.startMs === at(1) ? 1 : 2}:${e.kind}`).sort()).toEqual(['1:session', '2:restes']);
    expect(pair.computer.text(sessionPath(recordFileName(fileOf(2))))).toBeNull();
  });

  const HALVES: [string, SyncOptions][] = [
    ['qui ne s’écrit pas', { phoneWritable: false }],
  ];

  it.each(HALVES)('« Tout garder » avec un téléphone %s : rien ne lui est envoyé, la question est réglée sur l’ordinateur', async (_label, half) => {
    const pair = await syncedPair(4);
    deleteSyncSession(pair.phone, fileOf(0));
    await trashOnComputer(pair, 1);
    const asked = await run(pair);
    expect(refusedOf(asked)).toEqual([{ startMs: at(0), side: 'computer' }, { startMs: at(1), side: 'phone' }]);
    const steps = pair.phone.steps();
    const kept = await run(pair, { ...half, keepRefused: { sessions: refusedOf(asked) } });
    expect(pair.phone.steps()).toBe(steps);
    expect(kept).toMatchObject({ phoneWritable: false, complete: false, deletions: 'made', withheldDeletions: [] });
    expect(kept.kept).toEqual({ ...NOTHING_KEPT, sessions: [at(0), at(1)], fromTrash: { sessions: [at(1)], routes: [] } });
    // Sur l'ordinateur, tout est revenu ; la session que le téléphone a supprimée l'attend comme une session neuve.
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3].map(fileOf), [1, 2, 3].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
    expect(kept.withheldForPhone.map((i) => i.startMs)).toContain(at(0));
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(1), at(2), at(3)]);
    // Le téléphone toujours fermé à l'écriture : aucune question ne revient, rien ne part à la corbeille.
    const again = await run(pair, half);
    expect(again).toMatchObject({ deletions: 'made', withheldDeletions: [] });
    expect(describeSyncQuestion(again)).toBeNull();
    expect(pair.phone.steps()).toBe(steps);
    expect(trashOf(pair)).toEqual([]);
    // Le téléphone s'écrit de nouveau : il reçoit la session, sans qu'on redemande rien.
    const whole = await run(pair);
    expect(whole).toMatchObject({ deletions: 'made', complete: true });
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3].map(fileOf), [0, 1, 2, 3].map(fileOf)]);
    expect(trashOf(pair)).toEqual([]);
  });

  it('coupure entre la copie depuis la corbeille et le retrait de l’entrée : la session n’est qu’une fois dans la mémoire, la reprise la suit', async () => {
    const pair = await syncedPair(3);
    await trashOnComputer(pair, 1);
    const asked = await run(pair);
    // L'index de la corbeille ne s'écrit plus : la session est revenue dans la mémoire, son entrée n'a pas pu partir.
    const failing: SyncRemote = {
      ...pair.computer,
      writeText: async (path, text) => {
        if (path === TRASH_INDEX_PATH) throw new Error('coupure');
        return pair.computer.writeText(path, text);
      },
    };
    const cut = await run(pair, { keepRefused: { sessions: refusedOf(asked) } }, pair.phone, failing);
    expect(cut.error).toBe('coupure');
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect(sessionTrashEntries(trashOf(pair), at(1))).toHaveLength(1);
    await everyGpxHasRecord(pair.computer);
    // Reprise, avec ou sans la réponse : la session est des deux côtés, suivie ; rien à supprimer, rien en double.
    const resumed = await run(pair, { keepRefused: { sessions: refusedOf(asked) } });
    expect(resumed).toMatchObject({ interrupted: true, deletions: 'made', complete: true, withheldDeletions: [] });
    expect(resumed.kept).toEqual(NOTHING_KEPT);
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    expect((await run(pair)).plan?.items.flatMap((i) => i.ops)).toEqual([]);
  });

  it('coupure après l’oubli de la base, avant la copie : sans rien redemander, la reprise recopie la session depuis le téléphone', async () => {
    const pair = await syncedPair(3);
    await trashOnComputer(pair, 1);
    const asked = await run(pair);
    await emptyTrash(pair.computer);
    const failing: SyncRemote = {
      ...pair.computer,
      writeBytes: async (path, bytes) => {
        if (path.startsWith('sessions/')) throw new Error('disque plein');
        return pair.computer.writeBytes(path, bytes);
      },
    };
    const cut = await run(pair, { keepRefused: { sessions: refusedOf(asked) } }, pair.phone, failing);
    expect(cut.failed.map((f) => f.item.startMs)).toEqual([at(1)]);
    expect(baseOf(pair)?.sessions.map((s) => s.startMs)).toEqual([at(0), at(2)]);
    expect(baseOf(pair)).toMatchObject({ removed: [], held: [] });
    expect(await bothSides(pair)).toEqual([[0, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
    // Sans la réponse : la session n'est plus une suppression en attente, seulement une session du téléphone à recopier.
    const resumed = await run(pair);
    expect(resumed).toMatchObject({ deletions: 'made', complete: true, withheldDeletions: [] });
    expect(describeSyncQuestion(resumed)).toBeNull();
    expect(await bothSides(pair)).toEqual([[0, 1, 2].map(fileOf), [0, 1, 2].map(fileOf)]);
  });
});

describe('restauration et noms dans l’issue', () => {
  const named: SyncOptions['shownName'] = (record, gpx) => `${record ? 'fiche' : 'GPX'} ${gpx}`;
  const removals = (outcome: SyncOutcome) => (outcome.plan?.items ?? []).flatMap((i) => i.ops).filter((op) => op.kind === 'trash' || op.kind === 'removeFromPhone');

  it('restaurée après une suppression synchronisée : dite restaurée, recopiée sur le téléphone, rien de supprimé', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    const removed = await run(pair, { shownName: named });
    expect(removed.complete).toBe(true);
    expect(baseOf(pair)?.removed).toEqual([at(1)]);
    // Plus sur l'ordinateur : nommée par sa fiche gardée à la dernière synchronisation, sans rien relire.
    expect(removed.names.sessions[at(1)]).toBe(`fiche ${fileOf(1)}`);
    expect(removed.done.find((i) => i.startMs === at(1))?.restored).toBe(false);

    await restoreOnComputer(pair, 1);
    const back = await run(pair, { shownName: named });
    expect(back).toMatchObject({ deletions: 'made', complete: true, withheldDeletions: [] });
    expect(back.done.map((i) => [i.startMs, i.case, i.restored])).toEqual([[at(1), 'newOnComputer', true]]);
    expect(back.done[0].ops).toMatchObject([{ kind: 'copy', to: 'phone' }]);
    expect(removals(back)).toEqual([]);
    expect(back.names.sessions).toEqual({ [at(1)]: `fiche ${fileOf(1)}` });
    expect(baseOf(pair)).toMatchObject({ removed: [] });
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    // Rien à redire la fois suivante.
    expect((await run(pair)).plan?.items).toEqual([]);
  });

  it('restauration seule d’une session que le téléphone tenait : dite restaurée, aucune suppression d’aucun côté', async () => {
    const pair = pairOf();
    for (let k = 0; k < 5; k++) putBoth(pair, k);
    await trashOnComputer(pair, 2);
    await run(pair);
    expect(baseOf(pair)?.held).toEqual([at(2)]);
    await restoreOnComputer(pair, 2);
    const back = await run(pair, { shownName: named });
    expect(back).toMatchObject({ deletions: 'made', complete: true, withheldDeletions: [], keptFromPhone: [] });
    expect(back.plan?.items.map((i) => [i.startMs, i.case, i.restored])).toEqual([[at(2), 'firstMeeting', true]]);
    expect(removals(back)).toEqual([]);
    expect(back.names.sessions).toEqual({ [at(2)]: `fiche ${fileOf(2)}` });
    expect(baseOf(pair)).toMatchObject({ held: [], removed: [] });
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3, 4].map(fileOf), [0, 1, 2, 3, 4].map(fileOf)]);
  });

  it('les sessions réglées par « Tout garder » et « Les garder » sont nommées, sans être dites restaurées', async () => {
    const { pair, answer } = await keepScenario();
    const kept = await run(pair, { ...answer, shownName: named });
    expect(kept.kept.sessions.length).toBeGreaterThan(0);
    for (const startMs of kept.kept.sessions) expect(kept.names.sessions[startMs], String(startMs)).toMatch(/^(fiche|GPX|session) /);
    expect((kept.plan?.items ?? []).filter((i) => i.restored)).toEqual([]);
  });

  it('nommer ne relit aucune fiche déjà lue ni gardée : une fiche changée sur le téléphone, aucune lecture de plus sur l’ordinateur', async () => {
    const pair = await syncedPair(20);
    editSyncRecord(pair.phone, fileOf(3), (r) => ({ ...r, notes: notes({ comment: 'Note téléphone' }) }));
    deleteSyncSession(pair.phone, fileOf(7));
    const reads: string[] = [];
    const computer: SyncRemote = { ...pair.computer, readText: (path) => (path.startsWith('sessions/') && reads.push(path), pair.computer.readText(path)) };
    const outcome = await run(pair, { shownName: named }, pair.phone, computer);
    expect(outcome.complete).toBe(true);
    expect(outcome.names.sessions).toEqual({ [at(3)]: `fiche ${fileOf(3)}`, [at(7)]: `fiche ${fileOf(7)}` });
    expect(reads).toEqual([]);
  });

  it('une synchronisation refusée ne nomme rien', async () => {
    const pair = pairOf();
    putSyncSession(pair.computer, at(0));
    const browser = { ...pair.computer, kind: 'browser' as const };
    expect((await run(pair, { shownName: named }, pair.phone, browser)).names).toEqual({ sessions: {}, routes: {} });
  });
});

/**
 * Un peu de tout ce que les deux réponses règlent : une session supprimée sur le téléphone, une supprimée sur
 * l'ordinateur que sa corbeille tient (avec ses capteurs et une fiche changée), une autre que sa corbeille ne tient
 * plus, et une session de la corbeille encore sur le téléphone, jamais suivie.
 */
const KEPT_SCENARIO = [0, 1, 2, 3, 4, 5];

const keepScenario = async (): Promise<{ pair: Pair; answer: SyncOptions }> => {
  const pair = pairOf();
  for (let k = 0; k < 6; k++) putBoth(pair, k, k === 1 || k === 5 ? 30 : undefined);
  await trashOnComputer(pair, 5);
  await run(pair);
  deleteSyncSession(pair.phone, fileOf(0));
  editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Nom ordinateur' }));
  await trashOnComputer(pair, 1);
  await trashOnComputer(pair, 2);
  await dropTrashEntries(pair.computer, sessionTrashEntries(trashOf(pair), at(2)).map((e) => e.dir));
  const asked = await run(pair);
  return { pair, answer: { keepRefused: { sessions: refusedOf(asked) }, heldOnPhone: 'keep', heldToKeep: heldOf(asked) } };
};

/** Chaque session du scénario est encore quelque part, et aucune n'est en double d'un côté. */
const keptSomewhere = async (pair: Pair): Promise<void> => {
  const sides = await bothSides(pair);
  const trashed = new Set(trashOf(pair).map((e) => e.startMs));
  for (const k of KEPT_SCENARIO) expect(sides.some((names) => names.includes(fileOf(k))) || trashed.has(at(k)), `session ${k}`).toBe(true);
  for (const names of sides) expect(names.filter((name) => !KEPT_SCENARIO.map(fileOf).includes(name))).toEqual([]);
};

describe('« Tout garder » et « Les garder » coupés après chaque opération de l’ordinateur', () => {
  it.each([
    ['avec la même réponse', true], ['sans la réponse', false],
  ] as const)('reprise %s : rien de perdu, rien en double', async (_label, answered) => {
    const reference = await keepScenario();
    expect(reference.answer.keepRefused?.sessions).toEqual([
      { startMs: at(0), side: 'computer' }, { startMs: at(1), side: 'phone' }, { startMs: at(2), side: 'phone' },
    ]);
    expect(reference.answer.heldToKeep).toEqual([at(5)]);
    const whole = await run(reference.pair, reference.answer);
    expect(whole).toMatchObject({ deletions: 'made', complete: true });
    expect(whole.kept).toEqual({ sessions: [at(0), at(1), at(2), at(5)], routes: [], fromTrash: { sessions: [at(1), at(5)], routes: [] } });
    const expected = await pictureOf(reference.pair);
    expect([expected.computer, expected.phone]).toEqual([KEPT_SCENARIO.map(fileOf), KEPT_SCENARIO.map(fileOf)]);
    expect(trashOf(reference.pair)).toEqual([]);

    let cuts = 0;
    for (let n = 0; n < 300; n++) {
      const { pair, answer } = await keepScenario();
      pair.computer.cutAfter(n);
      const outcome = await run(pair, answer);
      pair.computer.cutAfter(null);
      if (outcome.linkLost === null && outcome.failed.length === 0 && outcome.error === null) {
        expect(outcome.complete).toBe(true);
        break;
      }
      cuts += 1;
      await everyGpxHasRecord(pair.computer);
      await everyGpxHasRecord(pair.phone);
      await keptSomewhere(pair);
      if (!answered) {
        // Le programme relancé ne sait plus la réponse : ce qui n'était pas encore réglé redevient une question, ou
        // une suppression ordinaire que la corbeille garde ; rien n'est perdu ni doublé.
        await run(pair);
        await run(pair);
        await everyGpxHasRecord(pair.computer);
        await everyGpxHasRecord(pair.phone);
        await keptSomewhere(pair);
        continue;
      }
      await run(pair, answer);
      const final = await run(pair);
      expect(final.complete, `coupure après ${n}`).toBe(true);
      expect(final.plan?.items.flatMap((i) => i.ops), `coupure après ${n}`).toEqual([]);
      expect(await pictureOf(pair), `coupure après ${n}`).toEqual(expected);
      await keptSomewhere(pair);
    }
    expect(cuts).toBeGreaterThan(8);
  });
});

const PC_ID = 'appareil-ordinateur';
const TEL_ID = 'appareil-telephone';

/** Texte d'un fichier de réglages écrit par l'appareil `id` à l'instant `savedAt`. */
const settingsText = (id: string, name: string, savedAt: number): string =>
  serializeSettingsFile(buildSettingsFile({ 'tracker.sportSettings': { activities: [] } }, savedAt, null, { id, name }));

const resting = (startedAtMs: number): StoredRestingResult => ({
  startedAtMs, version: 1, lowestBpm: 48, fromS: 60, toS: 120, meanBpm: 52, maxBpm: 60, coverage: 1, series: [50, 49, 48],
});

/**
 * Une paire avec, de chaque côté, le fichier de réglages de l'appareil et une vieille copie de celui de l'autre (le
 * téléphone a changé ses réglages depuis), un fichier du même nom écrit par deux tablettes différentes, et des tests
 * de FC repos et des lieux appris que l'autre n'a pas.
 */
const extrasPair = (cable = true): Pair => {
  const pair = pairOf(cable);
  putBoth(pair, 0);
  pair.computer.put('reglages/PC.json', settingsText(PC_ID, 'PC', 100));
  pair.computer.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 200));
  pair.phone.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 300));
  pair.computer.put('reglages/Tablette.json', settingsText('tablette-une', 'Tablette', 50));
  pair.phone.put('reglages/Tablette.json', settingsText('tablette-deux', 'Tablette', 60));
  pair.computer.put('fc-repos.json', restingHrFileText([resting(3), resting(1)]));
  pair.phone.put('fc-repos.json', restingHrFileText([resting(2), resting(1)]));
  pair.phone.put('journaux/enregistrement-1.json', '{"journal":1}');
  return pair;
};

const EXTRA_PATHS = ['reglages/PC.json', 'reglages/Téléphone.json', 'reglages/Tablette.json', 'fc-repos.json', 'journaux/enregistrement-1.json'];

/** Texte de chaque fichier transporté, tel que l'application de chaque côté le lirait. */
const extrasOf = async (pair: Pair): Promise<(string | null)[]> => {
  const texts: (string | null)[] = [];
  for (const folder of [pair.computer, pair.phone]) {
    await folder.list('');
    for (const path of EXTRA_PATHS) texts.push(await folder.readText(path));
  }
  return texts;
};

describe('fichiers de réglages, FC repos et journaux', () => {
  it('réglages recopiés sans jamais être adoptés, même nom d’un autre appareil laissé, FC repos fondus des deux côtés, journal vers l’ordinateur', async () => {
    const pair = extrasPair();
    const tablettes = [pair.computer.text('reglages/Tablette.json'), pair.phone.text('reglages/Tablette.json')];
    const outcome = await run(pair, { computerDeviceId: PC_ID });
    expect(outcome.complete).toBe(true);
    expect(pair.phone.text('reglages/PC.json')).toBe(pair.computer.text('reglages/PC.json'));
    expect(pair.computer.text('reglages/Téléphone.json')).toBe(settingsText(TEL_ID, 'Téléphone', 300));
    expect([pair.computer.text('reglages/Tablette.json'), pair.phone.text('reglages/Tablette.json')]).toEqual(tablettes);
    expect(outcome.extras.left).toEqual([{ kind: 'settings', path: 'reglages/Tablette.json', side: null, reason: 'otherDevice' }]);
    const union = restingHrFileText([resting(3), resting(2), resting(1)]);
    for (const folder of [pair.computer, pair.phone]) expect(folder.text('fc-repos.json')).toBe(union);
    expect(outcome.extras.done.map((op) => [op.kind, op.to, op.added]).sort()).toEqual([
      ['restingHr', 'computer', 1], ['restingHr', 'phone', 1], ['settings', 'computer', 0], ['settings', 'phone', 0],
    ]);
    // Le journal du téléphone est copié vers l'ordinateur, jamais l'inverse.
    expect(pair.computer.text('journaux/enregistrement-1.json')).toBe('{"journal":1}');
    expect(outcome.extras.copied.map((c) => c.path)).toEqual(['journaux/enregistrement-1.json']);
    // Rien de plus à faire, et rien n'est écrit sur le téléphone que son marqueur.
    const steps = pair.phone.steps();
    const again = await run(pair, { computerDeviceId: PC_ID });
    expect(again.extras.done).toEqual([]);
    expect(pair.phone.steps()).toBe(steps + MARKER_STEPS);
  });

  it('le téléphone dit qui il est dans son marqueur : son fichier fait foi, celui d’un autre téléphone suit la date', async () => {
    const withDevice = (pair: Pair, device: string): void => {
      pair.phone.put('tracker.json', JSON.stringify({ format: 'tracker-memoire', version: 1, appareil: device }));
    };
    // Date du téléphone qui a reculé : sa copie, moins datée, remplace quand même celle de l'ordinateur.
    const own = pairOf();
    putBoth(own, 0);
    own.computer.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 500));
    own.phone.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 100));
    withDevice(own, TEL_ID);
    await run(own, { computerDeviceId: PC_ID });
    expect(own.computer.text('reglages/Téléphone.json')).toBe(settingsText(TEL_ID, 'Téléphone', 100));
    // Un autre téléphone relié, qui tient la vieille copie : la copie récente de l'ordinateur lui revient.
    const other = pairOf();
    putBoth(other, 0);
    other.computer.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 500));
    other.phone.put('reglages/Téléphone.json', settingsText(TEL_ID, 'Téléphone', 100));
    withDevice(other, 'telephone-deux');
    await run(other, { computerDeviceId: PC_ID });
    expect(other.computer.text('reglages/Téléphone.json')).toBe(settingsText(TEL_ID, 'Téléphone', 500));
    expect(other.phone.text('reglages/Téléphone.json')).toBe(settingsText(TEL_ID, 'Téléphone', 500));
  });

  it('un fichier illisible ou d’une version plus récente n’est ni réécrit ni fondu, et c’est dit', async () => {
    const pair = pairOf();
    const pcResting = restingHrFileText([resting(3)]);
    pair.computer.put('fc-repos.json', pcResting);
    pair.phone.put('fc-repos.json', '{abîmé');
    pair.phone.put('reglages/Abîmé.json', 'pas du json');
    const outcome = await run(pair);
    expect(pair.computer.text('fc-repos.json')).toBe(pcResting);
    expect(pair.phone.text('fc-repos.json')).toBe('{abîmé');
    expect(pair.computer.text('reglages/Abîmé.json')).toBeNull();
    expect(outcome.extras.done).toEqual([]);
    expect(outcome.extras.left.map((l) => [l.kind, l.side, l.reason])).toEqual([
      ['settings', 'phone', 'unreadable'], ['restingHr', 'phone', 'unreadable'],
    ]);
  });

  it('téléphone qu’on ne peut pas écrire : seul l’ordinateur reçoit, le reste attend', async () => {
    const pair = extrasPair();
    const steps = pair.phone.steps();
    const half = await run(pair, { computerDeviceId: PC_ID, phoneWritable: false });
    expect(pair.phone.steps()).toBe(steps);
    expect(pair.computer.text('reglages/Téléphone.json')).toBe(settingsText(TEL_ID, 'Téléphone', 300));
    expect(half.extras.withheld.map((op) => [op.kind, op.to]).sort()).toEqual([['restingHr', 'phone'], ['settings', 'phone']]);
    expect(half.complete).toBe(false);
  });

  it.each(['phone', 'computer'] as const)('coupure du côté %s après chaque opération, puis reprise : rien de perdu, rien en double', async (side) => {
    const reference = extrasPair();
    expect((await run(reference, { computerDeviceId: PC_ID })).complete).toBe(true);
    const expected = await extrasOf(reference);
    const initial = await extrasOf(extrasPair());
    let cuts = 0;
    for (let n = 0; n < 200; n++) {
      const pair = extrasPair();
      pair[side].cutAfter(n);
      const outcome = await run(pair, { computerDeviceId: PC_ID });
      pair[side].cutAfter(null);
      if (outcome.linkLost === null && outcome.error === null && outcome.failed.length === 0 && outcome.extras.left.every((l) => l.reason !== 'failed')) break;
      cuts += 1;
      // Chaque fichier est, des deux côtés, tel qu'avant ou tel qu'attendu : jamais perdu ni à moitié écrit.
      (await extrasOf(pair)).forEach((text, i) => expect([initial[i], expected[i]], `coupure après ${n}, fichier ${i}`).toContain(text));
      await run(pair, { computerDeviceId: PC_ID });
      const final = await run(pair, { computerDeviceId: PC_ID });
      expect(final.complete, `coupure après ${n}`).toBe(true);
      expect(final.extras.done, `coupure après ${n}`).toEqual([]);
      expect(await extrasOf(pair), `coupure après ${n}`).toEqual(expected);
    }
    expect(cuts).toBeGreaterThan(3);
  });

  it('activité inconnue de l’appareil qui reçoit la session : signalée de son côté', async () => {
    const pair = pairOf();
    putSyncSession(pair.phone, at(1), { record: { activityId: 'a-moth' } });
    putSyncSession(pair.phone, at(2), { record: { activityId: 'wingfoil' } });
    putSyncSession(pair.computer, at(3), { record: { activityId: 'a-bateau-pc' } });
    const outcome = await run(pair, { knownActivities: { computer: ['wingfoil'], phone: ['wingfoil', 'a-moth'] } });
    expect(outcome.unknownActivities).toEqual([
      { side: 'computer', startMs: at(1), activityId: 'a-moth' },
      { side: 'phone', startMs: at(3), activityId: 'a-bateau-pc' },
    ]);
    // Sans liste pour un côté, il n'est pas vérifié.
    const unchecked = pairOf();
    putSyncSession(unchecked.phone, at(1), { record: { activityId: 'a-moth' } });
    expect((await run(unchecked)).unknownActivities).toEqual([]);
  });
});

/**
 * Une paire déjà synchronisée, puis : session neuve de chaque côté (5 Hz pour celle du téléphone), fiche changée des
 * deux côtés, supprimée sur le téléphone, supprimée sur l'ordinateur, supprimée sur l'ordinateur et changée sur le
 * téléphone, supprimée sur l'ordinateur puis sortie de la corbeille (sa copie du téléphone y est rangée entière avant
 * son retrait), et supprimée à la main sur l'ordinateur sans sa fiche (des restes sans GPX).
 */
const SCENARIO = [...Array.from({ length: 16 }, (_, k) => k), 20, 21];

const scenario = async (cable = true): Promise<Pair> => {
  const pair = pairOf(cable);
  for (let k = 0; k < 16; k++) putBoth(pair, k, k === 2 || k === 6 ? 30 : undefined);
  await run(pair);
  putSyncSession(pair.computer, at(20), { imuBytes: 25 });
  putSyncSession(pair.phone, at(21), { hz: 5 });
  editSyncRecord(pair.computer, fileOf(2), (r) => ({ ...r, name: 'Nom ordinateur' }));
  editSyncRecord(pair.phone, fileOf(2), (r) => ({ ...r, notes: notes({ comment: 'Note téléphone' }) }));
  deleteSyncSession(pair.phone, fileOf(3));
  await trashOnComputer(pair, 4);
  await trashOnComputer(pair, 5);
  editSyncRecord(pair.phone, fileOf(5), (r) => ({ ...r, notes: notes({ comment: 'Écrit avant le retrait' }) }));
  await trashOnComputer(pair, 6);
  await dropTrashEntries(pair.computer, sessionTrashEntries(trashOf(pair), at(6)).map((e) => e.dir));
  pair.computer.drop(sessionPath(fileOf(8)));
  return pair;
};

interface Picture {
  computer: string[];
  phone: string[];
  records: (string | null)[];
}

const pictureOf = async (pair: Pair): Promise<Picture> => {
  const computer = await syncSessionFiles(pair.computer);
  const phone = await syncSessionFiles(pair.phone);
  const strip = (text: string | null) => (text === null ? null : JSON.stringify({ ...JSON.parse(text), addedAt: undefined }));
  // Lus comme l'application de chaque côté les lit : sur le téléphone, un remplacement resté seul vaut son fichier.
  const records: (string | null)[] = [];
  for (const f of computer) records.push(strip(await pair.computer.readText(sessionPath(recordFileName(f)))));
  for (const f of phone) records.push(strip(await pair.phone.readText(sessionPath(recordFileName(f)))));
  return { computer, phone, records };
};

/** Toutes les identités du scénario sont encore quelque part : d'un côté, ou dans la corbeille de l'ordinateur. */
const nothingLost = async (pair: Pair): Promise<void> => {
  const names = new Set([...(await syncSessionFiles(pair.computer)), ...(await syncSessionFiles(pair.phone))]);
  const trashed = new Set(trashOf(pair).map((e) => e.startMs));
  for (const k of SCENARIO) expect(names.has(fileOf(k)) || trashed.has(at(k)), `session ${k}`).toBe(true);
};

describe('coupure après chaque opération, puis reprise', () => {
  it.each([
    ['phone', true], ['computer', true], ['phone', false],
  ] as const)('coupure du côté %s (câble : %s)', async (side, cable) => {
    const reference = await scenario(cable);
    const first = await run(reference);
    expect(first.complete).toBe(true);
    expect(first.keptFromPhone.sort()).toEqual([at(6), at(8)]);
    const expected = await pictureOf(reference);
    const expectedTrash = new Set(trashOf(reference).map((e) => `${e.startMs}:${e.origin}:${e.kind}`));
    expect(expected.phone).not.toContain(fileOf(4));
    expect(expected.phone).not.toContain(fileOf(6));
    expect(expected.phone).not.toContain(fileOf(8));
    expect(expected.computer).not.toContain(fileOf(3));
    expect(expected.phone).toContain(fileOf(20));
    expect(expected.computer).toContain(fileOf(21));
    // La fiche restée seule sur l'ordinateur n'est pas une session de la corbeille : une entrée de restes.
    expect(trashOf(reference).filter((e) => e.startMs === at(8)).map((e) => [e.origin, e.kind]).sort()).toEqual([['ordinateur', 'restes'], ['telephone', 'session']]);

    let cuts = 0;
    for (let n = 0; n < 600; n++) {
      const pair = await scenario(cable);
      const folder = pair[side];
      folder.cutAfter(n);
      let outcome: SyncOutcome;
      try {
        outcome = await run(pair);
      } catch (err) {
        // L'exécutant ne lève jamais, même quand l'ordinateur ne répond plus.
        expect(err).not.toBeInstanceOf(SyncCutError);
        throw err;
      }
      folder.cutAfter(null);
      // Plus aucune coupure : la synchronisation a tenu dans `n` opérations, toutes les coupures ont été essayées.
      if (outcome.linkLost === null && outcome.failed.length === 0 && outcome.error === null) {
        expect(outcome.complete).toBe(true);
        break;
      }
      cuts += 1;
      await everyGpxHasRecord(pair.computer);
      await everyGpxHasRecord(pair.phone);
      await nothingLost(pair);
      await run(pair);
      const final = await run(pair);
      expect(final.complete, `coupure après ${n}`).toBe(true);
      expect(final.plan?.items.flatMap((i) => i.ops), `coupure après ${n}`).toEqual([]);
      expect(await pictureOf(pair), `coupure après ${n}`).toEqual(expected);
      for (const key of expectedTrash) expect(new Set(trashOf(pair).map((e) => `${e.startMs}:${e.origin}:${e.kind}`)).has(key), `coupure après ${n} : ${key}`).toBe(true);
      await nothingLost(pair);
    }
    expect(cuts).toBeGreaterThan(5);
  });
});

describe('une copie plus ancienne du dossier du téléphone ne supprime rien', () => {
  const MARKER = 'tracker.json';

  /** Le contenu d'un dossier, tel qu'une copie de sauvegarde le garde. */
  const snapshot = (folder: SyncFolder): Map<string, string> => new Map(folder.paths().map((path) => [path, folder.text(path) as string]));
  /** Le dossier remplacé par une copie : tout ce qu'il tenait part, la copie revient telle quelle. */
  const restore = (folder: SyncFolder, copy: ReadonlyMap<string, string>): void => {
    for (const path of folder.paths()) folder.drop(path);
    for (const [path, text] of copy) folder.put(path, text);
  };

  it('copie remise plus tard : première rencontre sous un identifiant neuf, rien à la corbeille, chaque session revient', async () => {
    const pair = await syncedPair(3);
    const copy = snapshot(pair.phone);
    const oldId = readMarkerId(pair.phone.text(MARKER));
    putSyncSession(pair.phone, at(5));
    expect((await run(pair)).complete).toBe(true);
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(5));
    // Le téléphone remis à neuf reçoit sa sauvegarde, puis enregistre une session de plus.
    restore(pair.phone, copy);
    putSyncSession(pair.phone, at(7));
    const outcome = await run(pair, { confirmDeletions: true, beforeWrites: async () => 'copie' });
    expect(outcome).toMatchObject({ first: 'olderCopy', complete: true, safetyCopy: 'copie' });
    expect(trashOf(pair)).toEqual([]);
    const all = [0, 1, 2, 5, 7].map(fileOf);
    expect(await syncSessionFiles(pair.computer)).toEqual(all);
    expect(await syncSessionFiles(pair.phone)).toEqual(all);
    const newId = readMarkerId(pair.phone.text(MARKER));
    expect(newId).not.toBe(oldId);
    // L'ancienne base reste, pour le téléphone qui tiendrait encore l'ancien identifiant.
    expect(pair.computer.text(syncBasePath(oldId as string))).not.toBeNull();
    expect(describeSync(outcome).paragraphs[0]).toMatch(/^Le dossier du téléphone est une copie plus ancienne/);
    // La fois suivante, la paire est suivie.
    expect((await run(pair)).first).toBeNull();
  });

  it('le même dossier sur deux téléphones, en alternance : chacun garde ses sessions, rien ne part à la corbeille', async () => {
    const pair = await syncedPair(3);
    const second = syncMemoryFolder({ phone: true, clockMs: 1_800_000_900_000, cable: true });
    restore(second, snapshot(pair.phone));
    putSyncSession(pair.phone, at(5));
    expect((await run(pair)).complete).toBe(true);
    putSyncSession(second, at(6));
    const outcome = await run(pair, { confirmDeletions: true }, second);
    expect(outcome).toMatchObject({ first: 'olderCopy', complete: true });
    expect(readMarkerId(second.text(MARKER))).not.toBe(readMarkerId(pair.phone.text(MARKER)));
    for (let pass = 0; pass < 2; pass++) {
      expect((await run(pair, { confirmDeletions: true })).first).toBeNull();
      expect((await run(pair, { confirmDeletions: true }, second)).first).toBeNull();
    }
    const all = [0, 1, 2, 5, 6].map(fileOf);
    for (const folder of [pair.computer, pair.phone, second]) expect(await syncSessionFiles(folder)).toEqual(all);
    expect(trashOf(pair)).toEqual([]);
  });

  it('base d’une version qui ne posait pas de passage : la paire reste suivie, les suppressions passent', async () => {
    const pair = await syncedPair(8);
    const id = readMarkerId(pair.phone.text(MARKER)) as string;
    const oldBase = JSON.parse(pair.computer.text(syncBasePath(id)) as string) as Record<string, unknown>;
    delete oldBase.phonePass;
    pair.computer.put(syncBasePath(id), JSON.stringify(oldBase));
    const marker = JSON.parse(pair.phone.text(MARKER) as string) as Record<string, unknown>;
    delete marker.passage;
    pair.phone.put(MARKER, JSON.stringify(marker));
    deleteSyncSession(pair.phone, fileOf(1));
    const outcome = await run(pair);
    expect(outcome).toMatchObject({ first: null, complete: true });
    expect(trashOf(pair).map((e) => e.startMs)).toEqual([at(1)]);
    expect(baseOf(pair)?.phonePass).toBe(readMarkerPass(pair.phone.text(MARKER)));
  });
});

// ---------- règles propres à Tracker ----------

describe('sûreté du téléphone (Tracker)', () => {
  /** Ce que porte un dossier, octets compris : rien ne doit y changer. */
  const pictureAll = (folder: SyncFolder): string[] => folder.paths().map((p) => `${p}=${folder.text(p)}`);

  it('passage à blanc : rien n’est écrit d’aucun côté, ni témoin ni marqueur ni copie, et le plan entier est rendu', async () => {
    const pair = await syncedPair(4);
    putSyncSession(pair.computer, at(8));
    putSyncSession(pair.phone, at(9));
    await trashOnComputer(pair, 1);
    deleteSyncSession(pair.phone, fileOf(2));
    const before = { computer: pictureAll(pair.computer), phone: pictureAll(pair.phone), phoneSteps: pair.phone.steps(), computerSteps: pair.computer.steps() };
    let copies = 0;
    const preview = await run(pair, { dryRun: true, beforeWrites: async () => { copies += 1; return 'copie'; } });
    expect(preview).toMatchObject({ preview: true, refusal: null, safetyCopy: null });
    expect(copies).toBe(0);
    expect({ computer: pictureAll(pair.computer), phone: pictureAll(pair.phone), phoneSteps: pair.phone.steps(), computerSteps: pair.computer.steps() }).toEqual(before);
    // Le plan rendu est le plan entier permis, suppressions comprises : de quoi chiffrer la confirmation.
    const kinds = (preview.plan?.items ?? []).flatMap((i) => i.ops.map((op) => op.kind)).sort();
    expect(kinds).toEqual(['copy', 'copy', 'removeFromPhone', 'trash']);
    expect(preview.extrasPlan).not.toBeNull();
  });

  it('le téléphone qui enregistre : refus avant toute écriture, rien de changé d’aucun côté', async () => {
    const pair = await syncedPair(3);
    putSyncSession(pair.computer, at(7));
    const before = { computer: pictureAll(pair.computer), phone: pictureAll(pair.phone) };
    let asked = 0;
    const outcome = await run(pair, { phoneRecording: async () => { asked += 1; return true; } });
    expect(outcome.refusal).toBe('phoneRecording');
    expect(asked).toBe(1);
    expect({ computer: pictureAll(pair.computer), phone: pictureAll(pair.phone) }).toEqual(before);
    expect(describeSync(outcome)).toMatchObject({ paragraphs: [expect.stringMatching(/^Le téléphone enregistre une session : rien n'a été fait/)], action: 'retry' });
    // Libre ensuite : la synchronisation se fait.
    expect((await run(pair, { phoneRecording: async () => false })).complete).toBe(true);
  });

  it('un enregistrement qui commence en route : tout s’arrête net, proprement, et la reprise finit le travail', async () => {
    const pair = await syncedPair(2);
    for (let k = 5; k < 9; k++) putSyncSession(pair.computer, at(k));
    let writes = 0;
    const recording = Object.assign(new Error("Le téléphone enregistre une session : rien n'y est écrit pendant ce temps."), { code: 'PERMISSION', phoneRecording: true });
    const starting: SyncRemote = {
      ...pair.phone,
      writeBytes: async (path, bytes) => {
        if (path.startsWith('sessions/') && ++writes > 4) throw recording;
        return pair.phone.writeBytes(path, bytes);
      },
    };
    const stopped = await run(pair, {}, starting);
    expect(stopped).toMatchObject({ recordingStarted: true, linkLost: null, complete: false });
    expect(pair.computer.text(SYNC_RUNNING_PATH)).not.toBeNull();
    expect(describeSync(stopped)).toMatchObject({ title: 'Synchronisation arrêtée', action: 'restart' });
    expect(describeSync(stopped).notes.some((n) => n.text.startsWith('Un enregistrement a commencé sur le téléphone'))).toBe(true);
    await everyGpxHasRecord(pair.phone);
    const resumed = await run(pair);
    expect(resumed).toMatchObject({ interrupted: true, complete: true });
    expect(await syncSessionFiles(pair.phone)).toEqual([0, 1, 5, 6, 7, 8].map(fileOf));
  });

  it('rien n’est effacé du téléphone : un retrait est un dépôt dans sa corbeille, sans écraser un dépôt de la même session', async () => {
    // Cinq sessions : en retirer une reste sous le garde-fou (le quart d'un côté).
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(1))?.ops.map((op) => op.kind)).toEqual(['removeFromPhone']);
    const dir = `${TRASH_DIR}/${NOW}-${at(1)}`;
    expect([...pair.phone.aside().keys()]).toEqual([fileOf(1), recordFileName(fileOf(1))].map((n) => `${dir}/${n}`));
    // La même session remise sur le téléphone puis retirée de nouveau : un dépôt neuf, le premier n'est pas touché.
    putSyncSession(pair.phone, at(1), { imuBytes: 30 });
    putSyncSession(pair.computer, at(1), { imuBytes: 30 });
    await run(pair);
    await trashOnComputer(pair, 1);
    await run(pair);
    expect([...pair.phone.aside().keys()].filter((p) => p.endsWith('.gpx')).sort()).toEqual([`${dir}-2/${fileOf(1)}`, `${dir}/${fileOf(1)}`]);
    expect(await syncSessionFiles(pair.phone)).toEqual([0, 2, 3, 4].map(fileOf));
  });

  it('GPX et capteurs jamais réécrits : une fiche changée ne fait voyager que la fiche', async () => {
    const pair = await syncedPair(2);
    const gpxBefore = pair.phone.text(sessionPath(fileOf(0)));
    editSyncRecord(pair.computer, fileOf(0), (r) => ({ ...r, name: 'Nouveau nom' }));
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(0))?.ops.map((op) => op.kind)).toEqual(['writeRecord']);
    expect(pair.phone.text(sessionPath(fileOf(0)))).toBe(gpxBefore);
    expect(readSyncRecord(pair.phone, fileOf(0))?.name).toBe('Nouveau nom');
  });
});

describe('corbeille relue avant toute mise de côté (relecture du 217)', () => {
  /** Le GPX que la corbeille de l'ordinateur tient d'une session, chemin depuis la racine. */
  const trashGpxOf = (pair: Pair, k: number): string => {
    const entry = sessionTrashEntries(trashOf(pair), at(k))[0];
    return `corbeille/${entry.dir}/${entry.main}`;
  };

  it('un GPX de la corbeille de même taille mais d’un autre contenu ne compte pas : la copie du téléphone y entre d’abord', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    const kept = pair.computer.text(trashGpxOf(pair, 1)) as string;
    // Même longueur, autre trace (un caractère changé).
    pair.computer.put(trashGpxOf(pair, 1), kept.replace('<gpx', '<gpX'));
    const phoneGpx = pair.phone.text(sessionPath(fileOf(1)));
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(1))?.ops.map((op) => op.kind)).toEqual(['removeFromPhone']);
    expect(outcome.keptFromPhone).toEqual([at(1)]);
    const fromPhone = sessionTrashEntries(trashOf(pair), at(1)).find((e) => e.origin === 'telephone');
    expect(fromPhone && pair.computer.text(`corbeille/${fromPhone.dir}/${fromPhone.main}`)).toBe(phoneGpx);
    expect(await syncSessionFiles(pair.phone)).not.toContain(fileOf(1));
  });

  it('une copie rangée qui, relue, n’est pas identique : rien n’est mis de côté, la session reste et c’est dit', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    // Le disque rend, pour tout GPX de la corbeille, autre chose que ce qui y a été écrit.
    const lying: SyncRemote = {
      ...pair.computer,
      readBytes: async (path) => {
        const bytes = await pair.computer.readBytes(path);
        return bytes && path.startsWith('corbeille/') && path.endsWith('.gpx') ? new Uint8Array([...bytes].reverse()) : bytes;
      },
    };
    const outcome = await run(pair, {}, pair.phone, lying);
    expect(outcome.failed.map((f) => f.item.startMs)).toEqual([at(1)]);
    expect(outcome.failed[0].detail).toMatch(/relue, n'est pas identique : rien n'a été retiré/);
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    expect(pair.phone.aside().size).toBe(0);
    expect(describeSync(outcome)).toMatchObject({ title: 'Synchronisation terminée', action: 'restart' });
  });
});

describe('ce que les relecteurs n’avaient pas regardé', () => {
  it('une session modifiée d’un côté n’est jamais retirée parce qu’elle a été supprimée de l’autre', async () => {
    const pair = await syncedPair(5);
    // Supprimée sur le téléphone, modifiée sur l'ordinateur : elle revient sur le téléphone, rien à la corbeille.
    deleteSyncSession(pair.phone, fileOf(1));
    editSyncRecord(pair.computer, fileOf(1), (r) => ({ ...r, name: 'Modifiée ici' }));
    // Supprimée sur l'ordinateur, modifiée sur le téléphone : elle revient sur l'ordinateur, rien n'est mis de côté.
    await trashOnComputer(pair, 2);
    editSyncRecord(pair.phone, fileOf(2), (r) => ({ ...r, notes: notes({ comment: 'modifiée là-bas' }) }));
    const outcome = await run(pair);
    expect(outcome.done.filter((i) => i.revived).map((i) => i.startMs).sort()).toEqual([at(1), at(2)]);
    expect(await bothSides(pair)).toEqual([[0, 1, 2, 3, 4].map(fileOf), [0, 1, 2, 3, 4].map(fileOf)]);
    expect(pair.phone.aside().size).toBe(0);
    expect(readSyncRecord(pair.phone, fileOf(1))?.name).toBe('Modifiée ici');
    expect(readSyncRecord(pair.computer, fileOf(2))?.notes?.comment).toBe('modifiée là-bas');
  });

  it('garde-fou : plus de 10 retraits ou plus du quart d’un côté attendent un accord, rien ne part', async () => {
    const pair = await syncedPair(12);
    for (let k = 0; k < 11; k++) deleteSyncSession(pair.phone, fileOf(k));
    const held = await run(pair);
    expect(held).toMatchObject({ deletions: 'awaitingConfirmation', complete: false });
    expect(await syncSessionFiles(pair.computer)).toHaveLength(12);
    expect(trashOf(pair)).toEqual([]);
    expect(describeSyncQuestion(held)).toMatchObject({ kind: 'guard' });
    const small = await syncedPair(8);
    for (let k = 0; k < 3; k++) deleteSyncSession(small.phone, fileOf(k));
    expect((await run(small)).deletions).toBe('awaitingConfirmation');
  });
});

describe('brouillon non enregistré sur l’ordinateur', () => {
  it('une session supprimée sur le téléphone n’est jamais mise à la corbeille tant qu’elle a un brouillon : laissée, dite, puis retirée', async () => {
    const pair = await syncedPair(6);
    deleteSyncSession(pair.phone, fileOf(1));
    const withDraft = new Set([fileOf(1)]);
    const options: SyncOptions = { hasUnsavedDraft: (file) => withDraft.has(file) };
    // L'aperçu ne la compte pas parmi les retraits, et le dit.
    const preview = await run(pair, { ...options, dryRun: true });
    expect(preview.drafted.map((i) => i.startMs)).toEqual([at(1)]);
    expect(preview.plan?.items.find((i) => i.startMs === at(1))?.ops.some((op) => op.kind === 'trash')).not.toBe(true);
    // La synchronisation la laisse : rien à la corbeille, la session reste sur l'ordinateur, compte rendu « incomplète ».
    const outcome = await run(pair, { ...options, confirmDeletions: true, confirmedDeletions: [] });
    expect(outcome).toMatchObject({ complete: false, deletions: 'made' });
    expect(trashOf(pair)).toEqual([]);
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(1));
    const report = describeSync(outcome);
    expect(report).toMatchObject({ title: 'Synchronisation terminée', action: 'close' });
    expect(report.notes.some((n) => n.text.includes('a des modifications non enregistrées'))).toBe(true);
    // Brouillon enregistré ou annulé : la suppression du téléphone se fait.
    withDraft.clear();
    const after = await run(pair, options);
    expect(after.complete).toBe(true);
    expect(await syncSessionFiles(pair.computer)).not.toContain(fileOf(1));
    expect(trashOf(pair).map((e) => e.startMs)).toEqual([at(1)]);
  });
});

describe('relecture du commit 46b851d', () => {
  it('« sans rien supprimer » : des restes écartés empêchent une synchronisation dite entière, la date de fin n’avance pas', async () => {
    const pair = pairOf();
    for (let k = 0; k < 4; k++) putBoth(pair, k, 8);
    expect((await run(pair)).complete).toBe(true);
    const doneBefore = baseOf(pair)?.syncedAtMs;
    // Supprimée sur le téléphone, et sur l'ordinateur à la main, GPX seul : sa fiche et ses capteurs restent.
    deleteSyncSession(pair.phone, fileOf(1));
    pair.computer.drop(sessionPath(fileOf(1)));
    const half = await run(pair, { withoutDeletions: true, now: () => NOW + 60_000 });
    expect(half.withheldDeletions).toEqual([]);
    expect(half).toMatchObject({ complete: false, cut: 1 });
    expect(baseOf(pair)?.syncedAtMs).toBe(doneBefore);
    const report = describeSync(half);
    expect(report.notes.map((n) => n.text)).toContain("1 élément n'a pas pu être traité entièrement cette fois : la prochaine synchronisation s'en chargera.");
    // Restes permis : la synchronisation est entière, et datée.
    const whole = await run(pair, { now: () => NOW + 120_000 });
    expect(whole).toMatchObject({ complete: true, cut: 0 });
    expect(baseOf(pair)?.syncedAtMs).toBe(NOW + 120_000);
  });

  it('les fichiers annexes ne retirent jamais rien, avec ou sans « sans rien supprimer »', async () => {
    for (const withoutDeletions of [true, false]) {
      const pair = extrasPair();
      const before = { computer: pair.computer.paths(), phone: pair.phone.paths() };
      const outcome = await run(pair, { computerDeviceId: PC_ID, withoutDeletions });
      expect(outcome.extras.done.length + outcome.extras.copied.length).toBeGreaterThan(0);
      for (const side of ['computer', 'phone'] as const) {
        const now = (side === 'computer' ? pair.computer : pair.phone).paths();
        expect(before[side].filter((p) => !now.includes(p)), `${side} ${withoutDeletions}`).toEqual([]);
      }
    }
  });
});

/**
 * Le dossier du téléphone tel que l'application du téléphone le voit (pas le câble) : il lit et écrit directement, et
 * efface (sa corbeille). Ses écritures ne passent pas par le protocole du câble.
 */
const phoneApp = (f: SyncFolder): TrashFolder & MemoryFolder => {
  const bytes = (path: string): Uint8Array | null => {
    const text = f.text(path);
    return text === null ? null : new TextEncoder().encode(text);
  };
  return {
    kind: 'device',
    label: 'Téléphone',
    list: async (dir) => {
      const prefix = dir === '' ? '' : `${dir}/`;
      const entries = new Map<string, { name: string; kind: 'file' | 'directory'; size: number; mtimeMs: number }>();
      for (const path of f.paths().filter((p) => p.startsWith(prefix))) {
        const rest = path.slice(prefix.length);
        const cut = rest.indexOf('/');
        if (cut < 0) entries.set(rest, { name: rest, kind: 'file', size: bytes(path)?.byteLength ?? 0, mtimeMs: 0 });
        else entries.set(rest.slice(0, cut), { name: rest.slice(0, cut), kind: 'directory', size: 0, mtimeMs: 0 });
      }
      return [...entries.values()];
    },
    readText: async (path) => f.text(path),
    readBytes: async (path) => bytes(path),
    stat: async (path) => {
      const b = bytes(path);
      return b === null ? null : { size: b.byteLength, mtimeMs: 0 };
    },
    writeText: async (path, text) => f.put(path, text),
    writeBytes: async (path, b) => f.put(path, b),
    remove: async (path) => f.drop(path),
    removeDir: async (path) => {
      if (f.paths().some((p) => p.startsWith(`${path}/`))) throw new Error(`dossier non vide : ${path}`);
    },
  };
};

const PHONE_NOW = Date.UTC(2026, 10, 22, 8, 0, 0);
const phoneTrashOf = (pair: Pair): TrashEntry[] => parseTrashIndex(pair.phone.text(TRASH_INDEX_PATH)).entries;

/** Supprime une session sur le téléphone comme son application : copie dans sa corbeille, puis retrait. */
const trashOnPhone = async (pair: Pair, k: number): Promise<void> => {
  const app = phoneApp(pair.phone);
  const names = [fileOf(k), recordFileName(fileOf(k)), imuFileName(fileOf(k))].map(sessionPath);
  await stashInTrash(app, { kind: 'session', paths: names, main: names[0], startMs: at(k), name: `session ${k}` }, PHONE_NOW);
  for (const path of names) pair.phone.drop(path);
};

describe('corbeilles jumelles (lot 242-1)', () => {
  it('supprimée sur l’ordinateur : dépôt dans la corbeille du téléphone, depose.json d’abord, l’index du téléphone jamais écrit', async () => {
    const pair = await syncedPair(5);
    pair.phone.put(TRASH_INDEX_PATH, '{"index du téléphone":1}');
    await trashOnComputer(pair, 1);
    const outcome = await run(pair);
    expect(outcome.complete).toBe(true);
    const dir = `${TRASH_DIR}/${NOW}-${at(1)}`;
    // Seule écriture de l'ordinateur dans la corbeille du téléphone : la fiche du dépôt.
    expect(pair.phone.written().filter((p) => p.startsWith(`${TRASH_DIR}/`))).toEqual([`${dir}/${DEPOSIT_FILE}`]);
    expect(pair.phone.text(TRASH_INDEX_PATH)).toBe('{"index du téléphone":1}');
    expect(parseDeposit(pair.phone.text(`${dir}/${DEPOSIT_FILE}`))).toMatchObject({
      origin: 'ordinateur', kind: 'session', startMs: at(1), files: [{ name: fileOf(1) }, { name: recordFileName(fileOf(1)) }],
    });
    // Le téléphone l'adopte : une entrée de son index, à son horloge, et plus de depose.json.
    pair.phone.drop(TRASH_INDEX_PATH);
    const adopted = await adoptDeposits(phoneApp(pair.phone), PHONE_NOW);
    expect(adopted).toMatchObject([{ dir: `${NOW}-${at(1)}`, kind: 'session', startMs: at(1), main: fileOf(1), origin: 'ordinateur', deletedAtMs: PHONE_NOW }]);
    expect(phoneTrashOf(pair).map((e) => e.startMs)).toEqual([at(1)]);
    expect(pair.phone.text(`${dir}/${DEPOSIT_FILE}`)).toBeNull();
    // Dans les deux corbeilles.
    expect(sessionTrashEntries(trashOf(pair), at(1))).toHaveLength(1);
  });

  it('supprimée sur le téléphone : dans sa corbeille, puis dans celle de l’ordinateur à la synchronisation', async () => {
    const pair = await syncedPair(5);
    await trashOnPhone(pair, 2);
    expect(phoneTrashOf(pair).map((e) => e.startMs)).toEqual([at(2)]);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(2))?.case).toBe('deletedOnPhone');
    expect(sessionTrashEntries(trashOf(pair), at(2))).toHaveLength(1);
    expect(phoneTrashOf(pair).map((e) => e.startMs)).toEqual([at(2)]);
    expect(pair.phone.written().filter((p) => p.startsWith(`${TRASH_DIR}/`))).toEqual([]);
  });

  it('supprimée des deux côtés : la base l’oublie, chaque corbeille garde la sienne', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 3);
    await trashOnPhone(pair, 3);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(3))?.case).toBe('deletedOnBoth');
    expect(sessionTrashEntries(trashOf(pair), at(3))).toHaveLength(1);
    expect(phoneTrashOf(pair).map((e) => e.startMs)).toEqual([at(3)]);
    expect(baseOf(pair)?.sessions.map((l) => l.startMs)).not.toContain(at(3));
  });

  it('restaurée sur l’ordinateur : recopiée sur le téléphone sans question, et la corbeille du téléphone la voit revenue', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    await run(pair);
    await adoptDeposits(phoneApp(pair.phone), PHONE_NOW);
    await restoreOnComputer(pair, 1);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'newOnComputer', restored: true });
    expect(outcome.deletions).toBe('made');
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    // Au rechargement, le téléphone règle sa corbeille : la ligne de la session revenue est à régler (`settleReturnedTrash`).
    expect(returnedTrashGroups(phoneTrashOf(pair), new Set([0, 1, 2, 3, 4].map(at))).map((g) => g.entry.startMs)).toEqual([at(1)]);
  });

  it('restaurée sur le téléphone : recopiée sur l’ordinateur sans question, dite restaurée', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    await run(pair);
    const app = phoneApp(pair.phone);
    await adoptDeposits(app, PHONE_NOW);
    const [entry] = phoneTrashOf(pair);
    const plan = sessionRestorePlan(entry, await syncSessionFiles(pair.phone));
    await copyFromTrash(app, plan.copies);
    await dropTrashEntries(app, [entry.dir]);
    const outcome = await run(pair);
    expect(outcome.done.find((i) => i.startMs === at(1))).toMatchObject({ case: 'newOnPhone', restored: true, left: null });
    expect(outcome.deletions).toBe('made');
    expect(await syncSessionFiles(pair.computer)).toContain(fileOf(1));
    expect(describeSync(outcome).rows).toContainEqual(expect.objectContaining({ label: 'Restauré' }));
    // L'ordinateur règle ensuite sa corbeille : la session y est encore, et revenue dans sa mémoire.
    expect(returnedTrashGroups(trashOf(pair), new Set([0, 1, 2, 3, 4].map(at))).map((g) => g.entry.startMs)).toEqual([at(1)]);
  });

  it('« Vider » sur le téléphone ne vaut que pour lui : rien ne part vers l’ordinateur, sa corbeille garde la session', async () => {
    const pair = await syncedPair(5);
    await trashOnPhone(pair, 2);
    await run(pair);
    await emptyTrash(phoneApp(pair.phone));
    expect(phoneTrashOf(pair)).toEqual([]);
    const outcome = await run(pair);
    expect(outcome.done.filter((i) => i.ops.length > 0)).toEqual([]);
    expect(sessionTrashEntries(trashOf(pair), at(2))).toHaveLength(1);
  });

  it('« Vider » et la purge du téléphone épargnent un dépôt pas encore adopté', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    await run(pair);
    const app = phoneApp(pair.phone);
    await emptyTrash(app);
    expect(pair.phone.text(`${TRASH_DIR}/${NOW}-${at(1)}/${fileOf(1)}`)).not.toBeNull();
    expect(await adoptDeposits(app, PHONE_NOW)).toHaveLength(1);
  });

  it('coupure juste après depose.json : rien n’a quitté sessions/, le dépôt attend ; la passe suivante en ouvre un neuf, l’ancien vide part', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    // Le marqueur (2 opérations), puis la fiche du dépôt (2) : coupé juste après.
    pair.phone.cutAfter(MARKER_STEPS + 2);
    expect((await run(pair)).linkLost).not.toBeNull();
    pair.phone.cutAfter(null);
    const first = `${TRASH_DIR}/${NOW}-${at(1)}`;
    expect(pair.phone.text(`${first}/${DEPOSIT_FILE}`)).not.toBeNull();
    expect(await syncSessionFiles(pair.phone)).toContain(fileOf(1));
    const app = phoneApp(pair.phone);
    // Les fichiers manquants sont encore à leur place : le dépôt attend.
    expect(await adoptDeposits(app, PHONE_NOW)).toEqual([]);
    expect(pair.phone.text(`${first}/${DEPOSIT_FILE}`)).not.toBeNull();
    expect((await run(pair)).complete).toBe(true);
    expect(pair.phone.text(`${first}-2/${fileOf(1)}`)).not.toBeNull();
    const adopted = await adoptDeposits(app, PHONE_NOW);
    expect(adopted.map((e) => e.dir)).toEqual([`${NOW}-${at(1)}-2`]);
    expect(pair.phone.paths().filter((p) => p.startsWith(`${first}/`))).toEqual([]);
    expect(phoneTrashOf(pair).map((e) => [e.kind, e.startMs])).toEqual([['session', at(1)]]);
  });

  it('coupure après le GPX : la fiche restée seule repart dans un dépôt neuf, puis les deux dépôts sont adoptés ; rien de perdu', async () => {
    const pair = await syncedPair(5);
    await trashOnComputer(pair, 1);
    // Le marqueur (2), la fiche du dépôt (2), le GPX (1) : coupé avant la fiche de la session.
    pair.phone.cutAfter(MARKER_STEPS + 3);
    expect((await run(pair)).linkLost).not.toBeNull();
    pair.phone.cutAfter(null);
    const first = `${TRASH_DIR}/${NOW}-${at(1)}`;
    expect(pair.phone.text(`${first}/${fileOf(1)}`)).not.toBeNull();
    expect(pair.phone.text(sessionPath(recordFileName(fileOf(1))))).not.toBeNull();
    const app = phoneApp(pair.phone);
    expect(await adoptDeposits(app, PHONE_NOW)).toEqual([]);
    expect((await run(pair)).complete).toBe(true);
    expect(pair.phone.text(sessionPath(recordFileName(fileOf(1))))).toBeNull();
    const adopted = await adoptDeposits(app, PHONE_NOW);
    expect(adopted.map((e) => [e.dir, e.kind]).sort()).toEqual([[`${NOW}-${at(1)}`, 'session'], [`${NOW}-${at(1)}-2`, 'restes']]);
    // Chaque fichier de la session est dans la corbeille du téléphone, et rien de plus à adopter.
    for (const name of [fileOf(1), recordFileName(fileOf(1))]) expect(pair.phone.paths().some((p) => p.startsWith(`${TRASH_DIR}/`) && p.endsWith(`/${name}`)), name).toBe(true);
    expect(await adoptDeposits(app, PHONE_NOW)).toEqual([]);
  });
});

describe('le téléphone se met à jour seul (lot 242-2)', () => {
  it('le téléphone changé reçoit l’instant de la synchronisation dans son marqueur ; inchangé, rien n’y est posé', async () => {
    const pair = await syncedPair(2);
    const before = readMarkerSync(pair.phone.text('tracker.json'));
    // Rien de neuf : le marqueur garde son instant.
    expect((await run(pair, { now: () => NOW + 1000 })).phoneChanged).toBe(false);
    expect(readMarkerSync(pair.phone.text('tracker.json'))).toBe(before);
    // Une session neuve sur l'ordinateur part au téléphone : l'instant change, le reste du marqueur demeure.
    const id = readMarkerId(pair.phone.text('tracker.json'));
    putSyncSession(pair.computer, at(5));
    const outcome = await run(pair, { now: () => NOW + 2000 });
    expect(outcome.phoneChanged).toBe(true);
    expect(readMarkerSync(pair.phone.text('tracker.json'))).toBe(NOW + 2000);
    expect(readMarkerId(pair.phone.text('tracker.json'))).toBe(id);
  });

  it('un passage à blanc ou un téléphone qui enregistre ne touchent pas au marqueur', async () => {
    const pair = await syncedPair(1);
    putSyncSession(pair.computer, at(3));
    const marker = pair.phone.text('tracker.json');
    await run(pair, { dryRun: true });
    expect((await run(pair, { phoneRecording: async () => true })).refusal).toBe('phoneRecording');
    expect(pair.phone.text('tracker.json')).toBe(marker);
  });
});
