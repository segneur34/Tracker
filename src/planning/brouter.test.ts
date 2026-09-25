import { describe, expect, it } from 'vitest';
import { brouterErrorMessage, brouterUrl, parseBrouterGeojson } from './brouter';
import { parsePhoton, photonUrl } from './geocoding';

/** Extrait réduit d'une réponse réelle de brouter.de (25/09/2026). */
const BROUTER_RESPONSE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { creator: 'BRouter-1.7.10', name: 'brouter_hiking-mountain_0', 'track-length': '1667' },
    geometry: {
      type: 'LineString',
      coordinates: [[3.876718, 43.610874, 47.0], [3.876918, 43.610848, 47.0], [3.877033, 43.610893], ['x', 43.6, 1]],
    },
  }],
};

describe('BRouter', () => {
  it('demande un tronçon en longitude, latitude, avec le profil du mode', () => {
    expect(brouterUrl({ lat: 43.6108, lon: 3.8767 }, { lat: 43.62, lon: 3.89 }, 'foot')).toBe(
      'https://brouter.de/brouter?lonlats=3.876700,43.610800|3.890000,43.620000&profile=hiking-mountain&alternativeidx=0&format=geojson'
    );
    expect(brouterUrl({ lat: 0, lon: 0 }, { lat: 1, lon: 1 }, 'mtb')).toContain('profile=mtb');
  });

  it('lit la géométrie et l\'altitude, et écarte les points illisibles', () => {
    expect(parseBrouterGeojson(BROUTER_RESPONSE)).toEqual([
      { lat: 43.610874, lon: 3.876718, eleM: 47 },
      { lat: 43.610848, lon: 3.876918, eleM: 47 },
      { lat: 43.610893, lon: 3.877033 },
    ]);
  });

  it('refuse une réponse sans ligne', () => {
    expect(() => parseBrouterGeojson({ type: 'FeatureCollection', features: [] })).toThrow();
    expect(() => parseBrouterGeojson('datafile W30_N40.rd5 not found')).toThrow();
  });

  it('traduit les erreurs du serveur', () => {
    expect(brouterErrorMessage(400, 'datafile W30_N40.rd5 not found')).toMatch(/Aucun chemin/);
    expect(brouterErrorMessage(500, 'target island detected for section 0')).toMatch(/Aucun chemin/);
    expect(brouterErrorMessage(500, '')).toMatch(/erreur 500/);
  });
});

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
