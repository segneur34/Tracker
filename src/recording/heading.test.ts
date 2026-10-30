import { describe, expect, it } from 'vitest';
import { displayHeading, travelHeading } from './heading';
import { headingTrack } from '../test/track.fixture';

describe('cap de la flèche', () => {
  it('en mouvement : le cap du GPS, sinon celui des derniers points', () => {
    expect(travelHeading(headingTrack(10, 1.5, { bearingDeg: 12 }))).toEqual({ headingDeg: 12, moving: true });
    const fromTrack = travelHeading(headingTrack(10, 1.5));
    expect(fromTrack.moving).toBe(true);
    expect(fromTrack.headingDeg).toBeCloseTo(0, 3);
  });

  it("à l'arrêt : la boussole si elle répond, sinon le dernier cap de marche", () => {
    const walked = headingTrack(10, 1.5);
    const last = walked[walked.length - 1];
    const stopped = [...walked, ...Array.from({ length: 30 }, (_, i) => ({ ...last, timeMs: last.timeMs + (i + 1) * 1000, speedMs: 0 }))];
    const travel = travelHeading(stopped);
    expect(travel.moving).toBe(false);
    expect(displayHeading(travel, 250)).toBe(250);
    expect(displayHeading(travel, null)).toBeCloseTo(0, 3);
  });

  it('sans déplacement ni boussole : pas de cap', () => {
    const still = headingTrack(5, 0);
    expect(displayHeading(travelHeading(still), null)).toBeNull();
    expect(travelHeading([])).toEqual({ headingDeg: null, moving: false });
  });
});
