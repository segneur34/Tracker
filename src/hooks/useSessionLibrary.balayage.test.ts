import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibrarySession } from '../library/record';
import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';

/**
 * Balayage de la bibliothèque sur un faux dossier de 300 sessions (lot 68) :
 * publications groupées au rythme du compteur, aucune session perdue ni
 * doublée pendant le balayage, saisies et suppressions gardées, cache des
 * fiches mis à jour une seconde après un import ou une suppression.
 * `MESURE=1` affiche le nombre de publications, de notifications et la durée.
 */

const SESSION_COUNT = 300;
const START_MS = Date.parse('2026-10-27T06:00:00Z');

/** Publications de la liste (appels de `dedupeSessions`) et notifications des abonnés de la bibliothèque. */
const counters = vi.hoisted(() => ({ published: [] as LibrarySession[][], notifications: 0 }));

vi.mock('../library/record', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../library/record')>();
  return {
    ...actual,
    dedupeSessions: (sessions: LibrarySession[]) => {
      const result = actual.dedupeSessions(sessions);
      counters.published.push(result.kept);
      return result;
    },
  };
});

vi.mock('./createStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./createStore')>();
  return {
    ...actual,
    createListeners: () => {
      const listeners = actual.createListeners();
      return {
        ...listeners,
        notify: () => {
          counters.notifications += 1;
          listeners.notify();
        },
      };
    },
  };
});

/** GPX de trois points, à 10 s d'écart, parti `index` minutes après `START_MS`. */
const gpxAt = (index: number): string =>
  '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
  + [0, 10, 20].map((s, i) =>
    `<trkpt lat="${43.6 + i * 0.0003}" lon="3.8"><time>${new Date(START_MS + index * 60_000 + s * 1000).toISOString()}</time></trkpt>`).join('')
  + '</trkseg></trk></gpx>';

const gpxName = (index: number): string => `s${String(index).padStart(3, '0')}.gpx`;

/** Fichiers du faux dossier, par chemin. */
const files = new Map<string, string>();

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
    files.set(path, text);
  },
  readBytes: async () => null,
  writeBytes: async (path) => {
    files.set(path, 'imu');
  },
  remove: async (path) => {
    files.delete(path);
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
  openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
  pendingFolder: () => null,
}));

/** Stockage de l'appareil, gardé d'une ouverture à l'autre : le cache des fiches y survit. */
const stored = new Map<string, string>();
const CACHE_KEY = 'tracker.libraryCache';

type Library = typeof import('./useSessionLibrary');

const openFresh = async (): Promise<Library> => {
  vi.resetModules();
  const library = await import('./useSessionLibrary');
  await library.openLibrary();
  return library;
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Attend la fin du balayage de fond, au plus 20 000 tours. */
const settle = async (library: Library): Promise<void> => {
  for (let i = 0; i < 20_000 && library.readLibraryState().scanning !== null; i++) await tick();
  await tick();
};

const resetCounters = (): void => {
  counters.published.length = 0;
  counters.notifications = 0;
};

/** Mesure d'un scénario, affichée si `MESURE=1`. */
const measure = async (label: string, run: () => Promise<void>): Promise<{ ms: number; published: LibrarySession[][] }> => {
  resetCounters();
  const t0 = performance.now();
  await run();
  const ms = performance.now() - t0;
  if (import.meta.env.MESURE === '1') {
    console.log(`${label} : ${counters.published.length} publications, ${counters.notifications} notifications, ${Math.round(ms)} ms`);
  }
  return { ms, published: [...counters.published] };
};

/** Publications au plus : une au compteur toutes les 250 ms, plus celles d'ouverture et de fin. */
const publicationBound = (ms: number): number => Math.ceil(ms / 250) + 3;

const putGpxFiles = (): void => {
  for (let i = 0; i < SESSION_COUNT; i++) files.set(`sessions/${gpxName(i)}`, gpxAt(i));
};

/** Ouvre une mémoire de 300 sessions à fiche à jour, depuis son cache : sessions allégées (`partial`). */
const openFromCache = async (): Promise<Library> => {
  putGpxFiles();
  await settle(await openFresh());
  const library = await openFresh();
  await settle(library);
  return library;
};

/** Résumés périmés, dans les fiches du disque et dans le cache, comme après une hausse de `SUMMARY_CALC_VERSION`. */
const makeSummariesStale = (): void => {
  for (const [path, text] of files) {
    if (!path.startsWith('sessions/') || !path.endsWith('.json')) continue;
    const record = JSON.parse(text);
    record.summary.calcVersion -= 1;
    files.set(path, JSON.stringify(record, null, 2));
  }
  const cache = JSON.parse(stored.get(CACHE_KEY)!);
  for (const [name, entry] of Object.entries<{ size: number; record: { summary: { calcVersion: number } } }>(cache.entries)) {
    entry.record.summary.calcVersion -= 1;
    entry.size = files.get(`sessions/${name}`)!.length;
  }
  stored.set(CACHE_KEY, JSON.stringify(cache));
};

const expectWhole = (list: LibrarySession[], count: number): void => {
  expect(list).toHaveLength(count);
  expect(new Set(list.map((s) => s.file)).size).toBe(count);
  expect(new Set(list.map((s) => s.record.summary.startMs)).size).toBe(count);
};

/** Sessions sans leur état de lecture (`partial`) : ce qu'une réouverture doit retrouver. */
const comparable = (sessions: LibrarySession[]): string =>
  JSON.stringify(sessions.map(({ partial: _partial, ...rest }) => rest));

beforeEach(() => {
  files.clear();
  stored.clear();
  resetCounters();
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('balayage de 300 GPX sans fiche (scénario A)', () => {
  it('ne fait que grandir la liste, en publications bornées, et finit comme une réouverture', async () => {
    putGpxFiles();
    let library: Library | null = null;
    const { ms, published } = await measure('A, 300 GPX sans fiche', async () => {
      library = await openFresh();
      await settle(library);
    });
    const lib = library as unknown as Library;
    for (let i = 1; i < published.length; i++) expect(published[i].length).toBeGreaterThanOrEqual(published[i - 1].length);
    expectWhole(lib.readLibraryState().sessions, SESSION_COUNT);
    expect(published.length).toBeLessThanOrEqual(publicationBound(ms));

    const after = comparable(lib.readLibraryState().sessions);
    stored.delete(CACHE_KEY);
    const reopened = await openFresh();
    await settle(reopened);
    expect(comparable(reopened.readLibraryState().sessions)).toBe(after);
  }, 60_000);
});

describe('résumés périmés de 300 fiches en cache (scénario B, « Mettre à jour »)', () => {
  it('publie toujours les 300 sessions, sans doublon, en publications bornées', async () => {
    const library = await openFromCache();
    makeSummariesStale();
    const { ms, published } = await measure('B, 300 résumés périmés', () => library.refreshLibrary());
    expect(published.length).toBeGreaterThan(0);
    for (const list of published) expectWhole(list, SESSION_COUNT);
    expect(published.length).toBeLessThanOrEqual(publicationBound(ms));
    const { SUMMARY_CALC_VERSION } = await import('../library/record');
    expect(library.readLibraryState().sessions.every((s) => s.record.summary.calcVersion === SUMMARY_CALC_VERSION)).toBe(true);

    const after = comparable(library.readLibraryState().sessions);
    stored.delete(CACHE_KEY);
    const reopened = await openFresh();
    await settle(reopened);
    expect(comparable(reopened.readLibraryState().sessions)).toBe(after);
  }, 60_000);

  it('garde un nom saisi pendant le balayage, fiche traitée ou non, en liste et sur le disque', async () => {
    const library = await openFromCache();
    const { SUMMARY_CALC_VERSION } = await import('../library/record');
    makeSummariesStale();
    const refresh = library.refreshLibrary();
    for (let i = 0; i < 20_000 && (library.readLibraryState().scanning?.done ?? 0) < SESSION_COUNT / 3; i++) await tick();
    const all = Array.from({ length: SESSION_COUNT }, (_, i) => library.librarySession(gpxName(i))!);
    const done = all.find((s) => s.record.summary.calcVersion === SUMMARY_CALC_VERSION)!;
    const waiting = all.find((s) => s.record.summary.calcVersion < SUMMARY_CALC_VERSION)!;
    expect(done).toBeDefined();
    expect(waiting).toBeDefined();
    library.updateSessionRecord(done.file, { name: 'Traitée' });
    library.updateSessionRecord(waiting.file, { name: 'En attente' });
    await refresh;
    // Écritures différées des fiches (800 ms).
    await new Promise((r) => setTimeout(r, 1000));
    for (const [file, name] of [[done.file, 'Traitée'], [waiting.file, 'En attente']]) {
      expect(library.readLibraryState().sessions.find((s) => s.file === file)?.record.name).toBe(name);
      const disk = JSON.parse(files.get(`sessions/${file.replace(/\.gpx$/, '.json')}`)!);
      expect(disk.name).toBe(name);
      expect(disk.summary.calcVersion).toBe(SUMMARY_CALC_VERSION);
    }
  }, 60_000);

  it("ne fait pas revenir une session supprimée pendant le balayage", async () => {
    const library = await openFromCache();
    makeSummariesStale();
    const refresh = library.refreshLibrary();
    for (let i = 0; i < 20_000 && (library.readLibraryState().scanning?.done ?? 0) < SESSION_COUNT / 3; i++) await tick();
    const waiting = gpxName(SESSION_COUNT - 1);
    await library.removeSession(waiting);
    await refresh;
    expect(library.librarySession(waiting)).toBeUndefined();
    expect(library.readLibraryState().sessions.some((s) => s.file === waiting)).toBe(false);
    expectWhole(library.readLibraryState().sessions, SESSION_COUNT - 1);
    expect(files.has(`sessions/${waiting}`)).toBe(false);
    expect(files.has(`sessions/${waiting.replace(/\.gpx$/, '.json')}`)).toBe(false);
  }, 60_000);
});

describe('cache des fiches après un import et une suppression', () => {
  const COUNT = 10;
  const readCache = (): Record<string, unknown> => JSON.parse(stored.get(CACHE_KEY)!).entries;

  it("n'écrit qu'une seconde après, l'entrée touchée seulement", async () => {
    for (let i = 0; i < COUNT; i++) files.set(`sessions/${gpxName(i)}`, gpxAt(i));
    const library = await openFresh();
    await settle(library);
    const before = readCache();
    expect(Object.keys(before)).toHaveLength(COUNT);
    const raw = stored.get(CACHE_KEY);

    vi.useFakeTimers();
    const report = await library.importFiles([new File([gpxAt(COUNT)], 'nouvelle.gpx')]);
    const added = report.added[0].replace(/\.gpx$/, '.json');
    await vi.advanceTimersByTimeAsync(999);
    expect(stored.get(CACHE_KEY)).toBe(raw);
    await vi.advanceTimersByTimeAsync(1);
    const afterImport = readCache();
    expect(afterImport[added]).toBeDefined();
    for (const [name, entry] of Object.entries(before)) expect(JSON.stringify(afterImport[name])).toBe(JSON.stringify(entry));
    expect(Object.keys(afterImport)).toHaveLength(COUNT + 1);

    const removed = gpxName(0);
    await library.removeSession(removed);
    await vi.advanceTimersByTimeAsync(1000);
    const afterRemoval = readCache();
    expect(afterRemoval[removed.replace(/\.gpx$/, '.json')]).toBeUndefined();
    for (const [name, entry] of Object.entries(afterImport)) {
      if (name !== removed.replace(/\.gpx$/, '.json')) expect(JSON.stringify(afterRemoval[name])).toBe(JSON.stringify(entry));
    }
  }, 60_000);
});
