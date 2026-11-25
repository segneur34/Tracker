import { describe, expect, it } from 'vitest';
import {
  REFERENCE_HEART_RATE, SAILING_SPORTS, SPORT_PROFILES, UNCLASSIFIED_PROFILE, familySports, guardMovingSpeedMs, hasActiveThreshold,
  isSportType,
} from './sportProfiles';
import { thresholdActivityMask } from './sessionStats';
import type { SportType, TrackPoint } from './types';
import { kmhToMs, knotsToMs } from './units';

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

describe('garde contre un enregistrement jamais repris (lot 232)', () => {
  it('la même pour tous les supports : 200 m, 1 h, et 12 h après la fermeture', () => {
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
      const { guardStillRadiusM, guardStillDelayS, guardMaxClosedS } = SPORT_PROFILES[sport].recording;
      expect([guardStillRadiusM, guardStillDelayS, guardMaxClosedS], sport).toEqual([200, 3600, 43200]);
    }
  });

  it('sans bouger : la vitesse doit tenir 5 s, partout', () => {
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) expect(SPORT_PROFILES[sport].recording.guardMovingHoldS, sport).toBe(5);
  });

  it('vraie vitesse : la sortie d’un arrêt complet du calcul, 1,5 nd en voile, 2 km/h à pied, 3 km/h à vélo et en surf', () => {
    for (const sport of familySports('voile')) expect(guardMovingSpeedMs(SPORT_PROFILES[sport]), sport).toBeCloseTo(knotsToMs(1.5), 6);
    expect(guardMovingSpeedMs(SPORT_PROFILES.running)).toBeCloseTo(kmhToMs(2), 6);
    expect(guardMovingSpeedMs(SPORT_PROFILES.cycling)).toBeCloseTo(kmhToMs(3), 6);
    expect(guardMovingSpeedMs(SPORT_PROFILES.surf)).toBeCloseTo(kmhToMs(3), 6);
    // Le seuil d'entrée du masque d'activité au plancher d'arrêt, celui qu'un seuil réglé à 0 applique : une trace qui
    // part à cette vitesse est en action, un rien en dessous elle ne l'est pas.
    const start = (speedMs: number): TrackPoint[] => [{
      lat: 47.5, lon: -3.1, time: new Date(0).toISOString(), timeMs: 0, speedMs, smoothedSpeedMs: speedMs, bearing: 0, speedSource: 'doppler',
    }];
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
      const profile = SPORT_PROFILES[sport];
      if (!hasActiveThreshold(profile)) continue;
      const speedMs = guardMovingSpeedMs(profile);
      expect(thresholdActivityMask(start(speedMs + 1e-9), profile, 0)[0], sport).toBe(true);
      expect(thresholdActivityMask(start(speedMs - 1e-3), profile, 0)[0], sport).toBe(false);
    }
    // En m/s : environ 0,77 en voile, 0,83 à vélo et en surf, au-dessus du bruit d'un téléphone posé.
    expect(guardMovingSpeedMs(SPORT_PROFILES.wingfoil)).toBeCloseTo(0.772, 3);
    expect(guardMovingSpeedMs(SPORT_PROFILES.surf)).toBeCloseTo(0.833, 3);
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
