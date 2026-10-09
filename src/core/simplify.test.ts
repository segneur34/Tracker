import { describe, expect, it } from 'vitest';
import { pointSegmentDistanceM, simplifyLatLon, simplifyPlane } from './simplify';

describe('pointSegmentDistanceM', () => {
  it("mesure l'écart à un segment, et au bout le plus proche au-delà", () => {
    expect(pointSegmentDistanceM({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(pointSegmentDistanceM({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(pointSegmentDistanceM({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });
});

describe('simplifyPlane', () => {
  it('ne garde que les bouts d\'une ligne droite', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0.1 * Math.sin(i) }));
    expect(simplifyPlane(line, 1)).toEqual([line[0], line[49]]);
  });

  it('garde un coin plus marqué que la tolérance, et pas un plus faible', () => {
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 3 }, { x: 100, y: 0 }];
    expect(simplifyPlane(corner, 2)).toEqual(corner);
    expect(simplifyPlane(corner, 5)).toEqual([corner[0], corner[2]]);
  });

  it('rend tel quel un tracé de moins de trois points', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPlane(two, 10)).toEqual(two);
  });
});

describe('simplifyLatLon', () => {
  it('rend les positions d\'origine, dans un plan en mètres', () => {
    // 1e-4° de latitude vaut 11 m : un écart de 11 m au milieu est gardé à 5 m, pas à 20 m.
    const pts = [{ lat: 43.6, lon: 3.8, t: 0 }, { lat: 43.6001, lon: 3.805, t: 1 }, { lat: 43.6, lon: 3.81, t: 2 }];
    expect(simplifyLatLon(pts, 5)).toEqual(pts);
    expect(simplifyLatLon(pts, 20)).toEqual([pts[0], pts[2]]);
  });
});
