import { describe, expect, it } from 'vitest';
import { brouterErrorMessage, brouterUrl, parseBrouterGeojson, parseBrouterMessages, parseProfileUpload } from './brouter';
import {
  BROUTER_PROFILE_TEXT, WAY_CATEGORIES, WAY_CATEGORY_HIGHWAYS, WAY_PARAM, WAY_PREFERENCE_COST, buildBrouterProfile,
} from './brouterProfile';
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
  it('demande un tronçon en longitude, latitude, avec le profil envoyé, le type de voie et les règles d\'accès', () => {
    expect(brouterUrl({ lat: 43.6108, lon: 3.8767 }, { lat: 43.62, lon: 3.89 }, 'chemin', 'pieton', 'custom_42')).toBe(
      'https://brouter.de/brouter?lonlats=3.876700,43.610800|3.890000,43.620000&profile=custom_42'
        + '&profile:voie=1&profile:velo=0&alternativeidx=0&format=geojson'
    );
    const A = { lat: 0, lon: 0 };
    const B = { lat: 1, lon: 1 };
    expect(brouterUrl(A, B, 'piste', 'velo', 'custom_42')).toContain('&profile:voie=2&profile:velo=1&');
    expect(brouterUrl(A, B, 'route', 'velo', 'custom_42')).toContain('&profile:voie=3&');
    expect(brouterUrl(A, B, 'grandeRoute', 'pieton', 'custom_42')).toContain('&profile:voie=4&profile:velo=0&');
  });

  it('lit l\'id rendu à l\'envoi du profil, ou le refus du serveur', () => {
    expect(parseProfileUpload({ profileid: 'custom_1790885483132' })).toBe('custom_1790885483132');
    expect(() => parseProfileUpload({ profileid: 'custom_1', error: 'syntax error at line 12' })).toThrow(/refuse le profil.*line 12/);
    expect(() => parseProfileUpload({ profileid: '../trekking' })).toThrow(/illisible/);
    expect(() => parseProfileUpload('Please, retry later!')).toThrow(/illisible/);
  });

  it('lit la géométrie et l\'altitude, et écarte les points illisibles', () => {
    expect(parseBrouterGeojson(BROUTER_RESPONSE)).toEqual({
      points: [
        { lat: 43.610874, lon: 3.876718, eleM: 47 },
        { lat: 43.610848, lon: 3.876918, eleM: 47 },
        { lat: 43.610893, lon: 3.877033 },
      ],
    });
  });

  it('tire les voies suivies de `messages` : chaque ligne finit au point du tracé qui porte ses coordonnées', () => {
    // Forme des réponses de brouter.de (04/10/2026), coordonnées et étiquettes synthétiques.
    const points = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: 43.6 + i * 0.001, lon: 3.85 }));
    const row = (i: number, tags: string) => [String(3_850_000), String(43_600_000 + i * 1000), '50', '111', '1000', '0', '0', '0', '0', tags, '', '0', '0'];
    const messages = [
      ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'],
      row(2, 'reversedirection=yes highway=residential surface=asphalt oneway=yes'),
      row(3, 'highway=track tracktype=grade2 estimated_forest_class=5'),
      row(5, 'highway=track tracktype=grade2 estimated_forest_class=6'),
    ];
    expect(parseBrouterMessages(messages, points)).toEqual({
      tags: ['highway=residential surface=asphalt', 'highway=track tracktype=grade2'],
      runs: [[0, 0], [2, 1]],
    });
    const response = { features: [{ geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) }, properties: { messages } }] };
    expect(parseBrouterGeojson(response).surfaces?.runs).toEqual([[0, 0], [2, 1]]);
  });

  it('laisse le revêtement inconnu si `messages` manque ou ne colle pas au tracé', () => {
    const points = [{ lat: 43.6, lon: 3.85 }, { lat: 43.601, lon: 3.85 }];
    const header = ['Longitude', 'Latitude', 'WayTags'];
    expect(parseBrouterMessages(undefined, points)).toBeUndefined();
    expect(parseBrouterMessages([header], points)).toBeUndefined();
    expect(parseBrouterMessages([['Longitude', 'Latitude'], ['3850000', '43601000']], points)).toBeUndefined();
    expect(parseBrouterMessages([header, ['3900000', '43601000', 'highway=path']], points)).toBeUndefined();
    expect(parseBrouterMessages([header, ['3850000', '43601000', 'highway=path']], points)).toEqual({ tags: ['highway=path'], runs: [[0, 0]] });
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

describe('profil de calcul', () => {
  it('déclare ses deux variables, réglables par l\'adresse', () => {
    expect(BROUTER_PROFILE_TEXT).toMatch(/^assign voie = 1 # %voie%/m);
    expect(BROUTER_PROFILE_TEXT).toMatch(/^assign velo = 0 # %velo%/m);
    expect(BROUTER_PROFILE_TEXT).toContain('---context:global');
    expect(BROUTER_PROFILE_TEXT).toContain('---context:way');
    expect(BROUTER_PROFILE_TEXT).toContain('---context:node');
    // Toutes les étiquettes connues du serveur sortent dans `messages`, d'où le revêtement.
    expect(BROUTER_PROFILE_TEXT).toMatch(/^assign processUnusedTags true$/m);
  });

  it('reprend les catégories de voie et les coûts de chaque type', () => {
    WAY_CATEGORIES.forEach((c, i) => {
      expect(BROUTER_PROFILE_TEXT).toContain(`if highway=${WAY_CATEGORY_HIGHWAYS[c].join('|')} then ${i + 1}`);
    });
    for (const mode of Object.keys(WAY_PARAM) as (keyof typeof WAY_PARAM)[]) {
      const c = WAY_PREFERENCE_COST[mode];
      expect(BROUTER_PROFILE_TEXT).toContain(
        `( if equal categorie 1 then ${c.chemin} else if equal categorie 2 then ${c.piste} else if equal categorie 3 then ${c.route} else ${c.grande} )`
      );
    }
    // Un coût changé change le texte.
    const cheaper = buildBrouterProfile({ ...WAY_PREFERENCE_COST, piste: { ...WAY_PREFERENCE_COST.piste, chemin: 1.1 } });
    expect(cheaper).toContain('if equal categorie 1 then 1.1 else');
    expect(cheaper).not.toBe(BROUTER_PROFILE_TEXT);
  });

  it('reste en ASCII, et chaque type a sa propre valeur de voie', () => {
    expect([...BROUTER_PROFILE_TEXT].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(new Set(Object.values(WAY_PARAM)).size).toBe(4);
  });
});
