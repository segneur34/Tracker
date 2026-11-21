import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT } from '../test/geo.fixture';
import type { PlaceSearchResult } from '../planning/placeQuery';
import {
  PLACE_DEFAULTS, PLACE_VERSION, choosePlace, learnedPlaceTargets, localPlace, needsArrival, needsPlaceSearch, placeSearchOf,
  readSessionPlace, readSummaryPoint, summaryPoint, type PlaceHolder, type SessionPlace,
} from './sessionPlace';

const AT = '2026-11-21T10:00:00.000Z';
const START = { lat: 43.548, lon: 3.98 };

/** Point à `northM` mètres au nord du départ. */
const north = (northM: number) => ({ lat: START.lat + northM / M_PER_DEG_LAT, lon: START.lon });

const osm = (name: string | null, over: Partial<SessionPlace> = {}): SessionPlace => ({
  name, kind: 'eau', search: 'eau', source: 'osm', version: PLACE_VERSION, fetchedAt: AT, ...over,
});

const holder = (over: Partial<PlaceHolder> = {}, start = START, end = START): PlaceHolder => ({
  sport: 'wingfoil', summary: { start, end }, ...over,
});

const found = (over: Partial<PlaceSearchResult> = {}): PlaceSearchResult => ({ startCommune: 'Mauguio', endCommune: null, water: [], ...over });

describe('lieu d\'une session (lot 215)', () => {
  it('position du résumé arrondie au mètre, relue avec ses bornes', () => {
    expect(summaryPoint(43.5480049, 3.9800051)).toEqual({ lat: 43.548, lon: 3.98001 });
    expect(readSummaryPoint({ lat: 43.5, lon: 3.8 })).toEqual({ lat: 43.5, lon: 3.8 });
    expect(readSummaryPoint({ lat: 91, lon: 3.8 })).toBeNull();
    expect(readSummaryPoint({ lat: '43', lon: 3.8 })).toBeNull();
    expect(readSummaryPoint(null)).toBeNull();
  });

  it('lieu relu, et refusé s\'il est mal formé', () => {
    expect(readSessionPlace(osm('Carnon-Plage'))).toEqual(osm('Carnon-Plage'));
    expect(readSessionPlace(osm(null))).toEqual(osm(null));
    expect(readSessionPlace({ ...osm('Montpellier', { kind: 'commune', search: 'commune' }), to: 'Sète' })?.to).toBe('Sète');
    expect(readSessionPlace({ ...osm('X'), source: 'autre' })).toBeNull();
    expect(readSessionPlace({ ...osm('X'), kind: 'ville' })).toBeNull();
    expect(readSessionPlace({ ...osm('X'), version: 'un' })).toBeNull();
    expect(readSessionPlace({ ...osm('X'), name: '  ' })).toBeNull();
    expect(readSessionPlace('Carnon')).toBeNull();
  });

  it('recherche par famille : le plan d\'eau en voile et en surf, la commune à pied et à vélo, rien sans positions', () => {
    expect(placeSearchOf('wingfoil')).toBe('eau');
    expect(placeSearchOf('surf')).toBe('eau');
    expect(placeSearchOf('running')).toBe('commune');
    expect(placeSearchOf('cycling')).toBe('commune');
    expect(placeSearchOf('muscu')).toBeNull();
    expect(placeSearchOf('night-hr')).toBeNull();
    expect(placeSearchOf(null)).toBeNull();
  });

  it('à chercher : sans lieu, ou lieu d\'OpenStreetMap ancien ou d\'une autre famille ; jamais un lieu corrigé', () => {
    expect(needsPlaceSearch(holder())).toBe(true);
    expect(needsPlaceSearch(holder({ place: osm('Carnon-Plage') }))).toBe(false);
    expect(needsPlaceSearch(holder({ place: osm(null) }))).toBe(false);
    expect(needsPlaceSearch(holder({ place: osm('X', { version: PLACE_VERSION - 1 }) }))).toBe(true);
    // Session passée de la course au wing : la commune trouvée pour la course ne suffit plus.
    expect(needsPlaceSearch(holder({ place: osm('Mauguio', { kind: 'commune', search: 'commune' }) }))).toBe(true);
    expect(needsPlaceSearch(holder({ place: osm('X', { source: 'user', search: 'commune', version: 0 }) }))).toBe(false);
    expect(needsPlaceSearch(holder({ place: osm('X', { source: 'appris', search: 'commune' }) }))).toBe(false);
    // Sans départ, sans positions, à la position vide.
    expect(needsPlaceSearch({ sport: 'wingfoil', summary: {} })).toBe(false);
    expect(needsPlaceSearch(holder({ sport: 'muscu' }))).toBe(false);
    expect(needsPlaceSearch(holder({}, { lat: 0, lon: 0 }))).toBe(false);
  });

  it('arrivée cherchée à pied et à vélo au-delà de 5 km, pas en voile', () => {
    expect(needsArrival(holder({ sport: 'running' }, START, north(5100)), PLACE_DEFAULTS)).toBe(true);
    expect(needsArrival(holder({ sport: 'running' }, START, north(4900)), PLACE_DEFAULTS)).toBe(false);
    expect(needsArrival(holder({ sport: 'wingfoil' }, START, north(20_000)), PLACE_DEFAULTS)).toBe(false);
  });

  it('plan d\'eau : plage, puis port, baie et plan d\'eau ; dans une sorte, le plus proche ; sinon la commune', () => {
    const water = [
      { name: 'Étang de l\'Or', kind: 'eau' as const, lat: START.lat, lon: START.lon },
      { name: 'Port de Plaisance', kind: 'port' as const, lat: START.lat, lon: START.lon },
      { name: 'Palavas Est', kind: 'plage' as const, ...north(1400) },
      { name: 'Carnon-Plage', kind: 'plage' as const, ...north(900) },
      { name: 'Golfe', kind: 'baie' as const, lat: null, lon: null },
    ];
    expect(choosePlace(found({ water }), 'eau', START, AT)).toEqual(osm('Carnon-Plage'));
    expect(choosePlace(found({ water: water.filter((w) => w.kind !== 'plage') }), 'eau', START, AT).name).toBe('Port de Plaisance');
    expect(choosePlace(found({ water: water.filter((w) => w.kind === 'baie' || w.kind === 'eau') }), 'eau', START, AT).name).toBe('Golfe');
    expect(choosePlace(found({ water: water.filter((w) => w.kind === 'eau') }), 'eau', START, AT).name).toBe('Étang de l\'Or');
    expect(choosePlace(found(), 'eau', START, AT)).toEqual(osm('Mauguio', { kind: 'commune' }));
    expect(choosePlace(found({ startCommune: null }), 'eau', START, AT)).toEqual(osm(null, { kind: 'commune' }));
  });

  it('commune : celle du départ, et l\'arrivée si elle en diffère', () => {
    const commune = { kind: 'commune' as const, search: 'commune' as const };
    expect(choosePlace(found({ startCommune: 'Montpellier', endCommune: 'Sète' }), 'commune', START, AT))
      .toEqual(osm('Montpellier', { ...commune, to: 'Sète' }));
    expect(choosePlace(found({ startCommune: 'Montpellier', endCommune: 'Montpellier' }), 'commune', START, AT))
      .toEqual(osm('Montpellier', commune));
    expect(choosePlace(found({ startCommune: null, endCommune: 'Sète' }), 'commune', START, AT)).toEqual(osm('Sète', commune));
    expect(choosePlace(found({ startCommune: null }), 'commune', START, AT)).toEqual(osm(null, commune));
  });

  it('lieu corrigé repris à 499 m, pas à 501 m, et en priorité sur un lieu trouvé', () => {
    const user = (northM: number) => holder({ place: osm('Le Grand Travers', { source: 'user' }) }, north(northM), north(northM));
    expect(localPlace(holder(), [user(499)], PLACE_DEFAULTS, AT)).toEqual(osm('Le Grand Travers', { source: 'appris' }));
    expect(localPlace(holder(), [user(501)], PLACE_DEFAULTS, AT)).toBeNull();
    const nearby = holder({ place: osm('Carnon-Plage') }, north(50), north(50));
    expect(localPlace(holder(), [nearby, user(400)], PLACE_DEFAULTS, AT)?.name).toBe('Le Grand Travers');
    // Le plus proche des lieux corrigés.
    const other = holder({ place: osm('Petit Travers', { source: 'user' }) }, north(100), north(100));
    expect(localPlace(holder(), [user(400), other], PLACE_DEFAULTS, AT)?.name).toBe('Petit Travers');
    // Une session à pied reprend le nom du lieu corrigé, sans arrivée, avec sa recherche.
    expect(localPlace(holder({ sport: 'running' }), [user(10)], PLACE_DEFAULTS, AT)).toEqual(
      osm('Le Grand Travers', { source: 'appris', search: 'commune' }),
    );
  });

  it('lieu déjà trouvé repris à moins de 200 m, de la même recherche, sans arrivée à chercher', () => {
    const at = (northM: number, place: SessionPlace, sport: PlaceHolder['sport'] = 'wingfoil') => holder({ sport, place }, north(northM), north(northM));
    expect(localPlace(holder(), [at(150, osm('Carnon-Plage', { fetchedAt: 'avant' }))], PLACE_DEFAULTS, AT)).toEqual(osm('Carnon-Plage'));
    expect(localPlace(holder(), [at(250, osm('Carnon-Plage'))], PLACE_DEFAULTS, AT)).toBeNull();
    // Recherche différente (une course partie du même parking), version ancienne.
    expect(localPlace(holder(), [at(10, osm('Mauguio', { kind: 'commune', search: 'commune' }), 'running')], PLACE_DEFAULTS, AT)).toBeNull();
    expect(localPlace(holder(), [at(10, osm('X', { version: 0 }))], PLACE_DEFAULTS, AT)).toBeNull();
    // À pied : une course qui va loin cherche son arrivée ; une qui en avait une n'est pas recopiée.
    const run = (over: Partial<SessionPlace>) => osm('Montpellier', { kind: 'commune', search: 'commune', ...over });
    expect(localPlace(holder({ sport: 'running' }, START, north(8000)), [at(10, run({}), 'running')], PLACE_DEFAULTS, AT)).toBeNull();
    expect(localPlace(holder({ sport: 'running' }), [at(10, run({ to: 'Sète' }), 'running')], PLACE_DEFAULTS, AT)).toBeNull();
    expect(localPlace(holder({ sport: 'running' }), [at(10, run({}), 'running')], PLACE_DEFAULTS, AT)).toEqual(run({}));
  });

  it('un lieu corrigé vaut pour les sessions à moins de 500 m, sauf celles corrigées à la main et sans positions', () => {
    const sessions = [
      { id: 'proche', ...holder({ place: osm('Carnon-Plage') }, north(300)) },
      { id: 'loin', ...holder({}, north(600)) },
      { id: 'corrigee', ...holder({ place: osm('Ma plage', { source: 'user' }) }, north(100)) },
      { id: 'apprise', ...holder({ place: osm('Ancien', { source: 'appris' }) }, north(10)) },
      { id: 'muscu', ...holder({ sport: 'muscu' }) },
    ];
    expect(learnedPlaceTargets(START, sessions, PLACE_DEFAULTS).map((s) => s.id)).toEqual(['proche', 'apprise']);
  });
});
