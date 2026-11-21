import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLACE_BUSY, PLACE_NO_NETWORK, PLACE_QUERY_MARK, fetchPlaceSearch, isPlaceNetworkError, parsePlaceSearch, placeQuery, waterKindOf,
} from './placeQuery';

const START = { lat: 43.548, lon: 3.98 };
const END = { lat: 43.6108, lon: 3.8767 };

/**
 * Réponse de la forme que rend Overpass (relevée le 21/11 autour de Carnon, réduite) : commune du départ,
 * compte, commune de l'arrivée, compte, puis les plans d'eau avec leur centre.
 */
const RESPONSE = {
  version: 0.6,
  elements: [
    { type: 'area', id: 3600269999, tags: { name: 'Mauguio', admin_level: '8' } },
    { type: 'count', id: 0, tags: { total: '1' } },
    { type: 'area', id: 3600028722, tags: { name: 'Montpellier', admin_level: '8' } },
    { type: 'count', id: 0, tags: { total: '1' } },
    { type: 'way', id: 1, center: { lat: 43.5809, lon: 4.0306 }, tags: { name: 'Étang de l\'Or', natural: 'water', water: 'lagoon' } },
    { type: 'way', id: 2, center: { lat: 43.5531, lon: 3.9699 }, tags: { name: 'Port de Plaisance', natural: 'water', leisure: 'marina' } },
    { type: 'way', id: 3, center: { lat: 43.547, lon: 3.9919 }, tags: { name: 'Carnon-Plage', natural: 'beach' } },
    { type: 'node', id: 4, lat: 43.549, lon: 3.981, tags: { name: 'Plage du Petit Travers', natural: 'beach' } },
    { type: 'relation', id: 5, tags: { name: 'Golfe d\'Aigues-Mortes', natural: 'bay' } },
    { type: 'way', id: 6, center: { lat: 43.55, lon: 3.98 }, tags: { natural: 'beach' } },
    { type: 'way', id: 7, center: { lat: 43.55, lon: 3.98 }, tags: { name: 'Parking', amenity: 'parking' } },
  ],
};

describe('lieu d\'une session demandé à Overpass (lot 215)', () => {
  it('demande la commune du départ, celle de l\'arrivée, puis les plans d\'eau nommés autour du départ', () => {
    expect(placeQuery(START, null, false, 1500)).toBe(
      '[out:json][timeout:25];/*tracker-lieu*/is_in(43.548000,3.980000)->.a;area.a[boundary=administrative][admin_level=8];out tags;out count;'
    );
    const full = placeQuery(START, END, true, 1500.4);
    expect(full).toContain('is_in(43.610800,3.876700)->.b;area.b[boundary=administrative][admin_level=8];out tags;out count;');
    expect(full).toContain('nwr(around:1500,43.548000,3.980000)[name][natural~"^(beach|bay|water)$"];');
    expect(full).toContain('nwr(around:1500,43.548000,3.980000)[name][leisure=marina];');
    expect(full.endsWith(');out tags center;')).toBe(true);
  });

  it('range plages, ports, baies et plans d\'eau ; un port posé sur l\'eau reste un port', () => {
    expect(waterKindOf({ natural: 'beach' })).toBe('plage');
    expect(waterKindOf({ natural: 'water', leisure: 'marina' })).toBe('port');
    expect(waterKindOf({ harbour: 'yes' })).toBe('port');
    expect(waterKindOf({ harbour: 'no', natural: 'water' })).toBe('eau');
    expect(waterKindOf({ landuse: 'harbour' })).toBe('port');
    expect(waterKindOf({ natural: 'bay' })).toBe('baie');
    expect(waterKindOf({ amenity: 'parking' })).toBeNull();
  });

  it('lit les communes de chaque bloc et les plans d\'eau nommés, sans les éléments inutiles', () => {
    const found = parsePlaceSearch(RESPONSE, true);
    expect(found.startCommune).toBe('Mauguio');
    expect(found.endCommune).toBe('Montpellier');
    expect(found.water.map((w) => [w.name, w.kind])).toEqual([
      ['Étang de l\'Or', 'eau'], ['Port de Plaisance', 'port'], ['Carnon-Plage', 'plage'], ['Plage du Petit Travers', 'plage'],
      ['Golfe d\'Aigues-Mortes', 'baie'],
    ]);
    expect(found.water[3]).toMatchObject({ lat: 43.549, lon: 3.981 });
    // Sans centre donné : position inconnue.
    expect(found.water[4]).toMatchObject({ lat: null, lon: null });
    // L'arrivée non demandée n'est pas lue.
    expect(parsePlaceSearch(RESPONSE, false).endCommune).toBeNull();
  });

  it('départ en mer : aucune commune dans le premier bloc, celle de l\'arrivée reste à sa place', () => {
    const found = parsePlaceSearch({ elements: [
      { type: 'count', id: 0, tags: { total: '0' } },
      { type: 'area', id: 1, tags: { name: 'Sète' } },
      { type: 'count', id: 0, tags: { total: '1' } },
    ] }, true);
    expect(found).toEqual({ startCommune: null, endCommune: 'Sète', water: [] });
  });

  it('refuse une réponse abîmée ou interrompue', () => {
    expect(() => parsePlaceSearch('<html>', false)).toThrow(/illisible/);
    expect(() => parsePlaceSearch({ elements: 'x' }, false)).toThrow(/illisible/);
    expect(() => parsePlaceSearch({ elements: [], remark: 'runtime error: Query timed out' }, false)).toThrow(/pas pu finir/);
    // Éléments mal formés : ignorés.
    expect(parsePlaceSearch({ elements: [null, 3, { type: 'area' }, { type: 'way', tags: { name: 'X' } }] }, false))
      .toEqual({ startCommune: null, endCommune: null, water: [] });
  });
});

describe('marqueur des requêtes de lieu, lu aussi par le banc (lot 215)', () => {
  it('chaque requête porte le marqueur, le même texte que celui du banc', async () => {
    expect(placeQuery(START, END, true, 1500)).toContain(PLACE_QUERY_MARK);
    expect(placeQuery(START, null, false, 1500)).toContain(PLACE_QUERY_MARK);
    // Les types de Node ne sont pas ceux de l'app (voir `hooks/sessionLibrary/couches.test.ts`) : décrits à la main.
    const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(file: URL, encoding: 'utf8'): string };
    const banc = fs.readFileSync(new URL('../../outils/banc/lib/cdp.mjs', import.meta.url), 'utf8');
    expect(banc).toContain(`export const PLACE_QUERY_MARK = '${PLACE_QUERY_MARK}';`);
  });
});

describe('lieu d\'une session : appel réseau', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envoie la requête en POST et lit la réponse', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const found = await fetchPlaceSearch(START, END, true, 1500);
    expect(found.startCommune).toBe('Mauguio');
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');
    expect(String(init.body)).toContain('is_in');
  });

  it('sans réseau ou serveur occupé : un échec passager ; requête refusée : non', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const offline = await fetchPlaceSearch(START, null, false, 1500).catch((err: unknown) => err);
    expect(offline).toBeInstanceOf(Error);
    expect((offline as Error).message).toBe(PLACE_NO_NETWORK);
    expect(isPlaceNetworkError(offline)).toBe(true);

    vi.stubGlobal('fetch', async () => new Response('# 502 Gateway Timeout', { status: 502 }));
    const busy = await fetchPlaceSearch(START, null, false, 1500).catch((err: unknown) => err);
    expect((busy as Error).message).toBe(PLACE_BUSY);
    expect(isPlaceNetworkError(busy)).toBe(true);

    vi.stubGlobal('fetch', async () => new Response('bad request', { status: 400 }));
    const refused = await fetchPlaceSearch(START, null, false, 1500).catch((err: unknown) => err);
    expect((refused as Error).message).toMatch(/erreur 400/);
    expect(isPlaceNetworkError(refused)).toBe(false);
  });
});
