import { describe, expect, it } from 'vitest';
import { computeKinematics } from './kinematics';
import { activeRuns, buildCumulativeTrack, computeActiveTimeMs, thresholdActivityMask } from './sessionStats';
import { getActiveThresholds, SPORT_PROFILES, type SportProfile } from './sportProfiles';
import type { RawTrackPoint, TrackPoint } from './types';

const START_MS = Date.parse('2026-10-27T10:00:00Z');
const LAT = 43.6;
const M_PER_DEG_LON = (Math.PI / 180) * 6371e3 * Math.cos((LAT * Math.PI) / 180);
/** 5 km/h, en m/s. */
const WALK_MS = 5 / 3.6;

/**
 * Phase d'une trace vers l'est : `durationS` secondes à `speedMs`. Sans point
 * (`noPoints`), la position avance d'autant sans qu'aucun point ne soit écrit :
 * un trou de la trace, immobile à vitesse nulle.
 */
interface Phase {
  durationS: number;
  speedMs: number;
  noPoints?: boolean;
}

/** Points bruts à `hz` points par seconde ; `doppler` : chaque point porte la vitesse de sa phase. */
const buildRaw = (phases: Phase[], hz = 1, doppler = false): RawTrackPoint[] => {
  const points: RawTrackPoint[] = [];
  let meters = 0;
  let t = 0;
  const push = (speedMs: number) =>
    points.push({
      lat: LAT,
      lon: 3.8 + meters / M_PER_DEG_LON,
      time: new Date(START_MS + Math.round(t * 1000)).toISOString(),
      ...(doppler ? { speedMs } : {}),
    });
  push(phases[0]?.speedMs ?? 0);
  for (const phase of phases) {
    if (phase.noPoints) {
      meters += phase.speedMs * phase.durationS;
      t += phase.durationS;
      continue;
    }
    for (let i = 0; i < Math.round(phase.durationS * hz); i++) {
      meters += phase.speedMs / hz;
      t += 1 / hz;
      push(phase.speedMs);
    }
  }
  return points;
};

/** Trace enrichie avec les réglages du profil, comme l'analyse la calcule. */
const analyzed = (raw: RawTrackPoint[], profile: SportProfile): TrackPoint[] =>
  computeKinematics(raw, {
    medianWindowSeconds: profile.medianWindowSeconds,
    maxDetourRatio: profile.maxDetourRatio,
    maxSpeedMs: profile.maxPlausibleSpeedMs,
    maxGapS: profile.maxGapS,
  });

/** Temps en mouvement, en secondes, au seuil donné. */
const movingS = (track: TrackPoint[], profile: SportProfile, threshold: number): number =>
  computeActiveTimeMs(track, thresholdActivityMask(track, profile, threshold)) / 1000;

const totalDistanceM = (track: TrackPoint[]): number => {
  const { cumDist } = buildCumulativeTrack(track);
  return cumDist[cumDist.length - 1];
};

const RUNNING = SPORT_PROFILES.running;

describe('activeRuns', () => {
  const track = analyzed(buildRaw([{ durationS: 120, speedMs: WALK_MS }]), RUNNING);
  // Deux suites : 10 à 30, 50 à 80 ; un trou de 3 s dans la seconde la coupe à 65.
  const mask = track.map((_, i) => (i >= 11 && i <= 30) || (i >= 51 && i <= 80));
  const gapped = track.map((p, i) => (i === 65 ? { ...p, timeMs: p.timeMs + 2000 } : p));

  it('trouve les suites, et un trou plus long que la limite les coupe', () => {
    expect(activeRuns(track, mask)).toEqual([{ start: 10, end: 30 }, { start: 50, end: 80 }]);
    expect(activeRuns(gapped, mask, 2)).toEqual([{ start: 10, end: 30 }, { start: 50, end: 64 }, { start: 65, end: 80 }]);
  });

  it('bornée, donne les suites du masque restreint aux bornes (vagues d’un vol)', () => {
    const bounded = (from: number, to: number) => mask.map((m, i) => m && i >= from && i <= to);
    for (const [from, to] of [[20, 60], [0, 120], [31, 49], [55, 70], [50, 80]] as const) {
      expect(activeRuns(track, mask, Infinity, from, to)).toEqual(activeRuns(track, bounded(from, to)));
      expect(activeRuns(gapped, mask, 2, from, to)).toEqual(activeRuns(gapped, bounded(from, to), 2));
    }
  });
});

describe('getActiveThresholds', () => {
  it('ne rend jamais une détente basse nulle sous un seuil plus petit que l’écart de sortie (A-B1)', () => {
    // Marche à 0,5 km/h : 0,5 − 1 ne serait pas positif, la sortie vaut la moitié du seuil.
    const walk = getActiveThresholds(RUNNING, 0.5);
    expect(walk.enter).toBeCloseTo(1.5, 9);
    expect(walk.exit).toBeCloseTo(0.25, 9);
  });

  it('garde seuil + écart quand il reste positif', () => {
    expect(getActiveThresholds(RUNNING, 3)).toEqual({ enter: 4, exit: 2 });
    expect(getActiveThresholds(SPORT_PROFILES.cycling, 5)).toEqual({ enter: 6, exit: 3 });
  });

  it('donne au plancher d’arrêt du bateau une sortie à 0,5 nœud, et rend 0 pour un seuil nul', () => {
    const boat = SPORT_PROFILES.bateau;
    expect(getActiveThresholds(boat, boat.stillThreshold)).toEqual({ enter: 1.5, exit: 0.5 });
    expect(getActiveThresholds(RUNNING, 0)).toEqual({ enter: 1, exit: 0 });
  });
});

describe('thresholdActivityMask', () => {
  const walkStopWalk: Phase[] = [
    { durationS: 600, speedMs: WALK_MS },
    { durationS: 600, speedMs: 0 },
    { durationS: 600, speedMs: WALK_MS },
  ];

  it('sort pendant un arrêt au seuil de la marche, 0,5 km/h, à 1 Hz comme à 5 Hz (A-B1)', () => {
    const at1 = movingS(analyzed(buildRaw(walkStopWalk, 1), RUNNING), RUNNING, 0.5);
    const at5 = movingS(analyzed(buildRaw(walkStopWalk, 5), RUNNING), RUNNING, 0.5);
    expect(at1).toBeGreaterThan(1190);
    expect(at1).toBeLessThan(1210);
    expect(Math.abs(at5 - at1)).toBeLessThan(2);
  });

  it('ôte un arrêt complet sans seuil réglé, au plancher d’arrêt (bug des pauses, 27/10)', () => {
    const at1 = movingS(analyzed(buildRaw(walkStopWalk, 1), RUNNING), RUNNING, 0);
    const at5 = movingS(analyzed(buildRaw(walkStopWalk, 5), RUNNING), RUNNING, 0);
    expect(at1).toBeGreaterThan(1190);
    expect(at1).toBeLessThan(1210);
    expect(Math.abs(at5 - at1)).toBeLessThan(2);
  });

  it('n’ôte rien d’un arrêt de 2 s sans seuil réglé : la sortie se confirme sur 3 s', () => {
    const track = analyzed(buildRaw([{ durationS: 600, speedMs: WALK_MS }, { durationS: 2, speedMs: 0 }, { durationS: 600, speedMs: WALK_MS }]), RUNNING);
    // Seule l'entrée, au départ, attend sa confirmation.
    expect(movingS(track, RUNNING, 0)).toBeGreaterThan(1202 - 4);
  });

  it('ôte un trou immobile de la trace, en vitesse dérivée comme en Doppler (A-B3)', () => {
    for (const doppler of [false, true]) {
      const raw = buildRaw([
        { durationS: 600, speedMs: WALK_MS },
        { durationS: 300, speedMs: 0, noPoints: true },
        { durationS: 600, speedMs: WALK_MS },
      ], 1, doppler);
      const moving = movingS(analyzed(raw, RUNNING), RUNNING, 3);
      expect(moving).toBeGreaterThan(1190);
      expect(moving).toBeLessThan(1205);
    }
  });

  it('garde en mouvement un trou parcouru à l’allure de la trace (A-B3)', () => {
    const raw = buildRaw([
      { durationS: 600, speedMs: WALK_MS },
      { durationS: 300, speedMs: WALK_MS, noPoints: true },
      { durationS: 600, speedMs: WALK_MS },
    ], 1, true);
    const moving = movingS(analyzed(raw, RUNNING), RUNNING, 3);
    expect(moving).toBeGreaterThan(1495);
    expect(moving).toBeLessThan(1505);
  });

  it('ôte de la navigation d’un bateau un trou immobile de 5 min', () => {
    const boat = SPORT_PROFILES.bateau;
    const sail: Phase = { durationS: 600, speedMs: 2 };
    const gapped = analyzed(buildRaw([sail, { durationS: 300, speedMs: 0, noPoints: true }, sail], 1, true), boat);
    expect(movingS(gapped, boat, 1)).toBeCloseTo(1200, -1);
    // Sans trou, toute la session reste en navigation, bords lents compris.
    const slow = analyzed(buildRaw([sail, { durationS: 300, speedMs: 0.2 }, sail], 1, true), boat);
    expect(movingS(slow, boat, 1)).toBeCloseTo(1500, 5);
  });
});

describe('distance d’un trou de la trace (A-B2)', () => {
  it('ne gagne pas plus que la corde × 1,5 sur un trou immobile suivi d’une reprise en Doppler', () => {
    const walk: Phase = { durationS: 600, speedMs: 1.2 };
    const withGap = analyzed(buildRaw([walk, { durationS: 300, speedMs: 0, noPoints: true }, walk], 1, true), RUNNING);
    const withoutGap = analyzed(buildRaw([walk, walk], 1, true), RUNNING);
    // Le pas du trou mesure 1,2 m de corde : au plus 1,8 m de plus, au lieu de 1,2 m/s × 301 s.
    expect(totalDistanceM(withGap) - totalDistanceM(withoutGap)).toBeLessThan(1.2 * 1.5 + 0.01);
    expect(withGap.filter((p) => p.gapDistanceM !== undefined)).toHaveLength(1);
  });

  it('garde la distance d’un trou de 60 s parcouru en ligne droite', () => {
    const run: Phase = { durationS: 600, speedMs: 3 };
    const track = analyzed(buildRaw([run, { durationS: 60, speedMs: 3, noPoints: true }, run], 1, true), RUNNING);
    expect(totalDistanceM(track)).toBeCloseTo(3 * 1260, -1);
  });

  it('ne marque aucun trou sans profil (`maxGapS` absent)', () => {
    const raw = buildRaw([{ durationS: 60, speedMs: 3 }, { durationS: 60, speedMs: 0, noPoints: true }, { durationS: 60, speedMs: 3 }], 1, true);
    expect(computeKinematics(raw).some((p) => p.gapDistanceM !== undefined)).toBe(false);
  });
});
