import { describe, expect, it } from 'vitest';
import { computeKinematics, detectTrackDeviceSpeedUnit } from '../core/kinematics';
import { kinematicsOptionsOf, referenceSpeedMs, scalesFiltersToSession } from '../core/sessionSpeed';
import { buildCumulativeTrack, computeActiveDistanceM, computeActiveTimeMs, thresholdActivityMask } from '../core/sessionStats';
import { bestWindowSpeedMs } from '../core/topSegments';
import { FAMILY_BASE } from '../core/activities';
import { getSportProfile } from '../core/sportProfiles';
import type { RawTrackPoint } from '../core/types';
import { msToKnots } from '../core/units';
import type { SessionTest } from '../recording/fitnessTest';
import { suggestActiveThresholdKn } from '../sailing/sailingConfig';
import { SUMMARY_CALC_VERSION } from './record';
import { ORIGIN, at, mPerDegLon } from '../test/geo.fixture';
import { phasesTrack } from '../test/track.fixture';
import { analysisTrack, summarizeHeartRateSession, summarizeSession } from './summary';

const START_MS = Date.parse('2026-09-20T10:00:00Z');

/**
 * Trace vers l'est, `hz` points par seconde, à la vitesse de chaque phase
 * (`[durée en s, vitesse en m/s]`). `climbPerS`, facultatif, fait monter
 * l'altitude d'autant de mètres par seconde.
 */
const buildTrack = (phases: [number, number][], hz = 1, climbPerS?: number): RawTrackPoint[] => phasesTrack(phases, hz, { startMs: START_MS, climbPerS });

describe('summarizeSession', () => {
  it('range la FC de la session, rien sans FC', () => {
    const points = buildTrack([[600, 3]]).map((p, i) => ({ ...p, hr: 140 + (i % 20) }));
    const hr = summarizeSession(points, 'running')!.heartRate!;
    expect(hr.avgBpm).toBeGreaterThan(140);
    expect(hr.avgBpm).toBeLessThan(160);
    expect(hr.coveredS).toBe(600);
    expect(hr.histogram.seconds.reduce((a, b) => a + b, 0)).toBeCloseTo(600, -1);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.heartRate).toBeUndefined();
  });

  it('range le test guidé de la fiche : FC max et dernier palier tenu, rien sans test', () => {
    // 3 min à 2 m/s, puis des paliers de 60 s à 2,5 et 3 m/s ; le troisième, à 3,5, lâché tout de suite. FC de 120 à 180.
    const points = buildTrack([[180, 2], [60, 2.5], [60, 3], [60, 2]]).map((p, i) => ({ ...p, hr: 120 + Math.min(60, i / 5) }));
    const test: SessionTest = {
      protocol: 'fc-max', version: 1,
      settings: { warmupS: 180, age: 35, ageSource: 'defaut', lowBpm: 110, highBpm: 147, zoneMethod: 'max' },
      startMs: START_MS, rampStartMs: START_MS + 180_000, v0Ms: 2.5,
      steps: [0, 1, 2].map((k) => ({ startMs: START_MS + (180 + 60 * k) * 1000, targetMs: 2.5 + 0.5 * k })),
      rampEndMs: START_MS + 330_000, dropMs: START_MS + 305_000, endReason: 'auto', endMs: START_MS + 360_000, signals: [],
    };
    const summary = summarizeSession(points, 'run-test', { test })!.test!;
    expect(summary.steps).toBe(2);
    expect(summary.lastStepSpeedMs).toBe(3);
    expect(summary.hrMaxBpm).toBe(180);
    expect(summarizeSession(points, 'run-test')!.test).toBeUndefined();
  });

  it('range la cadence à pied (cad du GPX, en foulées), rien sans elle ni à vélo', () => {
    const points = buildTrack([[600, 3]]).map((p) => ({ ...p, cadence: 85 }));
    const cad = summarizeSession(points, 'running')!.cadence!;
    expect(cad.avgSpm).toBeCloseTo(170, 0);
    expect(cad.steps).toBeCloseTo(1700, -1);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.cadence).toBeUndefined();
    expect(summarizeSession(points, 'cycling')!.cadence).toBeUndefined();
  });

  it('rend la distance intégrée, les bornes et la cadence', () => {
    const summary = summarizeSession(buildTrack([[600, 3]]), 'running')!;
    expect(summary.calcVersion).toBe(SUMMARY_CALC_VERSION);
    expect(summary.startMs).toBe(START_MS);
    expect(summary.endMs).toBe(START_MS + 600_000);
    expect(summary.distanceM).toBeCloseTo(1800, -1);
    expect(summary.pointCount).toBe(601);
    expect(summary.samplingS).toBeCloseTo(1, 5);
    expect(summary.maxSpeedMs).toBeCloseTo(3, 1);
  });

  it('trace clairsemée (un point toutes les 15 s, chaque pas est un trou) : vitesse max lissée, pas 0 (lot 81)', () => {
    const summary = summarizeSession(buildTrack([[1200, 4]], 1 / 15), 'running')!;
    expect(summary.maxSpeedMs).toBeCloseTo(4, 1);
  });

  it('part de la trace d\'analyse, celle que la vignette colore', () => {
    // Pic de 1 s à 60 m/s : au-delà de la vitesse plausible d'une course, il est écrêté.
    const raw = buildTrack([[300, 3], [1, 60], [300, 3]]);
    for (const sport of ['running', 'wingfoil'] as const) {
      const track = analysisTrack(raw, sport);
      const summary = summarizeSession(raw, sport)!;
      expect(summary.pointCount).toBe(track.length);
      // Vitesse max : la meilleure moyenne sur 2 s de la trace d'analyse (Q34, lot 81).
      expect(summary.maxSpeedMs).toBe(bestWindowSpeedMs(track, buildCumulativeTrack(track), 2));
    }
    expect(Math.max(...analysisTrack(raw, 'running').map((p) => p.smoothedSpeedMs))).toBeLessThan(20);
    // Sans support, aucun filtre : la trace brute enrichie.
    expect(analysisTrack(raw, null)).toEqual(computeKinematics(raw));
  });

  it("donne la trace de l'analyse, mêmes options de cinématique, pour chaque famille (lot 72)", () => {
    // Le module d'analyse (`useGpxSession`) calcule sa trace avec ces mêmes options.
    const raw = buildTrack([[120, 2], [1, 40], [240, 6], [60, 1]]);
    for (const sport of [...Object.values(FAMILY_BASE), 'bateau', 'kite'] as const) {
      const profile = getSportProfile(sport);
      const options = kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs: referenceSpeedMs(raw) });
      expect(analysisTrack(raw, sport), sport).toEqual(computeKinematics(raw, options));
    }
  });

  it("voile, vitesse Doppler en km/h : la liste donne les chiffres de l'analyse, à 1 Hz comme à 5 Hz (lot 95)", () => {
    // Wingfoil 10 min à 20 nœuds puis 5 min à 2 nœuds, positions bruitées de ±0,5 m (bruit déterministe),
    // vitesse de l'appareil écrite en km/h, absente sur un point sur 37.
    const dopplerKmh = (hz: number): RawTrackPoint[] => {
      let seed = 95;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const clean = buildTrack([[600, 10.3], [300, 1]], hz);
      const eastM = clean.map((p) => (p.lon - clean[0].lon) * mPerDegLon(ORIGIN.lat));
      return clean.map((p, k) => {
        const speed = (eastM[Math.max(1, k)] - eastM[Math.max(1, k) - 1]) * hz;
        const noisy = at(eastM[k] + (rnd() - 0.5), rnd() - 0.5);
        return { ...p, ...noisy, ...(k % 37 === 5 ? {} : { speedMs: speed * 3.6 * (1 + (rnd() - 0.5) * 0.02) }) };
      });
    };
    for (const hz of [1, 5]) {
      const raw = dopplerKmh(hz);
      const unit = detectTrackDeviceSpeedUnit(raw);
      expect(unit).toBe('kmh');
      // Allure de l'analyse (`useGpxSession`) : unité détectée une fois, puis passée.
      const ref = referenceSpeedMs(raw, unit);
      // Garde-fou : l'unité change bien l'allure, sinon le test ne prouverait rien.
      expect(Math.abs(referenceSpeedMs(raw, null) - ref), `${hz} Hz`).toBeGreaterThan(0.01);
      expect(referenceSpeedMs(raw, 'ms') / ref, `${hz} Hz`).toBeCloseTo(3.6, 1);
      expect(ref, `${hz} Hz`).toBeCloseTo(10.3, 0);
      for (const sport of ['wingfoil', 'kite'] as const) {
        const name = `${sport}, ${hz} Hz`;
        const profile = getSportProfile(sport);
        const track = computeKinematics(raw, kinematicsOptionsOf(profile, { scaleToSession: true, referenceMs: ref }));
        expect(analysisTrack(raw, sport), name).toEqual(track);
        // Chiffres de l'analyse : seuil suggéré par l'allure, masque d'activité, ratio sur le temps en mouvement.
        const mask = thresholdActivityMask(track, profile, suggestActiveThresholdKn(sport, msToKnots(ref)));
        const summary = summarizeSession(raw, sport)!;
        expect(summary.movingTimeS, name).toBe(computeActiveTimeMs(track, mask) / 1000);
        expect(summary.movingDistanceM, name).toBe(computeActiveDistanceM(track, mask));
        expect(summary.inMotionS, name).toBe(computeActiveTimeMs(track, thresholdActivityMask(track, profile, 0)) / 1000);
        expect(summary.maxSpeedMs, name).toBe(bestWindowSpeedMs(track, buildCumulativeTrack(track), 2));
        expect(summary.pointCount, name).toBe(track.length);
        expect(summary.movingTimeS!, name).toBeGreaterThan(590);
        expect(summary.movingTimeS!, name).toBeLessThan(610);
      }
    }
  });

  it('ne compte en mouvement que le temps passé au-dessus du seuil du support', () => {
    // Course : 10 min à 10,8 km/h, puis 5 min à l'arrêt.
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0]]), 'running')!;
    expect(summary.movingTimeS).toBeGreaterThan(590);
    expect(summary.movingTimeS).toBeLessThan(610);
  });

  it('accorde le seuil de la voile à l\'allure de la session, comme le module', () => {
    // Wingfoil à 20 nœuds pendant 10 min, puis 5 min à 2 nœuds : seul le vol compte.
    const summary = summarizeSession(buildTrack([[600, 10.3], [300, 1]]), 'wingfoil')!;
    expect(summary.movingTimeS).toBeGreaterThan(590);
    expect(summary.movingTimeS).toBeLessThan(610);
  });

  it('mesure la distance parcourue en action, avec le même masque que le temps', () => {
    // 10 min à 3 m/s, 5 min à 0,5 m/s (sous le seuil de la course) : seuls les 1 800 m courus comptent.
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0.5]]), 'running')!;
    expect(summary.distanceM).toBeCloseTo(1950, -1);
    expect(summary.movingDistanceM!).toBeGreaterThan(1750);
    expect(summary.movingDistanceM!).toBeLessThan(1850);
    expect(summary.movingDistanceM! / summary.movingTimeS!).toBeCloseTo(3, 1);
    // Toute en action : la distance entière.
    const all = summarizeSession(buildTrack([[600, 3]]), 'running')!;
    expect(all.movingDistanceM!).toBeGreaterThan(all.distanceM - 20);
    // Voile : seul le vol.
    const wing = summarizeSession(buildTrack([[600, 10.3], [300, 1]]), 'wingfoil')!;
    expect(wing.movingDistanceM! / wing.movingTimeS!).toBeCloseTo(10.3, 0);
  });

  it('range le temps en mouvement de la voile à seuil, dénominateur du ratio de vol (version 12)', () => {
    // 5 min à l'arrêt, 10 min de vol à 20 nœuds, 5 min à 3 nœuds, 5 min à l'arrêt.
    for (const hz of [1, 5]) {
      const summary = summarizeSession(buildTrack([[300, 0], [600, 10.3], [300, 1.5], [300, 0]], hz), 'wingfoil', { activeThreshold: 7 })!;
      expect(summary.calcVersion).toBe(SUMMARY_CALC_VERSION);
      expect(summary.inMotionS!).toBeGreaterThan(890);
      expect(summary.inMotionS!).toBeLessThan(910);
      expect(summary.movingTimeS! / summary.inMotionS!).toBeCloseTo(2 / 3, 1);
    }
    // Ni la course ni le bateau, sans ratio de vol.
    expect('inMotionS' in summarizeSession(buildTrack([[600, 3]]), 'running')!).toBe(false);
    expect('inMotionS' in summarizeSession(buildTrack([[600, 2.06]]), 'bateau')!).toBe(false);
  });

  it('compte toute une session bateau en navigation, sans seuil, bords lents compris', () => {
    // 10 min à 4 nœuds, 5 min à 0,5 nœud : rien n'est écarté, même un seuil imposé.
    const raw = buildTrack([[600, 2.06], [300, 0.26]]);
    for (const summary of [summarizeSession(raw, 'bateau')!, summarizeSession(raw, 'bateau', { activeThreshold: 3 })!]) {
      expect(summary.movingTimeS).toBeCloseTo((summary.endMs - summary.startMs) / 1000, 5);
      expect(summary.movingDistanceM).toBeCloseTo(summary.distanceM, 5);
    }
  });

  it('suit un seuil imposé', () => {
    // À 10,8 km/h, un seuil de 12 km/h ne voit jamais la session en mouvement.
    const summary = summarizeSession(buildTrack([[600, 3]]), 'running', { activeThreshold: 12 })!;
    expect(summary.movingTimeS).toBe(0);
  });

  it('sans seuil (réglé à 0), ôte tout de même un arrêt complet du temps en mouvement (plancher, 27/10)', () => {
    // 10 min à 3 m/s, 5 min immobile : l'arrêt sort au plancher d'arrêt de la course.
    const summary = summarizeSession(buildTrack([[600, 3], [300, 0]]), 'running', { activeThreshold: 0 })!;
    expect(summary.movingTimeS!).toBeGreaterThan(595);
    expect(summary.movingTimeS!).toBeLessThan(605);
    // Seuls manquent les mètres des premières secondes, le temps de confirmer le départ.
    expect(summary.distanceM - summary.movingDistanceM!).toBeGreaterThanOrEqual(0);
    expect(summary.distanceM - summary.movingDistanceM!).toBeLessThan(10);
  });

  it("ne compte ni la distance ni le temps en mouvement d'une pause de l'enregistrement, à 1 Hz comme à 5 Hz", () => {
    // 5 min à 3 m/s, pause de 10 min (un second `<trkseg>`), 5 min à 3 m/s ; vitesse Doppler sur chaque point,
    // celle de la reprise comprise : intégrée sur la pause, elle ajoutait 1 800 m (bug du 17/10).
    const paused = (hz: number): RawTrackPoint[] => {
      const pauseStart = START_MS + 300_000;
      const pauseEnd = START_MS + 900_000;
      return buildTrack([[300, 3], [600, 0], [300, 3]], hz)
        .filter((p) => Date.parse(p.time as string) <= pauseStart || Date.parse(p.time as string) >= pauseEnd)
        .map((p) => ({ ...p, speedMs: 3, ...(Date.parse(p.time as string) === pauseEnd ? { segmentStart: true as const } : {}) }));
    };
    for (const hz of [1, 5]) {
      for (const activeThreshold of [0, undefined]) {
        const summary = summarizeSession(paused(hz), 'running', { activeThreshold })!;
        expect(summary.distanceM).toBeCloseTo(1800, -1);
        expect(summary.movingTimeS!).toBeGreaterThan(590);
        expect(summary.movingTimeS!).toBeLessThan(601);
        expect(summary.endMs - summary.startMs).toBe(1_200_000);
      }
    }
  });

  it('donne le même résumé à 1 Hz et à 5 Hz', () => {
    const phases: [number, number][] = [[300, 3], [120, 0], [300, 3.5]];
    const at1 = summarizeSession(buildTrack(phases, 1), 'running')!;
    const at5 = summarizeSession(buildTrack(phases, 5), 'running')!;
    expect(at5.distanceM).toBeCloseTo(at1.distanceM, -1);
    expect(Math.abs(at5.movingTimeS! - at1.movingTimeS!)).toBeLessThan(3);
    expect(Math.abs(at5.movingDistanceM! - at1.movingDistanceM!)).toBeLessThan(10);
    expect(at5.endMs - at5.startMs).toBe(at1.endMs - at1.startMs);
  });

  it('rend le dénivelé positif si la trace a des altitudes, `null` sinon', () => {
    // 100 m de montée régulière en 10 min.
    const withEle = summarizeSession(buildTrack([[600, 3]], 1, 100 / 600), 'running')!;
    expect(withEle.elevationGainM).toBeGreaterThan(90);
    expect(withEle.elevationGainM).toBeLessThan(105);
    expect(summarizeSession(buildTrack([[600, 3]]), 'running')!.elevationGainM).toBeNull();
  });

  it("prend le dénivelé sur l'altitude du terrain quand la fiche en porte une", () => {
    // GPS : 100 m de montée ; terrain : 50 m, un échantillon toutes les 10 s, même sans altitude GPS.
    const t = Array.from({ length: 61 }, (_, i) => i * 10_000);
    const terrainElevation = { startMs: START_MS, t, z: t.map((ms) => 50 + (50 * ms) / 600_000) };
    for (const raw of [buildTrack([[600, 3]], 1, 100 / 600), buildTrack([[600, 3]])]) {
      const summary = summarizeSession(raw, 'running', { terrainElevation })!;
      expect(summary.elevationGainM).toBeGreaterThan(45);
      expect(summary.elevationGainM).toBeLessThan(52);
    }
  });

  it('résume une trace sans support, sauf le temps en mouvement', () => {
    const summary = summarizeSession(buildTrack([[600, 3]]), null)!;
    expect(summary.distanceM).toBeCloseTo(1800, -1);
    expect(summary.movingTimeS).toBeNull();
    expect(summary.movingDistanceM).toBeNull();
  });

  it('rend `null` pour une trace de moins de deux points', () => {
    expect(summarizeSession([], 'running')).toBeNull();
    expect(summarizeSession(buildTrack([]), 'running')).toBeNull();
  });
});

describe('summarizeHeartRateSession (muscu, lot I du 25/10)', () => {
  const T0 = Date.UTC(2026, 9, 28, 18, 0, 0);
  const timed = Array.from({ length: 181 }, (_, k) => ({ time: new Date(T0 + k * 1000).toISOString(), hr: 100 + (k % 20) }));

  it('donne un résumé non nul : distance 0, durée hors pauses, FC présente', () => {
    const resumed = [...timed.slice(0, 91), ...timed.slice(91).map((p, k) => ({ ...p, time: new Date(T0 + (k + 120) * 1000).toISOString(), ...(k === 0 ? { segmentStart: true as const } : {}) }))];
    const s = summarizeHeartRateSession(resumed, 'muscu')!;
    expect(s.distanceM).toBe(0);
    expect(s.maxSpeedMs).toBe(0);
    expect(s.elevationGainM).toBeNull();
    expect(s.movingDistanceM).toBeNull();
    expect(s.movingTimeS).toBe(90 + 89);
    expect(s.startMs).toBe(T0);
    expect(s.heartRate?.maxBpm).toBeGreaterThan(110);
    expect(s.samplingS).toBe(1);
    expect(s.calcVersion).toBe(SUMMARY_CALC_VERSION);
  });

  it('moins de deux points : null', () => {
    expect(summarizeHeartRateSession(timed.slice(0, 1), 'muscu')).toBeNull();
  });
});
