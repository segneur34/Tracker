import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, backdropTile, reliefHeight, type BackdropVariant } from './patternTiles';

/** Points de départ et d'arrivée des lignes brisées d'un tracé (`M` et dernier `L` de chaque ligne). */
const lineEnds = (d: string): [number, number][] =>
  d.split('M').filter(Boolean).flatMap((line) => {
    const points = line.split('L').map((p) => p.split(' ').map(Number) as [number, number]);
    return [points[0], points[points.length - 1]];
  });

describe('tuiles des fonds de page', () => {
  it('le relief se raccorde d\'un bord à l\'autre, dans les deux sens', () => {
    for (const [x, y] of [[0, 0], [37, 210], [180, 600]]) {
      expect(reliefHeight(x + TILE_W, y)).toBeCloseTo(reliefHeight(x, y), 9);
      expect(reliefHeight(x, y + TILE_H)).toBeCloseTo(reliefHeight(x, y), 9);
    }
  });

  it('chaque fin de courbe de niveau au bord gauche reprend au bord droit, à la même hauteur', () => {
    const ends = backdropTile('contours').flatMap((p) => lineEnds(p.d));
    const left = ends.filter(([x]) => x === 0).map(([, y]) => y).sort((a, b) => a - b);
    const right = ends.filter(([x]) => x === TILE_W).map(([, y]) => y).sort((a, b) => a - b);
    expect(left.length).toBeGreaterThan(5);
    expect(right).toEqual(left);
  });

  it('chaque fond a ses tracés, sans valeur manquante', () => {
    for (const variant of ['contours', 'voile', 'course', 'velo', 'surf', 'fractionne'] as BackdropVariant[]) {
      const tile = backdropTile(variant);
      expect(tile.length).toBeGreaterThan(0);
      for (const p of tile) expect(p.d).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
