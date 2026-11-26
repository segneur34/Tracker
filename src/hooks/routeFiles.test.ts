import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryFolder } from '../platform/memoryFolder';
import type { RoutePlace } from '../library/routeName';
import type { PlannedRoute } from '../planning/route';
import { parseRouteRecord } from '../planning/routeRecord';
import { settle, trackTestTimers } from '../test/library.fixture';
import { createFakeFolder } from '../test/memoryFolder.fixture';

/**
 * File des écritures d'un itinéraire (lot 236) : un « Enregistrer » et le lieu trouvé en fond ne se croisent pas.
 * Le faux dossier rend la main entre chaque lecture et écriture, comme un vrai : sans file, la fiche relue par le
 * lieu écraserait celle qu'on vient d'enregistrer.
 */

const files = new Map<string, string>();
const log: string[] = [];
let failNextWrite = false;

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 2));

const fakeFolder: MemoryFolder = createFakeFolder(files, log, {
  readText: async (path) => {
    await pause();
    return files.get(path) ?? null;
  },
  writeText: async (path, text) => {
    await pause();
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error('écriture refusée');
    }
    log.push(`write ${path}`);
    files.set(path, text);
  },
});

const ROUTE: PlannedRoute = {
  waypoints: [{ lat: 43.6, lon: 3.88 }, { lat: 43.61, lon: 3.88 }],
  legs: [{ mode: 'straight', status: 'ready', points: [{ lat: 43.6, lon: 3.88 }, { lat: 43.61, lon: 3.88 }] }],
};

const PLACE: RoutePlace = {
  name: 'Montpellier', kind: 'commune', search: 'commune', source: 'osm', version: 1, fetchedAt: '2026-11-26T10:00:00.000Z',
  start: { lat: 43.6, lon: 3.88 },
};

const launch = async () => {
  vi.resetModules();
  vi.doMock('../platform/memoryFolder', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../platform/memoryFolder')>()),
    openMemoryFolder: async () => ({ state: 'ready', folder: fakeFolder }),
    pendingFolder: () => null,
  }));
  const library = await import('./useSessionLibrary');
  await library.openLibrary();
  await settle(library);
  return import('./routeFiles');
};

/** Fiche rangée de l'itinéraire, relue du faux dossier. */
const stored = (base: string) => parseRouteRecord(files.get(`itineraires/${base}.json`) ?? '');

let stopTimers = () => {};
beforeEach(() => {
  files.clear();
  log.length = 0;
  failNextWrite = false;
  stopTimers = trackTestTimers();
});
afterEach(() => {
  stopTimers();
  vi.doUnmock('../platform/memoryFolder');
});

describe('écritures d\'un itinéraire en file (lot 236)', () => {
  it('le lieu arrive avant « Enregistrer » avec un nom : le nom saisi reste, le lieu aussi', async () => {
    const { saveRoute, saveRoutePlace } = await launch();
    const first = await saveRoute(ROUTE, { name: '', activityId: null });
    await pause();
    const place = saveRoutePlace(first.base, PLACE, first.record.updatedAt);
    const named = saveRoute(ROUTE, { name: 'Tour du Pic', activityId: null }, first);
    expect(await place).not.toBeNull();
    await named;
    expect(stored(first.base)?.name).toBe('Tour du Pic');
    expect(stored(first.base)?.place).toEqual(PLACE);
  });

  it('« Enregistrer » avec un nom avant le lieu : le lieu renonce, la fiche n\'est pas réécrite par lui', async () => {
    const { saveRoute, saveRoutePlace } = await launch();
    const first = await saveRoute(ROUTE, { name: '', activityId: null });
    await pause();
    const named = saveRoute(ROUTE, { name: 'Tour du Pic', activityId: null }, first);
    const place = saveRoutePlace(first.base, PLACE, first.record.updatedAt);
    await named;
    expect(await place).toBeNull();
    expect(stored(first.base)?.name).toBe('Tour du Pic');
    expect(stored(first.base)?.place).toBeUndefined();
  });

  it('re-rangé sans nom avant le lieu : le lieu, cherché pour l\'ancienne fiche, n\'est pas rangé', async () => {
    const { saveRoute, saveRoutePlace } = await launch();
    const first = await saveRoute(ROUTE, { name: '', activityId: null });
    await pause();
    const again = saveRoute(ROUTE, { name: '', activityId: 'running' }, first);
    const place = saveRoutePlace(first.base, PLACE, first.record.updatedAt);
    await again;
    expect(await place).toBeNull();
    expect(stored(first.base)?.activityId).toBe('running');
    expect(stored(first.base)?.place).toBeUndefined();
  });

  it('une écriture qui échoue ne bloque pas la suivante de la file', async () => {
    const { saveRoute, saveRoutePlace } = await launch();
    const first = await saveRoute(ROUTE, { name: '', activityId: null });
    await pause();
    failNextWrite = true;
    const failed = saveRoute(ROUTE, { name: 'Perdu', activityId: null }, first);
    const place = saveRoutePlace(first.base, PLACE, first.record.updatedAt);
    await expect(failed).rejects.toThrow('écriture refusée');
    // Le GPX n'a pas été écrit, la fiche non plus : le lieu trouve la fiche inchangée et se range.
    expect(await place).not.toBeNull();
    expect(stored(first.base)?.place).toEqual(PLACE);
    expect(stored(first.base)?.name).toBe('');
  });

  it('deux itinéraires neufs rangés en même temps ne prennent pas le même nom de fichier', async () => {
    const { saveRoute } = await launch();
    const [a, b] = await Promise.all([saveRoute(ROUTE, { name: 'Tour', activityId: null }), saveRoute(ROUTE, { name: 'Tour', activityId: null })]);
    expect(new Set([a.base, b.base]).size).toBe(2);
  });
});
