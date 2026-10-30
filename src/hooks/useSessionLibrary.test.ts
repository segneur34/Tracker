import { afterEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, serializeRecord, type SessionRecord } from '../library/record';
import type { MemoryFolder } from '../platform/memoryFolder';
import { createFakeFolder } from '../test/memoryFolder.fixture';

const GPX = '2026-10-27_10-00-00_running.gpx';
const RECORD = '2026-10-27_10-00-00_running.json';
const START_MS = Date.parse('2026-10-27T10:00:00Z');

/** Fichiers du faux dossier, par chemin ; écritures et suppressions relevées dans l'ordre. */
const files = new Map<string, string>();
const log: string[] = [];
/** Suppressions en attente : chacune finit quand on appelle sa fonction. */
const pendingRemovals: (() => void)[] = [];

const fakeFolder: MemoryFolder = createFakeFolder(files, log, {
  remove: (path) =>
    new Promise<void>((resolve) => {
      pendingRemovals.push(() => {
        log.push(`remove ${path}`);
        files.delete(path);
        resolve();
      });
    }),
});

vi.mock('../platform/memoryFolder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
  openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
  pendingFolder: () => null,
}));

const record: SessionRecord = {
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx: GPX,
  sport: 'running',
  activityId: null,
  source: 'enregistrement',
  addedAt: '2026-10-27T11:00:00.000Z',
  title: 'Course, 27/10/2026 10:00',
  name: null,
  summary: {
    calcVersion: SUMMARY_CALC_VERSION,
    startMs: START_MS,
    endMs: START_MS + 600_000,
    distanceM: 1800,
    movingTimeS: 600,
    elevationGainM: null,
    maxSpeedMs: 3,
    pointCount: 601,
    samplingS: 1,
  },
  notes: null,
  analysis: null,
};

afterEach(() => vi.useRealTimers());

describe('removeSession (E-B4)', () => {
  it('ne laisse pas de session fantôme ni de fiche réécrite quand la session change pendant sa suppression', async () => {
    files.set(`sessions/${GPX}`, '<gpx/>');
    files.set(`sessions/${RECORD}`, serializeRecord(record));
    const library = await import('./useSessionLibrary');
    await library.openLibrary();
    expect(library.librarySession(GPX)).toBeDefined();

    vi.useFakeTimers();
    const removal = library.removeSession(GPX);
    // Pendant que le disque efface : une saisie, comme le ferait un recalcul de fond.
    library.updateSessionRecord(GPX, { name: 'Sortie du matin' });
    while (pendingRemovals.length > 0 || log.filter((l) => l.startsWith('remove')).length < 3) {
      pendingRemovals.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    }
    await removal;
    await vi.advanceTimersByTimeAsync(2000);

    expect(library.librarySession(GPX)).toBeUndefined();
    expect(files.has(`sessions/${RECORD}`)).toBe(false);
    expect(log.filter((l) => l.startsWith('write') && l.includes(RECORD))).toHaveLength(0);
  });
});
