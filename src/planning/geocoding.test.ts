import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePhoton, photonUrl, searchPlaces } from './geocoding';

describe('Photon', () => {
  it('cherche en français, près du centre de la carte', () => {
    const url = photonUrl('pic saint loup', { lat: 43.61234, lon: 3.87654 });
    expect(url).toBe('https://photon.komoot.io/api/?q=pic+saint+loup&limit=6&lang=fr&lat=43.6123&lon=3.8765');
  });

  it('lit nom, situation et position des lieux', () => {
    // Extrait réel (25/09/2026), plus une entrée sans position et une adresse sans nom.
    const places = parsePhoton({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Refuge de la Pra', street: 'Crête NW Grand Colon', city: 'Revel', county: 'Isère', country: 'France' },
          geometry: { type: 'Point', coordinates: [5.9445494, 45.1615471] },
        },
        { type: 'Feature', properties: { name: 'Sans position' }, geometry: { type: 'Point' } },
        {
          type: 'Feature',
          properties: { housenumber: '3', street: 'Rue de la Loge', city: 'Montpellier', county: 'Hérault', country: 'France' },
          geometry: { type: 'Point', coordinates: [3.877, 43.61] },
        },
        { type: 'Feature', properties: { name: 'Montpellier', city: 'Montpellier', country: 'France' }, geometry: { type: 'Point', coordinates: [3.87, 43.61] } },
      ],
    });
    expect(places).toEqual([
      { label: 'Refuge de la Pra', detail: 'Revel, Isère, France', lat: 45.1615471, lon: 5.9445494 },
      { label: '3 Rue de la Loge', detail: 'Montpellier, Hérault, France', lat: 43.61, lon: 3.877 },
      { label: 'Montpellier', detail: 'France', lat: 43.61, lon: 3.87 },
    ]);
    expect(parsePhoton(null)).toEqual([]);
  });
});

describe('recherche de lieux par le serveur', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('une réponse illisible donne un message en français', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }));
    await expect(searchPlaces('pic')).rejects.toThrow('Réponse de la recherche de lieux illisible.');
  });
});
