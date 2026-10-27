import { smoothHeartRate } from '../core/heartRate';
import { lastIndexAtOrBeforeTime } from '../core/search';
import { meanFilterByTime } from '../core/speedFilter';
import type { TrackPoint } from '../core/types';
import type { FitnessTestProtocol, SessionTest } from '../recording/fitnessTest';

/**
 * Résultats d'un test de FC max (`recording/fitnessTest.ts`), tirés de la
 * trace et du test rangé dans la fiche : FC max, vitesse du dernier palier
 * tenu en entier, vitesse max, récupération. Tout se mesure en temps.
 */
export interface FitnessTestResults {
  /** Pic de la FC lissée sur le test. */
  hrMaxBpm: number | null;
  hrMaxAtMs: number | null;
  /** Vitesse du dernier palier tenu en entier : son suivant a commencé avant le début du manque final. */
  lastStepSpeedMs: number | null;
  /** Paliers tenus en entier. */
  stepsHeld: number;
  /** Plus haute vitesse lissée pendant la rampe. */
  maxSpeedMs: number | null;
  v0Ms: number | null;
  /** Durée de la rampe, jusqu'au début du manque final (à l'appui pour une fin manuelle). */
  rampS: number | null;
  /** FC à la fin de la rampe, puis tant de secondes après, et leur différence. */
  hrAtRampEndBpm: number | null;
  hrAfterBpm: number | null;
  hrDropBpm: number | null;
  /** FC moyenne de l'échauffement, à comparer à la cible. */
  warmupAvgBpm: number | null;
}

/** Ce que la bibliothèque montre d'un test : « FC max 192 · 14,2 km/h ». */
export interface SummaryTest {
  hrMaxBpm: number | null;
  lastStepSpeedMs: number | null;
  steps: number;
}

/** Valeur au point le plus proche de `t`, s'il en est à moins de `gapMs`. */
const valueAt = (track: TrackPoint[], values: (number | null)[], t: number, gapMs: number): number | null => {
  const i = lastIndexAtOrBeforeTime(track, t);
  const candidates = [i, i + 1].filter((k) => k >= 0 && k < track.length && values[k] !== null);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const k of candidates) {
    const dist = Math.abs(track[k].timeMs - t);
    if (dist <= gapMs && dist < bestDist) {
      best = values[k];
      bestDist = dist;
    }
  }
  return best;
};

export const fitnessTestResults = (track: TrackPoint[], test: SessionTest, protocol: FitnessTestProtocol): FitnessTestResults => {
  const gapMs = protocol.fixGapS * 1000;
  const lastMs = track.length > 0 ? track[track.length - 1].timeMs : test.startMs;
  const testEndMs = test.endMs ?? lastMs;
  const hr = smoothHeartRate(track, protocol.resultHrSmoothS, protocol.fixGapS);

  let hrMaxBpm: number | null = null;
  let hrMaxAtMs: number | null = null;
  // FC moyenne de l'échauffement pondérée par le temps (règle 2) : chaque pas compte pour sa
  // durée, bornée à `fixGapS`, la moitié à chacun de ses bouts ; un point seul vaut pour lui-même.
  let warmupSum = 0;
  let warmupWeight = 0;
  let warmupLast: number | null = null;
  const warmupEndMs = test.rampStartMs ?? testEndMs;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    const v = hr[i];
    if (v === null || p.timeMs < test.startMs || p.timeMs > testEndMs) continue;
    if (hrMaxBpm === null || v > hrMaxBpm) {
      hrMaxBpm = v;
      hrMaxAtMs = p.timeMs;
    }
    if (p.timeMs < warmupEndMs) {
      warmupLast = v;
      const prev = i > 0 ? track[i - 1] : null;
      const before = prev ? hr[i - 1] : null;
      if (prev && before !== null && prev.timeMs >= test.startMs) {
        const dtS = Math.min((p.timeMs - prev.timeMs) / 1000, protocol.fixGapS);
        if (dtS > 0) {
          warmupSum += ((before + v) / 2) * dtS;
          warmupWeight += dtS;
        }
      }
    }
  }

  const failMs = test.dropMs ?? test.rampEndMs;
  let held = -1;
  if (failMs !== null) {
    for (let i = 0; i + 1 < test.steps.length; i++) if (test.steps[i + 1].startMs <= failMs) held = i;
  }

  let maxSpeedMs: number | null = null;
  if (test.rampStartMs !== null) {
    const rampEndMs = test.rampEndMs ?? lastMs;
    const speed = meanFilterByTime(track.map((p) => p.smoothedSpeedMs), track.map((p) => p.timeMs), protocol.smoothS);
    for (let i = 0; i < track.length; i++) {
      const t = track[i].timeMs;
      if (t < test.rampStartMs || t > rampEndMs) continue;
      if (maxSpeedMs === null || speed[i] > maxSpeedMs) maxSpeedMs = speed[i];
    }
  }

  const hrAtRampEndBpm = test.rampEndMs !== null ? valueAt(track, hr, test.rampEndMs, gapMs) : null;
  const hrAfterBpm = test.rampEndMs !== null ? valueAt(track, hr, test.rampEndMs + protocol.recoveryReadS * 1000, gapMs) : null;

  return {
    hrMaxBpm: hrMaxBpm === null ? null : Math.round(hrMaxBpm),
    hrMaxAtMs,
    lastStepSpeedMs: held >= 0 ? test.steps[held].targetMs : null,
    stepsHeld: held + 1,
    maxSpeedMs,
    v0Ms: test.v0Ms,
    rampS: test.rampStartMs !== null && failMs !== null ? Math.max(0, (failMs - test.rampStartMs) / 1000) : null,
    hrAtRampEndBpm: hrAtRampEndBpm === null ? null : Math.round(hrAtRampEndBpm),
    hrAfterBpm: hrAfterBpm === null ? null : Math.round(hrAfterBpm),
    hrDropBpm: hrAtRampEndBpm !== null && hrAfterBpm !== null ? Math.round(hrAtRampEndBpm - hrAfterBpm) : null,
    warmupAvgBpm: warmupWeight > 0 ? Math.round(warmupSum / warmupWeight) : warmupLast === null ? null : Math.round(warmupLast),
  };
};

/** Résumé d'un test pour la bibliothèque ; `null` s'il n'a ni FC ni palier tenu. */
export const summaryOfTest = (results: FitnessTestResults): SummaryTest | null =>
  results.hrMaxBpm === null && results.stepsHeld === 0
    ? null
    : { hrMaxBpm: results.hrMaxBpm, lastStepSpeedMs: results.lastStepSpeedMs, steps: results.stepsHeld };
