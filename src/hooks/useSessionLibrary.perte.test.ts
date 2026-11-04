import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FORMAT, RECORD_READER_VERSION, SUMMARY_CALC_VERSION, serializeRecord, type SessionRecord } from '../library/record';
import { bundleSessionGpx } from '../library/sessionBundle';
import type { MemoryFolder } from '../platform/memoryFolder';
import type { SessionTest } from '../recording/fitnessTest';
import { sessionFileName } from '../recording/session';
import { gpxAt, settle, tick, trackTestTimers, underFakeClock } from '../test/library.fixture';
import { createFakeFolder } from '../test/memoryFolder.fixture';

/**
 * Bibliothèque sur une mémoire simulée (lot 116, « ne plus perdre de données ») : session
 * enregistrée sans dossier, fiche dont l'écriture échoue, coupure entre le GPX et sa fiche,
 * fiche illisible sur le disque, cache d'une autre liste de champs, fiche d'une version plus
 * récente importée ou recopiée, relecture en échec dite au compte rendu.
 */

const startOf = (minute: number): number => Date.parse(`2026-10-27T10:${String(minute).padStart(2, '0')}:00Z`);

/** Fichiers du dossier mémoire, par chemin ; écritures et suppressions relevées dans l'ordre (`log`). */
const files = new Map<string, string>();
const log: string[] = [];
/** Chemins dont l'écriture échoue. */
const refused = new Set<string>();
/** Chemins dont la lecture lève (accès refusé). */
const readRefused = new Set<string>();
/** Écritures du dossier mémoire retenues jusqu'à ce que la promesse se résolve (écriture en vol). */
let writeGate: Promise<void> | null = null;
/** Lecture du marqueur du dossier retenue jusqu'à ce que la promesse se résolve ; `markerAsked` : elle a commencé. */
let markerGate: Promise<void> | null = null;
let markerAsked = false;

const memoryFolder = (store: Map<string, string>, label: string, kind: MemoryFolder['kind'] = 'picked'): MemoryFolder => createFakeFolder(
  store,
  log,
  {
    kind,
    label,
    readText: async (path) => {
      if (store === files && readRefused.has(path)) throw new Error('accès refusé');
      if (store === files && path === 'tracker.json' && markerGate) {
        markerAsked = true;
        await markerGate;
      }
      return store.get(path) ?? null;
    },
    writeText: async (path, text) => {
      if (store === files && writeGate) await writeGate;
      if (store === files && refused.has(path)) throw new Error('écriture refusée');
      log.push(`write ${path}`);
      store.set(path, text);
    },
    writeBytes: async (path) => {
      log.push(`write ${path}`);
      store.set(path, 'imu');
    },
  },
  (path) => store.get(path)!.length,
);

const fakeFolder = memoryFolder(files, 'Tracker');

/** Second dossier, désigné par « Choisir un dossier » (`chosen`). */
const otherFiles = new Map<string, string>();
const otherFolder = memoryFolder(otherFiles, 'Autre');

/** Mémoire du navigateur, ouverte au lieu du dossier quand `opened` le dit. */
const browserFiles = new Map<string, string>();
const browserFolder = memoryFolder(browserFiles, 'mémoire du navigateur', 'browser');

/** Dossier privé des sessions en attente : textes et octets, écritures relevées « pending write … ». */
const pendingFiles = new Map<string, string>();
const pendingBytes = new Map<string, Uint8Array>();
/** Noms du dossier en attente dont la lecture des octets lève (capteurs là mais illisibles). */
const pendingReadRefused = new Set<string>();

const fakePending: MemoryFolder = createFakeFolder(pendingFiles, log, {
  kind: 'device',
  label: 'en attente',
  writeText: async (path, text) => {
    log.push(`pending write ${path}`);
    pendingFiles.set(path, text);
  },
  writeBytes: async (path, bytes) => {
    log.push(`pending write ${path}`);
    pendingFiles.set(path, 'imu');
    pendingBytes.set(path, bytes);
  },
  readBytes: async (path) => {
    if (pendingReadRefused.has(path)) throw new Error('trop gros');
    return pendingBytes.get(path) ?? null;
  },
  remove: async (path) => {
    log.push(`pending remove ${path}`);
    pendingFiles.delete(path);
    pendingBytes.delete(path);
  },
});

/** Mémoire ouverte par `openLibrary` : le dossier, celle du navigateur, aucune, ou le dossier dont l'accès est à redonner. */
let opened: 'folder' | 'browser' | 'none' | 'permission' = 'folder';
/** Dossier rendu par « Choisir un dossier » (`chosen`) et par « Choisir à nouveau le dossier » (`reconnected`). */
let chosen: MemoryFolder | null = null;
let reconnected: MemoryFolder | null = null;

/** Modules simulés, refaits après chaque `vi.resetModules()` : un `vi.mock` posé une fois survivrait à `resetModules`. */
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
    openMemoryFolder: async () => (
      opened === 'folder' ? { state: 'ready', folder: fakeFolder }
        : opened === 'browser' ? { state: 'ready', folder: browserFolder }
          : opened === 'permission' ? { state: 'needs-permission', label: 'Tracker' }
            : { state: 'unavailable', reason: 'aucun dossier' }
    ),
    chooseMemoryFolder: async () => chosen,
    reconnectMemoryFolder: async () => reconnected,
    forgetChosenFolder: async () => undefined,
    pendingFolder: () => fakePending,
  }));
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

/** Lance `action` puis passe les écritures différées des fiches (800 ms), sous horloge simulée. */
const afterWrites = (action?: () => unknown): Promise<void> => underFakeClock(900, action);

const recordOf = (store: Map<string, string>, gpx: string): Record<string, unknown> =>
  JSON.parse(store.get(`sessions/${gpx.replace(/\.gpx$/, '.json')}`)!);

/** Stockage de l'appareil, gardé d'une ouverture à l'autre : le cache des fiches y survit. */
const stored = new Map<string, string>();
const CACHE_KEY = 'tracker.libraryCache';

beforeEach(() => {
  for (const map of [files, otherFiles, browserFiles, pendingFiles, stored]) map.clear();
  pendingBytes.clear();
  pendingReadRefused.clear();
  log.length = 0;
  refused.clear();
  readRefused.clear();
  opened = 'folder';
  chosen = null;
  reconnected = null;
  writeGate = null;
  markerGate = null;
  markerAsked = false;
  vi.stubGlobal('localStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Ce que l'enregistrement apporte à la fiche et que le GPX ne dit pas. */
const START = startOf(0);
const INTERVALS = [{
  workout: { reps: 1, workS: 10, restS: 5 },
  laps: [{ kind: 'travail' as const, rep: 1, startMs: START, endMs: START + 10_000 }],
}];
const MARKS = [{ timeMs: START + 10_000, lat: 43.6003, lon: 3.8, label: 'Bouée' }];
const TEST: SessionTest = {
  protocol: 'fc-max',
  version: 1,
  settings: { warmupS: 480, age: 35, ageSource: 'profil', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
  startMs: START,
  rampStartMs: START + 5_000,
  v0Ms: 2.5,
  steps: [{ startMs: START + 5_000, targetMs: 2.5 }],
  rampEndMs: null,
  dropMs: null,
  endReason: null,
  endMs: null,
  signals: [{ t: START, s: 'debut' }],
};

const expectRecordingFields = (record: Record<string, unknown> | undefined): void => {
  expect(record?.activityId).toBe('a-marche');
  expect(record?.marks).toEqual(MARKS);
  expect(record?.intervals).toEqual(INTERVALS);
  expect(record?.test).toEqual(TEST);
  expect((record?.analysis as { foil?: boolean } | null)?.foil).toBe(true);
};

const saveOffline = async (): Promise<string> => {
  opened = 'none';
  const offline = await openFresh();
  await offline.saveRecordedSession(gpxAt(0), 'running', 'a-marche', INTERVALS, new Uint8Array([1]), MARKS, true, TEST);
  return sessionFileName(START, 'running');
};

describe('session enregistrée sans dossier accessible (1)', () => {
  it('attend avec sa fiche, écrite après les capteurs et avant le GPX, reprise au rangement', async () => {
    const name = await saveOffline();
    expect(log.filter((l) => l.startsWith('pending write'))).toEqual([
      `pending write ${name.replace(/\.gpx$/, '.imu')}`, `pending write ${name.replace(/\.gpx$/, '.json')}`, `pending write ${name}`,
    ]);

    opened = 'folder';
    const library = await openFresh();
    await settle(library);
    const sessions = library.readLibraryState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].record.source).toBe('enregistrement');
    expectRecordingFields(sessions[0].record as unknown as Record<string, unknown>);
    expectRecordingFields(recordOf(files, sessions[0].file));
    expect([...pendingFiles.keys()]).toEqual([]);
    expect(library.readLibraryState().error).toBeNull();
  });

  it('rangée sans sa fiche illisible, et c’est dit', async () => {
    pendingFiles.set('x.gpx', gpxAt(0));
    pendingFiles.set('x.json', '{ "format": cassé');
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().sessions).toHaveLength(1);
    expect(library.readLibraryState().error).toContain('Fiche de la session en attente x.gpx illisible');
    expect([...pendingFiles.keys()]).toEqual([]);
  });

  it('efface sans rien dire une fiche restée seule (coupure avant le GPX)', async () => {
    pendingFiles.set('y.json', '{}');
    pendingFiles.set('z.json.tmp', '{');
    const library = await openFresh();
    await settle(library);
    expect([...pendingFiles.keys()]).toEqual([]);
    expect(library.readLibraryState().sessions).toHaveLength(0);
    expect(library.readLibraryState().error).toBeNull();
  });
});

describe('application tuée entre le GPX et sa fiche (3)', () => {
  it('« Analyser » repris complète la fiche que le balayage a créée : activité, repères, séances, test, foil', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('sortie.gpx')?.record.activityId).toBeNull();

    let location = '';
    await afterWrites(async () => {
      location = (await library.saveRecordedSession(gpxAt(0), 'running', 'a-marche', INTERVALS, null, MARKS, true, TEST)).location;
      expectRecordingFields(library.librarySession('sortie.gpx')?.record as unknown as Record<string, unknown>);
    });
    expect(location).toBe('déjà dans la mémoire');
    expectRecordingFields(recordOf(files, 'sortie.gpx'));
    expect([...files.keys()].filter((path) => path.endsWith('.gpx'))).toEqual(['sessions/sortie.gpx']);
  });

  it('une session en attente coupée de même est rangée une seule fois, sans « -2 », et complétée', async () => {
    const name = await saveOffline();
    // Rangement précédent coupé après le GPX : la session est dans sessions/ sans fiche, et encore en attente.
    files.set(`sessions/${name}`, gpxAt(0));
    opened = 'folder';
    const library = await openFresh();
    await settle(library);
    expect([...files.keys()].filter((path) => path.endsWith('.gpx'))).toEqual([`sessions/${name}`]);
    expectRecordingFields(library.librarySession(name)?.record as unknown as Record<string, unknown>);
    expect([...pendingFiles.keys()]).toEqual([]);
  });
});

/** Entrée d'un import de dossier, lue à la demande. */
const entry = (name: string, text: string) => ({
  name,
  key: name.replace(/\.(gpx|json)$/, ''),
  readText: async () => text,
  readBytes: async () => null,
});

/** Fiche d'une version future de Tracker, avec un champ que cette version ne connaît pas. */
const FUTURE_RECORD = JSON.stringify({
  format: RECORD_FORMAT, version: 99, gpx: 'a.gpx', sport: 'running', activityId: null, source: 'import',
  addedAt: '2026-10-27T11:00:00.000Z', title: null, name: 'Futur',
  summary: { calcVersion: SUMMARY_CALC_VERSION, startMs: START, endMs: START + 20_000, distanceM: 66, movingTimeS: 20, elevationGainM: null, maxSpeedMs: 3.3, pointCount: 3, samplingS: 10 },
  notes: null, analysis: null, nouveau: { forme: [1, 2] },
}, null, 1);
const BROKEN_RECORD = '{ "format": "tracker-session", cassé';

describe("fiche qu'on ne sait pas réécrire, importée ou recopiée (5b)", () => {
  it('importée à côté de son GPX : rangée au caractère près, la session en lecture seule', async () => {
    const library = await openFresh();
    await settle(library);
    const report = await library.importEntries([
      entry('a.gpx', gpxAt(0)), entry('a.json', FUTURE_RECORD), entry('b.gpx', gpxAt(30)), entry('b.json', BROKEN_RECORD),
    ]);
    expect(report.added).toHaveLength(2);
    const at = (minute: number) => library.readLibraryState().sessions.find((s) => s.record.summary.startMs === startOf(minute))!;
    const recordText = (minute: number) => files.get(`sessions/${at(minute).file.replace(/\.gpx$/, '.json')}`);
    expect(recordText(0)).toBe(FUTURE_RECORD);
    expect(at(0).readOnly).toBe(true);
    expect(at(0).warning).toContain('version plus récente');
    expect(at(0).record.name).toBe('Futur');
    expect(recordText(30)).toBe(BROKEN_RECORD);
    expect(at(30).readOnly).toBe(true);
    expect(at(30).warning).toContain('illisible');
  });

  it('recopiée de la mémoire du navigateur vers un dossier choisi : au caractère près', async () => {
    opened = 'browser';
    browserFiles.set('sessions/a.gpx', gpxAt(0));
    browserFiles.set('sessions/a.json', FUTURE_RECORD);
    browserFiles.set('sessions/b.gpx', gpxAt(30));
    browserFiles.set('sessions/b.json', BROKEN_RECORD);
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('a.gpx')?.readOnly).toBe(true);
    expect(library.librarySession('b.gpx')?.readOnly).toBe(true);

    chosen = fakeFolder;
    await library.chooseFolder();
    const records = [...files.entries()].filter(([path]) => path.startsWith('sessions/') && path.endsWith('.json')).map(([, text]) => text);
    expect(records.sort()).toEqual([FUTURE_RECORD, BROKEN_RECORD].sort());
    expect(library.readLibraryState().sessions.every((s) => s.readOnly)).toBe(true);
  });
});

describe('session déjà présente dont la fiche ne se relit pas (5c)', () => {
  /** Session tirée du cache allégé (`partial`), dont la fiche du disque ne se lit plus. */
  const openPartial = async (): Promise<Library> => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    await settle(await openFresh());
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('sortie.gpx')?.partial).toBe(true);
    readRefused.add('sessions/sortie.json');
    return library;
  };

  it('est dite au compte rendu de l’import, non complétée', async () => {
    const library = await openPartial();
    const sidecar = JSON.stringify({ format: RECORD_FORMAT, version: 1, gpx: 'sortie.gpx', name: 'Copie' });
    const report = await library.importEntries([entry('sortie.gpx', gpxAt(0)), entry('sortie.json', sidecar)]);
    expect(report.duplicates).toBe(1);
    expect(report.recordNotRead).toBe(1);
    expect(library.readLibraryState().message).toContain('fiche non relue pour 1 session déjà présente : non complétée');
  });

  it("garde le journal de l'enregistreur, et une session en attente, pour un autre essai", async () => {
    const library = await openPartial();
    await expect(library.saveRecordedSession(gpxAt(0), 'running', 'a-marche', [], null, MARKS)).rejects.toThrow('fiche');

    const name = await saveOffline();
    opened = 'folder';
    const reopened = await openFresh();
    await settle(reopened);
    expect(pendingFiles.has(name)).toBe(true);
    expect(pendingFiles.has(name.replace(/\.gpx$/, '.json'))).toBe(true);
    expect(reopened.readLibraryState().error).toContain('laissée en attente');
  });
});

describe('cache des fiches sous une autre liste de champs (5a)', () => {
  it("est ignoré : la fiche est relue en entier, et le champ devenu léger n'est pas perdu", async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const first = await openFresh();
    await settle(first);
    await afterWrites(() => first.updateSessionRecord('sortie.gpx', { marks: [{ timeMs: startOf(0) + 10_000, lat: 43.6, lon: 3.8, label: 'Bouée' }] }));
    await first.refreshLibrary();
    // Cache d'avant l'empreinte, d'une liste où les repères n'étaient pas légers : sa fiche n'a pas de repères.
    const cache = JSON.parse(stored.get(CACHE_KEY)!);
    expect(cache.fields).toBeDefined();
    delete cache.fields;
    delete cache.entries['sortie.json'].record.marks;
    stored.set(CACHE_KEY, JSON.stringify(cache));

    const library = await openFresh();
    await settle(library);
    const session = library.librarySession('sortie.gpx');
    expect(session?.partial).toBeFalsy();
    expect(session?.record.marks).toHaveLength(1);
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));
    expect(recordOf(files, 'sortie.gpx').marks).toHaveLength(1);
    expect(JSON.parse(stored.get(CACHE_KEY)!).fields).toBeDefined();
  });
});

describe('fiche dont la lecture lève (4)', () => {
  it("n'empêche pas d'ouvrir la mémoire : les autres s'ouvrent, elle reste telle quelle, en lecture seule", async () => {
    files.set('sessions/a.gpx', gpxAt(0));
    files.set('sessions/b.gpx', gpxAt(10));
    const first = await openFresh();
    await settle(first);
    await afterWrites(() => first.updateSessionRecord('b.gpx', { name: 'Soir' }));
    const bRecord = files.get('sessions/b.json');
    stored.clear();
    readRefused.add('sessions/b.json');

    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().status).toBe('ready');
    expect(library.librarySession('a.gpx')?.readOnly).toBe(false);
    const b = library.librarySession('b.gpx');
    expect(b?.readOnly).toBe(true);
    expect(b?.warning).toContain('Fiche non lue (accès refusé)');
    expect(files.get('sessions/b.json')).toBe(bRecord);

    // Accès rendu : « Mettre à jour » la relit.
    readRefused.clear();
    await library.refreshLibrary();
    expect(library.librarySession('b.gpx')?.readOnly).toBe(false);
    expect(library.librarySession('b.gpx')?.record.name).toBe('Soir');
  });
});

describe("fiche dont l'écriture a échoué (2)", () => {
  it('est retentée à « Mettre à jour », sans que la relecture remette celle du disque, et son erreur reste dite', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));
    expect(library.readLibraryState().error).toContain('non enregistrée');

    await library.refreshLibrary();
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');
    expect(library.readLibraryState().error).toContain('non enregistrée');
    expect(recordOf(files, 'sortie.gpx').name).toBeNull();

    refused.clear();
    await library.refreshLibrary();
    expect(recordOf(files, 'sortie.gpx').name).toBe('Matin');
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');
    expect(library.readLibraryState().error).toBeNull();
  });

  it("garde en mémoire la fiche créée qu'on n'a pas pu écrire : un GPX resté sans fiche n'en reçoit pas une neuve", async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    refused.add('sessions/sortie.json');
    const library = await openFresh();
    await settle(library);
    expect(files.has('sessions/sortie.json')).toBe(false);
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));

    await library.refreshLibrary();
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');

    refused.clear();
    await library.refreshLibrary();
    expect(recordOf(files, 'sortie.gpx').name).toBe('Matin');
  });

  it('est vidée par flushWrites dès que le dossier accepte de nouveau', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));
    refused.clear();
    // L'application passe en arrière-plan.
    const listeners: (() => void)[] = [];
    vi.stubGlobal('document', { addEventListener: (_: string, listener: () => void) => listeners.push(listener), visibilityState: 'hidden' });
    vi.stubGlobal('window', { addEventListener: () => undefined });
    library.startLibraryUi(() => false);
    await afterWrites(() => listeners.forEach((listener) => listener()));
    expect(recordOf(files, 'sortie.gpx').name).toBe('Matin');
  });
});

describe('changement de dossier avec une fiche pas encore écrite (2, décision du 01/11)', () => {
  it('reporte ses changements sur la même session du nouveau dossier, retrouvée par le début de trace', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    otherFiles.set('sessions/copie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin', activityId: 'a-marche' }));

    chosen = otherFolder;
    await afterWrites(() => library.chooseFolder());
    const copy = library.librarySession('copie.gpx');
    expect(copy?.record.name).toBe('Matin');
    expect(copy?.record.activityId).toBe('a-marche');
    expect(recordOf(otherFiles, 'copie.gpx').name).toBe('Matin');
    expect(library.readLibraryState().error).toBeNull();
  });

  it("dit les changements qu'aucune session du nouveau dossier ne reçoit", async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    otherFiles.set('sessions/autre.gpx', gpxAt(30));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));

    chosen = otherFolder;
    await library.chooseFolder();
    expect(library.readLibraryState().error).toContain('sortie.gpx');
  });

  it('les garde quand l’accès est perdu (« needs-permission »), et les reporte au dossier désigné de nouveau', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));

    // Accès retiré par Android : la mémoire passe à « needs-permission », la liste est vidée.
    opened = 'permission';
    await library.openLibrary();
    expect(library.readLibraryState().status).toBe('needs-permission');

    // « Choisir à nouveau le dossier » : le même dossier, désigné de nouveau.
    refused.clear();
    reconnected = memoryFolder(files, 'Tracker');
    await afterWrites(() => library.reconnectFolder());
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');
    expect(recordOf(files, 'sortie.gpx').name).toBe('Matin');
  });

  it('les reporte dans la mémoire du navigateur quand on y revient', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    browserFiles.set('sessions/copie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));

    opened = 'browser';
    await afterWrites(() => library.switchToBrowserMemory());
    expect(library.librarySession('copie.gpx')?.record.name).toBe('Matin');
    expect(recordOf(browserFiles, 'copie.gpx').name).toBe('Matin');
  });

  it("reporte une écriture de l'ancien dossier qui échoue après le changement, sans la retenter dans le nouveau", async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    otherFiles.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    refused.add('sessions/sortie.json');
    let release: () => void = () => undefined;
    writeGate = new Promise((resolve) => { release = resolve; });
    // L'écriture différée part, et attend le dossier.
    await afterWrites(() => library.updateSessionRecord('sortie.gpx', { name: 'Matin' }));

    chosen = otherFolder;
    await afterWrites(async () => {
      await library.chooseFolder();
      release();
      writeGate = null;
    });
    expect(library.readLibraryState().error).toBeNull();
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');
    expect(recordOf(otherFiles, 'sortie.gpx').name).toBe('Matin');
  });
});

describe('session en attente déjà rangée, en lecture seule (1, relecture)', () => {
  it('reste en attente avec sa fiche, et c’est dit, puis se range quand la fiche se relit', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    await settle(await openFresh());
    stored.clear();
    readRefused.add('sessions/sortie.json');
    const name = await saveOffline();

    opened = 'folder';
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('sortie.gpx')?.readOnly).toBe(true);
    expect(pendingFiles.has(name)).toBe(true);
    expect(pendingFiles.has(name.replace(/\.gpx$/, '.json'))).toBe(true);
    expect(library.readLibraryState().error).toContain('lecture seule');

    readRefused.clear();
    await library.refreshLibrary();
    expectRecordingFields(library.librarySession('sortie.gpx')?.record as unknown as Record<string, unknown>);
    expect([...pendingFiles.keys()]).toEqual([]);
  });
});

describe('capteurs là mais illisibles (lot 148, C5-6)', () => {
  it('en attente : les trois fichiers restent, c’est dit, puis la session se range quand ils se lisent', async () => {
    const name = await saveOffline();
    const imu = name.replace(/\.gpx$/, '.imu');
    expect(pendingBytes.has(imu)).toBe(true);
    pendingReadRefused.add(imu);

    opened = 'folder';
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().sessions).toHaveLength(0);
    expect([...pendingFiles.keys()].sort()).toEqual([name, name.replace(/\.gpx$/, '.json'), imu].sort());
    expect(library.readLibraryState().error).toContain('capteurs illisibles');
    expect(library.readLibraryState().pendingCount).toBe(1);

    pendingReadRefused.clear();
    await library.refreshLibrary();
    const file = library.readLibraryState().sessions[0].file;
    expect(library.hasSessionMotion(file)).toBe(true);
    expect([...pendingFiles.keys()]).toEqual([]);
  });

  const imuEntry = (read: () => Promise<Uint8Array | null>) => ({ name: 'a.imu', key: 'a', readText: async () => null, readBytes: read });

  it('à l’import : GPX et fiche rangés, capteurs comptés à part, et un nouvel import les ajoute', async () => {
    const library = await openFresh();
    await settle(library);
    const sidecar = JSON.stringify({ ...JSON.parse(FUTURE_RECORD), version: 1, name: 'Matin' });
    const report = await library.importEntries([
      entry('a.gpx', gpxAt(0)), entry('a.json', sidecar), imuEntry(async () => {
        throw new Error('trop gros');
      }),
    ]);
    expect(report.added).toHaveLength(1);
    expect(report.failed).toEqual([]);
    expect(report.motionFailed).toEqual(['a.gpx']);
    expect(library.readLibraryState().message).toContain('capteurs illisibles');
    const file = report.added[0];
    expect(library.librarySession(file)?.record.name).toBe('Matin');
    expect(library.hasSessionMotion(file)).toBe(false);

    const again = await library.importEntries([entry('a.gpx', gpxAt(0)), imuEntry(async () => new Uint8Array([1, 2]))]);
    expect(again.motionAdded).toBe(1);
    expect(again.motionFailed).toEqual([]);
    expect(library.hasSessionMotion(file)).toBe(true);
  });

  it('à l’import d’une session qui a déjà ses capteurs : rien n’est compté', async () => {
    const library = await openFresh();
    await settle(library);
    await library.importEntries([entry('a.gpx', gpxAt(0)), imuEntry(async () => new Uint8Array([1]))]);
    const report = await library.importEntries([entry('a.gpx', gpxAt(0)), imuEntry(async () => {
      throw new Error('trop gros');
    })]);
    expect(report.duplicates).toBe(1);
    expect(report.motionFailed).toEqual([]);
  });
});

describe('fiche qu\'on ne sait pas réécrire, portée par un GPX complet (lot 148, C5-4)', () => {
  const future = JSON.parse(FUTURE_RECORD) as SessionRecord;

  it('version plus récente : rangée au caractère près, GPX rendu, capteurs gardés, session en lecture seule', async () => {
    const library = await openFresh();
    await settle(library);
    const report = await library.importEntries([entry('a.gpx', bundleSessionGpx(gpxAt(0), future, new Uint8Array([7])))]);
    expect(report.added).toHaveLength(1);
    const file = report.added[0];
    expect(files.get(`sessions/${file}`)).toBe(gpxAt(0));
    expect(files.get(`sessions/${file.replace(/\.gpx$/, '.json')}`)).toBe(serializeRecord(future));
    expect(library.hasSessionMotion(file)).toBe(true);
    const session = library.librarySession(file)!;
    expect(session.readOnly).toBe(true);
    expect(session.warning).toContain('version plus récente');
    expect(session.record.name).toBe('Futur');
  });

  it('illisible : de même, au caractère près', async () => {
    const library = await openFresh();
    await settle(library);
    const broken = bundleSessionGpx(gpxAt(0), { ...future, version: 1 }, null).replace(/<tracker:record>[\s\S]*<\/tracker:record>/, '<tracker:record>{ cassé</tracker:record>');
    const report = await library.importEntries([entry('a.gpx', broken)]);
    const file = report.added[0];
    expect(files.get(`sessions/${file.replace(/\.gpx$/, '.json')}`)).toBe('{ cassé');
    expect(library.librarySession(file)?.readOnly).toBe(true);
    expect(library.librarySession(file)?.warning).toContain('illisible');
  });

  it('une fiche posée à côté, lisible, passe avant celle du paquet', async () => {
    const library = await openFresh();
    await settle(library);
    const sidecar = JSON.stringify({ ...future, version: 1, name: 'À côté' });
    const report = await library.importEntries([entry('a.gpx', bundleSessionGpx(gpxAt(0), future, null)), entry('a.json', sidecar)]);
    const session = library.librarySession(report.added[0])!;
    expect(session.readOnly).toBe(false);
    expect(session.record.name).toBe('À côté');
  });
});

describe('cache des fiches d\'une autre version du lecteur (lot 148, C5-7)', () => {
  /** Ouvre le dossier une fois, pour que le cache soit écrit, et rend ce cache à retoucher. */
  const cacheMade = async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    const first = await openFresh();
    await settle(first);
    await afterWrites(() => first.updateSessionRecord('sortie.gpx', { name: 'Matin' }));
    await first.refreshLibrary();
    const cache = JSON.parse(stored.get(CACHE_KEY)!);
    expect(cache.reader).toBe(RECORD_READER_VERSION);
    return cache;
  };

  it('est ignoré : la fiche est relue, puis le cache refait', async () => {
    const cache = await cacheMade();
    cache.reader = RECORD_READER_VERSION + 1;
    cache.entries['sortie.json'].record.name = 'Du cache';
    stored.set(CACHE_KEY, JSON.stringify(cache));
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Matin');
    expect(library.librarySession('sortie.gpx')?.partial).toBeFalsy();
    expect(JSON.parse(stored.get(CACHE_KEY)!).reader).toBe(RECORD_READER_VERSION);
  });

  it('un cache sans numéro vaut la version 1 : pas de relecture complète au premier lancement', async () => {
    expect(RECORD_READER_VERSION).toBe(1);
    const cache = await cacheMade();
    delete cache.reader;
    cache.entries['sortie.json'].record.name = 'Du cache';
    stored.set(CACHE_KEY, JSON.stringify(cache));
    const library = await openFresh();
    await settle(library);
    expect(library.librarySession('sortie.gpx')?.record.name).toBe('Du cache');
    expect(library.librarySession('sortie.gpx')?.partial).toBe(true);
  });
});

describe('marqueur d\'une version plus récente (lot 148, C5-9)', () => {
  const MARKER_V2 = JSON.stringify({ format: 'tracker-memoire', version: 2 });

  /** Un dossier où une ouverture ordinaire écrirait partout : GPX à la racine, sans fiche, fiche à refaire, extension à ranger, ancien fichier de réglages. */
  const folderToWrite = (): void => {
    files.set('tracker.json', MARKER_V2);
    files.set('racine.gpx', gpxAt(40));
    files.set('reglages.json', JSON.stringify({ format: 'tracker-reglages', version: 1, savedAt: 1, values: {} }));
    files.set('sessions/seul.gpx', gpxAt(0));
    files.set('sessions/majuscules.gpx', gpxAt(10));
    files.set('sessions/majuscules.JSON', FUTURE_RECORD.replace('"version": 99', '"version": 1'));
    files.set('sessions/vieille.gpx', gpxAt(20));
    files.set('sessions/vieille.json', JSON.stringify({ ...JSON.parse(FUTURE_RECORD), version: 1, gpx: 'vieille.gpx', name: 'Vieille', summary: { ...JSON.parse(FUTURE_RECORD).summary, calcVersion: 1, startMs: startOf(20) } }));
  };

  it('aucune écriture ni suppression, rien d\'échoué, sessions en lecture seule et mémoire dite telle', async () => {
    folderToWrite();
    const before = new Map(files);
    const library = await openFresh();
    await settle(library);
    expect(log).toEqual([]);
    expect(files).toEqual(before);
    const state = library.readLibraryState();
    expect(state.error).toBeNull();
    expect(state.memoryReadOnly).toBe(true);
    expect(state.status).toBe('ready');
    expect(library.canImportSessions(state)).toBe(false);
    expect(state.sessions.length).toBeGreaterThan(0);
    expect(state.sessions.every((s) => s.readOnly)).toBe(true);
    expect(library.librarySession('seul.gpx')?.warning).toContain('version plus récente');

    await library.refreshLibrary();
    expect(log).toEqual([]);
    expect(files).toEqual(before);
    expect(library.readLibraryState().error).toBeNull();
  });

  it('saisie, suppression et import n\'écrivent rien ; un enregistrement attend un dossier où ranger', async () => {
    folderToWrite();
    const before = new Map(files);
    const library = await openFresh();
    await settle(library);

    await afterWrites(() => library.updateSessionRecord('seul.gpx', { name: 'Matin' }));
    await library.removeSession('seul.gpx');
    expect(library.librarySession('seul.gpx')).toBeDefined();
    expect(library.readLibraryState().error).toContain('version plus récente');

    library.dismissLibraryMessage();
    const report = await library.importEntries([entry('n.gpx', gpxAt(50))]);
    expect(report.added).toEqual([]);
    expect(report.unsaved).toBe(1);

    const saved = await library.saveRecordedSession(gpxAt(55), 'running', 'a-marche');
    expect(saved.file).toBeNull();
    const name = sessionFileName(startOf(55), 'running');
    expect(pendingFiles.has(name)).toBe(true);
    expect(library.readLibraryState().pendingCount).toBe(1);
    expect(files).toEqual(before);

    // Une nouvelle relecture ne range pas la session en attente dans ce dossier.
    await library.refreshLibrary();
    expect(pendingFiles.has(name)).toBe(true);
    expect(files).toEqual(before);
  });

  it('marqueur illisible ou de la version connue : dossier ordinaire, marqueur illisible non réécrit', async () => {
    files.set('tracker.json', '{ cassé');
    files.set('sessions/seul.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().memoryReadOnly).toBe(false);
    expect(library.librarySession('seul.gpx')?.readOnly).toBe(false);
    expect(files.get('tracker.json')).toBe('{ cassé');
    expect(log).toContain('write sessions/seul.json');
  });
});

describe('dossier fermé ou remplacé pendant la lecture de son marqueur (lot 148)', () => {
  /** « Choisir un dossier » sur le dossier suivi, retenu à la lecture de son marqueur ; rend la fin du choix et de quoi libérer la lecture. */
  const choosingHeld = async (library: Library): Promise<{ choosing: Promise<void>; release: () => void }> => {
    let open!: () => void;
    markerGate = new Promise((resolve) => {
      open = resolve;
    });
    chosen = fakeFolder;
    const choosing = library.chooseFolder();
    for (let i = 0; i < 200 && !markerAsked; i++) await tick();
    expect(markerAsked).toBe(true);
    return {
      choosing,
      release: () => {
        markerGate = null;
        open();
      },
    };
  };

  it('fermé (accès perdu) : le dossier n\'est pas rouvert, rien n\'y est écrit', async () => {
    opened = 'none';
    const library = await openFresh();
    files.set('sessions/seul.gpx', gpxAt(0));
    const { choosing, release } = await choosingHeld(library);

    opened = 'permission';
    await library.openLibrary();
    expect(library.readLibraryState().status).toBe('needs-permission');

    release();
    await choosing;
    await settle(library);
    expect(library.readLibraryState().status).toBe('needs-permission');
    expect(library.readLibraryState().sessions).toEqual([]);
    expect(await library.currentMemoryFolder()).toBeNull();
    expect(log).toEqual([]);
    expect(files.has('tracker.json')).toBe(false);
  });

  it('remplacé par un autre dossier : celui-ci reste en service, le premier n\'est pas touché', async () => {
    opened = 'none';
    const library = await openFresh();
    files.set('sessions/seul.gpx', gpxAt(0));
    otherFiles.set('sessions/autre.gpx', gpxAt(10));
    const { choosing, release } = await choosingHeld(library);

    chosen = otherFolder;
    await library.chooseFolder();
    await settle(library);

    release();
    await choosing;
    await settle(library);
    expect(library.readLibraryState().folderLabel).toBe('Autre');
    expect((await library.currentMemoryFolder())?.label).toBe('Autre');
    expect(library.readLibraryState().sessions.map((s) => s.file)).toEqual(['autre.gpx']);
    expect(files.has('tracker.json')).toBe(false);
    expect(otherFiles.has('tracker.json')).toBe(true);
  });
});
