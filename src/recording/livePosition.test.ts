import { describe, expect, it } from 'vitest';
import type { LocationFix } from '../platform/location';
import { travelHeading } from './heading';
import { headingFixes, shownLiveFix } from './livePosition';

const T0 = Date.UTC(2026, 9, 31, 9, 0, 0);
/** Course vers l'est à 3 m/s puis, pendant la pause, vers le nord ; une position par seconde. */
const east = (s: number): LocationFix => ({ timeMs: T0 + s * 1000, lat: 43.7, lon: 3.85 + (3 * s) / 80_400, speedMs: 3 });
const north = (s: number, from: LocationFix): LocationFix => ({ timeMs: T0 + s * 1000, lat: from.lat + (3 * (s - 30)) / 111_200, lon: from.lon, speedMs: 3 });

describe('position de la carte du direct (lot 104)', () => {
  const kept = Array.from({ length: 31 }, (_, s) => east(s));
  const pausePoint = kept[30];
  const pauseFixes = Array.from({ length: 20 }, (_, k) => north(31 + k, pausePoint));

  it('montre la dernière position gardée hors pause manuelle', () => {
    expect(shownLiveFix(pausePoint, [])).toBe(pausePoint);
    expect(shownLiveFix(null, [])).toBeNull();
  });

  it('en pause manuelle, suit la dernière position reçue, qui n\'est pas gardée', () => {
    expect(shownLiveFix(pausePoint, pauseFixes.slice(0, 5))).toBe(pauseFixes[4]);
    expect(shownLiveFix(pausePoint, pauseFixes)).toBe(pauseFixes[19]);
    expect(shownLiveFix(null, pauseFixes)).toBe(pauseFixes[19]);
  });

  it('tire le cap de la trace hors pause, et des positions de la pause depuis son point', () => {
    expect(headingFixes(kept, [])).toBe(kept);
    expect(headingFixes(kept, pauseFixes)).toEqual([pausePoint, ...pauseFixes]);
    expect(headingFixes([], pauseFixes)).toBe(pauseFixes);
    // Vers l'est avant la pause, vers le nord pendant : la flèche tourne avec le coureur.
    expect(travelHeading(headingFixes(kept, [])).headingDeg).toBeCloseTo(90, 0);
    expect(travelHeading(headingFixes(kept, pauseFixes)).headingDeg).toBeCloseTo(0, 0);
  });
});
