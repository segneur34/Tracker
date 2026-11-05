import { describe, expect, it, vi } from 'vitest';
import type { SportType } from '../core/types';
import { SUMMARY_CALC_VERSION, type SessionAnalysis, type SessionRecord } from './record';
import { sessionRecord } from '../test/record.fixture';
import { phasesTrack } from '../test/track.fixture';
import {
  analyzeGpx, carriedThresholdNote, isSummaryOutdated, outdatedRefreshFiles, sessionActivitySettings, sessionFoil, summaryOptions, summaryOptionsKey, withSummary,
  type ActivitySummarySettings,
} from './summaryOptions';

// Pas de `DOMParser` dans l'environnement node : le « GPX » de ces tests est le JSON des points bruts.
vi.mock('../core/gpxParser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/gpxParser')>()),
  parseGpx: (text: string) => ({ rawPoints: JSON.parse(text), timedPoints: [], hasDeviceSpeed: false }),
}));

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
  it('garde aussi le pumping, le vent et la puissance posés par l’analyse (lot 145)', () => {
    const record = sessionRecord({}, { pumpingShare: 0.3, windDirDeg: 200, avgPowerW: 150 });
    const next = withSummary(record, sessionRecord({}, { distanceM: 30_000 }).summary);
    expect(next.summary).toMatchObject({ distanceM: 30_000, pumpingShare: 0.3, windDirDeg: 200, avgPowerW: 150 });
  });
});

describe('résumé à refaire quand les réglages changent (lot 37)', () => {
  const course: ActivitySummarySettings = { thresholdOverride: 6, foil: null };
  const of = (activity: ActivitySummarySettings) => (): ActivitySummarySettings => activity;
  /** Fiche dont le résumé porte l'empreinte des réglages `activity`, comme `analyzeGpx` la poserait. */
  const keyed = (sport: SportType, activity: ActivitySummarySettings, patch: Partial<SessionRecord> = {}): SessionRecord => {
    const record = sessionRecord({ sport, ...patch });
    return { ...record, summary: { ...record.summary, optionsKey: summaryOptionsKey(sport, summaryOptions(sport, record.analysis, activity)) } };
  };

  it("autres réglages sur cet appareil : rien, la session garde les siens (Q57) ; un geste : périmée", () => {
    const record = keyed('running', course);
    expect(isSummaryOutdated(record, of(course))).toBe(false);
    expect(isSummaryOutdated(record, of({ ...course, thresholdOverride: 7 }))).toBe(false);
    expect(isSummaryOutdated(record, of({ ...course, thresholdOverride: undefined }))).toBe(false);
    expect(isSummaryOutdated(record, of(course), () => ({ threshold: 7 }))).toBe(true);
    // Seuil retiré (défaut du calcul) ou mis à 0 (aucun seuil) : ce n'est pas le même résumé.
    expect(isSummaryOutdated(record, of(course), () => ({ threshold: null }))).toBe(true);
    expect(isSummaryOutdated(record, of(course), () => ({ threshold: 0 }))).toBe(true);
    // Geste déjà appliqué, ou revenu au réglage porté : rien.
    expect(isSummaryOutdated(record, of(course), () => ({ threshold: 6 }))).toBe(false);
  });

  it("session à seuil propre : rien quand les réglages de l'appareil diffèrent ; un geste la réécrit, pour que son porté suive", () => {
    const record = keyed('running', course, { analysis: analysis({ activeThreshold: 8 }) });
    expect(isSummaryOutdated(record, of({ ...course, thresholdOverride: 7 }))).toBe(false);
    expect(isSummaryOutdated(record, of({ ...course, thresholdOverride: undefined }))).toBe(false);
    expect(isSummaryOutdated(record, of(course), () => ({ threshold: 7 }))).toBe(true);
  });

  it('allure imposée changée : cette session seule', () => {
    const wing: ActivitySummarySettings = { thresholdOverride: undefined, foil: true };
    const changed = keyed('wingfoil', wing, { analysis: analysis({ referenceSpeedMs: 6 }) });
    const other = keyed('wingfoil', wing);
    const edited = { ...changed, analysis: analysis({ referenceSpeedMs: 7 }) };
    expect(isSummaryOutdated(edited, of(wing))).toBe(true);
    expect(isSummaryOutdated(other, of(wing))).toBe(false);
    expect(isSummaryOutdated(changed, of(wing))).toBe(false);
  });

  it("foil de l'activité : un geste rend périmée en surf ; autre foil sur l'appareil, rien", () => {
    const foil: ActivitySummarySettings = { thresholdOverride: undefined, foil: true };
    const noFoil: ActivitySummarySettings = { thresholdOverride: undefined, foil: false };
    expect(isSummaryOutdated(keyed('surf', foil), of(noFoil))).toBe(false);
    expect(isSummaryOutdated(keyed('surf', foil), of(noFoil), () => ({ foil: false }))).toBe(true);
    expect(isSummaryOutdated(keyed('wingfoil', foil), of(noFoil))).toBe(false);
    expect(isSummaryOutdated(keyed('running', foil), of(noFoil))).toBe(false);
    // Foil de la session : celui de l'activité n'y change rien.
    expect(isSummaryOutdated(keyed('surf', foil, { analysis: analysis({ foil: true }) }), of(noFoil))).toBe(false);
  });

  it("empreinte qui ne dit plus la fiche (fiche changée sur l'autre appareil) : périmée, sur les deux pareil", () => {
    const record = keyed('wingfoil', course);
    const edited = { ...record, analysis: analysis({ activeThreshold: 12 }) };
    expect(isSummaryOutdated(edited, of(course))).toBe(true);
    expect(isSummaryOutdated(edited, of({ ...course, thresholdOverride: 99 }))).toBe(true);
  });

  it("fiche d'avant l'empreinte : périmée une fois", () => {
    expect(isSummaryOutdated(sessionRecord({ sport: 'running' }), of(course))).toBe(true);
  });

  it('muscu, sport inconnu ou absent : jamais, sauf version du calcul dépassée', () => {
    for (const sport of ['muscu', 'moth', null] as (SportType | null)[]) {
      const record = sessionRecord({ sport });
      expect(isSummaryOutdated(record, of(course))).toBe(false);
      expect(isSummaryOutdated({ ...record, summary: { ...record.summary, calcVersion: SUMMARY_CALC_VERSION - 1 } }, of(course))).toBe(true);
    }
  });

  it('version du calcul dépassée : périmée, empreinte juste ou non', () => {
    const record = keyed('running', course);
    expect(isSummaryOutdated({ ...record, summary: { ...record.summary, calcVersion: SUMMARY_CALC_VERSION - 1 } }, of(course))).toBe(true);
  });

  describe("un résumé tout juste calculé n'est pas périmé, à 1 Hz comme à 5 Hz", () => {
    const cases: [SportType, ActivitySummarySettings, Partial<SessionAnalysis> | null, [number, number][]][] = [
      ['running', course, null, [[60, 0.3], [600, 3], [60, 0], [600, 3.5]]],
      ['running', { thresholdOverride: undefined, foil: null }, { activeThreshold: 4 }, [[60, 0.3], [600, 3]]],
      ['cycling', { thresholdOverride: 0, foil: null }, null, [[60, 0], [900, 8]]],
      ['wingfoil', { thresholdOverride: undefined, foil: true }, { referenceSpeedMs: 7 }, [[120, 1], [600, 9], [60, 2], [600, 10]]],
      ['kite', { thresholdOverride: 12, foil: false }, null, [[120, 1], [600, 9]]],
      ['surf', { thresholdOverride: undefined, foil: true }, { waveThreshold: 9 }, [[300, 0.8], [20, 6], [300, 0.8], [25, 7], [300, 0.5]]],
      ['surf', { thresholdOverride: undefined, foil: false }, null, [[300, 0.8], [20, 5], [300, 0.8]]],
    ];
    for (const hz of [1, 5]) {
      it.each(cases)(`%s (${hz} Hz)`, (sport, activity, own, phases) => {
        const sessionAnalysis = own ? analysis(own) : null;
        const analyzed = analyzeGpx(JSON.stringify(phasesTrack(phases, hz)), sport, sessionAnalysis, of(activity));
        expect(analyzed).not.toBeNull();
        expect(analyzed!.summary.optionsKey).toBeTypeOf('string');
        const record = withSummary(sessionRecord({ sport, analysis: sessionAnalysis }), analyzed!.summary);
        expect(isSummaryOutdated(record, of(activity))).toBe(false);
        // Sur un autre appareil, d'autres réglages : aucun recalcul. Un geste : un recalcul, qui y met fin.
        const other = { ...activity, thresholdOverride: (activity.thresholdOverride ?? 3) + 1 };
        expect(isSummaryOutdated(record, of(other))).toBe(false);
        const pending = { threshold: other.thresholdOverride };
        expect(isSummaryOutdated(record, of(other), () => pending)).toBe(true);
        const again = analyzeGpx(JSON.stringify(phasesTrack(phases, hz)), sport, sessionAnalysis, () => sessionActivitySettings(record, other, pending));
        const redone = withSummary(record, again!.summary);
        expect(redone.summary.activitySettings?.threshold).toBe(other.thresholdOverride);
        expect(isSummaryOutdated(redone, of(activity), () => pending)).toBe(false);
        expect(isSummaryOutdated(redone, of(activity))).toBe(false);
      });
    }
  });

  it("sans calcul connu, le résumé ne porte pas d'empreinte", () => {
    const analyzed = analyzeGpx(JSON.stringify(phasesTrack([[60, 3]])), null, null, of(course));
    expect(analyzed!.summary.optionsKey).toBeUndefined();
  });
});

describe('réglages portés par la session (Q57)', () => {
  const device: ActivitySummarySettings = { thresholdOverride: 10, foil: true };

  it('le geste, puis le porté, puis l\'appareil ; le même pour une fiche neuve (appareil)', () => {
    const carried = sessionRecord({ sport: 'surf' }, { activitySettings: { threshold: 8, foil: false } });
    expect(sessionActivitySettings(carried, device)).toEqual({ thresholdOverride: 8, foil: false });
    expect(sessionActivitySettings(carried, device, { threshold: 9 })).toEqual({ thresholdOverride: 9, foil: false });
    expect(sessionActivitySettings(null, device)).toEqual(device);
    expect(sessionActivitySettings(sessionRecord(), device)).toEqual(device);
  });

  it("porté null : aucun réglé, pas celui de l'appareil (la suggestion reste calculée dans les hooks)", () => {
    const record = sessionRecord({}, { activitySettings: { threshold: null } });
    expect(sessionActivitySettings(record, device).thresholdOverride).toBeUndefined();
  });

  it("composant inconnu : celui de l'appareil", () => {
    expect(sessionActivitySettings(sessionRecord({}, { activitySettings: {} }), device)).toEqual(device);
  });

  it("ancienne fiche : lu dans l'empreinte, seulement là où la session n'a pas le sien", () => {
    const old = sessionRecord({ sport: 'surf' }, { optionsKey: JSON.stringify([8, null, false, null]) });
    expect(sessionActivitySettings(old, device)).toEqual({ thresholdOverride: 8, foil: false });
    const own = { ...old, analysis: analysis({ activeThreshold: 12, foil: true }) };
    expect(sessionActivitySettings(own, device)).toEqual(device);
  });

  it('analyse et empreinte portent les réglages à 1 Hz comme à 5 Hz ; foil en surf seulement', () => {
    for (const hz of [1, 5]) {
      const track = JSON.stringify(phasesTrack([[300, 0.8], [20, 6], [300, 0.8]], hz));
      expect(analyzeGpx(track, 'surf', null, () => ({ thresholdOverride: 4, foil: true }))!.summary.activitySettings).toEqual({ threshold: 4, foil: true });
      expect(analyzeGpx(track, 'running', null, () => ({ thresholdOverride: undefined, foil: null }))!.summary.activitySettings).toEqual({ threshold: null });
    }
  });

  it('foil lu hors de l\'analyse : le sien, le porté, puis l\'appareil', () => {
    const surf = sessionRecord({ sport: 'surf' }, { activitySettings: { foil: false } });
    expect(sessionFoil(surf, true)).toBe(false);
    expect(sessionFoil({ ...surf, analysis: analysis({ foil: true }) }, false)).toBe(true);
    expect(sessionFoil(sessionRecord({ sport: 'surf' }, { optionsKey: '[null,null,true,null]' }), false)).toBe(true);
    // Voile : le foil ne change pas le résumé, il n'est pas porté.
    expect(sessionFoil(sessionRecord({ sport: 'wingfoil' }, { activitySettings: { threshold: 8 } }), true)).toBe(true);
    expect(sessionFoil(null, true)).toBe(true);
    expect(sessionFoil(null, null)).toBe(false);
  });

  it("phrase de l'onglet réglages : seulement si l'appareil dit autre chose", () => {
    const show = (v: number) => `${v} nd`;
    expect(carriedThresholdNote(undefined, 10, show)).toBeNull();
    expect(carriedThresholdNote(10, 10, show)).toBeNull();
    expect(carriedThresholdNote(null, null, show)).toBeNull();
    expect(carriedThresholdNote(8, 10, show)).toBe(
      "Calculée avec 8 nd, le réglage de l'activité à ce moment-là. Réglages dit 10 nd sur cet appareil : le changer recalcule les sessions de l'activité."
    );
    expect(carriedThresholdNote(null, 10, show)).toContain('sans seuil réglé');
    expect(carriedThresholdNote(8, null, show)).toContain("Réglages n'en règle aucun");
  });
});

describe("sessions à refaire, dans l'ordre de la liste (lot 37)", () => {
  it("garde l'ordre, écarte les fiches en lecture seule, les traces déjà tentées et les résumés à jour", () => {
    const session = (file: string, distanceM: number, readOnly = false) => ({ file, readOnly, record: sessionRecord({}, { distanceM }) });
    const sessions = [session('a', 1), session('b', 0), session('c', 1, true), session('d', 1), session('e', 1)];
    expect(outdatedRefreshFiles(sessions, (record) => record.summary.distanceM === 1, new Set(['d']))).toEqual(['a', 'e']);
    expect(outdatedRefreshFiles(sessions, () => false, new Set())).toEqual([]);
  });
});
