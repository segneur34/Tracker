import { describe, expect, it } from 'vitest';
import type { SessionAnalysis } from './record';
import { sessionRecord } from '../test/record.fixture';
import { summaryOptions, withSummary, type ActivitySummarySettings } from './summaryOptions';

const analysis = (patch: Partial<SessionAnalysis>): SessionAnalysis => ({
  activeThreshold: null, referenceSpeedMs: null, foil: null, waveThreshold: null, ...patch,
} as SessionAnalysis);

describe('réglages du résumé (lot 72)', () => {
  const activity: ActivitySummarySettings = { thresholdOverride: 9, foil: true };

  it("sans calcul, aucun réglage", () => {
    expect(summaryOptions(null, analysis({ activeThreshold: 3 }), activity)).toEqual({});
  });

  it("le seuil de la session prime sur celui de l'activité, qui prime sur le défaut", () => {
    expect(summaryOptions('wingfoil', analysis({ activeThreshold: 6 }), activity).activeThreshold).toBe(6);
    expect(summaryOptions('wingfoil', null, activity).activeThreshold).toBe(9);
    expect(summaryOptions('wingfoil', null, { thresholdOverride: undefined, foil: null }).activeThreshold).toBeUndefined();
  });

  it("l'allure imposée en voile seulement", () => {
    expect(summaryOptions('kite', analysis({ referenceSpeedMs: 7 }), activity).referenceSpeedOverrideMs).toBe(7);
    expect(summaryOptions('running', analysis({ referenceSpeedMs: 7 }), activity).referenceSpeedOverrideMs).toBeUndefined();
  });

  it("le foil de la session, sinon celui de l'activité", () => {
    expect(summaryOptions('surf', analysis({ foil: false }), activity).foil).toBe(false);
    expect(summaryOptions('surf', null, activity).foil).toBe(true);
    expect(summaryOptions('running', null, { thresholdOverride: undefined, foil: null }).foil).toBeUndefined();
  });

  it("l'altitude du terrain à pied et à vélo, sauf si le GPS est gardé", () => {
    const terrainElevation = { stepM: 10, startMs: 0, samples: [] } as never;
    expect(summaryOptions('running', null, activity, { terrainElevation, elevationSource: 'terrain', test: undefined } as never).terrainElevation)
      .toBe(terrainElevation);
    expect(summaryOptions('running', null, activity, { terrainElevation, elevationSource: 'gps' } as never).terrainElevation).toBeUndefined();
    expect(summaryOptions('wingfoil', null, activity, { terrainElevation } as never).terrainElevation).toBeUndefined();
  });
});

describe('nouveau résumé gardé avec ses manœuvres', () => {
  it('garde le nombre et la réussite des manœuvres de la dernière analyse', () => {
    const record = sessionRecord({}, { maneuverCount: 12, maneuverResults: { success: 10 } as never });
    const fresh = sessionRecord({}, { distanceM: 30_000 }).summary;
    const next = withSummary(record, fresh);
    expect(next.summary.distanceM).toBe(30_000);
    expect(next.summary.maneuverCount).toBe(12);
    expect(next.summary.maneuverResults).toEqual({ success: 10 });
    expect(withSummary({ ...record, summary: null }, fresh).summary).toEqual(fresh);
  });
});
