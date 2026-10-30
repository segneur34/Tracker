import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W, backdropTile, reliefHeight, trailX, veloHeight, type BackdropVariant } from './backdropPattern';

/** Points de départ et d'arrivée des lignes brisées d'un tracé (`M` et dernier `L` de chaque ligne). */
const lineEnds = (d: string): [number, number][] =>
  d.split('M').filter(Boolean).flatMap((line) => {
    const points = line.split('L').map((p) => p.split(' ').map(Number) as [number, number]);
    return [points[0], points[points.length - 1]];
  });

/** Hauteurs (ou abscisses) des fins de ligne posées sur un bord, triées. */
const onEdge = (ends: [number, number][], axis: 0 | 1, at: number): number[] =>
  ends.filter((p) => p[axis] === at).map((p) => p[1 - axis]).sort((a, b) => a - b);

const VARIANTS: BackdropVariant[] = ['contours', 'voile', 'course', 'velo', 'surf', 'fractionne'];

describe('tuiles des fonds de page', () => {
  it('les reliefs se raccordent d\'un bord à l\'autre, dans les deux sens', () => {
    const velo = backdropTile('velo');
    for (const [x, y] of [[0, 0], [37, 210], [180, 600]]) {
      expect(reliefHeight(x + TILE_W, y)).toBeCloseTo(reliefHeight(x, y), 9);
      expect(reliefHeight(x, y + TILE_H)).toBeCloseTo(reliefHeight(x, y), 9);
      expect(veloHeight(x + velo.width, y)).toBeCloseTo(veloHeight(x, y), 9);
      expect(veloHeight(x, y + velo.height)).toBeCloseTo(veloHeight(x, y), 9);
    }
  });

  it('chaque fin de courbe de niveau sur un bord reprend au bord opposé, au même endroit', () => {
    for (const variant of ['contours', 'velo'] as const) {
      const tile = backdropTile(variant);
      const ends = tile.paths.flatMap((p) => lineEnds(p.d));
      const left = onEdge(ends, 0, 0);
      expect(left.length, variant).toBeGreaterThan(5);
      expect(onEdge(ends, 0, tile.width), variant).toEqual(left);
      expect(onEdge(ends, 1, tile.height), variant).toEqual(onEdge(ends, 1, 0));
    }
  });

  it('à pied, le sentier se raccorde en hauteur et les courbes du relief doux aux bords', () => {
    expect(Math.abs(trailX(0) - trailX(TILE_H))).toBeLessThan(0.1);
    const tile = backdropTile('course');
    expect(tile.paths.map((p) => p.kind)).toEqual(['thin', 'dots', 'fill', undefined]);
    const ends = lineEnds(tile.paths[0].d);
    const left = onEdge(ends, 0, 0);
    expect(left.length).toBeGreaterThan(0);
    expect(onEdge(ends, 0, tile.width)).toEqual(left);
    expect(onEdge(ends, 1, tile.height)).toEqual(onEdge(ends, 1, 0));
  });

  it('chaque fond a ses tracés, sans valeur manquante, une taille et un espacement', () => {
    for (const variant of VARIANTS) {
      const tile = backdropTile(variant);
      expect(tile.paths.length, variant).toBeGreaterThan(0);
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
      expect(tile.scale).toBeGreaterThan(0);
      for (const p of tile.paths) {
        expect(p.d.length, variant).toBeGreaterThan(0);
        expect(p.d).not.toMatch(/NaN|undefined|Infinity/);
        if (p.alpha !== undefined) {
          expect(p.alpha).toBeGreaterThan(0);
          expect(p.alpha).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('la vague du surf s\'assombrit de la ligne la plus haute à la plus basse', () => {
    const alphas = backdropTile('surf').paths.map((p) => p.alpha ?? 1);
    expect(alphas.length).toBeGreaterThan(5);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeGreaterThan(alphas[i - 1]);
    expect(alphas[alphas.length - 1]).toBeCloseTo(1, 9);
  });
});
