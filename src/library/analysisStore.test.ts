import { describe, expect, it } from 'vitest';
import { kinematicsProfileOf, prepareTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import { SAILING_SPORTS, SPORT_PROFILES, getSportProfile, type SportProfile } from '../core/sportProfiles';
import { effectiveSpeedRange, segmentsFromColorCodes, trackColorSegments } from '../core/trackColor';
import type { SportType } from '../core/types';
import { msToKnots } from '../core/units';
import { summarizeManeuvers, withoutWindAt, type WindStats } from '../sailing/sailingAnalytics';
import { resolveSailingThresholds } from '../sailing/sailingConfig';
import {
  analyzeSailingAtThreshold, analyzeSailingWind, prepareSailingTrack, sailingAnalysisShown, sailingPolarGraph,
} from '../sailing/sailingSession';
import { gpxOf, sailRaw, upDownLegs } from '../test/sailing.fixture';
import {
  MISSING_TRACE, createAnalysisStore, isMissingTrace, stableText, type AnalyzeSailingOptions, type TrackColorOptions,
} from './analysisStore';

/**
 * Mémoire de l'analyse ouverte (lot 235) : ce que la tâche `analyzeSailing` rend, même passé par un clonage structuré
 * comme un message du worker, est strictement égal à ce que le module calculait sur le fil de l'affichage. La chaîne
 * de référence ci-dessous est celle de `useSailingSession` et de `SailingModule` avant le lot 235 (version 1.0.31),
 * recopiée telle quelle : ne pas la faire évoluer avec le code. À 1 Hz et à 5 Hz (règle 2), vent saisi ou estimé,
 * seuil propre à la session ou suggéré, allure imposée ou déduite.
 */

interface Case {
  sport: SportType;
  windDeg: number | null;
  sessionThresholdKn: number | null;
  referenceSpeedOverrideMs: number | undefined;
  sessionRange: TrackColorOptions['sessionRange'];
}

/** Copie gelée de la chaîne du hook et du module avant le lot 235 : seuil résolu, trois étapes, polaire, traits colorés. */
const frozenModuleChain = (text: string, profile: SportProfile, c: Case, color: TrackColorOptions) => {
  const gpx = prepareTrack(text, { fileName: 'a.gpx', profile: kinematicsProfileOf(profile), referenceSpeedOverrideMs: c.referenceSpeedOverrideMs });
  const prepared = prepareSailingTrack(gpx.track, { sport: c.sport, profile, referenceSpeedMs: gpx.referenceSpeedMs, cumulative: gpx.cumulative });
  const thresholds = resolveSailingThresholds(profile, null, c.sessionThresholdKn, msToKnots(gpx.referenceSpeedMs));
  const atThreshold = analyzeSailingAtThreshold(prepared, thresholds.activeKn);
  const wind = analyzeSailingWind(prepared, atThreshold, c.windDeg);
  const polarGraphData = sailingPolarGraph(prepared, wind.currentWindValue, wind.maneuverStats?.locations);
  const colorRange = effectiveSpeedRange({
    sessionRange: color.sessionRange, activityRange: color.activityRange, suggested: prepared.suggestedSpeedRangeMs, fallback: color.fallback,
  });
  return {
    gpx, prepared, thresholds, atThreshold, wind, polarGraphData,
    segments: trackColorSegments(gpx.track, 'voile', { minMs: colorRange.minMs, maxMs: colorRange.maxMs }),
  };
};

/** Le vent interpolé de deux variations du vent : mêmes valeurs à chaque instant de la trace, et autour. */
const expectSameWindAt = (a: WindStats | null, b: WindStats | null, times: number[]): void => {
  expect(a === null).toBe(b === null);
  if (!a || !b) return;
  for (const t of times) expect(a.windAt(t)).toBe(b.windAt(t));
};

const optionsOf = (c: Case, profile: SportProfile, thresholdKn: number, color: TrackColorOptions | null, key = 'k'): AnalyzeSailingOptions => ({
  key,
  traceId: 1,
  prepare: { fileName: 'a.gpx', profile: kinematicsProfileOf(profile), referenceSpeedOverrideMs: c.referenceSpeedOverrideMs },
  sport: c.sport,
  profile,
  thresholdKn,
  windDeg: c.windDeg,
  color,
});

const CASES: Case[] = [
  { sport: 'wingfoil', windDeg: null, sessionThresholdKn: null, referenceSpeedOverrideMs: undefined, sessionRange: null },
  { sport: 'wingfoil', windDeg: 35, sessionThresholdKn: 9, referenceSpeedOverrideMs: undefined, sessionRange: { minMs: 2, maxMs: 9 } },
  { sport: 'wingfoil', windDeg: 380, sessionThresholdKn: null, referenceSpeedOverrideMs: 3.1, sessionRange: null },
  { sport: 'windsurf', windDeg: null, sessionThresholdKn: 7.5, referenceSpeedOverrideMs: 4.2, sessionRange: null },
  { sport: 'bateau', windDeg: 15, sessionThresholdKn: null, referenceSpeedOverrideMs: undefined, sessionRange: null },
];

describe('analyzeSailing : strictement les chiffres du module d’avant le lot 235', () => {
  for (const hz of [1, 5]) {
    const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(4, 80), hz, seed: 7 }));
    for (const c of CASES) {
      it(`${c.sport} à ${hz} Hz, vent ${c.windDeg ?? 'estimé'}, seuil ${c.sessionThresholdKn ?? 'suggéré'}, allure ${c.referenceSpeedOverrideMs ?? 'déduite'}`, () => {
        const profile = getSportProfile(c.sport);
        const color: TrackColorOptions = { treatment: 'voile', sessionRange: c.sessionRange, activityRange: null, fallback: profile.speedRange };
        const ref = frozenModuleChain(text, profile, c, color);
        expect(ref.gpx.track.length).toBeGreaterThan(300);
        const store = createAnalysisStore();
        // Comme la page : la trace lue par `prepare` est gardée, l'analyse la reprend ; puis passée par un message.
        const prepare: PrepareTrackOptions = optionsOf(c, profile, 0, null).prepare;
        store.keepTrack({ key: 'k', traceId: 1, prepare }, prepareTrack(text, prepare));
        // Sans le texte : la trace gardée suffit.
        const reply = structuredClone(store.analyzeSailing('', optionsOf(c, profile, ref.thresholds.activeKn, color)));
        expect(store.work.prepareTrack).toBe(0);
        const shown = sailingAnalysisShown(reply.analysis);
        const { atThreshold, wind, prepared } = ref;
        expect(shown.computeThresholdKn).toBe(atThreshold.computeThresholdKn);
        expect(shown.flightThresholdKn).toBe(atThreshold.flightThresholdKn);
        expect(shown.stats).toStrictEqual(atThreshold.stats);
        expect(shown.flights).toStrictEqual(atThreshold.flights);
        expect(shown.windEstimate).toStrictEqual(atThreshold.windEstimate);
        expect(shown.autoWind).toBe(wind.autoWind);
        expect(shown.currentWindValue).toBe(wind.currentWindValue);
        expect(shown.windInputRequired).toBe(wind.windInputRequired);
        expect(shown.maneuverStats).toStrictEqual(wind.maneuverStats);
        expect(shown.maneuverSummary).toStrictEqual(wind.maneuverSummary);
        expect(shown.maneuverSummary).toStrictEqual(summarizeManeuvers(wind.maneuverStats));
        expect(shown.vmgStats).toStrictEqual(wind.vmgStats);
        expect(shown.vmgSeries).toStrictEqual(wind.vmgSeries);
        expect(shown.polarGraphData).toStrictEqual(ref.polarGraphData);
        expect(shown.suggestedSpeedRangeMs).toStrictEqual(prepared.suggestedSpeedRangeMs);
        expect(shown.maneuverThresholds).toStrictEqual(prepared.maneuverThresholds);
        expect(shown.windStats && withoutWindAt(shown.windStats)).toStrictEqual(wind.windStats && withoutWindAt(wind.windStats));
        const t0 = ref.gpx.track[0].timeMs;
        const t1 = ref.gpx.track[ref.gpx.track.length - 1].timeMs;
        expectSameWindAt(shown.windStats, wind.windStats, Array.from({ length: 60 }, (_, i) => t0 - 600_000 + ((t1 - t0 + 1_200_000) * i) / 59));
        // Les couleurs compactes refont, sur la trace que la page a reçue, les traits que le module dessinait.
        expect(reply.colors).not.toBeNull();
        expect(segmentsFromColorCodes(structuredClone(ref.gpx.track), reply.colors!)).toStrictEqual(ref.segments);
      });
    }
  }

  it('le cas de test couvre vent manquant, vent saisi, manœuvres, vols et VMG', () => {
    const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(4, 80), hz: 1, seed: 7 }));
    const profile = getSportProfile('wingfoil');
    const color: TrackColorOptions = { treatment: 'voile', sessionRange: null, activityRange: null, fallback: profile.speedRange };
    const saisi = frozenModuleChain(text, profile, CASES[1], color);
    expect(saisi.wind.maneuverStats?.locations.length).toBeGreaterThan(4);
    expect(saisi.wind.vmgStats).not.toBeNull();
    expect(saisi.wind.windStats).not.toBeNull();
    expect(saisi.atThreshold.flights.length).toBeGreaterThan(0);
  });
});

describe('analyzeSailing : la mémoire ne refait que ce qui dépend de ce qui a changé', () => {
  const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(3, 60), hz: 1, seed: 2 }));
  const profile = getSportProfile('wingfoil');
  const c: Case = CASES[0];
  const color: TrackColorOptions = { treatment: 'voile', sessionRange: null, activityRange: null, fallback: profile.speedRange };

  it('vent, seuil, couleurs, autre support, autre allure, autre session : chacun ses étapes', () => {
    const store = createAnalysisStore();
    const run = (over: Partial<AnalyzeSailingOptions> = {}) => store.analyzeSailing(text, { ...optionsOf(c, profile, 12, color), ...over });
    // Sans trace gardée, la tâche la lit elle-même.
    const first = run();
    expect(store.work).toEqual({ prepareTrack: 1, prepareSailing: 1, atThreshold: 1, wind: 1, colors: 1 });
    // La même demande : rien de refait, mêmes valeurs.
    expect(run()).toStrictEqual(first);
    expect(store.work).toEqual({ prepareTrack: 1, prepareSailing: 1, atThreshold: 1, wind: 1, colors: 1 });
    run({ windDeg: 40 });
    expect(store.work).toEqual({ prepareTrack: 1, prepareSailing: 1, atThreshold: 1, wind: 2, colors: 1 });
    run({ windDeg: 40, thresholdKn: 10 });
    expect(store.work).toEqual({ prepareTrack: 1, prepareSailing: 1, atThreshold: 2, wind: 3, colors: 1 });
    run({ windDeg: 40, thresholdKn: 10, color: { ...color, sessionRange: { minMs: 1, maxMs: 8 } } });
    expect(store.work).toEqual({ prepareTrack: 1, prepareSailing: 1, atThreshold: 2, wind: 3, colors: 2 });
    // Sans couleurs demandées : aucune.
    expect(run({ windDeg: 40, thresholdKn: 10, color: null }).colors).toBeNull();
    // Autre support : la préparation voile est refaite, pas la lecture de la trace.
    run({ sport: 'kite', profile: getSportProfile('kite') });
    expect(store.work.prepareSailing).toBe(2);
    expect(store.work.prepareTrack).toBe(1);
    // Autre allure imposée : la trace est relue.
    run({ prepare: { ...optionsOf(c, profile, 12, color).prepare, referenceSpeedOverrideMs: 3 } });
    expect(store.work.prepareTrack).toBe(2);
    expect(store.work.prepareSailing).toBe(3);
    // Autre session (autre clé) : tout est refait, et elle remplace la précédente.
    run({ key: 'autre' });
    expect(store.work.prepareTrack).toBe(3);
    expect(store.key).toBe('autre');
  });

  it('release : vide la mémoire de cette session seulement ; la demande suivante relit la trace', () => {
    const store = createAnalysisStore();
    const prepare = optionsOf(c, profile, 12, color).prepare;
    store.keepTrack({ key: 'k', traceId: 1, prepare }, prepareTrack(text, prepare));
    expect(store.key).toBe('k');
    store.release('une autre page');
    expect(store.key).toBe('k');
    const kept = store.analyzeSailing(text, optionsOf(c, profile, 12, color));
    expect(store.work.prepareTrack).toBe(0);
    store.release('k');
    expect(store.key).toBeNull();
    // Sans le texte, la trace libérée est dite absente ; avec, elle est relue.
    expect(() => store.analyzeSailing('', optionsOf(c, profile, 12, color))).toThrow(expect.objectContaining({ name: MISSING_TRACE }));
    expect(store.analyzeSailing(text, optionsOf(c, profile, 12, color))).toStrictEqual(kept);
    expect(store.work.prepareTrack).toBe(1);
  });

  it('sans le texte : une autre lecture de la page (autre numéro, autre allure) ou une autre page est dite absente', () => {
    const store = createAnalysisStore();
    const prepare = optionsOf(c, profile, 12, color).prepare;
    store.keepTrack({ key: 'k', traceId: 1, prepare }, prepareTrack(text, prepare));
    const missing = (over: Partial<AnalyzeSailingOptions>) => {
      try {
        store.analyzeSailing('', { ...optionsOf(c, profile, 12, color), ...over });
        return false;
      } catch (err) {
        return isMissingTrace(err);
      }
    };
    expect(missing({})).toBe(false);
    expect(missing({ traceId: 2 })).toBe(true);
    expect(missing({ key: 'autre' })).toBe(true);
    expect(missing({ prepare: { ...prepare, referenceSpeedOverrideMs: 3 } })).toBe(true);
    expect(store.work.prepareTrack).toBe(0);
  });
});

describe('stableText : deux entrées différentes ne passent jamais pour les mêmes', () => {
  it('infini, NaN et -0 gardent leur texte ; le reste comme JSON.stringify', () => {
    const texts = [Infinity, -Infinity, NaN, null, 0, -0, 1].map((v) => stableText([v]));
    expect(new Set(texts).size).toBe(texts.length);
    expect(stableText({ a: 1, b: [2, 'x', null], c: { d: true } })).toBe(JSON.stringify({ a: 1, b: [2, 'x', null], c: { d: true } }));
  });

  it('seuil NaN puis infini : deux calculs, pas une reprise du premier', () => {
    const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(2, 60), hz: 1, seed: 4 }));
    const profile = getSportProfile('wingfoil');
    const store = createAnalysisStore();
    const options = optionsOf(CASES[0], profile, NaN, null);
    store.analyzeSailing(text, options);
    store.analyzeSailing(text, { ...options, thresholdKn: Infinity });
    expect(store.work.atThreshold).toBe(2);
    // Deux profils qui ne diffèrent que par un infini et un NaN : la préparation est refaite.
    store.analyzeSailing(text, { ...options, profile: { ...profile, maxGapS: Infinity } });
    store.analyzeSailing(text, { ...options, profile: { ...profile, maxGapS: NaN } });
    expect(store.work.prepareSailing).toBe(3);
  });
});

describe('aucune fonction dans les messages : la vraie demande et la vraie réponse passent un clonage structuré', () => {
  const text = gpxOf(sailRaw({ windDeg: 20, legs: upDownLegs(3, 60), hz: 1, seed: 6 }));
  for (const sport of Object.keys(SPORT_PROFILES) as SportType[]) {
    const profile = SPORT_PROFILES[sport];
    if (!SAILING_SPORTS.includes(sport)) continue;
    it(`${sport} : demande et réponse clonées sans erreur, réponse égale à l'originale`, () => {
      const request = optionsOf({ ...CASES[1], sport }, profile, 9, {
        treatment: 'voile', sessionRange: { minMs: 2, maxMs: 9 }, activityRange: null, fallback: profile.speedRange,
      });
      expect(structuredClone(request)).toStrictEqual(request);
      const reply = createAnalysisStore().analyzeSailing(text, request);
      expect(reply.analysis.maneuverStats).not.toBeNull();
      expect(structuredClone(reply)).toStrictEqual(reply);
    });
  }
});
