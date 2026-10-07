import { describe, expect, it } from 'vitest';
import { brouterErrorMessage, brouterUrl, parseBrouterGeojson, parseBrouterMessages, parseProfileUpload } from './brouter';
import {
  BROUTER_PROFILE_TEXT, PEDESTRIAN_HIGHWAY, UNRIDEABLE_TAGS, WAY_COSTS, WAY_TYPES, WAY_TYPE_HIGHWAYS, WAY_TYPE_LEVEL, WAY_TYPE_VARIABLE,
  buildBrouterProfile, profileCombination, type WayType,
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
  it('demande un tronçon en longitude, latitude, avec le profil envoyé, les types de voie cochés et les règles d\'accès', () => {
    expect(brouterUrl({ lat: 43.6108, lon: 3.8767 }, { lat: 43.62, lon: 3.89 }, ['sentier'], 'pieton', 'custom_42')).toBe(
      'https://brouter.de/brouter?lonlats=3.876700,43.610800|3.890000,43.620000&profile=custom_42'
        + '&profile:calcul=1&alternativeidx=0&format=geojson'
    );
    const A = { lat: 0, lon: 0 };
    const B = { lat: 1, lon: 1 };
    expect(brouterUrl(A, B, ['piste'], 'velo', 'custom_42')).toContain('&profile:calcul=18&');
    expect(brouterUrl(A, B, ['sentier', 'piste'], 'velo', 'custom_42')).toContain('&profile:calcul=19&');
    // Plusieurs types cochés, dans n'importe quel ordre : route 4 + grande route 8, plus 16 pour le vélo.
    expect(brouterUrl(A, B, ['grandeRoute', 'route'], 'velo', 'custom_42')).toContain('&profile:calcul=28&');
    expect(brouterUrl(A, B, ['grandeRoute', 'route'], 'pieton', 'custom_42')).toContain('&profile:calcul=12&');
  });

  it('retour d\'une boucle : zones à éviter et variante demandées dans l\'adresse', () => {
    const A = { lat: 0, lon: 0 };
    const B = { lat: 1, lon: 1 };
    const polygons = '0.00000,0.00000,0.00010,0.00000,0.00010,0.00010,200';
    expect(brouterUrl(A, B, ['route'], 'pieton', 'custom_42', { polygons, alternative: 2 })).toBe(
      'https://brouter.de/brouter?lonlats=0.000000,0.000000|1.000000,1.000000&profile=custom_42'
        + `&profile:calcul=4&alternativeidx=2&format=geojson&polygons=${polygons}`
    );
    expect(brouterUrl(A, B, ['route'], 'pieton', 'custom_42', {})).toBe(brouterUrl(A, B, ['route'], 'pieton', 'custom_42'));
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
  /** Profil sur une ligne, espaces réduits : les règles se lisent sans dépendre de la mise en page. */
  const flat = BROUTER_PROFILE_TEXT.replace(/\s+/g, ' ');

  it('déclare une seule variable réglable par l\'adresse, et en tire les types cochés et les règles d\'accès', () => {
    expect(BROUTER_PROFILE_TEXT).toMatch(/^assign calcul = 1 # %calcul%/m);
    expect(BROUTER_PROFILE_TEXT.match(/# %\w+%/g)).toEqual(['# %calcul%']);
    expect(BROUTER_PROFILE_TEXT).not.toMatch(/assign voie\b/);
    // Jamais le nom d'une clé OSM que le profil lit (`route=ferry`).
    for (const name of Object.values(WAY_TYPE_VARIABLE)) expect(BROUTER_PROFILE_TEXT).not.toContain(`${name}=`);
    expect(BROUTER_PROFILE_TEXT).toContain('---context:global');
    expect(BROUTER_PROFILE_TEXT).toContain('---context:way');
    expect(BROUTER_PROFILE_TEXT).toContain('---context:node');
    // Toutes les étiquettes connues du serveur sortent dans `messages`, d'où le revêtement.
    expect(BROUTER_PROFILE_TEXT).toMatch(/^assign processUnusedTags true$/m);
  });

  it('classe les voies selon ce qu\'elles sont : étiquette de départ, puis revêtement', () => {
    const cat = (t: WayType) => WAY_TYPES.indexOf(t) + 1;
    expect(flat).toContain(`if highway=${WAY_TYPE_HIGHWAYS.grandeRoute.join('|')} then ${cat('grandeRoute')}`);
    // Route ou rue piétonne non revêtue : piste.
    expect(flat).toContain(
      `else if highway=${WAY_TYPE_HIGHWAYS.route.join('|')}|${PEDESTRIAN_HIGHWAY} then ( if nonrevetu then ${cat('piste')} else ${cat('route')} )`
    );
    // Piste revêtue : route.
    expect(flat).toContain(`else if highway=track then ( if revetu then ${cat('route')} else ${cat('piste')} )`);
    // Sentier : route s'il est un trottoir, revêtu, ou une voie cyclable sans revêtement déclaré ; piste s'il est compacté.
    expect(flat).toContain(
      `else if highway=${WAY_TYPE_HIGHWAYS.sentier.join('|')} then ( if footway=sidewalk|crossing then ${cat('route')}`
        + ` else if ( and not highway=steps revetu ) then ${cat('route')}`
        + ` else if surface=compacted|fine_gravel then ${cat('piste')}`
        + ` else if ( and surface= bicycle=designated ) then ${cat('route')}`
        + ` else ${cat('sentier')} ) else 0`
    );
    expect(flat).toContain('assign revetu = if surface= then tracktype=grade1 else surface=asphalt|');
    expect(flat).toContain('assign nonrevetu = if surface= then tracktype=grade2|grade3|grade4|grade5 else surface=gravel|');
    expect(flat).toContain(`if equal categorie 1 then ${WAY_TYPE_VARIABLE[WAY_TYPES[0]]}`);
  });

  it('suit les types cochés ; à vélo, un type plus facile reste permis, un plus dur est évité selon l\'écart', () => {
    const { bikeEasier, bikeHarder, foot, mainRoad, unrideable, entryM } = WAY_COSTS;
    expect(bikeEasier).toBeLessThan(bikeHarder[0]);
    expect(bikeHarder[0]).toBeLessThan(bikeHarder[1]);
    expect(bikeHarder[bikeHarder.length - 1]).toBeLessThan(unrideable);
    expect(foot).toBeLessThan(mainRoad);
    expect(WAY_TYPE_LEVEL.route).toBe(WAY_TYPE_LEVEL.grandeRoute);
    expect(WAY_TYPE_LEVEL.route).toBeLessThan(WAY_TYPE_LEVEL.piste);
    expect(WAY_TYPE_LEVEL.piste).toBeLessThan(WAY_TYPE_LEVEL.sentier);
    expect(flat).toContain('assign niveaumax = if suitsentier then 2 else if suitpiste then 1 else 0');
    expect(flat).toContain('assign niveau = if equal categorie 1 then 2 else if equal categorie 2 then 1 else 0');
    expect(flat).toContain(
      `assign preference = if aporter then ${unrideable} else if suivie then 1`
        + ` else if equal categorie 4 then ${mainRoad} else if ( not velo ) then ${foot}`
        + ` else if lesser ecart 1 then ${bikeEasier} else if equal ecart 1 then ${bikeHarder[0]} else ${bikeHarder[1]} assign`
    );
    // Chaque entrée sur un type non coché coûte une longueur fixe ; le bac garde son coût d'embarquement.
    expect(BROUTER_PROFILE_TEXT).toContain('assign initialclassifier = if route=ferry then 3 else if suivie then 1 else 2');
    expect(BROUTER_PROFILE_TEXT).toContain(`assign initialcost = if route=ferry then 10000 else if suivie then 0 else ${entryM}`);
    // Les coûts se changent pour la mesure.
    const softer = buildBrouterProfile({ ...WAY_COSTS, bikeEasier: 2, entryM: 0 });
    expect(softer).toContain('else if lesser ecart 1 then 2');
    expect(softer).toContain('else if suivie then 0 else 0');
  });

  it('à vélo, évite les voies difficiles plus que tout type non coché, mais pas un simple sentier de montagne', () => {
    expect(BROUTER_PROFILE_TEXT).toContain('if ( not velo ) then false');
    expect(BROUTER_PROFILE_TEXT).toContain(`mtb:scale=${UNRIDEABLE_TAGS.mtbScale.join('|')}`);
    expect(BROUTER_PROFILE_TEXT).toContain(`sac_scale=${UNRIDEABLE_TAGS.sacScale.join('|')}`);
    expect(BROUTER_PROFILE_TEXT).toContain(`smoothness=${UNRIDEABLE_TAGS.smoothness.join('|')}`);
    // Le T2 (`mountain_hiking`) se roule souvent : 45 m au Salagou faisaient faire 2,4 km de détour.
    expect(UNRIDEABLE_TAGS.sacScale).not.toContain('mountain_hiking');
    expect(BROUTER_PROFILE_TEXT).not.toMatch(/[=|]mountain_hiking/);
  });

  it('reste en ASCII, et chaque type a sa propre variable', () => {
    expect([...BROUTER_PROFILE_TEXT].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(new Set(Object.values(WAY_TYPE_VARIABLE)).size).toBe(WAY_TYPES.length);
  });

  /** Toutes les combinaisons : chaque sous-ensemble non vide des types, à pied et à vélo. */
  const combinations = (): { ways: WayType[]; velo: boolean }[] =>
    Array.from({ length: 2 ** WAY_TYPES.length - 1 }, (_, m) => WAY_TYPES.filter((_, i) => ((m + 1) >> i) & 1))
      .flatMap((ways) => [{ ways, velo: false }, { ways, velo: true }]);

  it('décode `calcul` dans le profil : chaque combinaison retrouve ses types et ses règles', () => {
    // Petit évaluateur des lignes de décodage du profil (`greater`, `sub`, `multiply`).
    const decode = (calcul: number): Record<string, number> => {
      const vars: Record<string, number> = { calcul };
      const value = (token: string) => (token in vars ? vars[token] : Number(token));
      for (const line of BROUTER_PROFILE_TEXT.split('\n')) {
        const greater = /^assign (\w+) = greater (\w+) (\d+)$/.exec(line);
        const sub = /^assign (\w+) = sub (\w+) multiply (\d+) (\w+)$/.exec(line);
        if (greater) vars[greater[1]] = value(greater[2]) > value(greater[3]) ? 1 : 0;
        if (sub) vars[sub[1]] = value(sub[2]) - value(sub[3]) * value(sub[4]);
      }
      return vars;
    };
    for (const { ways, velo } of combinations()) {
      const vars = decode(profileCombination(ways, velo));
      expect(vars.velo).toBe(velo ? 1 : 0);
      for (const t of WAY_TYPES) expect(vars[WAY_TYPE_VARIABLE[t]]).toBe(ways.includes(t) ? 1 : 0);
    }
  });

  it('donne au serveur une empreinte différente pour chaque combinaison', () => {
    // Le serveur range un profil compilé sous la somme des `hashCode` Java des noms et valeurs passés :
    // deux combinaisons de même somme se partageraient le même calcul.
    const javaHash = (s: string) => [...s].reduce((h, ch) => (Math.imul(31, h) + ch.charCodeAt(0)) | 0, 0);
    const checksums = combinations().map(({ ways, velo }) => javaHash('calcul') + javaHash(String(profileCombination(ways, velo))));
    expect(new Set(checksums).size).toBe(checksums.length);
  });
});
