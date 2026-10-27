import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_FIELDS, DEFAULT_NOTIFICATION_FIELDS, MAX_LIVE_FIELDS, MAX_NOTIFICATION_FIELDS, defaultLiveFieldsOf, defaultNotificationFieldsOf,
  liveFieldLabel, liveFieldShortLabel, liveFieldValue, liveFieldsOfTreatment, sanitizeLiveFields, type LiveFieldContext,
} from './liveFields';
import { SPORT_PROFILES, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { EMPTY_LIVE_STATS } from './liveStats';

const context = (patch: Partial<LiveFieldContext> = {}): LiveFieldContext => ({
  stats: EMPTY_LIVE_STATS,
  durationMs: 0,
  nowMs: 0,
  remainingM: null,
  headingDeg: null,
  markDistanceM: null,
  markBearingDeg: null,
  heartRateBpm: null,
  heartRateZoneBounds: null,
  speedUnit: 'kmh',
  distanceUnit: 'km',
  ...patch,
});

describe('liveFieldsOfTreatment', () => {
  it('ne propose que les chiffres qui ont un sens pour le traitement', () => {
    expect(liveFieldsOfTreatment('voile')).toContain('recentTopShort');
    expect(liveFieldsOfTreatment('voile')).not.toContain('power');
    for (const treatment of ['voile', 'course', 'velo', 'surf'] as const) {
      expect(liveFieldsOfTreatment(treatment)).toEqual(expect.arrayContaining(['heartRate', 'averageHeartRate', 'heartRateZone']));
    }
    expect(liveFieldsOfTreatment('course')).toContain('power');
    expect(liveFieldsOfTreatment('voile')).toContain('markDistance');
    expect(liveFieldsOfTreatment('surf')).toEqual(expect.arrayContaining(['markDistance', 'markBearing']));
    expect(liveFieldsOfTreatment('course')).not.toContain('markBearing');
    expect(liveFieldsOfTreatment('course')).not.toContain('heading');
    expect(liveFieldsOfTreatment('velo')).toContain('grade');
  });

  it('propose les défauts de chaque traitement', () => {
    for (const treatment of ['voile', 'course', 'velo', 'surf'] as const) {
      for (const key of DEFAULT_LIVE_FIELDS[treatment]) expect(liveFieldsOfTreatment(treatment)).toContain(key);
      for (const key of DEFAULT_NOTIFICATION_FIELDS[treatment]) expect(liveFieldsOfTreatment(treatment)).toContain(key);
      expect(DEFAULT_NOTIFICATION_FIELDS[treatment].length).toBeLessThanOrEqual(MAX_NOTIFICATION_FIELDS);
    }
  });

  it('propose les défauts de chaque calcul, permis par son traitement', () => {
    for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
      const treatment = sportTreatment(sport);
      expect(sanitizeLiveFields(defaultLiveFieldsOf(sport), treatment)).toEqual(defaultLiveFieldsOf(sport));
      expect(sanitizeLiveFields(defaultNotificationFieldsOf(sport), treatment, MAX_NOTIFICATION_FIELDS)).toEqual(defaultNotificationFieldsOf(sport));
    }
  });

  it('bateau : vitesse, moyenne, distance et cap ; notification vitesse et distance', () => {
    expect(defaultLiveFieldsOf('bateau')).toEqual(['speed', 'average', 'distance', 'heading']);
    expect(defaultNotificationFieldsOf('bateau')).toEqual(['speed', 'distance']);
    expect(defaultLiveFieldsOf('wingfoil')).toEqual(DEFAULT_LIVE_FIELDS.voile);
  });
});

describe('sanitizeLiveFields', () => {
  it('garde les clés connues et permises, sans doublon, dans la limite', () => {
    expect(sanitizeLiveFields(['speed', 'power', 'speed', 'inconnu', 'heading'], 'course')).toEqual(['speed', 'power']);
    expect(sanitizeLiveFields(['speed', 'average', 'max', 'distance', 'duration'], 'voile')).toHaveLength(MAX_LIVE_FIELDS);
  });

  it('borne au maximum demandé, celui de la notification', () => {
    expect(sanitizeLiveFields(['speed', 'average', 'max', 'distance'], 'voile', MAX_NOTIFICATION_FIELDS)).toEqual(['speed', 'average']);
    expect(sanitizeLiveFields(['heading', 'speed', 'power', 'average', 'max'], 'course', 3)).toEqual(['speed', 'power', 'average']);
  });

  it("rend null quand rien ne reste, pour retomber sur le défaut", () => {
    expect(sanitizeLiveFields([], 'course')).toBeNull();
    expect(sanitizeLiveFields(['heading'], 'course')).toBeNull();
    expect(sanitizeLiveFields('speed', 'course')).toBeNull();
    expect(sanitizeLiveFields(undefined, 'course')).toBeNull();
  });
});

describe('liveFieldLabel', () => {
  it("parle d'allure en min/km et de mille en milles nautiques", () => {
    expect(liveFieldLabel('average', { speedUnit: 'minkm', distanceUnit: 'km' })).toBe('Allure moyenne');
    expect(liveFieldLabel('average', { speedUnit: 'kn', distanceUnit: 'nm' })).toBe('Moyenne');
    expect(liveFieldLabel('lastDistance', { speedUnit: 'kn', distanceUnit: 'nm' })).toBe('Dernier mille');
    expect(liveFieldLabel('recentDistanceSpeed', { speedUnit: 'kmh', distanceUnit: 'km' })).toBe('300 derniers m');
    expect(liveFieldLabel('power', { speedUnit: 'kmh', distanceUnit: 'km' })).toBe('Puissance (15 s)');
  });
});

describe('liveFieldShortLabel', () => {
  it("abrège, et parle d'allure en min/km", () => {
    expect(liveFieldShortLabel('speed', { speedUnit: 'kmh', distanceUnit: 'km' })).toBe('Vit.');
    expect(liveFieldShortLabel('speed', { speedUnit: 'minkm', distanceUnit: 'km' })).toBe('Allure');
    expect(liveFieldShortLabel('lastDistance', { speedUnit: 'kn', distanceUnit: 'nm' })).toBe('Dern. mille');
  });
});

describe('liveFieldValue', () => {
  it('formate pente, dénivelé et vitesse ascensionnelle', () => {
    const stats = { ...EMPTY_LIVE_STATS, currentGrade: 0.062, recentDistanceGainM: 14.6, climbRateMh: 851.2 };
    expect(liveFieldValue('grade', context({ stats }))).toBe('+6 %');
    expect(liveFieldValue('grade', context({ stats: { ...stats, currentGrade: -0.08 } }))).toBe('−8 %');
    expect(liveFieldValue('grade', context({ stats: { ...stats, currentGrade: 0.004 } }))).toBe('0 %');
    expect(liveFieldValue('recentDistanceGain', context({ stats }))).toBe('15 m');
    expect(liveFieldValue('climbRate', context({ stats }))).toBe('851 m/h');
  });

  it('formate puissance et énergie, par kilo sans poids', () => {
    const stats = { ...EMPTY_LIVE_STATS, recentPowerW: 312.4, effortJ: 640 * 4184 };
    expect(liveFieldValue('power', context({ stats }))).toBe('312 W');
    expect(liveFieldValue('effort', context({ stats }))).toBe('640 kcal');
    const perKg = { ...stats, recentPowerW: 4.18, effortJ: 8.5 * 4184, energyPerKg: true };
    expect(liveFieldValue('power', context({ stats: perKg }))).toBe('4.2 W/kg');
    expect(liveFieldValue('effort', context({ stats: perKg }))).toBe('8.5 kcal/kg');
  });

  it('donne le temps restant à la moyenne actuelle, et rien sans trace', () => {
    const stats = { ...EMPTY_LIVE_STATS, averageSpeedMs: 3 };
    expect(liveFieldValue('remainingTime', context({ stats, remainingM: 5400 }))).toBe('0:30:00');
    expect(liveFieldValue('remainingTime', context({ stats }))).toBe('—');
    expect(liveFieldValue('remaining', context({ stats, remainingM: 5400 }))).toBe('5.40 km');
  });

  it('marque les valeurs manquantes', () => {
    for (const key of ['grade', 'gain', 'climbRate', 'power', 'effort', 'heading', 'legAverage', 'markDistance', 'markBearing'] as const) {
      expect(liveFieldValue(key, context())).toBe('—');
    }
    expect(liveFieldValue('heading', context({ headingDeg: 359.7 }))).toBe('0°');
    expect(liveFieldValue('markBearing', context({ markBearingDeg: 245.2 }))).toBe('245°');
    expect(liveFieldValue('heartRate', context({ heartRateBpm: 142.4 }))).toBe('142 bpm');
    expect(liveFieldValue('heartRate', context())).toBe('—');
    expect(liveFieldValue('averageHeartRate', context({ stats: { ...EMPTY_LIVE_STATS, averageHeartRateBpm: 151.6 } }))).toBe('152 bpm');
    expect(liveFieldValue('averageHeartRate', context())).toBe('—');
    const bounds = [100, 120, 140, 160, 180];
    expect(liveFieldValue('heartRateZone', context({ heartRateBpm: 152, heartRateZoneBounds: bounds }))).toBe('Z3 · 152');
    expect(liveFieldValue('heartRateZone', context({ heartRateBpm: 92, heartRateZoneBounds: bounds }))).toBe('sous Z1 · 92');
    expect(liveFieldValue('heartRateZone', context({ heartRateBpm: 152 }))).toBe('—');
    expect(liveFieldValue('markDistance', context({ markDistanceM: 143 }))).toBe('143 m');
  });
});

describe('étape (26/10)', () => {
  it('ne se propose que dans la notification, à pied et à vélo', () => {
    expect(liveFieldsOfTreatment('course', 'notification')).toContain('step');
    expect(liveFieldsOfTreatment('velo', 'notification')).toContain('step');
    expect(liveFieldsOfTreatment('voile', 'notification')).not.toContain('step');
    expect(liveFieldsOfTreatment('course')).not.toContain('step');
    expect(sanitizeLiveFields(['step', 'speed'], 'course', MAX_NOTIFICATION_FIELDS, 'notification')).toEqual(['step', 'speed']);
    // Dans la carte réduite, elle est écartée.
    expect(sanitizeLiveFields(['step', 'speed'], 'course')).toEqual(['speed']);
  });

  it("se lit n/N au compteur, le palier seul pendant un test, « — » sans l'un ni l'autre", () => {
    expect(liveFieldLabel('step', context())).toBe('Étape');
    expect(liveFieldShortLabel('step', context())).toBe('Étape');
    expect(liveFieldValue('step', context({ step: { rep: 5, of: 20 } }))).toBe('5/20');
    expect(liveFieldValue('step', context({ step: { rep: 4, of: null } }))).toBe('4');
    expect(liveFieldValue('step', context({ step: null }))).toBe('—');
    expect(liveFieldValue('step', context())).toBe('—');
  });
});
