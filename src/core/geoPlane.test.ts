import { describe, expect, it } from 'vitest';
import { distanceToSegmentM, pointSegmentDistanceM, projectOnSegment } from './geoPlane';
import { planeProjection } from './geo';

describe('pointSegmentDistanceM', () => {
  it("mesure l'écart à un segment, et au bout le plus proche au-delà", () => {
    expect(pointSegmentDistanceM({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(pointSegmentDistanceM({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(pointSegmentDistanceM({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });
});

const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((43.6 * Math.PI) / 180);
/** Position à `east` m à l'est et `north` m au nord de (43,6 ; 3,8). */
const at = (east: number, north: number) => ({ lat: 43.6 + north / M_PER_DEG_LAT, lon: 3.8 + east / M_PER_DEG_LON });

describe('distanceToSegmentM', () => {
  it("mesure l'écart perpendiculaire quand le pied tombe dans le segment", () => {
    expect(distanceToSegmentM(at(30, 0), at(0, -100), at(0, 100))).toBeCloseTo(30, 0);
  });

  it('mesure la distance au bout le plus proche au-delà du segment', () => {
    expect(distanceToSegmentM(at(0, 140), at(0, -100), at(0, 100))).toBeCloseTo(40, 0);
    expect(distanceToSegmentM(at(30, -140), at(0, -100), at(0, 100))).toBeCloseTo(50, 0);
  });

  it('traite un segment réduit à un point comme ce point', () => {
    expect(distanceToSegmentM(at(30, 40), at(0, 0), at(0, 0))).toBeCloseTo(50, 0);
  });
});

describe('projectOnSegment', () => {
  it('rend la place du pied sur le segment, bornée à [0, 1]', () => {
    expect(projectOnSegment(at(30, 0), at(0, -100), at(0, 100)).t).toBeCloseTo(0.5, 2);
    expect(projectOnSegment(at(0, 300), at(0, -100), at(0, 100)).t).toBe(1);
    expect(projectOnSegment(at(0, -300), at(0, -100), at(0, 100)).t).toBe(0);
    expect(projectOnSegment(at(0, 0), at(5, 5), at(5, 5)).t).toBe(0);
  });

  it('donne l\'écart du pied par rapport au point', () => {
    const proj = projectOnSegment(at(30, 0), at(0, -100), at(0, 100));
    expect(proj.offsetX).toBeCloseTo(-30, 0);
    expect(proj.offsetY).toBeCloseTo(0, 0);
    expect(proj.distanceM).toBeCloseTo(30, 0);
  });
});

describe('planeProjection', () => {
  it('fait l\'aller-retour entre degrés et mètres', () => {
    const plane = planeProjection(43.6);
    const p = { lat: 43.61, lon: 3.85 };
    const back = plane.from(plane.to(p));
    expect(back.lat).toBeCloseTo(p.lat, 9);
    expect(back.lon).toBeCloseTo(p.lon, 9);
  });

  it('compte moins de mètres par degré de longitude que de latitude', () => {
    const plane = planeProjection(60);
    const a = plane.to({ lat: 60, lon: 0 });
    const b = plane.to({ lat: 60, lon: 1 });
    const c = plane.to({ lat: 61, lon: 0 });
    expect(b.x - a.x).toBeCloseTo((c.y - a.y) / 2, -1);
  });
});
