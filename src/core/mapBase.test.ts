import { describe, expect, it } from 'vitest';
import { baseOfTileKey, isMapBase, resolveMapBase, isTileTemplate, MAP_BASES, tileCacheUsageByBase, tileTemplate, tileUrl } from './mapBase';
import { tileKey } from './tiles';

describe('tileUrl', () => {
  const tile = { z: 15, x: 16808, y: 11953 };

  it('donne l’adresse OSM, sans sous-domaine', () => {
    expect(tileUrl('plan', tile)).toBe('https://tile.openstreetmap.org/15/16808/11953.png');
  });

  it('donne l’adresse Esri dans l’ordre y puis x, sans image grise au large', () => {
    expect(tileUrl('satellite', tile))
      .toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/11953/16808?blankTile=false');
  });
});

describe('clés des tuiles par fond', () => {
  const tile = { z: 14, x: 8310, y: 5980 };

  it('garde la clé du plan, préfixe celle du satellite', () => {
    expect(tileKey(tile, MAP_BASES.plan.keyPrefix)).toBe('14_8310_5980');
    expect(tileKey(tile, MAP_BASES.satellite.keyPrefix)).toBe('sat_14_8310_5980');
  });

  it('range chaque tuile gardée sous son fond', () => {
    expect(baseOfTileKey('14_8310_5980')).toBe('plan');
    expect(baseOfTileKey('sat_14_8310_5980')).toBe('satellite');
    const entries = [
      { key: '14_1_1', bytes: 10, savedAtMs: 0 },
      { key: 'sat_14_1_1', bytes: 30, savedAtMs: 0 },
      { key: 'sat_14_1_2', bytes: 20, savedAtMs: 0 },
    ];
    expect(tileCacheUsageByBase(entries)).toEqual({ plan: { tiles: 1, bytes: 10 }, satellite: { tiles: 2, bytes: 50 } });
  });
});

describe('isMapBase', () => {
  it('écarte une valeur stockée inconnue', () => {
    expect(isMapBase('plan')).toBe(true);
    expect(isMapBase('satellite')).toBe(true);
    expect(isMapBase('hybride')).toBe(false);
    expect(isMapBase(undefined)).toBe(false);
  });
});

describe('resolveMapBase (lot 193)', () => {
  it('prend le fond de la session, sinon celui de la famille', () => {
    expect(resolveMapBase('satellite', 'plan')).toBe('satellite');
    expect(resolveMapBase('plan', 'satellite')).toBe('plan');
    expect(resolveMapBase(undefined, 'satellite')).toBe('satellite');
    expect(resolveMapBase('hybride', 'plan')).toBe('plan');
  });
});

describe('adresse des tuiles réglable (lot 188)', () => {
  const tile = { z: 15, x: 16808, y: 11953 };
  const custom = 'https://tuiles.example.org/{z}/{x}/{y}.png';

  it('vide ou absente : l’adresse d’origine', () => {
    expect(tileTemplate('plan')).toBe(MAP_BASES.plan.url);
    expect(tileTemplate('plan', {})).toBe(MAP_BASES.plan.url);
    expect(tileTemplate('satellite', { satellite: '' })).toBe(MAP_BASES.satellite.url);
    expect(tileTemplate('satellite', { satellite: '   ' })).toBe(MAP_BASES.satellite.url);
  });

  it('renseignée : la sienne, espaces autour retirés, et pour son fond seulement', () => {
    expect(tileTemplate('plan', { plan: `  ${custom} ` })).toBe(custom);
    expect(tileTemplate('satellite', { plan: custom })).toBe(MAP_BASES.satellite.url);
    expect(tileUrl('plan', tile, tileTemplate('plan', { plan: custom }))).toBe('https://tuiles.example.org/15/16808/11953.png');
  });

  it('sans les trois repères, ou pas une adresse web : l’adresse d’origine', () => {
    expect(tileTemplate('plan', { plan: 'https://tuiles.example.org/{z}/{x}.png' })).toBe(MAP_BASES.plan.url);
    expect(tileTemplate('plan', { plan: 'tuiles.example.org/{z}/{x}/{y}.png' })).toBe(MAP_BASES.plan.url);
    expect(isTileTemplate('ftp://a/{z}/{x}/{y}')).toBe(false);
    expect(isTileTemplate('https://a b/{z}/{x}/{y}')).toBe(false);
  });

  it('un repère répété ou un repère inconnu ({s}) est refusé : il resterait en clair dans l’adresse demandée', () => {
    expect(isTileTemplate('https://a.example/{z}/{x}/{y}@{z}x.png')).toBe(false);
    expect(isTileTemplate('https://{s}.example/{z}/{x}/{y}.png')).toBe(false);
    expect(isTileTemplate('https://a.example/{z}/{x}/{y}?r={r}')).toBe(false);
    expect(isTileTemplate('https://a.example/{y}/{x}/{z}.png')).toBe(true);
  });

  it('les adresses d’origine sont valides', () => {
    expect(isTileTemplate(MAP_BASES.plan.url)).toBe(true);
    expect(isTileTemplate(MAP_BASES.satellite.url)).toBe(true);
  });

  it('libellé d’Esri complet, sur la carte et sur l’image de partage', () => {
    expect(MAP_BASES.satellite.attribution).toBe('Powered by Esri &middot; Imagerie &copy; Esri, Vantor, Earthstar Geographics, GIS User Community');
    expect(MAP_BASES.satellite.credit).toBe('Powered by Esri · Imagerie © Esri, Vantor, Earthstar Geographics, GIS User Community');
  });
});
