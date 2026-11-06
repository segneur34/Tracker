import { describe, expect, it } from 'vitest';
import { SAILING_SPORTS, SPORT_PROFILES, isSportType } from './sportProfiles';
import type { SportType } from './types';

describe('isSportType', () => {
  it('ne reconnaît que les supports du profil', () => {
    expect(isSportType('wingfoil')).toBe(true);
    expect(isSportType('running')).toBe(true);
    expect(isSportType('toString')).toBe(false);
    expect(isSportType(42)).toBe(false);
  });
});

describe('hrEnergy', () => {
  it("n'est donné qu'en voile et en surf", () => {
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
      const expected = SAILING_SPORTS.includes(sport) || sport === 'surf';
      expect(SPORT_PROFILES[sport].hrEnergy !== null, sport).toBe(expected);
    }
  });
});
