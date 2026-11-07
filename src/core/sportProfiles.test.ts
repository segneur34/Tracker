import { describe, expect, it } from 'vitest';
import { REFERENCE_HEART_RATE, SAILING_SPORTS, SPORT_PROFILES, UNCLASSIFIED_PROFILE, isSportType } from './sportProfiles';
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

describe('références du transverse (lot 187)', () => {
  it('le cardio de référence est celui de la course, le même objet', () => {
    expect(REFERENCE_HEART_RATE).toBe(SPORT_PROFILES.running.heartRate);
    expect(REFERENCE_HEART_RATE.thresholdOffsetBpm).toBe(0);
  });

  it("le profil d'une session sans calcul donne ce que la course donnait : dénivelé, fenêtre de vitesse max, cardio", () => {
    const running = SPORT_PROFILES.running;
    expect(UNCLASSIFIED_PROFILE.elevation).toBe(running.elevation);
    expect(UNCLASSIFIED_PROFILE.maxSpeedWindowS).toBe(running.maxSpeedWindowS);
    expect(UNCLASSIFIED_PROFILE.heartRate).toBe(running.heartRate);
  });
});
