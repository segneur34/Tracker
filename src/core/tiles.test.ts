import { describe, expect, it } from 'vitest';
import { ancestorTile, isStale, parseTileKey, tileCacheUsage, tileKey, tilesToEvict } from './tiles';

describe('tileKey', () => {
  it('fait l’aller-retour avec parseTileKey, extension comprise', () => {
    const tile = { z: 14, x: 8310, y: 5980 };
    expect(tileKey(tile)).toBe('14_8310_5980');
    expect(parseTileKey(tileKey(tile))).toEqual(tile);
    expect(parseTileKey('14_8310_5980.png')).toEqual(tile);
  });

  it('refuse un nom qui n’est pas une tuile', () => {
    expect(parseTileKey('reglages.json')).toBeNull();
    expect(parseTileKey('14_8310.png')).toBeNull();
  });
});

describe('ancestorTile', () => {
  it('trouve la parente et la case de la tuile en elle', () => {
    expect(ancestorTile({ z: 15, x: 16621, y: 11963 }, 1)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 2, col: 1, row: 1 });
    expect(ancestorTile({ z: 15, x: 16620, y: 11962 }, 1)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 2, col: 0, row: 0 });
    expect(ancestorTile({ z: 17, x: 66487, y: 47855 }, 3)).toEqual({ tile: { z: 14, x: 8310, y: 5981 }, scale: 8, col: 7, row: 7 });
  });

  it('ne remonte pas au-dessus du zoom 0', () => {
    expect(ancestorTile({ z: 2, x: 1, y: 1 }, 3)).toBeNull();
    expect(ancestorTile({ z: 2, x: 3, y: 2 }, 2)).toEqual({ tile: { z: 0, x: 0, y: 0 }, scale: 4, col: 3, row: 2 });
    expect(ancestorTile({ z: 5, x: 1, y: 1 }, 0)).toBeNull();
  });
});

describe('isStale', () => {
  it('compare l’âge à la limite', () => {
    expect(isStale(0, 1000, 999)).toBe(true);
    expect(isStale(0, 1000, 1000)).toBe(false);
  });
});

describe('tilesToEvict', () => {
  const entries = [
    { key: 'b', bytes: 30, savedAtMs: 2 },
    { key: 'a', bytes: 40, savedAtMs: 1 },
    { key: 'c', bytes: 30, savedAtMs: 3 },
  ];

  it('ne touche à rien sous le plafond', () => {
    expect(tilesToEvict(entries, 100)).toEqual([]);
    expect(tileCacheUsage(entries)).toEqual({ tiles: 3, bytes: 100 });
  });

  it('efface les plus anciennes jusqu’à repasser sous le plafond', () => {
    expect(tilesToEvict(entries, 99)).toEqual(['a']);
    expect(tilesToEvict(entries, 30)).toEqual(['a', 'b']);
    expect(tilesToEvict(entries, 0)).toEqual(['a', 'b', 'c']);
  });
});
