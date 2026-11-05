import { describe, expect, it } from 'vitest';
import { POWER_LEVEL_BOUNDS, POWER_LEVEL_LABELS, powerLevel, thresholdWkg } from './powerLevels';

describe('niveau à vélo au seuil (barème dérivé de Coggan, lot 146)', () => {
  it('range les hommes et les femmes sur leurs bornes', () => {
    expect(powerLevel('h', 1.9)).toBe('non entraîné');
    expect(powerLevel('h', 2.0)).toBe('loisir');
    expect(powerLevel('h', 2.8)).toBe('entraîné');
    expect(powerLevel('h', 4.0)).toBe('coureur de 3e ou 4e catégorie');
    expect(powerLevel('h', 5.5)).toBe('élite mondiale');
    expect(powerLevel('f', 2.8)).toBe('compétiteur');
    expect(powerLevel('f', 1.6)).toBe('non entraîné');
    expect(powerLevel('f', 4.8)).toBe('élite mondiale');
  });

  it('une borne par niveau au-dessus du premier', () => {
    for (const bounds of Object.values(POWER_LEVEL_BOUNDS)) expect(bounds).toHaveLength(POWER_LEVEL_LABELS.length - 1);
  });

  it('seuil : 95 % des meilleurs 20 min, rapporté au poids', () => {
    expect(thresholdWkg(212, 72)).toBeCloseTo((212 * 0.95) / 72, 9);
    expect(thresholdWkg(212, null)).toBeNull();
    expect(thresholdWkg(212, 0)).toBeNull();
  });
});
