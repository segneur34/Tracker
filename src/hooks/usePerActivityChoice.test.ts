import { describe, expect, it } from 'vitest';
import { choiceFor } from './usePerActivityChoice';

describe('choiceFor', () => {
  it('sans choix fait sur la page : celui de Réglages', () => {
    expect(choiceFor(null, 'running', true)).toBe(true);
    expect(choiceFor(null, 'running', false)).toBe(false);
  });

  it('le choix fait pour cette activité prime, coché ou décoché', () => {
    expect(choiceFor({ activityId: 'running', measure: false }, 'running', true)).toBe(false);
    expect(choiceFor({ activityId: 'running', measure: true }, 'running', false)).toBe(true);
  });

  it("le choix fait pour une autre activité ne la suit pas ; sans activité, celui de Réglages", () => {
    expect(choiceFor({ activityId: 'running', measure: false }, 'walking', true)).toBe(true);
    expect(choiceFor({ activityId: 'running', measure: false }, null, true)).toBe(true);
  });
});
