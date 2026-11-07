import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LAT, ORIGIN } from '../test/geo.fixture';
import { simplifyAlongElevation, simplifyLatLon, simplifyPlane, thinToPixels } from './simplify';

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

describe('simplifyAlongElevation', () => {
  /** Route droite vers le nord, un point tous les 10 m, altitude donnée par la distance. */
  const road = (count: number, eleM: (distM: number) => number | undefined) => Array.from({ length: count }, (_, i) => {
    const distM = i * 10;
    const ele = eleM(distM);
    return { lat: ORIGIN.lat + distM / M_PER_DEG_LAT, lon: ORIGIN.lon, ...(ele !== undefined ? { eleM: ele } : {}) };
  });
  const hill = (distM: number) => 100 + 50 * (1 - Math.abs(distM - 500) / 500);

  it('garde le sommet d\'une route droite, que le plan seul perd', () => {
    const pts = road(101, hill);
    expect(simplifyLatLon(pts, 2)).toEqual([pts[0], pts[100]]);
    expect(simplifyAlongElevation(pts, 2, 1)).toEqual([pts[0], pts[50], pts[100]]);
  });

  it('sans altitude, rend exactement ce que rend simplifyLatLon', () => {
    const pts = road(101, () => undefined).map((p, i) => ({ ...p, lon: p.lon + (i === 40 ? 1e-3 : 0) }));
    expect(simplifyAlongElevation(pts, 2, 1)).toEqual(simplifyLatLon(pts, 2));
  });

  it('garde les bouts de chaque morceau d\'altitude, même sur le plat', () => {
    const pts = road(101, (d) => (d >= 300 && d <= 600 ? undefined : 100));
    // Le morceau finit à 290 m, le suivant commence à 610 m.
    expect(simplifyAlongElevation(pts, 2, 1)).toEqual([pts[0], pts[29], pts[61], pts[100]]);
  });

  it('rend tel quel un tracé de moins de trois points', () => {
    const pts = road(2, hill);
    expect(simplifyAlongElevation(pts, 2, 1)).toBe(pts);
  });
});

describe('thinToPixels', () => {
  const px = (p: { x: number; y: number }) => p;

  it('garde un point dès qu’il s’écarte d’un demi-pixel du dernier gardé, et les deux bouts', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.4, y: 0 }, { x: 0.5, y: 0 }, { x: 0.7, y: 0.1 }, { x: 1, y: 0.1 }, { x: 1.1, y: 0.1 }];
    expect(thinToPixels(pts, px, 0.5)).toEqual([pts[0], pts[3], pts[5], pts[6]]);
  });

  it('donne le même tracé à 1 et à 5 points par pixel', () => {
    const line = (perPx: number) => Array.from({ length: 10 * perPx + 1 }, (_, i) => ({ x: i / perPx, y: 0 }));
    // Un point par pixel : tous gardés. Cinq par pixel : un sur trois (0, 0,6, 1,2…), puis le dernier.
    expect(thinToPixels(line(1), px, 0.5)).toHaveLength(11);
    const dense = thinToPixels(line(5), px, 0.5).map((p) => p.x);
    expect(dense).toHaveLength(18);
    expect(dense[1]).toBeCloseTo(0.6);
    expect(dense.at(-2)).toBeCloseTo(9.6);
    expect(dense.at(-1)).toBe(10);
  });

  it('rend tel quel un tracé de moins de trois points', () => {
    const two = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }];
    expect(thinToPixels(two, px, 0.5)).toEqual(two);
  });
});
