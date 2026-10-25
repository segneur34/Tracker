import { describe, expect, it } from 'vitest';
import { heartRateZones } from '../core/heartRate';
import { SPORT_PROFILES } from '../core/sportProfiles';
import { EMPTY_RUNNER_PROFILE, type RunnerProfile } from '../hooks/useRunnerProfile';
import { formatOffsetBpm, hrSourceLabel, zonesOriginText } from './heartRateOrigin';

const MODEL = SPORT_PROFILES.running.heartRate.zoneModel;
const atDay = (day: number, month: number) => new Date(2026, month - 1, day, 9).getTime();

describe('hrSourceLabel', () => {
  it('dit le test ou la séance et son jour, ou la saisie', () => {
    expect(hrSourceLabel({ kind: 'test', atMs: atDay(24, 10) })).toBe('test du 24/10');
    expect(hrSourceLabel({ kind: 'seance', atMs: atDay(3, 9) })).toBe('séance du 03/09');
    expect(hrSourceLabel({ kind: 'saisie', atMs: null })).toBe('saisie');
  });
});

describe('zonesOriginText', () => {
  const runner: RunnerProfile = {
    ...EMPTY_RUNNER_PROFILE,
    hrMax: 190, hrMaxSource: { kind: 'test', atMs: atDay(24, 10) },
    hrRest: 50, hrRestSource: { kind: 'test', atMs: atDay(25, 10) },
  };

  it('dit les seuils, le décalage et les deux FC avec leur origine', () => {
    const zones = heartRateZones(runner, null, MODEL, -7)!;
    expect(zonesOriginText(zones, runner)).toBe(
      'S1 141 et S2 162 bpm (−7 pour cette activité), tirés de la FC repos 50 (test du 25/10) et de la FC max 190 (test du 24/10).'
    );
  });

  it("dit une FC max estimée par l'âge, sans FC repos", () => {
    const zones = heartRateZones(EMPTY_RUNNER_PROFILE, 40, MODEL)!;
    expect(zonesOriginText(zones, EMPTY_RUNNER_PROFILE)).toBe("S1 140 et S2 160 bpm, tirés de la FC max 180 (estimée par l'âge), sans FC repos.");
  });

  it('dit des seuils saisis', () => {
    const entered = { ...runner, hrThresholds: [150, 170] };
    expect(zonesOriginText(heartRateZones(entered, null, MODEL)!, entered)).toBe('S1 150 et S2 170 bpm, saisis dans Réglages › Pratiquant.');
    expect(formatOffsetBpm(3)).toBe('+3');
  });
});
