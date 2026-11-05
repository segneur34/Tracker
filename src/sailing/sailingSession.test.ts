import { describe, expect, it } from 'vitest';
import { getSportProfile } from '../core/sportProfiles';
import type { SportType, TrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';
import { degApart, sailTrack, slowPolar, upDownLegs, type SailTrack } from '../test/sailing.fixture';
import {
  FAST_SESSION_REFERENCE_KN,
  MANEUVER_ENTRY_SPEED_RATIO,
  MANEUVER_MIN_ENTRY_SPEED_KN,
  POLAR_MIN_SPEED_RATIO,
  SLOW_SESSION_ACTIVE_THRESHOLD_KN,
} from './sailingConfig';
import {
  analyzeSailingAtThreshold,
  analyzeSailingSession,
  analyzeSailingWind,
  prepareSailingTrack,
  sailingPolarGraph,
  type SailingSessionSettings,
} from './sailingSession';

const WIND = 20;

/** Réglages d'une analyse sur une trace préparée : vent estimé, seuils de la suggestion, sauf surcharge. */
const settingsOf = (t: SailTrack, sport: SportType = 'wingfoil', over: Partial<SailingSessionSettings> = {}): SailingSessionSettings => ({
  sport,
  referenceSpeedMs: t.referenceSpeedMs,
  cumulative: t.cumulative,
  activityThresholdKn: null,
  sessionThresholdKn: null,
  windDeg: null,
  ...over,
});

const analyze = (t: SailTrack, sport: SportType = 'wingfoil', over: Partial<SailingSessionSettings> = {}) =>
  analyzeSailingSession(t.track, settingsOf(t, sport, over));

/** Valeur sans les fonctions (vent interpolé, descripteur de la polaire), pour comparer deux calculs par `toEqual`. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// Sessions mises en cache : chaque trace passe une fois par la cinématique.
const fast = sailTrack({ windDeg: WIND, legs: upDownLegs(6), hz: 1, seed: 5 });
const slow = sailTrack({ windDeg: WIND, legs: upDownLegs(6), hz: 1, seed: 5, polar: slowPolar });
const wingProfile = getSportProfile('wingfoil');

describe('analyzeSailingSession : seuils accordés à l’allure (règle 4)', () => {
  it('session rapide : seuil d’activité du profil ; seuils de manœuvre à la proportion de l’allure, sous leurs plafonds', () => {
    const a = analyze(fast);
    expect(a.referenceSpeedKn).toBeGreaterThan(FAST_SESSION_REFERENCE_KN);
    expect(a.thresholds.suggestedKn).toBe(wingProfile.defaultActiveThreshold);
    expect(a.thresholds.activeKn).toBe(wingProfile.defaultActiveThreshold);
    expect(a.maneuverThresholds.minEntrySpeedKn).toBeCloseTo(Math.min(MANEUVER_MIN_ENTRY_SPEED_KN, MANEUVER_ENTRY_SPEED_RATIO * a.referenceSpeedKn), 9);
    expect(a.maneuverThresholds.polarMinSpeedKn).toBeCloseTo(Math.min(wingProfile.defaultPolarMinSpeed, POLAR_MIN_SPEED_RATIO * a.referenceSpeedKn), 9);
  });

  it('session lente : seuils abaissés, jamais au-dessus des plafonds du profil', () => {
    const a = analyze(slow);
    expect(a.referenceSpeedKn).toBeLessThan(FAST_SESSION_REFERENCE_KN);
    expect(a.thresholds.suggestedKn).toBe(SLOW_SESSION_ACTIVE_THRESHOLD_KN);
    expect(a.thresholds.activeKn).toBeLessThan(wingProfile.defaultActiveThreshold);
    expect(a.maneuverThresholds.minEntrySpeedKn).toBeLessThan(MANEUVER_MIN_ENTRY_SPEED_KN);
    expect(a.maneuverThresholds.polarMinSpeedKn).toBeLessThan(wingProfile.defaultPolarMinSpeed);
    // Les manœuvres de la session lente restent vues : sans abaissement, la vitesse d'entrée de 4 nd les écarterait.
    expect(a.maneuverStats).not.toBeNull();
    expect(a.maneuverStats!.tackSuccess + a.maneuverStats!.tackFail + a.maneuverStats!.jibeSuccess + a.maneuverStats!.jibeFail).toBeGreaterThan(0);
  });

  it('allure imposée plus basse que celle de la trace : seuils de manœuvre et suggestion abaissés', () => {
    const own = analyze(fast);
    const imposed = analyze(fast, 'wingfoil', { referenceSpeedMs: knotsToMs(6) });
    expect(imposed.referenceSpeedKn).toBeCloseTo(6, 6);
    expect(imposed.maneuverThresholds.minEntrySpeedKn).toBeLessThan(own.maneuverThresholds.minEntrySpeedKn);
    expect(imposed.maneuverThresholds.polarMinSpeedKn).toBeLessThan(own.maneuverThresholds.polarMinSpeedKn);
    expect(imposed.thresholds.suggestedKn).toBeLessThan(own.thresholds.suggestedKn);
  });

  it('allure imposée plus haute : rien ne monte au-dessus du profil', () => {
    const a = analyze(slow, 'wingfoil', { referenceSpeedMs: knotsToMs(40) });
    expect(a.thresholds.suggestedKn).toBe(wingProfile.defaultActiveThreshold);
    expect(a.maneuverThresholds).toEqual({ minEntrySpeedKn: MANEUVER_MIN_ENTRY_SPEED_KN, polarMinSpeedKn: wingProfile.defaultPolarMinSpeed });
  });
});

describe('analyzeSailingSession : ordre du seuil d’activité', () => {
  it('seuil de la session, puis celui de l’activité, puis la suggestion', () => {
    expect(analyze(fast, 'wingfoil', { sessionThresholdKn: 6, activityThresholdKn: 11 }).thresholds).toMatchObject({ activeKn: 6, defaultKn: 11, flightKn: 6 });
    expect(analyze(fast, 'wingfoil', { activityThresholdKn: 11 }).thresholds).toMatchObject({ activeKn: 11, defaultKn: 11 });
    expect(analyze(fast).thresholds).toMatchObject({ activeKn: wingProfile.defaultActiveThreshold, defaultKn: wingProfile.defaultActiveThreshold });
  });

  it('le seuil effectif est celui des calculs : statistiques, vols et manœuvres', () => {
    const a = analyze(fast, 'wingfoil', { sessionThresholdKn: 11, windDeg: WIND });
    expect(a.computeThresholdKn).toBe(11);
    expect(a.flightThresholdKn).toBe(11);
    const low = analyze(fast, 'wingfoil', { sessionThresholdKn: 4, windDeg: WIND });
    // Plus de temps actif au seuil bas, jamais moins.
    const activeCount = (mask: boolean[]) => mask.filter(Boolean).length;
    expect(activeCount(low.activityMask)).toBeGreaterThan(activeCount(a.activityMask));
    expect(Number(low.stats!.activeRatio)).toBeGreaterThan(Number(a.stats!.activeRatio));
  });

  it('bateau : pas de seuil réglable, seuil fixe de réussite, toute manœuvre comptée en navigation', () => {
    const t = sailTrack({ windDeg: WIND, legs: upDownLegs(4), hz: 1, seed: 5 }, 'bateau');
    const a = analyze(t, 'bateau', { sessionThresholdKn: 7, activityThresholdKn: 9 });
    const fixedKn = getSportProfile('bateau').withoutActiveThreshold!.maneuverSuccess;
    expect(a.thresholds.withThreshold).toBe(false);
    expect(a.thresholds.activeKn).toBe(fixedKn);
    expect(a.thresholds.flightKn).toBeUndefined();
    expect(a.computeThresholdKn).toBe(fixedKn);
    expect(a.flightThresholdKn).toBeUndefined();
    expect(a.ratioMask).toBeUndefined();
    expect(a.flights).toEqual([]);
  });
});

describe('analyzeSailingSession : seuil différé (Q40)', () => {
  it('les calculs suivent `computeThresholdKn`, les seuils affichés restent ceux de la session', () => {
    const deferred = analyze(fast, 'wingfoil', { sessionThresholdKn: 6, computeThresholdKn: 11, windDeg: WIND });
    const at11 = analyze(fast, 'wingfoil', { sessionThresholdKn: 11, windDeg: WIND });
    expect(deferred.thresholds.activeKn).toBe(6);
    expect(deferred.computeThresholdKn).toBe(11);
    expect(plain(deferred.stats)).toEqual(plain(at11.stats));
    expect(plain(deferred.maneuverStats)).toEqual(plain(at11.maneuverStats));
    expect(plain(deferred.windEstimate)).toEqual(plain(at11.windEstimate));
  });
});

describe('analyzeSailingSession : vent', () => {
  it('vent saisi normalisé dans [0 ; 360[', () => {
    expect(analyze(fast, 'wingfoil', { windDeg: 380 }).currentWindValue).toBe(20);
    expect(analyze(fast, 'wingfoil', { windDeg: -340 }).currentWindValue).toBe(20);
    const a = analyze(fast, 'wingfoil', { windDeg: 380 });
    const b = analyze(fast, 'wingfoil', { windDeg: 20 });
    expect(plain(a.maneuverStats)).toEqual(plain(b.maneuverStats));
  });

  it('vent saisi : il prime sur l’estimation, qui reste rendue', () => {
    const a = analyze(fast, 'wingfoil', { windDeg: 60 });
    expect(a.currentWindValue).toBe(60);
    expect(a.autoWind).toBe(a.windEstimate!.direction);
    expect(degApart(a.autoWind!, WIND)).toBeLessThanOrEqual(3);
  });

  it('estimation fiable sans vent saisi : elle est retenue', () => {
    const a = analyze(fast);
    expect(a.windEstimate!.reliable).toBe(true);
    expect(a.currentWindValue).toBe(a.windEstimate!.direction);
    expect(a.windInputRequired).toBe(false);
    expect(a.maneuverStats).not.toBeNull();
    expect(a.vmgStats).not.toBeNull();
    expect(a.polarGraphData.length).toBeGreaterThan(0);
  });

  it('estimation peu fiable sans vent saisi : vent demandé, analyses du vent suspendues', () => {
    // Un bord de près, une abattée, un bord de largue : rien ne départage (`windSessions.test.ts`).
    const t = sailTrack({ windDeg: WIND, legs: [{ twa: 45, durationS: 600 }, { twa: 135, durationS: 600 }], hz: 1, seed: 5 });
    const a = analyze(t);
    expect(a.windEstimate!.reliable).toBe(false);
    expect(a.autoWind).toBe(a.windEstimate!.direction);
    expect(a.currentWindValue).toBeNull();
    expect(a.windInputRequired).toBe(true);
    expect(a.maneuverStats).toBeNull();
    expect(a.maneuverSummary.tack).toBeNull();
    expect(a.windStats).toBeNull();
    expect(a.vmgStats).toBeNull();
    expect(a.polarGraphData).toEqual([]);
    // Les statistiques ne dépendent pas du vent : elles sont là.
    expect(a.stats).not.toBeNull();
    // Le vent saisi débloque tout.
    const typed = analyze(t, 'wingfoil', { windDeg: WIND });
    expect(typed.windInputRequired).toBe(false);
    expect(typed.maneuverStats).not.toBeNull();
    expect(typed.vmgStats).not.toBeNull();
  });

  it('trace vide : rien de calculé, pas de vent demandé', () => {
    const empty: TrackPoint[] = [];
    const a = analyzeSailingSession(empty, { sport: 'wingfoil', referenceSpeedMs: 0, activityThresholdKn: null, sessionThresholdKn: null, windDeg: null });
    expect(a.detection).toBeNull();
    expect(a.polarStage).toBeNull();
    expect(a.stats).toBeNull();
    expect(a.windEstimate).toBeNull();
    expect(a.autoWind).toBeNull();
    expect(a.windInputRequired).toBe(false);
    expect(a.maneuverStats).toBeNull();
    expect(a.vmgStats).toBeNull();
    expect(a.polarGraphData).toEqual([]);
  });
});

describe('analyzeSailingSession : cadence (règle 2)', () => {
  it('la même session à 1 Hz et à 5 Hz : mêmes seuils, même vent, mêmes manœuvres', () => {
    const spec = { windDeg: WIND, legs: upDownLegs(6), seed: 5 };
    const a1 = analyze(sailTrack({ ...spec, hz: 1 }));
    const a5 = analyze(sailTrack({ ...spec, hz: 5 }));
    expect(a5.trackData.length).toBeGreaterThan(4 * a1.trackData.length);
    expect(a5.referenceSpeedKn).toBeCloseTo(a1.referenceSpeedKn, 0);
    expect(a5.thresholds.activeKn).toBe(a1.thresholds.activeKn);
    expect(a5.maneuverThresholds.minEntrySpeedKn).toBeCloseTo(a1.maneuverThresholds.minEntrySpeedKn, 2);
    expect(a5.maneuverThresholds.polarMinSpeedKn).toBeCloseTo(a1.maneuverThresholds.polarMinSpeedKn, 2);
    expect(degApart(a5.currentWindValue!, a1.currentWindValue!)).toBeLessThanOrEqual(2);
    const count = (a: typeof a1) => [a.maneuverStats!.tackSuccess + a.maneuverStats!.tackFail, a.maneuverStats!.jibeSuccess + a.maneuverStats!.jibeFail];
    expect(count(a5)).toEqual(count(a1));
    // Ratio de temps actif mesuré en secondes, pas en points : à un point près.
    expect(Math.abs(Number(a5.stats!.activeRatio) - Number(a1.stats!.activeRatio))).toBeLessThanOrEqual(1);
  });
});

describe('analyzeSailingSession : les trois étapes', () => {
  it('enchaînées à la main, elles rendent l’analyse en une fois', () => {
    const settings = settingsOf(fast, 'wingfoil', { sessionThresholdKn: 9, windDeg: 25 });
    const whole = analyzeSailingSession(fast.track, settings);
    const prepared = prepareSailingTrack(fast.track, settings);
    const atThreshold = analyzeSailingAtThreshold(prepared, 9);
    const wind = analyzeSailingWind(prepared, atThreshold, 25);
    const polarGraphData = sailingPolarGraph(prepared, wind.currentWindValue);
    expect(plain(whole)).toEqual(plain({ ...prepared, ...atThreshold, ...wind, polarGraphData, thresholds: whole.thresholds }));
  });

  it('le vent saisi ne passe que par l’étape du vent : VMG et polaire le suivent', () => {
    const prepared = prepareSailingTrack(fast.track, settingsOf(fast));
    const atThreshold = analyzeSailingAtThreshold(prepared, 8);
    const a = analyzeSailingWind(prepared, atThreshold, WIND);
    const b = analyzeSailingWind(prepared, atThreshold, WIND + 30);
    expect(a.currentWindValue).toBe(WIND);
    expect(b.currentWindValue).toBe(WIND + 30);
    expect(plain(b.vmgStats)).not.toEqual(plain(a.vmgStats));
    expect(sailingPolarGraph(prepared, b.currentWindValue)).not.toEqual(sailingPolarGraph(prepared, a.currentWindValue));
  });

  it('VMG : les manœuvres sont écartées des chiffres et font un trou dans la courbe (lot 167)', () => {
    const a = analyze(fast);
    const locations = a.maneuverStats!.locations;
    expect(locations.length).toBeGreaterThan(0);
    expect(a.vmgSeries).toHaveLength(a.trackData.length);
    for (const m of locations) expect(a.vmgSeries[Math.round((m.entryIndex + m.exitIndex) / 2)]).toBeNull();
    expect(a.vmgSeries.some((v) => v !== null && v > 0)).toBe(true);
    expect(a.vmgSeries.some((v) => v !== null && v < 0)).toBe(true);
    // Sans vent : ni chiffres ni courbe.
    const noWind = analyze(sailTrack({ windDeg: WIND, legs: [{ twa: 45, durationS: 600 }, { twa: 135, durationS: 600 }], hz: 1, seed: 5 }));
    expect(noWind.vmgStats).toBeNull();
    expect(noWind.vmgSeries).toEqual([]);
  });

  it('la polaire ne dépend pas du seuil d’activité, seulement du vent retenu', () => {
    const prepared = prepareSailingTrack(fast.track, settingsOf(fast));
    const at6 = analyzeSailingWind(prepared, analyzeSailingAtThreshold(prepared, 6), WIND);
    const at11 = analyzeSailingWind(prepared, analyzeSailingAtThreshold(prepared, 11), WIND);
    expect(at6.currentWindValue).toBe(at11.currentWindValue);
    expect(sailingPolarGraph(prepared, at6.currentWindValue)).toEqual(sailingPolarGraph(prepared, at11.currentWindValue));
    expect(sailingPolarGraph(prepared, null)).toEqual([]);
  });

  it('sans cumul donné, il est calculé', () => {
    const settings = settingsOf(fast);
    const withCum = prepareSailingTrack(fast.track, settings);
    const withoutCum = prepareSailingTrack(fast.track, { ...settings, cumulative: undefined });
    expect(plain(withoutCum.cumulative)).toEqual(plain(withCum.cumulative));
    expect(plain(withoutCum.tops)).toEqual(plain(withCum.tops));
  });
});
