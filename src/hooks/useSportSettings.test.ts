import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES } from '../core/activities';
import { getSportProfile, hasActiveThreshold } from '../core/sportProfiles';
import { knotsToMs } from '../core/units';
import { DEFAULT_PACE_LEVEL } from '../planning/duration';
import { BIKE_TYPES } from '../cycling/energy';
import {
  MAX_GEAR_LABEL_LENGTH, PRESETS_VERSION, TREATMENT_UNITS, defaultAutoPauseOf, defaultBikeKg, defaultBikeType, defaultGradeRange,
  defaultHeartRateOf, defaultLiveFieldsFor, defaultMarkGuideOf, defaultNotificationFieldsFor, defaultPaceOf, defaultSpeedRangeOf, defaultSpeedUnitOf,
  defaultTerrainStepOf, defaultThresholdOf, rangeFollowsPace, resetStoredPresets, sanitizeGearLabels, thresholdFollowsPace, type StoredSettings,
} from './useSportSettings';

describe('pré-réglages du bateau (21/10)', () => {
  const boat = { id: 'a-voilier', name: 'Voilier', base: 'bateau' as const, color: '#014e86' };

  it('colore de 1 à 15 nœuds, sans seuil, pause sous 0,2 km/h pendant 60 s', () => {
    const range = defaultSpeedRangeOf(boat);
    expect(range.minMs).toBeCloseTo(knotsToMs(1), 6);
    expect(range.maxMs).toBeCloseTo(knotsToMs(15), 6);
    const profile = getSportProfile('bateau');
    expect(hasActiveThreshold(profile)).toBe(false);
    expect(profile.withoutActiveThreshold?.maneuverSuccess).toBe(1);
    expect(profile.recording.autoPauseSpeedMs * 3.6).toBeCloseTo(0.2, 6);
    expect(profile.recording.autoPauseDelayS).toBe(60);
    expect(hasActiveThreshold(getSportProfile('wingfoil'))).toBe(true);
  });

  it("efface une fois les anciens réglages du bateau, rien d'autre", () => {
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES, boat],
      speedRanges: { [boat.id]: { minMs: 1, maxMs: 9 }, bateau: { minMs: 1, maxMs: 8 }, kite: { minMs: 3, maxMs: 12 } },
      thresholds: { [boat.id]: 3, kite: 9 },
      autoPause: { [boat.id]: { speedMs: 0.3, delayS: 60 } },
      liveFields: { [boat.id]: ['speed'] },
      notificationFields: { [boat.id]: ['speed', 'max'] },
      speedUnits: { [boat.id]: 'kmh' },
    };
    const next = resetStoredPresets(stored);
    expect(next.speedRanges).toEqual({ kite: { minMs: 3, maxMs: 12 } });
    expect(next.thresholds).toEqual({ kite: 9 });
    expect(next.autoPause).toEqual({});
    expect(next.liveFields).toEqual({});
    expect(next.notificationFields).toEqual({});
    expect(next.speedUnits).toEqual({ [boat.id]: 'kmh' });
    // Réglages écrits après la mise à jour : gardés.
    const written = { ...stored, presetsVersion: PRESETS_VERSION };
    expect(resetStoredPresets(written)).toBe(written);
    // Rien à effacer : les réglages eux-mêmes.
    const clean: StoredSettings = { speedUnits: { kite: 'kmh' } };
    expect(resetStoredPresets(clean)).toBe(clean);
  });
});

describe('pré-réglages des activités (21/10)', () => {
  const [voile, course, marche, route, gravel, vtt, runIntervals, bikeIntervals, surf] = DEFAULT_ACTIVITIES;
  const pav = { id: 'a-pav', name: 'Pav', base: 'windsurf' as const, color: '#5b87f2' };
  const trail = { id: 'a-trail', name: 'Trail', base: 'running' as const, color: '#d42a3c' };
  const kmh = (ms: number) => Math.round(ms * 3.6 * 10) / 10;
  const kn = (ms: number) => Math.round((ms / knotsToMs(1)) * 10) / 10;

  it('wing et planche : 8 nœuds partout, seuil et couleurs fixes', () => {
    for (const activity of [voile, pav]) {
      expect(defaultThresholdOf(activity, false)).toBe(8);
      expect(thresholdFollowsPace(activity)).toBe(false);
      expect(rangeFollowsPace(activity)).toBe(false);
      const range = defaultSpeedRangeOf(activity);
      expect([kn(range.minMs), kn(range.maxMs)]).toEqual([8, 24]);
      expect(kmh(defaultAutoPauseOf(activity).speedMs)).toBe(1.5);
      expect(defaultLiveFieldsFor(activity)).toEqual(['speed', 'average', 'recentTopShort', 'distance']);
      expect(defaultMarkGuideOf(activity).curve.map((p) => p.distanceM)).toEqual([5, 25, 34]);
    }
    // Le kite suit toujours l'allure.
    const kite = { id: 'a-kite', name: 'Kite', base: 'kite' as const, color: '#1976d2' };
    expect(thresholdFollowsPace(kite)).toBe(true);
    expect(rangeFollowsPace(kite)).toBe(true);
  });

  it("sans seuil d'activité à pied, à vélo et en fractionné, sauf la marche", () => {
    for (const activity of [course, route, gravel, vtt, runIntervals, bikeIntervals, trail]) {
      expect(defaultThresholdOf(activity, false)).toBe(0);
    }
    expect(defaultThresholdOf(marche, false)).toBe(0.5);
    // Le surf garde ses défauts.
    expect(defaultThresholdOf(surf, false)).toBe(getSportProfile('surf').defaultActiveThreshold);
  });

  it('course : km/h, couleurs de 1 à 13, pause sous 0,5 km/h pendant 20 s, ceinture, sentier et piste', () => {
    expect(defaultSpeedUnitOf(course)).toBe('kmh');
    const range = defaultSpeedRangeOf(course);
    expect([kmh(range.minMs), kmh(range.maxMs)]).toEqual([1, 13]);
    expect(defaultAutoPauseOf(course)).toEqual({ speedMs: 0.5 / 3.6, delayS: 20 });
    expect(defaultGradeRange(course)).toEqual({ min: 0, max: 0.17 });
    expect(defaultHeartRateOf(course)).toBe(true);
    expect(defaultTerrainStepOf(course)).toBe(5);
    // Une activité créée sur la course prend son pré-réglage.
    expect(defaultSpeedRangeOf(trail)).toEqual(range);
  });

  it("la marche a le sien en entier, sans rien reprendre de la course", () => {
    const range = defaultSpeedRangeOf(marche);
    expect([kmh(range.minMs), kmh(range.maxMs)]).toEqual([1, 8]);
    expect(defaultHeartRateOf(marche)).toBe(false);
    expect(defaultNotificationFieldsFor(marche)).toEqual(['speed', 'heartRate']);
    const walk = defaultPaceOf(marche);
    expect(walk.level).toBe('perso');
    expect(walk.customFlatSpeedMs! * 3.6).toBeCloseTo(5);
    expect(defaultPaceOf(course)).toEqual({ level: DEFAULT_PACE_LEVEL, customFlatSpeedMs: null });
  });

  it('vélo : type et poids pré-réglés, le poids du type dès que le type change', () => {
    expect(defaultBikeType(route)).toBe('route');
    expect(defaultBikeKg(route, 'route')).toBe(12);
    expect(defaultBikeKg(route, 'gravel')).toBe(BIKE_TYPES.gravel.bikeKg);
    expect(defaultBikeType(gravel)).toBe('gravel');
    expect(defaultBikeKg(gravel, 'gravel')).toBe(13);
    expect(defaultBikeType(vtt)).toBe('vtt');
    expect(defaultBikeKg(vtt, 'vtt')).toBe(BIKE_TYPES.vtt.bikeKg);
    expect(defaultHeartRateOf(route)).toBe(true);
    expect(defaultHeartRateOf(gravel)).toBe(false);
  });

  it('fractionné : chiffres cardio, pause coupée', () => {
    for (const activity of [runIntervals, bikeIntervals]) {
      expect(defaultLiveFieldsFor(activity)).toEqual(['speed', 'average', 'heartRate', 'heartRateZone']);
      expect(defaultAutoPauseOf(activity).speedMs).toBe(0);
    }
  });

  it('efface une fois les anciens réglages des sports pré-réglés, pas ceux du kite ni du surf', () => {
    const stored: StoredSettings = {
      activities: [...DEFAULT_ACTIVITIES, pav],
      presetsVersion: 1,
      thresholds: { running: 2, 'a-gravel': 2, [pav.id]: 9, kite: 12, surf: 9 },
      speedRanges: { 'a-route': { minMs: 2, maxMs: 12 }, cycling: { minMs: 2, maxMs: 12 } },
      tabs: { [pav.id]: { vent: false } },
      gearLabels: { running: ['Chaussures', ''] },
    };
    const next = resetStoredPresets(stored);
    expect(next.thresholds).toEqual({ kite: 12, surf: 9 });
    expect(next.speedRanges).toEqual({ 'a-route': { minMs: 2, maxMs: 12 } });
    expect(next.tabs).toEqual({});
    expect(next.gearLabels).toEqual(stored.gearLabels);
  });
});

describe('unités proposées par traitement', () => {
  it('le surf propose les nœuds, le km/h restant en tête et par défaut', () => {
    expect(TREATMENT_UNITS.surf).toContain('kn');
    expect(TREATMENT_UNITS.surf[0]).toBe('kmh');
    expect(getSportProfile('surf').speedUnit).toBe('kmh');
  });
});

describe('sanitizeGearLabels', () => {
  it('rogne les intitulés et garde un texte vide pour celui par défaut', () => {
    expect(sanitizeGearLabels(['  Chaussures ', ''])).toEqual(['Chaussures', '']);
  });

  it('tronque un intitulé trop long', () => {
    expect(sanitizeGearLabels(['x'.repeat(50), 'Sac'])?.[0]).toHaveLength(MAX_GEAR_LABEL_LENGTH);
  });

  it('rend null pour deux intitulés vides ou une valeur mal formée', () => {
    expect(sanitizeGearLabels([' ', ''])).toBeNull();
    expect(sanitizeGearLabels(['Vélo'])).toBeNull();
    expect(sanitizeGearLabels(['Vélo', 3])).toBeNull();
    expect(sanitizeGearLabels('Vélo')).toBeNull();
  });
});
