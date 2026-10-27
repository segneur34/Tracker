import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';

/**
 * Bibliothèque sur un faux dossier (lot 3 de la revue du 27/10) : import sans
 * dossier, import d'un dossier fichier par fichier, ordre de suppression,
 * fiche non écrite tenue hors du cache.
 */

const gpxAt = (minute: number): string =>
  '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
  + [0, 10, 20].map((s, i) =>
    `<trkpt lat="${43.6 + i * 0.0003}" lon="3.8"><time>2026-10-27T10:${String(minute).padStart(2, '0')}:${String(s).padStart(2, '0')}Z</time></trkpt>`).join('')
  + '</trkseg></trk></gpx>';

/** Fichiers du faux dossier, par chemin ; lectures, écritures et suppressions relevées dans l'ordre. */
const files = new Map<string, string>();
const log: string[] = [];
/** Chemins dont l'écriture échoue. */
const refused = new Set<string>();
let access: 'ready' | 'unavailable' = 'ready';
const pendingWrites: string[] = [];

const entriesOf = (dir: string): FolderEntry[] =>
  [...files.keys()]
    .filter((path) => (dir === '' ? !path.includes('/') : path.startsWith(`${dir}/`)))
    .map((path) => ({ name: dir === '' ? path : path.slice(dir.length + 1), kind: 'file' as const, size: files.get(path)!.length, mtimeMs: 1 }));

const fakeFolder: MemoryFolder = {
  kind: 'picked',
  label: 'Tracker',
  list: async (dir) => entriesOf(dir),
  readText: async (path) => files.get(path) ?? null,
  writeText: async (path, text) => {
    if (refused.has(path)) throw new Error('écriture refusée');
    log.push(`write ${path}`);
    files.set(path, text);
  },
  readBytes: async () => null,
  writeBytes: async (path) => {
    log.push(`write ${path}`);
    files.set(path, 'imu');
  },
  remove: async (path) => {
    log.push(`remove ${path}`);
    files.delete(path);
  },
};

const fakePending: MemoryFolder = {
  ...fakeFolder,
  kind: 'device',
  label: 'en attente',
  list: async () => [],
  writeText: async (path) => {
    pendingWrites.push(path);
  },
  writeBytes: async (path) => {
    pendingWrites.push(path);
  },
};

// Pas de `DOMParser` dans l'environnement node : les points des GPX de ce test, lus par expression régulière.
vi.mock('../core/gpxParser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/gpxParser')>()),
  parseGpx: (text: string) => {
    if (!text.includes('<gpx')) throw new Error('GPX illisible');
    return {
      rawPoints: [...text.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"><time>([^<]+)<\/time>/g)]
        .map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), time: m[3] })),
      trackType: 'running',
      hasDeviceSpeed: false,
    };
  },
}));

vi.mock('../platform/memoryFolder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
  openMemoryFolder: async () => (access === 'ready' ? { state: 'ready', folder: fakeFolder } : { state: 'unavailable', reason: 'aucun dossier' }),
  pendingFolder: () => fakePending,
}));

const openFresh = async () => {
  vi.resetModules();
  const library = await import('./useSessionLibrary');
  await library.openLibrary();
  return library;
};

/** Attend la fin du balayage de fond lancé à l'ouverture. */
const settle = async (library: typeof import('./useSessionLibrary')) => {
  for (let i = 0; i < 50 && library.readLibraryState().scanning !== null; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  files.clear();
  log.length = 0;
  refused.clear();
  pendingWrites.length = 0;
  access = 'ready';
});

describe('import sans dossier mémoire (E-B2, décision du 27/10 : refusé)', () => {
  it("ne met rien en attente et refuse l'import", async () => {
    access = 'unavailable';
    const library = await openFresh();
    expect(library.canImportSessions(library.readLibraryState())).toBe(false);
    const report = await library.importFiles([new File([gpxAt(0)], 'sortie.gpx')]);
    expect(report.unsaved).toBe(1);
    expect(report.added).toHaveLength(0);
    expect(pendingWrites).toHaveLength(0);
  });
});

describe("import d'un dossier (E-B1)", () => {
  it('lit chaque session juste avant de la ranger, jamais tout le dossier d’abord', async () => {
    const library = await openFresh();
    await settle(library);
    log.length = 0;
    const entry = (name: string, text: string) => ({
      name,
      key: name.replace('.gpx', ''),
      readText: async () => {
        log.push(`read ${name}`);
        return text;
      },
      readBytes: async () => new Uint8Array(),
    });
    const report = await library.importEntries([
      entry('a.gpx', gpxAt(0)),
      entry('b.gpx', gpxAt(30)),
    ]);
    expect(report.added).toHaveLength(2);
    const reads = log.map((l, i) => [l, i] as const).filter(([l]) => l.startsWith('read'));
    const firstWrite = log.findIndex((l) => l.startsWith('write sessions/'));
    // La première session est rangée avant que la seconde ne soit lue.
    expect(reads.map(([l]) => l)).toEqual(['read a.gpx', 'read b.gpx']);
    expect(firstWrite).toBeLessThan(reads[1][1]);
  });
});

describe('suppression (E-B9)', () => {
  it('retire le GPX d’abord : un échec ensuite ne ressuscite pas la session sans ses notes', async () => {
    const library = await openFresh();
    await settle(library);
    await library.importFiles([new File([gpxAt(0)], 'sortie.gpx')]);
    const file = library.readLibraryState().sessions[0].file;
    log.length = 0;
    await library.removeSession(file);
    expect(log.filter((l) => l.startsWith('remove'))[0]).toBe(`remove sessions/${file}`);
  });
});

describe('fiche non écrite (E-B10)', () => {
  it("n'entre pas dans le cache des fiches", async () => {
    const library = await openFresh();
    await settle(library);
    await library.importFiles([new File([gpxAt(0)], 'sortie.gpx')]);
    const file = library.readLibraryState().sessions[0].file;
    const recordPath = `sessions/${file.replace(/\.gpx$/, '.json')}`;
    refused.add(recordPath);
    vi.useFakeTimers();
    library.updateSessionRecord(file, { name: 'Matin' });
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    // Un import vide reconstruit le cache.
    await library.importFiles([]);
    await new Promise((r) => setTimeout(r, 0));
    const { jsonStore } = await import('../platform/storage');
    const cache = jsonStore.read<{ entries: Record<string, unknown> }>('tracker.libraryCache');
    expect(cache?.entries[file.replace(/\.gpx$/, '.json')]).toBeUndefined();
  });
});
