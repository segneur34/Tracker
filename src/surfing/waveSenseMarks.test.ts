import { describe, expect, it } from 'vitest';
import { planeProjection } from '../core/geo';
import type { LatLon } from '../core/types';
import type { PeakZone } from './peakZone';
import {
  waveSenseMarks, WAVE_ARROW_HEAD_LENGTH_PX, WAVE_ARROW_HEAD_WIDTH_PX, WAVE_ARROW_LENGTH_PX, WAVE_LINE_GAP_PX, WAVE_LINE_HALF_SHARE,
} from './waveSenseMarks';

const CENTER: LatLon = { lat: 44, lon: -1.2 };
const proj = planeProjection(CENTER.lat, CENTER);

/** Zone synthétique de 200 m sur 40 m, centrée en `CENTER`. */
const zoneAt = (majorAxisDeg: number): PeakZone => ({
  center: CENTER, semiMajorM: 100, semiMinorM: 20, majorAxisDeg,
  orientation: 'vagues', departures: [], insideDepartures: [],
});

const bearing = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(b.x - a.x, b.y - a.y);

describe('waveSenseMarks', () => {
  it.each([0, 90, 180, 270])('la flèche pointe vers %i° et garde ses pixels, à deux échelles', (sense) => {
    for (const mpp of [0.5, 2]) {
      const marks = waveSenseMarks(zoneAt(90), sense, mpp);
      const tail = proj.to(marks.shaft[0]);
      const tip = proj.to(marks.head[0]);
      expect(dist(tail, tip) / mpp).toBeCloseTo(WAVE_ARROW_LENGTH_PX, 3);
      expect(bearing(tail, tip)).toBeCloseTo(sense, 3);
      const base = proj.to(marks.shaft[1]);
      expect(dist(base, tip) / mpp).toBeCloseTo(WAVE_ARROW_HEAD_LENGTH_PX, 3);
      expect(dist(proj.to(marks.head[1]), proj.to(marks.head[2])) / mpp).toBeCloseTo(WAVE_ARROW_HEAD_WIDTH_PX, 3);
      // La flèche part du centre de la zone.
      expect(tail.x).toBeCloseTo(0, 6);
      expect(tail.y).toBeCloseTo(0, 6);
    }
  });

  it('la ligne est parallèle au grand axe, du côté large, à demi-petit axe + son écart en pixels', () => {
    for (const mpp of [0.5, 2]) {
      // Grand axe est-ouest, vagues vers le nord : le large est au sud.
      const marks = waveSenseMarks(zoneAt(90), 0, mpp);
      const [a, b] = marks.line.map((p) => proj.to(p));
      expect(a.y).toBeCloseTo(b.y, 4);
      expect(a.y).toBeCloseTo(-(20 + WAVE_LINE_GAP_PX * mpp), 4);
      // Sa longueur suit la zone, pas le zoom.
      expect(Math.abs(b.x - a.x)).toBeCloseTo(2 * WAVE_LINE_HALF_SHARE * 100, 3);
      expect((a.x + b.x) / 2).toBeCloseTo(0, 4);
    }
  });

  it('la ligne reste du côté large quand le sens s\'inverse', () => {
    const [a] = waveSenseMarks(zoneAt(90), 180, 1).line.map((p) => proj.to(p));
    expect(a.y).toBeGreaterThan(0);
  });

  it('un axe qui n\'est pas perpendiculaire au sens : la flèche suit le sens, la ligne reste parallèle à l\'axe', () => {
    const marks = waveSenseMarks(zoneAt(60), 10, 1);
    expect(bearing(proj.to(marks.shaft[0]), proj.to(marks.head[0]))).toBeCloseTo(10, 3);
    const [a, b] = marks.line.map((p) => proj.to(p));
    expect(bearing(a, b) % 180).toBeCloseTo(60, 3);
    // Le milieu de la ligne est du côté large : opposé au sens (10°).
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(mid.x * Math.sin((10 * Math.PI) / 180) + mid.y * Math.cos((10 * Math.PI) / 180)).toBeLessThan(0);
  });
});
