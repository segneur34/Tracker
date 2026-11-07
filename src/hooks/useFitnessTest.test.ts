import { describe, expect, it } from 'vitest';
import { getSportProfile } from '../core/sportProfiles';
import { EMPTY_RUNNER_PROFILE, type RunnerProfile } from '../library/athleteProfile';
import { heartRateZones } from '../core/heartRate';
import { fitnessTestRunner } from './useFitnessTest';

const MODEL = getSportProfile('run-test').heartRate.zoneModel;
const profile = (over: Partial<RunnerProfile>): RunnerProfile => ({ ...EMPTY_RUNNER_PROFILE, ...over });

describe('fitnessTestRunner', () => {
  it('sans activité : calcul de test à pied, son modèle de zones et son décalage', () => {
    const runner = fitnessTestRunner(EMPTY_RUNNER_PROFILE);
    expect(runner.zoneModel).toBe(MODEL);
    expect(runner.offsetBpm).toBe(getSportProfile('run-test').heartRate.thresholdOffsetBpm);
    expect(runner.age).toBeNull();
    expect(runner.athlete).toBe(EMPTY_RUNNER_PROFILE);
  });

  it('l’âge vient de l’année de naissance du profil', () => {
    expect(fitnessTestRunner(profile({ birthYear: 1986 })).age).toBe(new Date().getFullYear() - 1986);
  });

  it('FC max estimée par l’âge, puis zones qui en découlent', () => {
    const age = new Date().getFullYear() - 1986;
    const runner = fitnessTestRunner(profile({ birthYear: 1986 }));
    const zones = heartRateZones(runner.athlete, runner.age, runner.zoneModel, runner.offsetBpm);
    expect(zones).not.toBeNull();
    expect(zones).toMatchObject({ method: 'max', estimated: true });
    // Sans âge ni FC max ni seuils : pas de zones.
    expect(heartRateZones(EMPTY_RUNNER_PROFILE, fitnessTestRunner(EMPTY_RUNNER_PROFILE).age, MODEL, 0)).toBeNull();
    expect(age).toBeGreaterThan(0);
  });

  it('une FC max saisie prime sur l’estimation par l’âge', () => {
    const runner = fitnessTestRunner(profile({ birthYear: 1986, hrMax: 190 }));
    const zones = heartRateZones(runner.athlete, runner.age, runner.zoneModel, runner.offsetBpm);
    expect(zones).toMatchObject({ method: 'max', estimated: false });
  });
});
