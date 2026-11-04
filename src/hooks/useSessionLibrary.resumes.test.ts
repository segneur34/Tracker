import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECORD_FORMAT, RECORD_VERSION, SUMMARY_CALC_VERSION, serializeRecord, type SessionAnalysis, type SessionRecord } from '../library/record';
import type { MemoryFolder } from '../platform/memoryFolder';
import { gpxAtTime, settle, tick, trackTestTimers } from '../test/library.fixture';
import { createFakeFolder } from '../test/memoryFolder.fixture';

/**
 * Résumés refaits quand les réglages changent (lot 37), sur un faux dossier : fiches d'avant
 * l'empreinte refaites une fois, rien de relu ni d'écrit à l'ouverture suivante, les sessions de
 * l'activité refaites après un seuil changé (à l'ouverture comme en cours d'utilisation), trace
 * illisible tentée une fois, déclenchement par un réglage écrit. La session garde ses réglages (Q57) :
 * ceux d'un autre appareil ne réécrivent rien, seul un geste le fait, repris s'il est interrompu.
 */

/** Course de trois points, à 10 s d'écart, partie à `hhmm` le 27/10/2026. */
const gpxAt = gpxAtTime;

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

/** Échec du chargement du stockage au démarrage, simulé. */
let storageFailed = false;

/**
 * Modules simulés, refaits après chaque `vi.resetModules()` : un `vi.mock` posé une fois survit à `resetModules` et
 * garderait d'un test à l'autre la même instance du stockage (valeurs refusées, cache de lecture).
 */
const mockPlatform = (): void => {
  // Pas de `DOMParser` dans l'environnement node : les points des GPX de ce test, lus par expression régulière.
  vi.doMock('../core/gpxParser', async (importOriginal) => ({
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
  vi.doMock('../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  vi.doMock('../platform/storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/storage')>()),
    storageStartupFailure: () => (storageFailed ? { all: true, keys: [] } : null),
  }));
};

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

/** Aucune minuterie d'un test ne sonne pendant le suivant (`trackTestTimers`). */
let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  stopTestTimers = trackTestTimers();
});
afterEach(() => stopTestTimers());
type Settings = typeof import('./useSportSettings');

/** Lancement de l'application : modules neufs, mémoire ouverte. */
const openFresh = async (): Promise<{ library: Library; settings: Settings }> => {
  vi.resetModules();
  mockPlatform();
  const library = await import('./useSessionLibrary');
  const settings = await import('./useSportSettings');
  await library.openLibrary();
  return { library, settings };
};

const gpxReads = (): string[] => log.filter((l) => /^read sessions\/.*\.gpx$/.test(l)).map((l) => l.slice('read sessions/'.length));
const recordWrites = (): string[] => log.filter((l) => /^write sessions\/.*\.json$/.test(l)).map((l) => l.slice('write sessions/'.length));
const diskRecord = (gpx: string): SessionRecord => JSON.parse(files.get(`sessions/${jsonOf(gpx)}`)!);

const setThreshold = (settings: Settings, activityId: string, value: number): void =>
  settings.updateStoredSettings((s) => ({ ...s, thresholds: { ...s.thresholds, [activityId]: value } }));

beforeEach(() => {
  storageFailed = false;
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

describe('la session garde ses réglages (Q57)', () => {
  const gestures = (): { baseline: Record<string, unknown>; pending: Record<string, unknown> } => JSON.parse(stored.get('tracker.summaryGestures')!);

  /** L'autre appareil : mêmes fichiers, autre stockage, ses réglages datés (ce n'est pas un appareil neuf, qui reprendrait ceux du dossier). */
  const otherDevice = (threshold: number): void => {
    stored.clear();
    stored.set('tracker.sportSettings', JSON.stringify({ thresholds: { running: threshold } }));
    stored.set('tracker.settingsSavedAt', JSON.stringify(Date.now()));
  };

  it('deux appareils, deux jeux de réglages, une fiche, plusieurs ouvertures : aucune écriture ; puis un geste : réécrite une fois', async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);
    await first.library.queueOutdatedRefresh();
    const carried = diskRecord(COURSE).summary;
    expect(carried.activitySettings?.threshold).toBe(4);

    // Le second appareil a 7 dans ses réglages, et un stockage neuf.
    otherDevice(7);
    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(second.settings.readStoredSettings().thresholds?.running).toBe(7);
    expect(recordWrites()).toEqual([]);
    expect(gpxReads()).toEqual([]);
    expect(second.library.librarySession(COURSE)!.record.summary.activitySettings?.threshold).toBe(4);
    await second.library.queueOutdatedRefresh();
    expect(recordWrites()).toEqual([]);

    const third = await openFresh();
    await settle(third.library);
    expect(recordWrites()).toEqual([]);

    // Le geste sur le second appareil : ses courses, une fois.
    setThreshold(third.settings, 'running', 8);
    await third.library.queueOutdatedRefresh();
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(8);
    expect(gestures().pending).toEqual({});
    log.length = 0;
    await third.library.queueOutdatedRefresh();
    expect(recordWrites()).toEqual([]);
  });

  it('geste suivi de la fermeture : le recalcul reprend au lancement suivant, puis plus rien', async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);
    // Fermée avant que rien ne soit refait, mais après que le geste a été vu : la référence a déjà suivi.
    stored.set('tracker.summaryGestures', JSON.stringify({
      baseline: { ...gestures().baseline, running: { threshold: 4 } }, pending: { running: { threshold: 4 } },
    }));

    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());
    expect(gestures().pending).toEqual({});

    log.length = 0;
    const third = await openFresh();
    await settle(third.library);
    expect(recordWrites()).toEqual([]);
  });

  it("échec du GPX : le geste attend, et est retenté à l'ouverture suivante", async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    const good = files.get(`sessions/${COURSE}`)!;
    files.set(`sessions/${COURSE}`, 'illisible');
    setThreshold(first.settings, 'running', 4);
    await first.library.queueOutdatedRefresh();
    expect(gestures().pending).toEqual({ running: { threshold: 4 } });

    files.set(`sessions/${COURSE}`, good);
    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(recordWrites()).toEqual([jsonOf(COURSE)]);
    expect(gestures().pending).toEqual({});
  });

  it('appareil neuf : réglages repris du dossier, aucun geste, aucune écriture de fiche', async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);
    await first.library.queueOutdatedRefresh();
    // Le fichier de réglages du premier appareil reste dans le dossier, avec le seuil 9.
    const settingsPath = [...files.keys()].find((path) => path.startsWith('reglages/'))!;
    const file = JSON.parse(files.get(settingsPath)!);
    file.savedAt = Date.now();
    file.values['tracker.sportSettings'] = { thresholds: { running: 9 } };
    files.set(settingsPath, JSON.stringify(file));

    stored.clear();
    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(second.settings.readStoredSettings().thresholds?.running).toBe(9);
    expect(recordWrites()).toEqual([]);
    expect(gestures().pending).toEqual({});
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(4);
  });

  it("« Reprendre » le fichier d'un autre appareil compte comme un geste : ses sessions suivent à la réouverture", async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    // Le fichier de réglages de l'appareil part 2 s après un changement : on n'en dépend pas, on le récrit à la main sous un autre appareil.
    const own = JSON.parse(files.get([...files.keys()].find((path) => path.startsWith('reglages/'))!)!);
    const other = { ...own, device: { id: 'autre-appareil', name: 'Autre' }, values: { ...own.values, 'tracker.sportSettings': { thresholds: { running: 9 } } } };
    files.set('reglages/autre.json', JSON.stringify(other));
    await first.library.adoptSettingsFile('autre.json');
    expect(first.settings.readStoredSettings().thresholds?.running).toBe(9);

    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(9);
    expect(gestures().pending).toEqual({});
  });

  it('pré-réglages mis à jour avant la fin d\'une ouverture lente, à la toute première comparaison : un geste quand même', async () => {
    putSessions();
    const keyed = oldRecord(COURSE, '10:00', {});
    files.set(`sessions/${jsonOf(COURSE)}`, serializeRecord({ ...keyed, summary: { ...keyed.summary, optionsKey: JSON.stringify([7, null, null, null]) } }));
    // Réglages d'une version d'avant : le seuil de Course sera effacé par la mise à jour des pré-réglages.
    stored.set('tracker.sportSettings', JSON.stringify({ thresholds: { running: 7 }, presetsVersion: 0 }));
    vi.resetModules();
    mockPlatform();
    const library = await import('./useSessionLibrary');
    const settings = await import('./useSportSettings');
    const opening = library.openLibrary();
    expect(settings.upgradeStoredPresets()).toBe(true);
    expect(settings.readStoredSettings().thresholds?.running).toBeUndefined();
    await opening;
    await settle(library);
    await library.settingsUpgraded();
    await settle(library);
    for (let i = 0; i < 500 && diskRecord(COURSE).summary.activitySettings === undefined; i++) await tick();
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).not.toBe(7);
    expect(diskRecord(COURSE).summary.activitySettings).toBeDefined();
    expect(gestures().pending).toEqual({});
  });

  it('stockage illisible au démarrage : aucune comparaison, des défauts ne passent pas pour un geste', async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);
    await first.library.queueOutdatedRefresh();
    const kept = stored.get('tracker.summaryGestures');
    const settings = stored.get('tracker.sportSettings')!;

    storageFailed = true;
    stored.delete('tracker.sportSettings');
    log.length = 0;
    const second = await openFresh();
    await settle(second.library);
    expect(recordWrites()).toEqual([]);
    expect(stored.get('tracker.summaryGestures')).toBe(kept);

    storageFailed = false;
    stored.set('tracker.sportSettings', settings);
    const third = await openFresh();
    await settle(third.library);
    expect(recordWrites()).toEqual([]);
    expect(gestures().pending).toEqual({});
  });

  it('activité supprimée : plus de recalcul, ses sessions gardent ce qu\'elles portent', async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);
    await first.library.queueOutdatedRefresh();
    log.length = 0;
    first.settings.updateStoredSettings((settings) => ({
      ...settings,
      activities: first.settings.readStoredActivities().filter((a) => a.id !== 'running'),
    }));
    await first.library.queueOutdatedRefresh();
    expect(recordWrites()).toEqual([]);
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(4);
  });

  it('seuil propre retiré sur une ancienne fiche : retour au réglage de l\'appareil, pas au seuil retiré', async () => {
    putSessions();
    const gpx = COURSE_SEUIL;
    const old = oldRecord(gpx, '10:30', { analysis: analysis({ activeThreshold: 12 }) });
    const key = JSON.stringify([12, null, null, null]);
    files.set(`sessions/${jsonOf(gpx)}`, serializeRecord({ ...old, summary: { ...old.summary, optionsKey: key } }));
    const { library, settings } = await openFresh();
    await settle(library);
    setThreshold(settings, 'running', 6);
    await library.queueOutdatedRefresh();
    log.length = 0;
    library.updateSessionRecord(gpx, { analysis: analysis({ activeThreshold: null, savedAt: 2 }) });
    await settle(library);
    for (let i = 0; i < 200 && recordWrites().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await tick();
    expect(JSON.parse(diskRecord(gpx).summary.optionsKey!)[0]).toBe(6);
    expect(diskRecord(gpx).summary.activitySettings?.threshold).toBe(6);
  });

  it('activité changée : ce qui était porté part avec elle, la nouvelle prend les réglages de l\'appareil', async () => {
    putSessions();
    const { library, settings } = await openFresh();
    await settle(library);
    setThreshold(settings, 'running', 4);
    await library.queueOutdatedRefresh();
    log.length = 0;
    const walking = settings.readStoredActivities().find((a) => a.id !== 'running' && a.base === 'running');
    expect(walking).toBeDefined();
    setThreshold(settings, walking!.id, 2);
    library.updateSessionRecord(COURSE, { activityId: walking!.id });
    for (let i = 0; i < 200 && recordWrites().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    await tick();
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(2);
  });
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

  it("seuil de Course changé application fermée : à l'ouverture, les courses sont refaites, seuil propre compris, chiffres de celle-ci identiques", async () => {
    putSessions();
    const first = await openFresh();
    await settle(first.library);
    setThreshold(first.settings, 'running', 4);

    const ownBefore = diskRecord(COURSE_SEUIL).summary;
    log.length = 0;
    const { library } = await openFresh();
    await settle(library);
    expect(gpxReads().sort()).toEqual([COURSE, COURSE_SEUIL].sort());
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());
    const ownAfter = diskRecord(COURSE_SEUIL).summary;
    expect(ownAfter.activitySettings?.threshold).toBe(4);
    expect({ ...ownAfter, activitySettings: null }).toEqual({ ...ownBefore, activitySettings: null });
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
    expect(gpxReads().sort()).toEqual([COURSE, COURSE_SEUIL].sort());
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());

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
    expect(seen).toBe(2);
    expect(gpxReads().sort()).toEqual([COURSE, COURSE_SEUIL].sort());
    expect(recordWrites().sort()).toEqual([COURSE, COURSE_SEUIL].map(jsonOf).sort());
    expect(diskRecord(COURSE).summary.activitySettings?.threshold).toBe(4);
    expect(library.readLibraryState().toUpdate).toBe(0);
    // Le fichier de réglages de l'appareil part 2 s après la saisie : attendu ici, pour ne rien laisser derrière le test.
    await new Promise((r) => setTimeout(r, 1200));
  });
});
