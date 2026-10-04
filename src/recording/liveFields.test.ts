import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_FIELDS, MAX_LIVE_FIELDS, liveFieldLabel, liveFieldValue, liveFieldsOfFamily, sanitizeLiveFields, type LiveFieldContext } from './liveFields';
import { EMPTY_LIVE_STATS } from './liveStats';

const context = (patch: Partial<LiveFieldContext> = {}): LiveFieldContext => ({
  stats: EMPTY_LIVE_STATS,
  durationMs: 0,
  nowMs: 0,
  remainingM: null,
  headingDeg: null,
  speedUnit: 'kmh',
  distanceUnit: 'km',
  ...patch,
});

describe('liveFieldsOfFamily', () => {
  it('ne propose que les chiffres qui ont un sens pour la famille', () => {
    expect(liveFieldsOfFamily('voile')).toContain('recentTopShort');
    expect(liveFieldsOfFamily('voile')).not.toContain('power');
    expect(liveFieldsOfFamily('course')).toContain('power');
    expect(liveFieldsOfFamily('course')).not.toContain('heading');
    expect(liveFieldsOfFamily('velo')).toContain('grade');
  });

  it('propose les défauts de chaque famille', () => {
    for (const family of ['voile', 'course', 'velo'] as const) {
      for (const key of DEFAULT_LIVE_FIELDS[family]) expect(liveFieldsOfFamily(family)).toContain(key);
    }
  });
});

describe('sanitizeLiveFields', () => {
  it('garde les clés connues et permises, sans doublon, dans la limite', () => {
    expect(sanitizeLiveFields(['speed', 'power', 'speed', 'inconnu', 'heading'], 'course')).toEqual(['speed', 'power']);
    expect(sanitizeLiveFields(['speed', 'average', 'max', 'distance', 'duration'], 'voile')).toHaveLength(MAX_LIVE_FIELDS);
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
    for (const key of ['grade', 'gain', 'climbRate', 'power', 'effort', 'heading', 'legAverage'] as const) {
      expect(liveFieldValue(key, context())).toBe('—');
    }
    expect(liveFieldValue('heading', context({ headingDeg: 359.7 }))).toBe('0°');
  });
});
