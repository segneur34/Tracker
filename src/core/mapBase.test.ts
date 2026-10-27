import { describe, expect, it } from 'vitest';
import { baseOfTileKey, isMapBase, MAP_BASES, tileCacheUsageByBase, tileUrl } from './mapBase';
import { tileKey } from './tiles';

describe('tileUrl', () => {
  const tile = { z: 15, x: 16808, y: 11953 };

  it('donne l’adresse OSM, sous-domaine choisi comme Leaflet', () => {
    expect(tileUrl('plan', tile)).toBe('https://a.tile.openstreetmap.org/15/16808/11953.png');
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
