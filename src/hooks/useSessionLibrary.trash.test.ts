import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderEntry, MemoryFolder } from '../platform/memoryFolder';
import {
  TRASH_INDEX_PATH, TRASH_KEEP_MS, deletesToTrash, parseTrashIndex, serializeTrashIndex, sessionDiscardText, trashDeleteButton,
  type TrashEntry,
} from '../library/trash';
import { gpxAt, settle, tick, trackTestTimers } from '../test/library.fixture';

/**
 * Corbeille du programme Windows, de la bibliothèque au dossier (élément 217, sous-lot 3a) : une session supprimée y
 * passe au lieu d'être effacée, avec sa fiche et ses capteurs, revient par « Restaurer » ou par un import, et la
 * corbeille est purgée à l'ouverture. Sur un autre dossier que celui du disque (téléphone, navigateur, dossier choisi
 * dans le navigateur), la suppression reste un effacement, aux mêmes textes.
 */

const files = new Map<string, string>();
const dirs = new Set<string>();
const log: string[] = [];
/** Chemins dont la lecture échoue. */
const broken = new Set<string>();
/** Sorte du dossier ouvert. */
const shell = vi.hoisted(() => ({ kind: 'disk' as MemoryFolder['kind'] }));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const addParents = (path: string) => {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
};
const put = (path: string, text: string) => {
  log.push(`write ${path}`);
  addParents(path);
  files.set(path, text);
};

const folder = (): MemoryFolder => ({
  kind: shell.kind,
  label: 'Tracker',
  list: async (dir) => {
    const entries: FolderEntry[] = [];
    const name = (p: string) => p.slice(dir === '' ? 0 : dir.length + 1);
    for (const [p, text] of files) if (parentOf(p) === dir) entries.push({ name: name(p), kind: 'file', size: text.length, mtimeMs: 1 });
    for (const d of dirs) if (parentOf(d) === dir) entries.push({ name: name(d), kind: 'directory', size: 0, mtimeMs: 1 });
    return entries;
  },
  readText: async (path) => {
    if (broken.has(path)) throw new Error('illisible');
    return files.get(path) ?? null;
  },
  writeText: async (path, text) => put(path, text),
  readBytes: async (path) => {
    if (broken.has(path)) throw new Error('illisible');
    return files.has(path) ? encoder.encode(files.get(path)) : null;
  },
  writeBytes: async (path, bytes) => put(path, decoder.decode(bytes)),
  stat: async (path) => (files.has(path) ? { size: files.get(path)!.length, mtimeMs: 1 } : null),
  remove: async (path) => {
    log.push(`remove ${path}`);
    files.delete(path);
  },
  ...(shell.kind === 'disk' ? {
    removeDir: async (path: string) => {
      if ([...files.keys()].some((p) => p.startsWith(`${path}/`))) throw new Error('pas vide');
      dirs.delete(path);
    },
  } : {}),
});

const mockPlatform = (): void => {
  // Pas de `DOMParser` dans l'environnement node : les points des GPX de ce test, lus par expression régulière.
  vi.doMock('../core/gpxParser', async (importOriginal) => ({
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
  vi.doMock('../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: folder() }),
    pendingFolder: () => null,
  }));
};

type Library = typeof import('./useSessionLibrary');

const openFresh = async (): Promise<Library> => {
  vi.resetModules();
  mockPlatform();
  const library = await import('./useSessionLibrary');
  await library.openLibrary();
  await settle(library);
  return library;
};

/** Laisse finir ce qui part sans être attendu (purge, relecture de la corbeille). */
const drain = async (library: Library): Promise<void> => {
  for (let i = 0; i < 50; i++) await tick();
  await settle(library);
};

const FIRST = '2026-10-27_10-00-00_course.gpx';
const SECOND = '2026-10-27_10-30-00_course.gpx';
const GPX = `sessions/${FIRST}`;
const IMU = 'sessions/2026-10-27_10-00-00_course.imu';
const trashFiles = () => [...files.keys()].filter((p) => p.startsWith('corbeille/') && p !== TRASH_INDEX_PATH).sort();
const index = () => parseTrashIndex(files.get(TRASH_INDEX_PATH) ?? null);

let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  stopTestTimers = trackTestTimers();
  files.clear();
  dirs.clear();
  log.length = 0;
  broken.clear();
  shell.kind = 'disk';
  files.set(GPX, gpxAt(0));
  files.set(IMU, 'capteurs');
  files.set(`sessions/${SECOND}`, gpxAt(30));
  addParents(GPX);
});

afterEach(() => {
  stopTestTimers();
});

describe('corbeille du programme Windows', () => {
  it('une session supprimée passe à la corbeille avec sa fiche et ses capteurs, GPX retiré en premier, et ne compte plus', async () => {
    const library = await openFresh();
    const first = library.readLibraryState().sessions.find((s) => s.file === FIRST)!;
    log.length = 0;
    await library.removeSession(first.file);
    await drain(library);
    expect(library.readLibraryState().sessions.map((s) => s.file)).toEqual([SECOND]);
    expect(files.has(GPX)).toBe(false);
    expect(files.has(IMU)).toBe(false);
    const writeIndex = log.indexOf(`write ${TRASH_INDEX_PATH}`);
    expect(writeIndex).toBeGreaterThan(-1);
    expect(log.filter((l) => l.startsWith('remove'))[0]).toBe(`remove ${GPX}`);
    expect(log.indexOf(`remove ${GPX}`)).toBeGreaterThan(writeIndex);
    const [entry] = index().entries;
    expect(entry).toMatchObject({ kind: 'session', startMs: first.record.summary.startMs, origin: 'ordinateur', reason: 'supprimee', main: FIRST });
    expect(trashFiles()).toEqual([
      `corbeille/${entry.dir}/2026-10-27_10-00-00_course.gpx`, `corbeille/${entry.dir}/2026-10-27_10-00-00_course.imu`,
      `corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`,
    ]);
    expect(files.get(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.imu`)).toBe('capteurs');
    expect(library.trashStore.get().entries).toEqual([entry]);
  });

  it('une saisie pas encore écrite part avec la session', async () => {
    const library = await openFresh();
    library.updateSessionRecord(FIRST, { name: 'Sortie du matin' });
    await library.removeSession(FIRST);
    await drain(library);
    const [entry] = index().entries;
    expect(entry.name).toBe('Sortie du matin');
    expect(JSON.parse(files.get(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`)!).name).toBe('Sortie du matin');
  });

  it('« Restaurer » la ramène avec sa fiche et ses capteurs ; « Supprimer définitivement » et « Vider » effacent', async () => {
    const library = await openFresh();
    library.updateSessionRecord(FIRST, { name: 'Sortie du matin' });
    await library.removeSession(FIRST);
    await drain(library);
    const [entry] = library.trashStore.get().entries;
    expect(await library.restoreFromTrash(entry)).toBe('« Sortie du matin » est revenue dans la mémoire.');
    await drain(library);
    expect(library.readLibraryState().sessions.map((s) => s.file).sort()).toEqual([FIRST, SECOND]);
    expect(files.get(GPX)).toBe(gpxAt(0));
    expect(files.get(IMU)).toBe('capteurs');
    expect(library.readLibraryState().sessions.find((s) => s.file === FIRST)?.record.name).toBe('Sortie du matin');
    expect(index().entries).toEqual([]);
    expect(trashFiles()).toEqual([]);
    expect(library.trashStore.get().entries).toEqual([]);

    await library.removeSession(FIRST);
    await library.removeSession(SECOND);
    await drain(library);
    expect(library.trashStore.get().entries).toHaveLength(2);
    await library.deleteFromTrash(library.trashStore.get().entries[0]);
    expect(library.trashStore.get().entries).toHaveLength(1);
    await library.emptyWholeTrash();
    expect(library.trashStore.get().entries).toEqual([]);
    expect(trashFiles()).toEqual([]);
    expect(library.readLibraryState().sessions).toEqual([]);
  });

  it('une session revenue par un import quitte la corbeille', async () => {
    const library = await openFresh();
    await library.removeSession(FIRST);
    await drain(library);
    expect(library.trashStore.get().entries).toHaveLength(1);
    const text = gpxAt(0);
    await library.importEntries([{ name: 'reprise.gpx', key: 'reprise', readText: async () => text, readBytes: async () => encoder.encode(text) }]);
    await drain(library);
    expect(library.readLibraryState().sessions).toHaveLength(2);
    expect(library.trashStore.get().entries).toEqual([]);
    expect(index().entries).toEqual([]);
  });

  it('un itinéraire supprimé passe à la corbeille, fiche puis GPX', async () => {
    const library = await openFresh();
    files.set('itineraires/Lac.json', '{"fiche":1}');
    files.set('itineraires/Lac.gpx', '<gpx/>');
    const f = (await library.currentMemoryFolder())!;
    await library.stashRoute(f, { base: 'Lac', name: 'Tour du lac', createdAt: '2026-11-01T10:00:00.000Z' }, ['itineraires/Lac.json', 'itineraires/Lac.gpx'], 'itineraires/Lac.json');
    const [entry] = index().entries;
    expect(entry).toMatchObject({ kind: 'itineraire', routeBase: 'Lac', name: 'Tour du lac', main: 'Lac.json' });
    expect(trashFiles()).toEqual([`corbeille/${entry.dir}/Lac.gpx`, `corbeille/${entry.dir}/Lac.json`]);
    for (const p of ['itineraires/Lac.json', 'itineraires/Lac.gpx']) files.delete(p);
    expect(await library.restoreFromTrash(entry)).toBe('« Tour du lac » est revenu dans les itinéraires.');
    expect(files.get('itineraires/Lac.json')).toBe('{"fiche":1}');
    expect(files.get('itineraires/Lac.gpx')).toBe('<gpx/>');
    expect(index().entries).toEqual([]);
  });

  it("purge à l'ouverture : plus de 30 jours effacé, le reste et un dossier posé à la main gardés", async () => {
    const now = Date.now();
    const entry = (dir: string, deletedAtMs: number): TrashEntry => ({
      dir, kind: 'session', startMs: 1, routeBase: null, createdAt: null, name: 'Course', deletedAtMs, origin: 'ordinateur', reason: 'supprimee',
      main: 'x.gpx', files: [{ name: 'x.gpx', size: 3 }],
    });
    files.set(TRASH_INDEX_PATH, serializeTrashIndex([entry('1763000000000-vieille', now - TRASH_KEEP_MS - 60_000), entry('1763000000001-recente', now - 60_000)]));
    for (const p of ['corbeille/1763000000000-vieille/x.gpx', 'corbeille/1763000000001-recente/x.gpx', 'corbeille/photos/a.jpg']) {
      files.set(p, 'x');
      addParents(p);
    }
    const library = await openFresh();
    await drain(library);
    expect(index().entries.map((e) => e.dir)).toEqual(['1763000000001-recente']);
    expect(trashFiles()).toEqual(['corbeille/1763000000001-recente/x.gpx', 'corbeille/photos/a.jpg']);
    expect(dirs.has('corbeille/1763000000000-vieille')).toBe(false);
    expect(library.trashStore.get().entries.map((e) => e.dir)).toEqual(['1763000000001-recente']);
    // Les sessions de la corbeille ne sont jamais lues comme des sessions.
    expect(library.readLibraryState().sessions.map((s) => s.file).sort()).toEqual([FIRST, SECOND]);
  });

  it('corbeille illisible : la suppression est refusée, rien ne part, et c’est dit', async () => {
    files.set(TRASH_INDEX_PATH, '{abîmé');
    const library = await openFresh();
    await drain(library);
    expect(library.trashStore.get().error).toContain('ne se lit pas');
    await library.removeSession(FIRST);
    await drain(library);
    expect(files.get(GPX)).toBe(gpxAt(0));
    expect(library.readLibraryState().sessions).toHaveLength(2);
    expect(library.readLibraryState().error).toContain('Suppression impossible');
  });

  it.each(['device', 'browser', 'picked'] as const)('mémoire « %s » (téléphone, navigateur) : la suppression efface comme avant, sans corbeille, aux mêmes textes', async (kind) => {
    shell.kind = kind;
    const library = await openFresh();
    const { folderKind, memoryReadOnly } = library.readLibraryState();
    expect(folderKind).toBe(kind);
    const toTrash = deletesToTrash(folderKind, memoryReadOnly);
    expect(toTrash).toBe(false);
    expect(trashDeleteButton(toTrash, 'Confirmer')).toBe('Confirmer');
    expect(trashDeleteButton(toTrash, 'Jeter définitivement')).toBe('Jeter définitivement');
    expect(sessionDiscardText(toTrash, 'phrase de toujours')).toBe('phrase de toujours');
    log.length = 0;
    await library.removeSession(FIRST);
    await drain(library);
    expect(log.filter((l) => l.startsWith('remove'))).toEqual([
      `remove ${GPX}`, 'remove sessions/2026-10-27_10-00-00_course.json', `remove ${IMU}`,
    ]);
    expect(log.some((l) => l.includes('corbeille'))).toBe(false);
    expect([...files.keys()].some((p) => p.startsWith('corbeille/'))).toBe(false);
    expect(library.trashStore.get().entries).toEqual([]);
    // Un itinéraire non plus n'y passe pas.
    const f = (await library.currentMemoryFolder())!;
    await library.stashRoute(f, { base: 'Lac', name: 'Lac', createdAt: 'x' }, ['itineraires/Lac.json'], 'itineraires/Lac.json');
    expect([...files.keys()].some((p) => p.startsWith('corbeille/'))).toBe(false);
  });

  it('dossier du disque : la confirmation promet la corbeille, que la suppression tient', async () => {
    const library = await openFresh();
    const { folderKind, memoryReadOnly } = library.readLibraryState();
    expect(trashDeleteButton(deletesToTrash(folderKind, memoryReadOnly), 'Confirmer')).toBe('Mettre à la corbeille (30 jours)');
  });
});

describe('session de la corbeille qui revient par un import (programme Windows)', () => {
  const gpxEntry = (text = gpxAt(0)) => ({ name: 'reprise.gpx', key: 'reprise', readText: async () => text, readBytes: async () => encoder.encode(text) });
  const recordEntry = (text: string) => ({ name: 'reprise.json', key: 'reprise', readText: async () => text, readBytes: async () => encoder.encode(text) });

  /** Session nommée et notée, supprimée vers la corbeille : la bibliothèque, et sa fiche telle qu'elle était. */
  const deletedWithNotes = async (): Promise<{ library: Library; record: string }> => {
    const library = await openFresh();
    library.updateSessionRecord(FIRST, { name: 'Sortie du matin', notes: { comment: 'Genou à surveiller' } as never });
    await library.removeSession(FIRST);
    await drain(library);
    const [entry] = index().entries;
    return { library, record: files.get(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`)! };
  };

  it('en simple GPX : elle reprend la fiche et les capteurs de la corbeille, puis seulement l’entrée part', async () => {
    const { library } = await deletedWithNotes();
    await library.importEntries([gpxEntry()]);
    await drain(library);
    const back = library.readLibraryState().sessions.find((s) => s.record.summary.startMs === Date.UTC(2026, 9, 27, 10, 0, 0))!;
    expect(back.record.name).toBe('Sortie du matin');
    expect(back.record.notes?.comment).toBe('Genou à surveiller');
    expect(JSON.parse(files.get(`sessions/${back.file}`.replace(/\.gpx$/, '.json'))!).notes.comment).toBe('Genou à surveiller');
    expect(files.get(`sessions/${back.file}`.replace(/\.gpx$/, '.imu'))).toBe('capteurs');
    expect(index().entries).toEqual([]);
    expect(trashFiles()).toEqual([]);
  });

  it('par « Récupérer » (import sans bruit), même règle', async () => {
    const { library } = await deletedWithNotes();
    await library.importEntries([gpxEntry()], { quiet: true });
    await drain(library);
    const back = library.readLibraryState().sessions.find((s) => s.record.summary.startMs === Date.UTC(2026, 9, 27, 10, 0, 0))!;
    expect(back.record.notes?.comment).toBe('Genou à surveiller');
    expect(index().entries).toEqual([]);
  });

  it('avec sa propre fiche : elle prime, les capteurs viennent de la corbeille, et l’entrée part', async () => {
    const { library, record } = await deletedWithNotes();
    const own = JSON.stringify({ ...JSON.parse(record), name: 'Nom du téléphone', notes: null });
    await library.importEntries([gpxEntry(), recordEntry(own)]);
    await drain(library);
    const back = library.readLibraryState().sessions.find((s) => s.record.summary.startMs === Date.UTC(2026, 9, 27, 10, 0, 0))!;
    expect(back.record.name).toBe('Nom du téléphone');
    expect(files.get(`sessions/${back.file}`.replace(/\.gpx$/, '.imu'))).toBe('capteurs');
    expect(index().entries).toEqual([]);
  });

  it('fiche de la corbeille illisible : la session revient avec elle, gardée telle quelle', async () => {
    const { library } = await deletedWithNotes();
    const [entry] = index().entries;
    files.set(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`, '{abîmé');
    await library.importEntries([gpxEntry()]);
    await drain(library);
    const back = library.readLibraryState().sessions.find((x) => x.record.summary.startMs === Date.UTC(2026, 9, 27, 10, 0, 0));
    expect(files.get(`sessions/${back!.file}`.replace(/\.gpx$/, '.json'))).toBe('{abîmé');
    expect(index().entries).toEqual([]);
  });

  it('entrée qui ne se lit pas : la session entre, l’entrée reste dans la corbeille', async () => {
    const { library } = await deletedWithNotes();
    const [entry] = index().entries;
    broken.add(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`);
    await library.importEntries([gpxEntry()]);
    await drain(library);
    expect(library.readLibraryState().sessions).toHaveLength(2);
    expect(index().entries.map((e) => e.dir)).toEqual([entry.dir]);
    expect(files.get(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.json`)).toContain('Genou à surveiller');
  });

  it('import du dossier mémoire lui-même : sa corbeille n’est pas réimportée', async () => {
    const library = await openFresh();
    await library.removeSession(FIRST);
    await drain(library);
    const [entry] = index().entries;
    const picked = (path: string, text: string): File => {
      const file = new File([text], path.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: path });
      return file;
    };
    await library.importFiles([
      picked(`Tracker/corbeille/${entry.dir}/2026-10-27_10-00-00_course.gpx`, files.get(`corbeille/${entry.dir}/2026-10-27_10-00-00_course.gpx`)!),
      picked(`Tracker/sessions/${SECOND}`, files.get(`sessions/${SECOND}`)!),
    ]);
    await drain(library);
    expect(library.readLibraryState().sessions.map((s) => s.file)).toEqual([SECOND]);
    expect(index().entries).toHaveLength(1);
  });
});
