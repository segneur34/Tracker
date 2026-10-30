import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryFolder } from '../platform/memoryFolder';
import { createFakeFolder, fakeEntries } from '../test/memoryFolder.fixture';

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

const fakeFolder: MemoryFolder = createFakeFolder(
  files,
  log,
  {
    writeText: async (path, text) => {
      if (refused.has(path)) throw new Error('écriture refusée');
      log.push(`write ${path}`);
      files.set(path, text);
    },
    writeBytes: async (path) => {
      log.push(`write ${path}`);
      files.set(path, 'imu');
    },
  },
  (path) => files.get(path)!.length,
);

/** Fichiers déjà dans le dossier en attente, par nom (les écritures n'y vont pas : `pendingWrites`). */
const pendingFiles = new Map<string, string>();

const fakePending: MemoryFolder = {
  ...fakeFolder,
  kind: 'device',
  label: 'en attente',
  list: async () => fakeEntries(pendingFiles, ''),
  readText: async (path) => pendingFiles.get(path) ?? null,
  remove: async (path) => {
    pendingFiles.delete(path);
  },
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

/** Échec du chargement du stockage au démarrage, simulé (A3). */
let storageFailed = false;

vi.mock('../platform/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/storage')>()),
  storageStartupFailure: () => (storageFailed ? { all: true, keys: [] } : null),
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
  pendingFiles.clear();
  access = 'ready';
  storageFailed = false;
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
    // Un import vide met à jour le cache, une seconde après.
    await library.importFiles([]);
    await new Promise((r) => setTimeout(r, 1100));
    const { jsonStore } = await import('../platform/storage');
    const cache = jsonStore.read<{ entries: Record<string, unknown> }>('tracker.libraryCache');
    expect(cache?.entries[file.replace(/\.gpx$/, '.json')]).toBeUndefined();
  });
});

describe('fiche de 0 octet (A2 : création interrompue)', () => {
  it('est tenue pour absente et refaite depuis le GPX, sans passer en lecture seule', async () => {
    files.set('sessions/sortie.gpx', gpxAt(0));
    files.set('sessions/sortie.json', '');
    const library = await openFresh();
    await settle(library);
    const session = library.librarySession('sortie.gpx');
    expect(session?.readOnly).toBe(false);
    expect(session?.warning).toBeNull();
    expect(JSON.parse(files.get('sessions/sortie.json')!).gpx).toBe('sortie.gpx');
  });
});

describe("fiche d'une version future renommée (A1)", () => {
  it('garde, au caractère près, le champ de forme nouvelle', async () => {
    const { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION } = await import('../library/record');
    const startMs = Date.parse('2026-10-27T10:00:00Z');
    const surfaces = { source: 'overpass', format: 2, segments: [{ from: 0, kind: 'asphalte' }] };
    files.set('sessions/sortie.gpx', gpxAt(0));
    files.set('sessions/sortie.json', JSON.stringify({
      format: RECORD_FORMAT, version: RECORD_VERSION, gpx: 'sortie.gpx', sport: 'running', activityId: null, source: 'import',
      addedAt: '2026-10-27T11:00:00.000Z', title: null, name: null,
      summary: { calcVersion: SUMMARY_CALC_VERSION, startMs, endMs: startMs + 20_000, distanceM: 66, movingTimeS: 20, elevationGainM: null, maxSpeedMs: 3.3, pointCount: 3, samplingS: 10 },
      notes: null, analysis: null, surfaces,
    }, null, 2));
    const library = await openFresh();
    await settle(library);
    vi.useFakeTimers();
    library.updateSessionRecord('sortie.gpx', { name: 'Matin' });
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    const written = JSON.parse(files.get('sessions/sortie.json')!);
    expect(written.name).toBe('Matin');
    expect(JSON.stringify(written.surfaces, null, 2)).toBe(JSON.stringify(surfaces, null, 2));
  });
});

describe('enregistrement en attente d\'un dossier (A2)', () => {
  it('pose les capteurs avant le GPX : un GPX en attente a toujours les siens complets', async () => {
    access = 'unavailable';
    const library = await openFresh();
    await library.saveRecordedSession(gpxAt(0), 'running', null, [], new Uint8Array([1]));
    expect(pendingWrites.map((p) => p.replace(/^.*\./, ''))).toEqual(['imu', 'gpx']);
  });
});

describe('temporaires laissés en attente par un plantage (lot 84, A)', () => {
  it('range un GPX temporaire complet, efface un tronqué en le disant, et le reste d’une écriture achevée', async () => {
    pendingFiles.set('complet.gpx.tmp', gpxAt(0));
    pendingFiles.set('tronque.gpx.tmp', gpxAt(5).slice(0, 80));
    pendingFiles.set('fini.gpx', gpxAt(10));
    pendingFiles.set('fini.gpx.tmp', gpxAt(10));
    const library = await openFresh();
    await settle(library);
    expect([...pendingFiles.keys()]).toEqual([]);
    const starts = library.readLibraryState().sessions.map((s) => new Date(s.record.summary.startMs).toISOString()).sort();
    expect(starts).toEqual(['2026-10-27T10:00:00.000Z', '2026-10-27T10:10:00.000Z']);
    expect(library.readLibraryState().error).toContain('tronque.gpx incomplète');
    expect(library.readLibraryState().error).not.toContain('fini');
  });
});

describe('capteurs en attente illisibles (lot 84, A)', () => {
  it('ne les efface pas quand leur lecture échoue, la session étant rangée sans eux', async () => {
    // Le faux dossier en attente rend `null` à toute lecture d'octets : échec de lecture des capteurs.
    pendingFiles.set('x.gpx.tmp', gpxAt(0));
    pendingFiles.set('x.imu', 'capteurs');
    pendingFiles.set('y.gpx', gpxAt(10));
    pendingFiles.set('y.imu.tmp', 'capteurs');
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().sessions).toHaveLength(2);
    expect([...pendingFiles.keys()].sort()).toEqual(['x.imu', 'y.imu.tmp']);
  });
});

describe('GPX vide dans le dossier (lot 84, C)', () => {
  it('n’est ni une session ni « illisible », et reste en place', async () => {
    files.set('sessions/vide.gpx', '');
    files.set('sessions/blanc.gpx', ' \n  ');
    files.set('sessions/sortie.gpx', gpxAt(0));
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().sessions.map((s) => s.file)).toEqual(['sortie.gpx']);
    expect(library.readLibraryState().unreadable).toEqual([]);
    expect(files.has('sessions/vide.gpx')).toBe(true);
    expect(log.filter((l) => l.includes('vide') || l.includes('blanc'))).toEqual([]);
  });

  it('avec une fiche, reste dit « illisible » : la fiche et ses notes ne deviennent pas invisibles', async () => {
    const { RECORD_FORMAT, RECORD_VERSION } = await import('../library/record');
    files.set('sessions/vide.gpx', '');
    // Fiche lisible au résumé illisible, puis fiche d'une version plus récente.
    files.set('sessions/vide.json', JSON.stringify({
      format: RECORD_FORMAT, version: RECORD_VERSION, gpx: 'vide.gpx', sport: 'running', activityId: null, source: 'import',
      addedAt: '2026-10-27T11:00:00.000Z', title: null, name: 'Matin', summary: null, notes: null, analysis: null,
    }));
    files.set('sessions/futur.gpx', '');
    files.set('sessions/futur.json', JSON.stringify({ format: RECORD_FORMAT, version: RECORD_VERSION + 1, gpx: 'futur.gpx', name: 'Soir' }));
    const library = await openFresh();
    await settle(library);
    expect([...library.readLibraryState().unreadable].sort()).toEqual(['futur.gpx', 'vide.gpx']);
  });

  it('à l’import, est compté parmi les ignorés, pas parmi les illisibles', async () => {
    const library = await openFresh();
    await settle(library);
    const report = await library.importFiles([new File([''], 'vide.gpx'), new File([gpxAt(0)], 'sortie.gpx')]);
    expect(report.ignored).toEqual(['vide.gpx']);
    expect(report.invalid).toEqual([]);
    expect(report.added).toHaveLength(1);
  });
});

describe('stockage illisible au démarrage (A3)', () => {
  beforeEach(() => {
    // Appareil neuf à chaque essai : un stockage vide, à lui.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' });
    vi.stubGlobal('window', { addEventListener: () => undefined });
  });
  afterEach(() => vi.unstubAllGlobals());

  const otherDevice = async () => {
    const { buildSettingsFile, serializeSettingsFile } = await import('../library/settingsFile');
    files.set('reglages/autre.json', serializeSettingsFile(
      buildSettingsFile({ 'tracker.runnerProfile': { me: { name: 'Autre' } } }, 1000, null, { id: 'autre', name: 'Autre' })
    ));
  };

  it("ne reprend pas seul le fichier de réglages d'un autre appareil, et n'écrit pas le sien", async () => {
    await otherDevice();
    storageFailed = true;
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().message ?? '').not.toContain('Réglages repris');
    expect(log.filter((l) => l.startsWith('write reglages/'))).toEqual([]);
    library.startLibraryUi(() => false);
    expect(library.readLibraryState().error).toContain('Relancez');
  });

  it('sans échec, un appareil neuf reprend le plus récent, comme avant', async () => {
    await otherDevice();
    const library = await openFresh();
    await settle(library);
    expect(library.readLibraryState().message).toContain('Réglages repris');
  });
});

describe('capteurs ajoutés par un import à une session présente (D10)', () => {
  it('republient la session : une analyse ouverte voit ses capteurs sans attendre un autre rendu', async () => {
    const library = await openFresh();
    await settle(library);
    await library.importFiles([new File([gpxAt(0)], 'sortie.gpx')]);
    const file = library.readLibraryState().sessions[0].file;
    const before = library.readLibraryState().sessions[0];
    expect(library.hasSessionMotion(file)).toBe(false);
    const entry = (name: string) => ({
      name,
      key: 'sortie',
      readText: async () => gpxAt(0),
      readBytes: async () => new Uint8Array([1, 2, 3]),
    });
    const report = await library.importEntries([entry('sortie.gpx'), entry('sortie.imu')]);
    expect(report.motionAdded).toBe(1);
    expect(library.hasSessionMotion(file)).toBe(true);
    const after = library.readLibraryState().sessions.find((s) => s.file === file);
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
  });
});
