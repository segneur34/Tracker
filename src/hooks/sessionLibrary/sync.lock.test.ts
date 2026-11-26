import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncRemote } from './sync';
import { putSyncSession, syncMemoryFolder, syncSessionFiles, type SyncFolder } from '../../test/syncFolder.fixture';

/**
 * Le verrou de la synchronisation : refusée pendant un import ou un enregistrement, « import en cours » tenu pendant
 * toute la durée et rendu quoi qu'il arrive, corbeille tenue, mémoire relue à la fin.
 */

const doubles = vi.hoisted(() => ({ recording: false, flushFails: false, refreshed: 0 }));

vi.mock('./lifecycle', () => ({
  refreshLibrary: async () => {
    doubles.refreshed += 1;
  },
}));
vi.mock('./deviceSettings', () => ({
  flushWrites: async () => {
    if (doubles.flushFails) throw new Error('écriture impossible');
  },
  deviceId: () => 'appareil-ordinateur',
}));
vi.mock('./importer', () => ({
  canImportSessions: (s: { status: string; memoryReadOnly: boolean }) => s.status === 'ready' && !s.memoryReadOnly,
}));

const { synchronizePhone } = await import('./sync');
const { lib } = await import('./memory');
const { libraryState, setState } = await import('./store');
const { trashReleased } = await import('./trash');

const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);
let computer: SyncFolder;
let phone: SyncFolder;

beforeEach(() => {
  doubles.recording = false;
  doubles.flushFails = false;
  doubles.refreshed = 0;
  computer = syncMemoryFolder({ clockMs: 1_800_000_000_000 });
  phone = syncMemoryFolder({ phone: true, cable: true, clockMs: 1_800_000_500_000 });
  putSyncSession(computer, T0);
  putSyncSession(phone, T0 + 3_600_000);
  lib.folder = computer;
  setState({ status: 'ready', memoryReadOnly: false, importing: false });
});

describe('verrou de la synchronisation', () => {
  it('refusée pendant un import ou un enregistrement, sans rien toucher', async () => {
    setState({ importing: true });
    expect((await synchronizePhone(phone)).refusal).toBe('busy');
    expect(libraryState().importing).toBe(true);
    setState({ importing: false });
    doubles.recording = true;
    expect((await synchronizePhone(phone, { recording: () => doubles.recording })).refusal).toBe('busy');
    expect(libraryState().importing).toBe(false);
    expect(phone.steps() + computer.steps()).toBe(0);
    expect(doubles.refreshed).toBe(0);
  });

  it('tient « import en cours » et la corbeille pendant toute la durée, puis relit la mémoire', async () => {
    const seen: boolean[] = [];
    let trashHeld = false;
    const watched: SyncRemote = {
      ...phone,
      list: async (dir) => {
        seen.push(libraryState().importing);
        let released = false;
        void trashReleased().then(() => {
          released = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        trashHeld = trashHeld || !released;
        return phone.list(dir);
      },
    };
    const outcome = await synchronizePhone(watched);
    expect(outcome.complete).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(trashHeld).toBe(true);
    expect(libraryState().importing).toBe(false);
    expect(doubles.refreshed).toBe(1);
    expect(await syncSessionFiles(phone)).toEqual(await syncSessionFiles(computer));
    await trashReleased();
  });

  it('rend le verrou après une erreur, un refus ou une liaison perdue', async () => {
    doubles.flushFails = true;
    const failed = await synchronizePhone(phone);
    expect(failed.error).toBe('écriture impossible');
    expect(libraryState().importing).toBe(false);
    doubles.flushFails = false;

    phone.drop('tracker.json');
    expect((await synchronizePhone(phone)).refusal).toBe('phoneNoMarker');
    expect(libraryState().importing).toBe(false);

    const other = syncMemoryFolder({ phone: true, clockMs: 1_800_000_900_000 });
    putSyncSession(computer, T0 + 7_200_000);
    other.cutAfter(0);
    const cut = await synchronizePhone(other);
    expect(cut.linkLost).not.toBeNull();
    expect(libraryState().importing).toBe(false);
    expect(doubles.refreshed).toBe(3);
  });

  it('refusée sans mémoire prête, ou sur un dossier sans corbeille', async () => {
    setState({ memoryReadOnly: true });
    expect((await synchronizePhone(phone)).refusal).toBe('memory');
    setState({ memoryReadOnly: false });
    lib.folder = { ...computer, kind: 'browser' };
    expect((await synchronizePhone(phone)).refusal).toBe('noTrash');
    expect(libraryState().importing).toBe(false);
  });
});
