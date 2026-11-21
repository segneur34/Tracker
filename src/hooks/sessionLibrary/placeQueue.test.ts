import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRecordWithRaw } from '../../library/record';
import { PLACE_VERSION, type SessionPlace } from '../../library/sessionPlace';
import type { AnalyzedGpx } from '../../library/summaryOptions';
import { PLACE_NO_NETWORK, type PlaceSearchResult } from '../../planning/placeQuery';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { trackTestTimers } from '../../test/library.fixture';
import { createFakeFolder } from '../../test/memoryFolder.fixture';
import { sessionRecord } from '../../test/record.fixture';
import type { PlaceFetcher } from './placeQueue';
import type { SummaryRunner } from './summaryQueue';

/**
 * File du lieu des sessions (lot 215), avec une fausse recherche sur le réseau : la plus récente d'abord, un lieu
 * déjà trouvé tout près recopié sans requête, une seconde au moins entre deux requêtes ; hors ligne, la file
 * s'arrête et reprend à l'occasion suivante ; une réponse illisible n'est pas retentée dans le même lancement ; un
 * lieu corrigé vaut pour les sessions parties à côté.
 */

const files = new Map<string, string>();
const log: string[] = [];
const fakeFolder: MemoryFolder = createFakeFolder(files, log);

const START_MS = Date.UTC(2026, 10, 4, 8, 0, 0);
/** Départ de chaque trace, par rang : 0 et 1 à 50 m l'une de l'autre, 2 à une dizaine de kilomètres. */
const STARTS = [{ lat: 43.6, lon: 3.8 }, { lat: 43.60045, lon: 3.8 }, { lat: 43.7, lon: 3.8 }];
const NAMES = ['a.gpx', 'b.gpx', 'c.gpx'];

/** Résumé du faux calcul : une course partie d'autant de minutes que son rang, de son départ. */
const analyzedAt = (index: number): AnalyzedGpx => ({
  summary: { ...sessionRecord().summary, startMs: START_MS + index * 60_000, start: STARTS[index], end: STARTS[index] },
  sport: 'running',
  title: `Trace ${index}`,
});

const fakeRunner: SummaryRunner = async (text) => analyzedAt(Number(/rang="(\d)"/.exec(text)?.[1]));

/** Fausse recherche : la commune dit la latitude du départ demandé. */
const answer = (start: { lat: number }): PlaceSearchResult => ({ startCommune: `Ville ${start.lat}`, endCommune: null, water: [] });

const openFresh = async () => {
  vi.resetModules();
  vi.doMock('../../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  const library = await import('../useSessionLibrary');
  const summaries = await import('./summaryQueue');
  const places = await import('./placeQueue');
  summaries.setSummaryRunner(fakeRunner);
  return { library, places, summaries };
};

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

const waitFor = async (what: string, done: () => boolean): Promise<void> => {
  for (let i = 0; i < 20_000 && !done(); i++) await turn();
  if (!done()) throw new Error(`attendu : ${what}`);
};

type Opened = Awaited<ReturnType<typeof openFresh>>;

/** Lieu de la session d'un fichier, dans la liste publiée. */
const placeOf = (library: Opened['library'], file: string): SessionPlace | undefined =>
  library.readLibraryState().sessions.find((s) => s.file === file)?.record.place;

/** Ouvre la mémoire, attend la fin du balayage et du passage de la file. */
const openAndSettle = async ({ library, places }: Opened): Promise<void> => {
  await library.openLibrary();
  await waitFor('balayage fini', () => library.readLibraryState().scanning === null && library.readLibraryState().sessions.length === NAMES.length);
  await turn();
  await places.placePass();
};

let stopTestTimers: () => void = () => undefined;
beforeEach(() => {
  files.clear();
  log.length = 0;
  NAMES.forEach((name, i) => files.set(`sessions/${name}`, `<gpx rang="${i}"></gpx>`));
  stopTestTimers = trackTestTimers();
});
afterEach(() => {
  stopTestTimers();
  vi.doUnmock('../../platform/memoryFolder');
});

describe('file du lieu des sessions (lot 215)', () => {
  it('ne cherche rien tant que la recherche n\'est pas lancée', async () => {
    const opened = await openFresh();
    await openAndSettle(opened);
    expect(placeOf(opened.library, 'c.gpx')).toBeUndefined();
    opened.summaries.setSummaryRunner(null);
  });

  it('la plus récente d\'abord, un lieu tout près recopié sans requête, une seconde entre deux requêtes', async () => {
    const opened = await openFresh();
    const calls: { start: { lat: number }; at: number }[] = [];
    const fetcher = vi.fn<PlaceFetcher>(async (start) => {
      calls.push({ start, at: Date.now() });
      return answer(start);
    });
    opened.places.startPlaceSearch(fetcher);
    await openAndSettle(opened);
    opened.summaries.setSummaryRunner(null);
    // c (la plus récente), puis b ; a, à 50 m de b, reprend son lieu sans requête.
    expect(calls.map((c) => c.start.lat)).toEqual([43.7, 43.60045]);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(990);
    // Course : la commune, sans plan d'eau ; départ et arrivée confondus, pas d'arrivée demandée.
    expect(fetcher.mock.calls[0].slice(1, 3)).toEqual([null, false]);
    expect(placeOf(opened.library, 'c.gpx')).toMatchObject({ name: 'Ville 43.7', kind: 'commune', search: 'commune', source: 'osm', version: PLACE_VERSION });
    expect(placeOf(opened.library, 'b.gpx')?.name).toBe('Ville 43.60045');
    expect(placeOf(opened.library, 'a.gpx')?.name).toBe('Ville 43.60045');
    // Rangé dans la fiche, comme une saisie.
    await waitFor('fiche écrite', () => parseRecordWithRaw(files.get('sessions/c.json') ?? '')?.parts.place?.name === 'Ville 43.7');
  });

  it('hors ligne : la file s\'arrête sans rien ranger, et reprend à l\'occasion suivante', async () => {
    const opened = await openFresh();
    let online = false;
    const fetcher = vi.fn<PlaceFetcher>(async (start) => {
      if (!online) throw new Error(PLACE_NO_NETWORK);
      return answer(start);
    });
    opened.places.startPlaceSearch(fetcher);
    await openAndSettle(opened);
    opened.summaries.setSummaryRunner(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(placeOf(opened.library, 'c.gpx')).toBeUndefined();
    online = true;
    opened.places.queuePlaces();
    await opened.places.placePass();
    expect(placeOf(opened.library, 'c.gpx')?.name).toBe('Ville 43.7');
    expect(placeOf(opened.library, 'a.gpx')?.name).toBe('Ville 43.60045');
  });

  it('réponse illisible : la session n\'est pas retentée dans le même lancement, les autres le sont', async () => {
    const opened = await openFresh();
    const fetcher = vi.fn<PlaceFetcher>(async (start) => {
      if (start.lat === 43.7) throw new Error('Réponse du serveur d\'OpenStreetMap illisible.');
      return answer(start);
    });
    opened.places.startPlaceSearch(fetcher);
    await openAndSettle(opened);
    opened.summaries.setSummaryRunner(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
    opened.places.queuePlaces();
    await opened.places.placePass();
    expect(fetcher.mock.calls.map(([start]) => start.lat)).toEqual([43.7, 43.60045]);
    expect(placeOf(opened.library, 'c.gpx')).toBeUndefined();
    expect(placeOf(opened.library, 'b.gpx')?.name).toBe('Ville 43.60045');
  });

  it('un lieu corrigé vaut pour les sessions parties à côté, et n\'est jamais cherché de nouveau', async () => {
    const opened = await openFresh();
    const fetcher = vi.fn<PlaceFetcher>(async (start) => answer(start));
    opened.places.startPlaceSearch(fetcher);
    await openAndSettle(opened);
    opened.summaries.setSummaryRunner(null);
    const before = fetcher.mock.calls.length;
    const user: SessionPlace = { name: 'Le Grand Travers', kind: 'commune', search: 'commune', source: 'user', version: PLACE_VERSION, fetchedAt: 'x' };
    opened.library.updateSessionRecord('b.gpx', { name: null, place: user });
    expect(placeOf(opened.library, 'b.gpx')).toEqual(user);
    expect(placeOf(opened.library, 'a.gpx')).toMatchObject({ name: 'Le Grand Travers', source: 'appris' });
    // c, à dix kilomètres, garde le sien.
    expect(placeOf(opened.library, 'c.gpx')?.name).toBe('Ville 43.7');
    opened.places.queuePlaces();
    await opened.places.placePass();
    expect(fetcher).toHaveBeenCalledTimes(before);
  });
});
