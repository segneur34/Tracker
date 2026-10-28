import { describe, expect, it } from 'vitest';
import { activityShares, favoriteActivity, favoriteFamily } from './profile';
import type { StatSession } from './stats';

// Dates construites à l'heure locale : les tests ne dépendent pas du fuseau de la machine.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const session = (startMs: number, over: Partial<StatSession> = {}): StatSession => ({
  file: `s-${startMs}.json`,
  name: null,
  startMs,
  endMs: startMs + 3_600_000,
  distanceM: 10_000,
  movingTimeS: 3000,
  inMotionS: null,
  movingDistanceM: 9000,
  elevationGainM: null,
  maxSpeedMs: 5,
  activityId: 'course',
  family: 'course',
  treatment: 'course',
  positions: true,
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
  gear: null,
  ...over,
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

describe('favoriteActivity', () => {
  it('prend l’activité qui a le plus de temps', () => {
    expect(favoriteActivity([
      session(at(2026, 3, 1)),
      session(at(2026, 3, 2), { activityId: 'velo', endMs: at(2026, 3, 2) + 3 * 3_600_000 }),
      session(at(2026, 3, 3)),
      session(at(2026, 3, 4), { activityId: 'voile' }),
    ], ['course', 'velo', 'voile'])).toBe('velo');
  });

  it('à durée égale, la plus récemment pratiquée', () => {
    expect(favoriteActivity([
      session(at(2026, 3, 5), { activityId: 'voile' }),
      session(at(2026, 3, 1)),
    ], ['course', 'voile'])).toBe('voile');
  });

  it('sans session, aucun', () => {
    expect(favoriteActivity([], ['course'])).toBeNull();
  });
});

describe('favoriteFamily', () => {
  it('donne la famille du sport préféré, pas celle qui a le plus de temps en tout', () => {
    // Deux activités de vélo font plus de temps à elles deux, mais la course est l’activité préférée.
    expect(favoriteFamily([
      session(at(2026, 3, 1), { endMs: at(2026, 3, 1) + 2 * 3_600_000 }),
      session(at(2026, 3, 2), { activityId: 'route', family: 'velo', endMs: at(2026, 3, 2) + 1.5 * 3_600_000 }),
      session(at(2026, 3, 3), { activityId: 'vtt', family: 'velo', endMs: at(2026, 3, 3) + 1.5 * 3_600_000 }),
    ], ['course', 'route', 'vtt'])).toBe('course');
  });

  it('sans session, aucune', () => {
    expect(favoriteFamily([], ['course'])).toBeNull();
  });
});
