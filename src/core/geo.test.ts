import { describe, expect, it } from 'vitest';
import { toRad } from './angles';
import { cumulativeDistancesM, EARTH_RADIUS_M, haversineDistance, pathLengthM, planeProjection } from './geo';

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const points = Array.from({ length: 300 }, () => ({ lat: 43.5 + (rnd() - 0.5) * 0.2, lon: 3.9 + (rnd() - 0.5) * 0.3 }));

describe('géodésie', () => {
  it('plan local centré sur un point : écriture gelée de projectOnSegment (lot 57)', () => {
    for (const p of points.slice(0, 30)) {
      const cosLat = Math.cos(toRad(p.lat));
      const plane = planeProjection(p.lat, p);
      for (const q of points) {
        const x = toRad(q.lon - p.lon) * cosLat * EARTH_RADIUS_M;
        const y = toRad(q.lat - p.lat) * EARTH_RADIUS_M;
        expect(plane.to(q)).toEqual({ x, y });
        const back = plane.from(plane.to(q));
        expect(back.lat).toBeCloseTo(q.lat, 9);
        expect(back.lon).toBeCloseTo(q.lon, 9);
      }
    }
  });

  it('plan local sans origine : écriture gelée de simplifyLatLon', () => {
    const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(43.6));
    const ky = toRad(1) * EARTH_RADIUS_M;
    const plane = planeProjection(43.6);
    for (const q of points) expect(plane.to(q)).toEqual({ x: q.lon * kx, y: q.lat * ky });
  });

  it('longueur et distances cumulées : somme des Haversine, la même au bit près', () => {
    const cum = cumulativeDistancesM(points);
    expect(cum[0]).toBe(0);
    expect(pathLengthM(points)).toBe(cum[cum.length - 1]);
    expect(cum[1]).toBe(haversineDistance(points[0].lat, points[0].lon, points[1].lat, points[1].lon));
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM(points.slice(0, 1))).toBe(0);
    expect(cumulativeDistancesM([])).toEqual([]);
  });
});
