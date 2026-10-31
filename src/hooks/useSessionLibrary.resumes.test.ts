import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, serializeRecord, type SessionAnalysis, type SessionRecord } from '../library/record';
import type { MemoryFolder } from '../platform/memoryFolder';
import { createFakeFolder } from '../test/memoryFolder.fixture';

/**
 * Résumés refaits quand les réglages changent (lot 37), sur un faux dossier : fiches d'avant
 * l'empreinte refaites une fois, rien de relu ni d'écrit à l'ouverture suivante, seules les
 * sessions de l'activité sans seuil propre refaites après un seuil changé (à l'ouverture comme en
 * cours d'utilisation), trace illisible tentée une fois, déclenchement par un réglage écrit.
 */

/** Course de trois points, à 10 s d'écart, partie à `hhmm` le 27/10/2026. */
const gpxAt = (hhmm: string): string =>
  '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
  + [0, 10, 20].map((s, i) =>
    `<trkpt lat="${43.6 + i * 0.0003}" lon="3.8"><time>2026-10-27T${hhmm}:${String(s).padStart(2, '0')}Z</time></trkpt>`).join('')
  + '</trkseg></trk></gpx>';

/** Fichiers du faux dossier, par chemin ; lectures, écritures et suppressions relevées dans l'ordre. */
const files = new Map<string, string>();
const log: string[] = [];

const fakeFolder: MemoryFolder = createFakeFolder(
  files,
  log,
  {
    readText: async (path) => {
      log.push(`read ${path}`);
      return files.get(path) ?? null;
    },
  },
  (path) => files.get(path)!.length,
);

// Pas de `DOMParser` dans l'environnement node : les points des GPX de ce test, lus par expression régulière.
vi.mock('../core/gpxParser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/gpxParser')>()),
  parseGpx: (text: string) => {
    if (!text.includes('<gpx')) throw new Error('GPX illisible');
    return {
      rawPoints: [...text.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"><time>([^<]+)<\/time>/g)]
        .map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), time: m[3] })),
      timedPoints: [],
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

/** Stockage de l'appareil, gardé d'une ouverture à l'autre : réglages et cache des fiches y survivent. */
const stored = new Map<string, string>();

const analysis = (patch: Partial<SessionAnalysis>): SessionAnalysis => ({
  windDeg: null, activeThreshold: null, referenceSpeedMs: null, speedRange: null, effortThresholdMs: null, foil: null,
  pumping: null, waveThreshold: null, bikeWeightKg: null, loadKg: null, savedAt: 1, ...patch,
});

/** Course sans seuil propre, course au seuil propre, sortie à vélo. */
const COURSE = '2026-10-27_10-00-00_running.gpx';
const COURSE_SEUIL = '2026-10-27_10-30-00_running.gpx';
const VELO = '2026-10-27_11-00-00_cycling.gpx';

const jsonOf = (gpx: string): string => gpx.replace(/\.gpx$/, '.json');

/** Fiche d'avant l'empreinte (résumé sans `optionsKey`), pour le GPX `gpx` parti à `hhmm`. */
const oldRecord = (gpx: string, hhmm: string, patch: Partial<SessionRecord>): SessionRecord => {
  const startMs = Date.parse(`2026-10-27T${hhmm}:00Z`);
  return {
    format: RECORD_FORMAT, version: RECORD_VERSION, gpx, sport: 'running', activityId: 'running', source: 'enregistrement',
    addedAt: '2026-10-27T12:00:00.000Z', title: null, name: null,
    summary: {
      calcVersion: SUMMARY_CALC_VERSION, startMs, endMs: startMs + 20_000, distanceM: 66, movingTimeS: 20,
      elevationGainM: null, maxSpeedMs: 3.3, pointCount: 3, samplingS: 10,
    },
    notes: null, analysis: null, ...patch,
  };
};

const putSessions = (): void => {
  for (const [gpx, hhmm, patch] of [
    [COURSE, '10:00', {}],
    [COURSE_SEUIL, '10:30', { analysis: analysis({ activeThreshold: 5 }) }],
    [VELO, '11:00', { sport: 'cycling', activityId: 'cycling' }],
  ] as [string, string, Partial<SessionRecord>][]) {
    files.set(`sessions/${gpx}`, gpxAt(hhmm));
    files.set(`sessions/${jsonOf(gpx)}`, serializeRecord(oldRecord(gpx, hhmm, patch)));
  }
};

type Library = typeof import('./useSessionLibrary');
type Settings = typeof import('./useSportSettings');

/** Lancement de l'application : modules neufs, mémoire ouverte. */
const openFresh = async (): Promise<{ library: Library; settings: Settings }> => {
  vi.resetModules();
  const library = await import('./useSessionLibrary');
  const settings = await import('./useSportSettings');
  await library.openLibrary();
  return { library, settings };
};

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Attend la fin du passage de fond. */
const settle = async (library: Library): Promise<void> => {
  for (let i = 0; i < 20_000 && library.readLibraryState().scanning !== null; i++) await tick();
  await tick();
};

const gpxReads = (): string[] => log.filter((l) => /^read sessions\/.*\.gpx$/.test(l)).map((l) => l.slice('read sessions/'.length));
const recordWrites = (): string[] => log.filter((l) => /^write sessions\/.*\.json$/.test(l)).map((l) => l.slice('write sessions/'.length));
const diskRecord = (gpx: string): SessionRecord => JSON.parse(files.get(`sessions/${jsonOf(gpx)}`)!);

const setThreshold = (settings: Settings, activityId: string, value: number): void =>
  settings.updateStoredSettings((s) => ({ ...s, thresholds: { ...s.thresholds, [activityId]: value } }));

beforeEach(() => {
  files.clear();
  stored.clear();
  log.length = 0;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => stored.set(k, v),
    removeItem: (k: string) => stored.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('résumés refaits quand les réglages changent (lot 37)', () => {
  it("refait une fois les fiches d'avant l'empreinte, puis ne relit ni n'écrit rien au lancement suivant", async () => {
    putSessions();
    const { library } = await openFresh();
    await settle(library);
    expect(gpxReads().sort()).toEqual([COURSE, COURSE_SEUIL, VELO].sort());
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL, VELO].map(jsonOf).sort());
    for (const gpx of [COURSE, COURSE_SEUIL, VELO]) expect(diskRecord(gpx).summary.optionsKey).toBeTypeOf('string');
    expect(library.readLibraryState().toUpdate).toBe(0);

    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(gpxReads()).toEqual([]);
    expect(log.filter((l) => l.startsWith('write sessions/'))).toEqual([]);
    expect(second.library.readLibraryState().sessions).toHaveLength(3);
  });

  it("seuil de Course changé application fermée : à l'ouverture, seule la course sans seuil propre est refaite", async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);

    log.length = 0;
    const { library } = await openFresh();
    await settle(library);
    expect(gpxReads()).toEqual([COURSE]);
    expect(recordWrites()).toEqual([jsonOf(COURSE)]);
    const course = library.librarySession(COURSE)!;
    expect(course.record.summary.optionsKey).toBe(diskRecord(COURSE).summary.optionsKey);
    expect(course.record.summary.optionsKey).not.toBe(library.librarySession(COURSE_SEUIL)!.record.summary.optionsKey);
  });

  it("seuil changé en cours d'utilisation : seules les sessions de l'activité sont refaites ; une trace illisible n'est tentée qu'une fois", async () => {
    putSessions();
    const { library, settings } = await openFresh();
    await settle(library);

    // Seuil inchangé : rien.
    log.length = 0;
    await library.queueOutdatedRefresh();
    expect(log.filter((l) => l.startsWith('read ') || l.startsWith('write '))).toEqual([]);

    setThreshold(settings, 'running', 4);
    await library.queueOutdatedRefresh();
    expect(gpxReads()).toEqual([COURSE]);
    expect(recordWrites()).toEqual([jsonOf(COURSE)]);

    // Le GPX du vélo devient illisible : tenté une fois, signalé, puis laissé jusqu'à la prochaine ouverture.
    files.set(`sessions/${VELO}`, 'illisible');
    log.length = 0;
    setThreshold(settings, 'cycling', 15);
    await library.queueOutdatedRefresh();
    expect(gpxReads()).toEqual([VELO]);
    expect(recordWrites()).toEqual([]);
    expect(library.readLibraryState().unreadable).toEqual([VELO]);
    log.length = 0;
    setThreshold(settings, 'cycling', 16);
    await library.queueOutdatedRefresh();
    expect(gpxReads()).toEqual([]);
    expect(library.readLibraryState().unreadable).toEqual([VELO]);
    expect(library.readLibraryState().toUpdate).toBe(0);
  });

  it('un réglage écrit déclenche le recalcul, une fois la saisie posée, avec son compteur', async () => {
    putSessions();
    const { library, settings } = await openFresh();
    await settle(library);
    vi.stubGlobal('document', { addEventListener: () => undefined, visibilityState: 'visible' });
    vi.stubGlobal('window', { addEventListener: () => undefined });
    library.startLibraryUi(() => true);

    log.length = 0;
    // Saisie touche à touche : un seul recalcul, avec le dernier seuil.
    setThreshold(settings, 'running', 3);
    setThreshold(settings, 'running', 4);
    await new Promise((r) => setTimeout(r, 1000));
    expect(gpxReads()).toEqual([]);
    let seen = 0;
    for (let i = 0; i < 2000; i++) {
      seen = Math.max(seen, library.readLibraryState().toUpdate);
      if (recordWrites().length > 0) break;
      await tick();
    }
    await settle(library);
    expect(seen).toBe(1);
    expect(gpxReads()).toEqual([COURSE]);
    expect(recordWrites()).toEqual([jsonOf(COURSE)]);
    expect(library.readLibraryState().toUpdate).toBe(0);
    // Le fichier de réglages de l'appareil part 2 s après la saisie : attendu ici, pour ne rien laisser derrière le test.
    await new Promise((r) => setTimeout(r, 1200));
  });
});
