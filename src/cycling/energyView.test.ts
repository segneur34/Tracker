import { describe, expect, it } from 'vitest';
import { energyCases } from '../core/energyTestTracks';
import { GRADE_ANALYSIS } from '../core/sportProfiles';
import type { EnergyInputs, EnergyRunner } from '../running/energyView';
import { cyclingEnergyView } from './energyView';

const [plain] = energyCases();

const inputs = (runner: EnergyRunner, status: EnergyInputs['surfaces']['status']): EnergyInputs => ({
  track: plain.track, grades: plain.grades, gradeZones: GRADE_ANALYSIS, activityMask: plain.mask, runner, age: 40,
  bikeType: 'route', bikeWeightKg: 8, loadKg: 0, energyModel: 'course', surfaces: { status, stretches: null },
});

const WEIGHED: EnergyRunner = { weightKg: 70, heightCm: 178, sex: 'm', economyMlKgKm: null };

describe('cyclingEnergyView', () => {
  it('range la dépense totale sous la clé « total », calculée ou non', () => {
    const view = cyclingEnergyView(inputs(WEIGHED, 'idle'));
    expect(view.stats.map((s) => s.key)).toEqual(['puissance', 'travail', 'effort', 'total']);
    expect(view.stats.find((s) => s.key === 'total')?.value).toMatch(/kcal$/);
    const none = cyclingEnergyView(inputs({ ...WEIGHED, weightKg: null }, 'idle'));
    expect(none.stats.map((s) => s.key)).toEqual(['puissance', 'travail', 'effort', 'total']);
    expect(none.stats.every((s) => s.value === '—')).toBe(true);
    expect(none.warning).toEqual({ code: 'sans-poids-velo' });
  });

  it('avertit du revêtement cherché ou introuvable', () => {
    expect(cyclingEnergyView(inputs(WEIGHED, 'idle')).warning).toBeNull();
    expect(cyclingEnergyView(inputs(WEIGHED, 'searching')).warning?.code).toBe('revetement-recherche');
    expect(cyclingEnergyView(inputs(WEIGHED, 'error')).warning?.code).toBe('revetement-introuvable');
  });
});
