import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTIVITIES, MARCHE_ACTIVITY } from '../core/activities';
import { getSportProfile } from '../core/sportProfiles';
import { DEFAULT_PACE_LEVEL } from '../planning/duration';
import { DEFAULT_SPEED_RANGE_MS, DEFAULT_WALK_SPEED_RANGE_MS } from '../running/runningAnalytics';
import {
  MAX_GEAR_LABEL_LENGTH, TREATMENT_SPEED_RANGE_MS, TREATMENT_UNITS, defaultPaceOf, defaultSpeedRangeOf, sanitizeGearLabels,
} from './useSportSettings';

describe('défauts de la Marche de départ', () => {
  const course = DEFAULT_ACTIVITIES[1];

  it('colore de 1,5 à 8 km/h, la course de 4 à 15', () => {
    expect(defaultSpeedRangeOf(MARCHE_ACTIVITY)).toBe(DEFAULT_WALK_SPEED_RANGE_MS);
    expect(DEFAULT_WALK_SPEED_RANGE_MS.minMs * 3.6).toBeCloseTo(1.5);
    expect(DEFAULT_WALK_SPEED_RANGE_MS.maxMs * 3.6).toBeCloseTo(8);
    expect(defaultSpeedRangeOf(course)).toBe(DEFAULT_SPEED_RANGE_MS);
    expect(defaultSpeedRangeOf({ ...MARCHE_ACTIVITY, id: 'a-ma-marche' })).toBe(DEFAULT_SPEED_RANGE_MS);
    expect(defaultSpeedRangeOf(DEFAULT_ACTIVITIES[0])).toBe(TREATMENT_SPEED_RANGE_MS.voile);
  });

  it('estime le temps des itinéraires à 5 km/h, les autres au niveau par défaut', () => {
    const walk = defaultPaceOf(MARCHE_ACTIVITY.id);
    expect(walk.level).toBe('perso');
    expect(walk.customFlatSpeedMs! * 3.6).toBeCloseTo(5);
    expect(defaultPaceOf(course.id)).toEqual({ level: DEFAULT_PACE_LEVEL, customFlatSpeedMs: null });
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
