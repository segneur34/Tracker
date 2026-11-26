import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import type { Waypoint } from '../planning/route';
import { routeToRecord, type RouteRecord } from '../planning/routeRecord';
import {
  readRoutePlace, routeDisplayName, routeFileLabel, routeKind, routePlaceAt, routePlaceNames, routePlaceQuery, routeRecordWithPlace,
  type RouteNameSource, type RoutePlace,
} from './routeName';
import { PLACE_DEFAULTS, PLACE_VERSION, type SessionPlace } from './sessionPlace';

const AT = '2026-11-20T10:00:00.000Z';
/** Créé le 20/11 à midi heure locale : la même date affichée quel que soit le fuseau du poste. */
const CREATED = new Date(2026, 10, 20, 12).toISOString();
const START: Waypoint = { lat: 43.6, lon: 3.88 };

/** Point à `northM` mètres au nord du départ. */
const north = (northM: number): Waypoint => ({ lat: START.lat + northM / M_PER_DEG_LAT, lon: START.lon });

const LOOP = [START, north(2000), { lat: START.lat, lon: START.lon + 0.02 }, START];
const NEAR = [START, north(3000)];
const FAR = [START, north(20000)];

const commune = (name: string | null, over: Partial<SessionPlace> = {}): SessionPlace => ({
  name, kind: 'commune', search: 'commune', source: 'osm', version: PLACE_VERSION, fetchedAt: AT, ...over,
});

const source = (waypoints: Waypoint[], place?: RoutePlace, name = ''): RouteNameSource => ({ name, waypoints, createdAt: CREATED, place });

describe('nom donné d\'office d\'un itinéraire (lot 236)', () => {
  it('reconnaît une boucle et un aller', () => {
    expect(routeKind(LOOP)).toBe('boucle');
    expect(routeKind(NEAR)).toBe('aller');
    expect(routeKind([START, north(10), START])).toBe('boucle');
    // Deux points confondus ne font pas une boucle (`isLooped` en veut trois).
    expect(routeKind([START, START])).toBe('aller');
    expect(routeKind([])).toBe('aller');
  });

  it('un nom saisi prime toujours', () => {
    expect(routeDisplayName(source(LOOP, routePlaceAt(commune('Montpellier'), START, null), '  Tour du Pic '))).toBe('Tour du Pic');
    expect(routeFileLabel(source(LOOP, undefined, 'Tour du Pic'))).toBe('Tour du Pic');
  });

  it('sans lieu : « Boucle du 20/11 », « Aller du 20/11 »', () => {
    expect(routeDisplayName(source(LOOP))).toBe('Boucle du 20/11');
    expect(routeDisplayName(source(FAR))).toBe('Aller du 20/11');
    // Lieu cherché, rien trouvé : comme sans lieu.
    expect(routeDisplayName(source(LOOP, routePlaceAt(commune(null), START, null)))).toBe('Boucle du 20/11');
  });

  it('avec le lieu : boucle, aller lointain vers une autre commune, aller proche', () => {
    expect(routeDisplayName(source(LOOP, routePlaceAt(commune('Montpellier'), START, null)))).toBe('Boucle à Montpellier le 20/11');
    const far = routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, FAR[1]);
    expect(routeDisplayName(source(FAR, far))).toBe('Aller de Montpellier à Sète le 20/11');
    expect(routeDisplayName(source(NEAR, routePlaceAt(commune('Montpellier'), START, null)))).toBe('Aller de Montpellier le 20/11');
  });

  it('l\'arrivée n\'est citée qu\'à plus de 5 km du départ, comme pour les sessions', () => {
    const place = (end: Waypoint) => routePlaceAt({ ...commune('Montpellier'), to: 'Lattes' }, START, end);
    expect(routePlaceNames(source([START, north(4900)], place(north(4900)))).to).toBeNull();
    expect(routePlaceNames(source([START, north(5100)], place(north(5100)))).to).toBe('Lattes');
    // Une boucle ne cite jamais d'arrivée.
    expect(routePlaceNames(source([START, north(9000), START], place(START))).to).toBeNull();
  });

  it('un point déplacé de plus de 500 m ne cite plus l\'ancien lieu', () => {
    const place = routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, FAR[1]);
    const moved = (startM: number, endM: number) => source([north(startM), north(20000 + endM)], place);
    expect(routeDisplayName(moved(400, 0))).toBe('Aller de Montpellier à Sète le 20/11');
    expect(routeDisplayName(moved(600, 0))).toBe('Aller du 20/11');
    expect(routeDisplayName(moved(0, 600))).toBe('Aller de Montpellier le 20/11');
    // Arrivée jamais cherchée (pas de position `end`) : pas citée.
    expect(routeDisplayName(source(FAR, { ...routePlaceAt(commune('Montpellier'), START, null), to: 'Sète' }))).toBe('Aller de Montpellier le 20/11');
  });

  it('nom des fichiers : date en tête, genre, lieu s\'il est connu', () => {
    expect(routeFileLabel(source(LOOP))).toBe('2026-11-20 Boucle');
    expect(routeFileLabel(source(NEAR))).toBe('2026-11-20 Aller');
    expect(routeFileLabel(source(LOOP, routePlaceAt(commune('Montpellier'), START, null)))).toBe('2026-11-20 Boucle - Montpellier');
    const far = routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, FAR[1]);
    expect(routeFileLabel(source(FAR, far))).toBe('2026-11-20 Aller - Montpellier → Sète');
  });

  it('lieu relu de la fiche, écarté s\'il est mal formé', () => {
    const place = routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, FAR[1]);
    expect(readRoutePlace(JSON.parse(JSON.stringify(place)))).toEqual(place);
    expect(readRoutePlace(commune('Montpellier'))).toBeNull();
    expect(readRoutePlace({ ...place, start: { lat: 'x', lon: 3 } })).toBeNull();
    expect(readRoutePlace({ ...place, end: 'ailleurs' })).toEqual(routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, null));
    expect(readRoutePlace(undefined)).toBeNull();
    // Le nom d'une fiche au lieu mal formé reste lisible, sans lieu.
    expect(routeDisplayName(source(LOOP, { bidon: true } as never))).toBe('Boucle du 20/11');
  });
});

describe('recherche du lieu d\'un itinéraire (lot 236)', () => {
  const holder = (waypoints: Waypoint[], place?: RoutePlace, name = '') => ({ name, waypoints, place });

  it('rien à chercher : nom saisi, moins de deux points, départ sans position', () => {
    expect(routePlaceQuery(holder(LOOP, undefined, 'Tour'), 'commune')).toBeNull();
    expect(routePlaceQuery(holder([START]), 'commune')).toBeNull();
    expect(routePlaceQuery(holder([{ lat: 0, lon: 0 }, north(100)]), 'commune')).toBeNull();
  });

  it('sans lieu : le départ, et l\'arrivée d\'un aller lointain seulement', () => {
    expect(routePlaceQuery(holder(LOOP), 'commune')).toEqual({ start: START, end: null, search: 'commune' });
    expect(routePlaceQuery(holder(NEAR), 'eau')).toEqual({ start: START, end: null, search: 'eau' });
    expect(routePlaceQuery(holder(FAR), 'commune')).toEqual({ start: START, end: FAR[1], search: 'commune' });
  });

  it('lieu à jour : rien ; recherche, version, départ ou arrivée changés : à chercher de nouveau', () => {
    const loop = routePlaceAt(commune('Montpellier'), START, null);
    expect(routePlaceQuery(holder(LOOP, loop), 'commune')).toBeNull();
    // Rien trouvé : pas cherché de nouveau.
    expect(routePlaceQuery(holder(LOOP, routePlaceAt(commune(null), START, null)), 'commune')).toBeNull();
    expect(routePlaceQuery(holder(LOOP, loop), 'eau')).not.toBeNull();
    expect(routePlaceQuery(holder(LOOP, { ...loop, version: PLACE_VERSION - 1 }), 'commune')).not.toBeNull();
    expect(routePlaceQuery(holder([north(600), north(2000), START, north(600)], loop), 'commune')).not.toBeNull();
    const far = routePlaceAt({ ...commune('Montpellier'), to: 'Sète' }, START, FAR[1]);
    expect(routePlaceQuery(holder(FAR, far), 'commune')).toBeNull();
    expect(routePlaceQuery(holder([START, north(20600)], far), 'commune')?.end).toEqual(north(20600));
    // Une boucle devenue aller lointain : l'arrivée n'a jamais été cherchée.
    expect(routePlaceQuery(holder(FAR, loop), 'commune')).toEqual({ start: START, end: FAR[1], search: 'commune' });
    // Un aller lointain devenu proche garde son lieu : l'arrivée n'est simplement plus citée.
    expect(routePlaceQuery(holder(NEAR, far), 'commune')).toBeNull();
  });

  it('le lieu ne se range que dans une fiche inchangée, sans nom saisi, de cette version', () => {
    const route = { waypoints: LOOP, legs: [] };
    const record: RouteRecord = routeToRecord(route, { name: '', activityId: null, createdAt: CREATED, updatedAt: AT });
    const place = routePlaceAt(commune('Montpellier'), START, null);
    expect(routeRecordWithPlace(record, place, AT)).toEqual({ ...record, place });
    expect(routeRecordWithPlace(record, place, 'avant')).toBeNull();
    expect(routeRecordWithPlace({ ...record, name: 'Tour' }, place, AT)).toBeNull();
    expect(routeRecordWithPlace({ ...record, version: 99 }, place, AT)).toBeNull();
  });

  it('seuils passés en paramètre (règle 3)', () => {
    const params = { ...PLACE_DEFAULTS, arrivalMinM: 2000 };
    expect(routePlaceQuery(holder(NEAR), 'commune', params)?.end).toEqual(NEAR[1]);
    const place = routePlaceAt({ ...commune('Montpellier'), to: 'Lattes' }, START, NEAR[1]);
    expect(routeDisplayName(source(NEAR, place), params)).toBe('Aller de Montpellier à Lattes le 20/11');
  });
});
