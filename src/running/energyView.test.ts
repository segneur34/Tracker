import { describe, expect, it } from 'vitest';
import { energyCases } from '../core/energyTestTracks';
import { GRADE_ANALYSIS } from '../core/sportProfiles';
import { runningEnergyView, TOTAL_ENERGY_LABEL, type EnergyInputs, type EnergyRunner } from './energyView';

const [plain] = energyCases();

const inputs = (runner: EnergyRunner, loadKg = 0): EnergyInputs => ({
  track: plain.track, grades: plain.grades, gradeZones: GRADE_ANALYSIS, activityMask: plain.mask, runner, age: 40,
  bikeType: 'route', bikeWeightKg: 8, loadKg, energyModel: 'course', surfaces: { status: 'idle', stretches: null },
});

const WEIGHED: EnergyRunner = { weightKg: 70, heightCm: 178, sex: 'm', economyMlKgKm: null };
const UNWEIGHED: EnergyRunner = { weightKg: null, heightCm: null, sex: null, economyMlKgKm: null };

describe('runningEnergyView', () => {
  it('range la dépense totale sous la clé « total »', () => {
    const view = runningEnergyView(inputs(WEIGHED));
    expect(view.stats.map((s) => s.key)).toEqual(['effort', 'total', 'puissance', 'cout-km']);
    expect(view.stats.find((s) => s.key === 'total')?.label).toBe(TOTAL_ENERGY_LABEL);
    expect(view.powerUnit).toBe('W');
    expect(view.warning).toBeNull();
  });

  it('sans poids : valeurs par kilo, avertissement par code', () => {
    const view = runningEnergyView(inputs(UNWEIGHED));
    expect(view.powerUnit).toBe('W/kg');
    expect(view.warning).toEqual({ code: 'sans-poids' });
    expect(runningEnergyView(inputs(UNWEIGHED, 5)).warning).toEqual({ code: 'sans-poids-charge', loadKg: 5 });
  });
});
