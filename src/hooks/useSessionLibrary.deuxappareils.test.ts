import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, serializeRecord, type SessionRecord, type StoredSessionNotes } from '../library/record';
import type { FileStat, MemoryFolder } from '../platform/memoryFolder';
import { gpxAt, settle, tick, trackTestTimers, underFakeClock } from '../test/library.fixture';
import { createFakeFolder } from '../test/memoryFolder.fixture';

/**
 * Deux appareils sur un même dossier (lot 148, sujet 3) : la fiche change sur le disque entre sa
 * lecture et son écriture. Faux dossier où chaque écriture change la date, comme un vrai fichier.
 */

const GPX = '2026-10-27_10-00-00_running.gpx';
const JSON_NAME = GPX.replace(/\.gpx$/, '.json');
const JSON_PATH = `sessions/${JSON_NAME}`;
const START_MS = Date.parse('2026-10-27T10:00:00Z');

const gpxText = (): string => gpxAt(0);

const files = new Map<string, string>();
const dates = new Map<string, number>();
const log: string[] = [];
let clock = 1000;
/** Date rendue par le dossier, à la place de la vraie : 0 pour un fournisseur qui n'en donne pas. */
let forcedDate: number | null = null;
let statFails = false;

const touch = (path: string, text: string): void => {
  files.set(path, text);
  dates.set(path, (clock += 1000));
};

const statOf = (path: string): FileStat | null => {
  const text = files.get(path);
  return text === undefined ? null : { size: text.length, mtimeMs: forcedDate ?? dates.get(path) ?? 1 };
};

const fakeFolder: MemoryFolder = createFakeFolder(files, log, {
  list: async (dir) =>
    [...files.keys()]
      .filter((path) => (dir === '' ? !path.includes('/') : path.startsWith(`${dir}/`)))
      .map((path) => ({ name: dir === '' ? path : path.slice(dir.length + 1), kind: 'file' as const, ...statOf(path)! })),
  readText: async (path) => {
    log.push(`read ${path}`);
    return files.get(path) ?? null;
  },
  writeText: async (path, text) => {
    log.push(`write ${path}`);
    touch(path, text);
  },
  stat: async (path) => {
    if (statFails) throw new Error('stat refusé');
    return statOf(path);
  },
});

/** Modules simulés, refaits après chaque `vi.resetModules()` : un `vi.mock` posé une fois survivrait à `resetModules`. */
const mockPlatform = (): void => {
  vi.doMock('../core/gpxParser', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../core/gpxParser')>()),
    parseGpx: (text: string) => ({
      rawPoints: [...text.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"><time>([^<]+)<\/time>/g)]
        .map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), time: m[3] })),
      timedPoints: [],
      trackType: 'running',
      hasDeviceSpeed: false,
    }),
  }));
  vi.doMock('../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
};

const stored = new Map<string, string>();

const notes = (patch: Partial<StoredSessionNotes>): StoredSessionNotes => ({
  foil: '', mast: '', wing: '', gear1: '', gear2: '', conditions: '', gear: null, comment: '', windLevel: null, waterState: null, rating: null, savedAt: 100, ...patch,
});

const baseRecord = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  format: RECORD_FORMAT, version: RECORD_VERSION, gpx: GPX, sport: 'running', activityId: 'running', source: 'enregistrement',
  addedAt: '2026-10-27T12:00:00.000Z', title: null, name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION, startMs: START_MS, endMs: START_MS + 20_000, distanceM: 66, movingTimeS: 20, elevationGainM: null, maxSpeedMs: 3.3,
    pointCount: 3, samplingS: 10, optionsKey: JSON.stringify([null, null, null, null]), activitySettings: { threshold: null },
  },
  notes: null, analysis: null, ...patch,
});

const putSession = (patch: Partial<SessionRecord> = {}): void => {
  touch(`sessions/${GPX}`, gpxText());
  touch(JSON_PATH, serializeRecord(baseRecord(patch)));
};

/** L'autre appareil écrit la fiche. */
const otherDeviceWrites = (patch: Partial<SessionRecord>): void => {
  touch(JSON_PATH, serializeRecord({ ...JSON.parse(files.get(JSON_PATH)!), ...patch }));
};

type Library = typeof import('./useSessionLibrary');

/** Aucune minuterie d'un test ne sonne pendant le suivant (`trackTestTimers`). */
let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  stopTestTimers = trackTestTimers();
});
afterEach(() => stopTestTimers());

const openFresh = async (): Promise<Library> => {
  vi.resetModules();
  mockPlatform();
  const library = await import('./useSessionLibrary');
  await library.openLibrary();
  return library;
};

const disk = (): SessionRecord => JSON.parse(files.get(JSON_PATH)!);
const writes = (): string[] => log.filter((l) => l === `write ${JSON_PATH}`);
const reads = (): string[] => log.filter((l) => l === `read ${JSON_PATH}`);

beforeEach(() => {
  files.clear();
  dates.clear();
  stored.clear();
  log.length = 0;
  forcedDate = null;
  statFails = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Écrit tout de suite ce qui attendait (`flushWrites`, par « Mettre à jour » : écritures en attente, puis relecture). */
const flush = (library: Library): Promise<void> => library.refreshLibrary();

describe('fiche changée sur le disque', () => {
  it('rien de changé : une écriture sans relire la fiche', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    log.length = 0;
    library.updateSessionRecord(GPX, { name: 'Ici' });
    await flush(library);
    const firstRead = log.indexOf(`read ${JSON_PATH}`);
    expect(firstRead === -1 || firstRead > log.indexOf(`write ${JSON_PATH}`)).toBe(true);
    expect(disk().name).toBe('Ici');
    expect(writes()).toHaveLength(1);
  });

  it('notes saisies là-bas, nom ici : les deux gardés, sans message', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: 500 }) });
    library.updateSessionRecord(GPX, { name: 'Ici' });
    await flush(library);
    expect(disk().name).toBe('Ici');
    expect(disk().notes?.comment).toBe('là-bas');
    expect(library.librarySession(GPX)!.record.notes?.comment).toBe('là-bas');
    expect(library.readLibraryState().error).toBeNull();
  });

  it('un résumé refait ne perd pas les notes saisies là-bas', async () => {
    putSession({ summary: { ...baseRecord().summary, calcVersion: SUMMARY_CALC_VERSION - 1 } });
    // Le recalcul de fond est lancé à l'ouverture : la fiche change entre la lecture du dossier et lui.
    const library = await (async () => {
      vi.resetModules();
      mockPlatform();
      const lib = await import('./useSessionLibrary');
      const opened = lib.openLibrary();
      await tick();
      otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: 500 }) });
      await opened;
      return lib;
    })();
    await settle(library);
    expect(disk().notes?.comment).toBe('là-bas');
    expect(disk().summary.calcVersion).toBe(SUMMARY_CALC_VERSION);
  });

  it('même champ saisi des deux côtés : le plus récent, et c\'est dit', async () => {
    putSession({ notes: notes({ comment: 'lu' }) });
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: Date.now() + 60_000 }) });
    library.updateSessionRecord(GPX, { notes: notes({ comment: 'ici', savedAt: Date.now() }) });
    await flush(library);
    expect(disk().notes?.comment).toBe('là-bas');
    expect(library.readLibraryState().error).toContain('aussi changé sur un autre appareil (notes)');
  });

  it('date nulle (fournisseur du téléphone) : relue à chaque écriture, rien de perdu', async () => {
    forcedDate = 0;
    putSession();
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: 500 }) });
    log.length = 0;
    library.updateSessionRecord(GPX, { name: 'Ici' });
    await flush(library);
    expect(reads().length).toBeGreaterThan(0);
    expect(disk().name).toBe('Ici');
    expect(disk().notes?.comment).toBe('là-bas');
  });

  it('date illisible (stat en échec) : relue aussi', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: 500 }) });
    statFails = true;
    library.updateSessionRecord(GPX, { name: 'Ici' });
    await flush(library);
    expect(disk().name).toBe('Ici');
    expect(disk().notes?.comment).toBe('là-bas');
  });

  it('fiche devenue d\'une version plus récente : rien d\'écrit, lecture seule, c\'est dit', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ version: RECORD_VERSION + 1 });
    const text = files.get(JSON_PATH);
    log.length = 0;
    await writeNow(async () => {
      library.updateSessionRecord(GPX, { name: 'Ici' });
      await library.dismissLibraryMessage();
    });
    expect(files.get(JSON_PATH)).toBe(text);
    expect(writes()).toEqual([]);
    expect(library.librarySession(GPX)!.readOnly).toBe(true);
    expect(library.readLibraryState().error).toContain('non enregistrés');
  });

  it('fiche devenue illisible : rien d\'écrit, lecture seule', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    touch(JSON_PATH, '{ abîmée');
    log.length = 0;
    await writeNow(() => library.updateSessionRecord(GPX, { name: 'Ici' }));
    expect(files.get(JSON_PATH)).toBe('{ abîmée');
    expect(writes()).toEqual([]);
    expect(library.librarySession(GPX)!.readOnly).toBe(true);
  });

  it('fiche disparue : écrite, comme avant', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    files.delete(JSON_PATH);
    await writeNow(() => library.updateSessionRecord(GPX, { name: 'Ici' }));
    expect(disk().name).toBe('Ici');
  });

  it('copie arrivée avec une date plus ancienne : vue quand même', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    const text = serializeRecord({ ...disk(), notes: notes({ comment: 'copie', savedAt: 50 }) });
    files.set(JSON_PATH, text);
    dates.set(JSON_PATH, 10);
    await writeNow(() => library.updateSessionRecord(GPX, { name: 'Ici' }));
    expect(disk().notes?.comment).toBe('copie');
    expect(disk().name).toBe('Ici');
  });

  it("le disque a déjà tout : pas d'écriture", async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    otherDeviceWrites({ name: 'Ici' });
    log.length = 0;
    await writeNow(() => library.updateSessionRecord(GPX, { name: 'Ici' }));
    expect(writes()).toEqual([]);
    expect(library.librarySession(GPX)!.record.name).toBe('Ici');
  });

  it("saisie faite pendant une écriture refusée : la valeur d'avant la plus ancienne compte, pas de faux conflit, rien de perdu", async () => {
    const now = Date.now();
    putSession({ notes: notes({ comment: '' }) });
    const library = await openFresh();
    await settle(library);
    const write = fakeFolder.writeText;
    // « abc » est tapé pendant que l'écriture de « ab » échoue.
    fakeFolder.writeText = async () => {
      fakeFolder.writeText = write;
      library.updateSessionRecord(GPX, { notes: notes({ comment: 'abc', savedAt: now + 1 }) });
      throw new Error('disque plein');
    };
    await writeNow(() => library.updateSessionRecord(GPX, { notes: notes({ comment: 'ab', savedAt: now }) }));
    // L'autre appareil, plus récent, a changé un autre champ des notes.
    otherDeviceWrites({ notes: notes({ comment: '', conditions: 'là-bas', savedAt: now + 60_000 }) });
    await flush(library);
    expect(disk().notes?.comment).toBe('abc');
    expect(disk().notes?.conditions).toBe('là-bas');
    expect(library.readLibraryState().error ?? '').not.toContain('aussi changé');
  });

  it('écriture refusée : retentée, ce qui a été saisi garde sa priorité sur le disque', async () => {
    putSession();
    const library = await openFresh();
    await settle(library);
    const write = fakeFolder.writeText;
    fakeFolder.writeText = async () => {
      throw new Error('disque plein');
    };
    await writeNow(() => library.updateSessionRecord(GPX, { name: 'Ici' }));
    expect(library.readLibraryState().error).toContain('disque plein');
    fakeFolder.writeText = write;
    otherDeviceWrites({ notes: notes({ comment: 'là-bas', savedAt: 500 }) });
    await flush(library);
    expect(disk().name).toBe('Ici');
    expect(disk().notes?.comment).toBe('là-bas');
  });
});

/** Lance `action` (une saisie) et passe l'écriture différée de la fiche (800 ms), sous horloge simulée. */
async function writeNow(action: () => unknown): Promise<void> {
  await underFakeClock(900, action);
  await tick();
}
