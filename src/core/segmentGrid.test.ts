import { describe, expect, it } from 'vitest';
import type { PlanePoint } from './geo';
import { pointSegmentDistanceM } from './geoPlane';
import { buildSegmentGrid } from './segmentGrid';

type Seg = readonly [PlanePoint, PlanePoint];
const seg = (x0: number, y0: number, x1: number, y1: number): Seg => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

describe('grille de segments', () => {
  const segments: Seg[] = [seg(0, 0, 100, 0), seg(0, 50, 100, 50), seg(500, 500, 600, 700), seg(-300, -300, 300, 300)];

  it('rend tout segment à moins de la marge du point, quelle que soit sa longueur', () => {
    const margin = 10;
    const grid = buildSegmentGrid(segments, margin, margin);
    for (let x = -350; x <= 650; x += 7) {
      for (let y = -350; y <= 750; y += 7) {
        const p = { x, y };
        const found = new Set(grid.near(p));
        segments.forEach(([a, b], i) => {
          if (pointSegmentDistanceM(p, a, b) < margin) expect(found.has(i), `(${x}, ${y}) segment ${i}`).toBe(true);
        });
      }
    }
  });

  it('ne rend rien loin de tout segment, et chaque indice une fois, dans l\'ordre', () => {
    const grid = buildSegmentGrid(segments, 10, 10);
    expect(grid.near({ x: 2000, y: 2000 })).toEqual([]);
    const list = grid.near({ x: 50, y: 0 });
    expect(list).toEqual([...new Set(list)].sort((a, b) => a - b));
    expect(list).toContain(0);
    expect(list).not.toContain(2);
  });

  it('un segment réduit à un point est retrouvé', () => {
    const grid = buildSegmentGrid([seg(5, 5, 5, 5)], 12, 12);
    expect(grid.near({ x: 8, y: 9 })).toEqual([0]);
  });
});
