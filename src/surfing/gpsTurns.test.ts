import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../core/types';
import { countDirectionChanges } from './gpsTurns';

/** Points d'une vague à 1 Hz, de caps donnés (cap de l'appareil, ou cap des positions seul). */
const pointsWithHeadings = (headings: number[], device = true): TrackPoint[] =>
  headings.map((h, i) => ({
    lat: 43, lon: 3, time: new Date(i * 1000), timeMs: i * 1000, speedMs: 5, smoothedSpeedMs: 5,
    bearing: device ? 0 : h, ...(device ? { courseDeg: h } : {}), speedSource: 'doppler',
  }));

describe('countDirectionChanges', () => {
  it('compte bottom turn, top turn et cutback d\'au moins 60°', () => {
    // Point de départ, puis +120°, −180°, +60°.
    const track = pointsWithHeadings([0, 200, 260, 320, 260, 200, 140, 200]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(3);
  });

  it('ignore le tremblement du cap', () => {
    const track = pointsWithHeadings([0, 200, 215, 195, 212, 190, 205, 198]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(0);
  });

  it('passe le nord sans compter de faux virage', () => {
    const track = pointsWithHeadings([0, 340, 355, 10, 25, 40]);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(1);
  });

  it('prend le cap des positions sans cap de l\'appareil', () => {
    const track = pointsWithHeadings([0, 200, 260, 320, 260, 200, 140, 200], false);
    expect(countDirectionChanges(track, 0, track.length - 1, 60)).toBe(3);
  });
});
