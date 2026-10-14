import { describe, expect, it } from 'vitest';
import { getSportProfile } from '../core/sportProfiles';
import { MAX_GEAR_LABEL_LENGTH, TREATMENT_UNITS, sanitizeGearLabels } from './useSportSettings';

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
