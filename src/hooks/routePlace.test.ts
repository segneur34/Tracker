import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import type { SportType } from '../core/types';
import { routeDisplayName, type RoutePlace } from '../library/routeName';
import { PLACE_DEFAULTS, PLACE_VERSION, type PlaceHolder, type SessionPlace } from '../library/sessionPlace';
import type { PlaceSearchResult } from '../planning/placeQuery';
import type { Waypoint } from '../planning/route';
import { routeToRecord } from '../planning/routeRecord';
import { createRoutePlaceFinder, type RoutePlaceDeps } from './routePlace';
import type { SavedRoute } from './routeFiles';

const AT = '2026-11-20T10:00:00.000Z';
const CREATED = new Date(2026, 10, 20, 12).toISOString();
const START: Waypoint = { lat: 43.6, lon: 3.88 };
/** Point à `northM` mètres au nord du départ, arrondi comme dans la fiche (7 décimales). */
const north = (northM: number): Waypoint => ({ lat: Number((START.lat + northM / M_PER_DEG_LAT).toFixed(7)), lon: START.lon });

const LOOP = [START, north(2000), { lat: START.lat, lon: START.lon + 0.02 }, START];
const FAR = [START, north(20000)];

const saved = (waypoints: Waypoint[], over: { name?: string; activityId?: string | null; place?: RoutePlace; readOnly?: boolean } = {}): SavedRoute => {
  const record = routeToRecord({ waypoints, legs: [] }, { name: over.name ?? '', activityId: over.activityId ?? 'course', createdAt: CREATED, updatedAt: AT });
  return { base: 'b', record: over.place ? { ...record, place: over.place } : record, readOnly: over.readOnly ?? false };
};

const SPORTS: Record<string, SportType> = { course: 'running', wing: 'wingfoil' };

/** Recherche simulée : rend la réponse donnée pour chaque point demandé, et note les requêtes. */
const setup = (answer: (start: Waypoint, end: Waypoint | null, water: boolean) => PlaceSearchResult | Error, sessions: PlaceHolder[] = []) => {
  const requests: { start: Waypoint; end: Waypoint | null; water: boolean }[] = [];
  const saves: { base: string; place: RoutePlace; expected: string }[] = [];
  const deps: RoutePlaceDeps = {
    search: async (start, end, water) => {
      requests.push({ start, end, water });
      const result = answer(start, end, water);
      if (result instanceof Error) throw result;
      return result;
    },
    sportOf: (id) => (id ? SPORTS[id] ?? null : null),
    sessions: () => sessions,
    save: async (base, place, expected) => {
      saves.push({ base, place, expected });
      return null;
    },
    params: PLACE_DEFAULTS,
    pauseMs: 0,
    now: () => AT,
  };
  return { find: createRoutePlaceFinder(deps), requests, saves };
};

const result = (over: Partial<PlaceSearchResult> = {}): PlaceSearchResult => ({ startCommune: 'Montpellier', endCommune: null, water: [], ...over });

/** Nom montré une fois le lieu rangé. */
const nameWith = (route: SavedRoute, place: RoutePlace) => routeDisplayName({ ...route.record, place });

describe('lieu d\'un itinéraire, cherché en fond (lot 236)', () => {
  it('boucle à pied : une requête de commune, le lieu rangé sans toucher à la date de rangement', async () => {
    const { find, requests, saves } = setup(() => result());
    const route = saved(LOOP);
    await find(route);
    expect(requests).toEqual([{ start: START, end: null, water: false }]);
    expect(saves).toHaveLength(1);
    expect(saves[0].expected).toBe(AT);
    expect(nameWith(route, saves[0].place)).toBe('Boucle à Montpellier le 20/11');
  });

  it('aller lointain à pied : départ et arrivée dans la même requête', async () => {
    const { find, requests, saves } = setup(() => result({ endCommune: 'Sète' }));
    const route = saved(FAR);
    await find(route);
    expect(requests).toEqual([{ start: START, end: FAR[1], water: false }]);
    expect(nameWith(route, saves[0].place)).toBe('Aller de Montpellier à Sète le 20/11');
  });

  it('aller lointain en voile : le plan d\'eau de l\'arrivée par une seconde requête', async () => {
    const atStart = (p: Waypoint) => p.lat === START.lat;
    const { find, requests, saves } = setup((start) => result({
      water: [{ name: atStart(start) ? 'Plage de Carnon' : 'Port de Palavas', kind: atStart(start) ? 'plage' : 'port', lat: start.lat, lon: start.lon }],
    }));
    const route = saved(FAR, { activityId: 'wing' });
    await find(route);
    expect(requests).toEqual([{ start: START, end: null, water: true }, { start: FAR[1], end: null, water: true }]);
    expect(nameWith(route, saves[0].place)).toBe('Aller de Plage de Carnon à Port de Palavas le 20/11');
  });

  it('sans réseau : rien de rangé, cherché de nouveau à l\'occasion suivante', async () => {
    let online = false;
    const { find, requests, saves } = setup(() => (online ? result() : new Error('Pas de réseau')));
    const route = saved(LOOP);
    expect(await find(route)).toBeNull();
    expect(saves).toHaveLength(0);
    online = true;
    await find(route);
    expect(requests).toHaveLength(2);
    expect(saves).toHaveLength(1);
  });

  it('arrivée en voile sans réponse : le départ est rangé, l\'arrivée reste à chercher', async () => {
    const { find, saves } = setup((start) => (start.lat === START.lat ? result({ water: [{ name: 'Plage de Carnon', kind: 'plage', lat: null, lon: null }] }) : new Error('x')));
    const route = saved(FAR, { activityId: 'wing' });
    await find(route);
    expect(saves[0].place.end).toBeUndefined();
    expect(nameWith(route, saves[0].place)).toBe('Aller de Plage de Carnon le 20/11');
  });

  it('rien à faire : nom saisi, fiche d\'une version plus récente, lieu à jour', async () => {
    const { find, requests } = setup(() => result());
    await find(saved(LOOP, { name: 'Tour du Pic' }));
    await find(saved(LOOP, { readOnly: true }));
    const place: RoutePlace = {
      name: 'Montpellier', kind: 'commune', search: 'commune', source: 'osm', version: PLACE_VERSION, fetchedAt: AT, start: START,
    };
    await find(saved(LOOP, { place }));
    expect(requests).toHaveLength(0);
  });

  it('un lieu corrigé sur une session partie tout près est repris sans requête', async () => {
    const corrected: SessionPlace = { name: 'Le Lez', kind: 'commune', search: 'commune', source: 'user', version: PLACE_VERSION, fetchedAt: AT };
    const session: PlaceHolder = { sport: 'running', summary: { start: north(100), end: north(100) }, place: corrected };
    const { find, requests, saves } = setup(() => result(), [session]);
    const route = saved(LOOP);
    await find(route);
    expect(requests).toHaveLength(0);
    expect(nameWith(route, saves[0].place)).toBe('Boucle à Le Lez le 20/11');
  });

  it('sans activité : la commune, sans reprise de lieu', async () => {
    const { find, requests } = setup(() => result());
    await find(saved(LOOP, { activityId: null }));
    expect(requests).toEqual([{ start: START, end: null, water: false }]);
  });

  it('une recherche à la fois', async () => {
    let active = 0;
    let most = 0;
    const { find } = setup(() => result());
    const slow = createRoutePlaceFinder({
      search: async () => {
        active += 1;
        most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return result();
      },
      sportOf: () => 'running', sessions: () => [], save: async () => null, params: PLACE_DEFAULTS, pauseMs: 0, now: () => AT,
    });
    await Promise.all([slow(saved(LOOP)), slow(saved(FAR)), find(saved(LOOP))]);
    expect(most).toBe(1);
  });
});
