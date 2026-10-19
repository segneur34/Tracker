import { describe, expect, it } from 'vitest';
import { activityShares, calendarYearBounds, profileYears } from './profile';
import { inBounds, type StatSession } from './stats';

// Dates construites à l'heure locale : les tests ne dépendent pas du fuseau de la machine.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const session = (startMs: number, over: Partial<StatSession> = {}): StatSession => ({
  file: `s-${startMs}.json`,
  name: null,
  startMs,
  endMs: startMs + 3_600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  movingDistanceM: 9000,
  elevationGainM: null,
  maxSpeedMs: 5,
  activityId: 'course',
  family: 'course',
  treatment: 'course',
  maneuverCount: null,
  maneuverResults: null,
  foil: false,
  waveCount: null,
  longestWaveM: null,
  longestFlightS: null,
  flightS: null,
  reps: 0,
  heartRate: null,
  cadenceSpm: null,
  ...over,
});

describe('calendarYearBounds', () => {
  it("va du 1er janvier à minuit au 1er janvier suivant, exclu", () => {
    const b = calendarYearBounds(2026);
    expect(inBounds(at(2025, 12, 31, 23, 59), b)).toBe(false);
    expect(inBounds(at(2026, 1, 1, 0, 0), b)).toBe(true);
    expect(inBounds(at(2026, 12, 31, 23, 59), b)).toBe(true);
    expect(inBounds(at(2027, 1, 1, 0, 0), b)).toBe(false);
  });
});

describe('profileYears', () => {
  it("va de l'année de la plus vieille session à l'année en cours, années vides comprises", () => {
    const sessions = [session(at(2026, 3, 1)), session(at(2024, 6, 1))];
    expect(profileYears(sessions, at(2026, 10, 19))).toEqual([2024, 2025, 2026]);
  });

  it("donne l'année en cours seule, sans session", () => {
    expect(profileYears([], at(2026, 10, 19))).toEqual([2026]);
  });
});

describe('activityShares', () => {
  it('répartit le temps par activité, de la plus longue à la plus courte', () => {
    const shares = activityShares([
      session(at(2026, 3, 1), { activityId: 'velo', endMs: at(2026, 3, 1) + 3 * 3_600_000 }),
      session(at(2026, 3, 2)),
      session(at(2026, 3, 3), { activityId: 'voile' }),
      session(at(2026, 3, 4)),
    ], ['voile', 'course', 'velo']);
    expect(shares.map((s) => s.activityId)).toEqual(['velo', 'course', 'voile']);
    expect(shares.map((s) => s.share)).toEqual([0.5, 2 / 6, 1 / 6]);
    expect(shares.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1);
    expect(shares[1].totals.sessions).toBe(2);
  });

  it("garde l'ordre des activités à durée égale", () => {
    const shares = activityShares([session(at(2026, 3, 1)), session(at(2026, 3, 2), { activityId: 'voile' })], ['voile', 'course']);
    expect(shares.map((s) => s.activityId)).toEqual(['voile', 'course']);
  });

  it('est vide sans session', () => {
    expect(activityShares([], ['course'])).toEqual([]);
  });
});
