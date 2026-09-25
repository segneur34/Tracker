import { buildCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { computeTopSegments } from '../core/topSegments';
import type { TrackPoint } from '../core/types';
import { MANEUVER_MAX_STEP_S, MANEUVER_MIN_DISTANCE_M, MANEUVER_MIN_TURN_DEG, MANEUVER_WINDOW_S } from '../sailing/sailingConfig';
import { angleDiff, normalizeAngle } from '../sailing/wind';

/**
 * Bords de voile pendant l'enregistrement. Le vent est inconnu en direct :
 * pas d'amure, un bord est un tronçon de cap tenu, repéré par son cap moyen.
 *
 * Un bord se ferme quand le cap des `windowS` dernières secondes s'écarte de
 * plus de `minTurnDeg` du cap moyen du bord ; le suivant s'ouvre quand le
 * cap redevient stable sur une fenêtre entière, si bien que le virage
 * n'appartient à aucun des deux. Caps moyens pondérés par la distance : à
 * l'arrêt, le cap n'est que du bruit de position et ne pèse rien.
 * Tout en unités SI ; la page convertit.
 */

export interface LiveLegOptions {
  /** Écart de cap, en degrés, qui ferme un bord. */
  minTurnDeg: number;
  /** Fenêtre du cap récent, en secondes. */
  windowS: number;
  /** Distance minimale, en mètres, pour qu'un cap moyen ait un sens. */
  minDistanceM: number;
  /** Cohérence (longueur du vecteur moyen, de 0 à 1) d'un cap redevenu stable. */
  stableCoherence: number;
  /** Écart au cap stabilisé, en degrés, des pas de fin de virage retirés du début du bord. */
  settleToleranceDeg: number;
  /** Au-delà, en secondes, une manœuvre qui ne se stabilise pas ouvre quand même un bord. */
  maxTurnS: number;
  /** Durée du maximum affiché, en secondes. */
  topDurationS: number;
}

export const LIVE_LEG_DEFAULTS: LiveLegOptions = {
  minTurnDeg: MANEUVER_MIN_TURN_DEG,
  windowS: MANEUVER_WINDOW_S,
  minDistanceM: MANEUVER_MIN_DISTANCE_M,
  // Environ ±25° d'éventail sur la fenêtre : le clapot passe, un virage non.
  stableCoherence: 0.97,
  settleToleranceDeg: 10,
  maxTurnS: MANEUVER_MAX_STEP_S,
  topDurationS: 2,
};

export interface LiveLeg {
  startMs: number;
  endMs: number;
  distanceM: number;
  /** Cap moyen, en degrés ; `null` tant que le bord n'a pas parcouru `minDistanceM`. */
  headingDeg: number | null;
  /** Vitesse moyenne, en m/s. */
  averageSpeedMs: number | null;
  /** Meilleure vitesse sur `topDurationS`, en m/s. */
  maxSpeedMs: number | null;
}

export interface LiveLegs {
  /** Bord en cours ; `null` pendant une manœuvre. */
  current: LiveLeg | null;
  /** Dernier bord fermé, pauses comprises. */
  previous: LiveLeg | null;
}

export const EMPTY_LIVE_LEGS: LiveLegs = { current: null, previous: null };

/** Cumuls des pas pondérés par leur distance : sommes sur un intervalle en temps constant. */
interface StepSums {
  x: number[];
  y: number[];
  d: number[];
}

const stepSums = (track: TrackPoint[]): StepSums => {
  const sums: StepSums = { x: [0], y: [0], d: [0] };
  for (let i = 1; i < track.length; i++) {
    const d = segmentDistanceM(track, i);
    const b = (track[i].bearing * Math.PI) / 180;
    sums.x.push(sums.x[i - 1] + d * Math.sin(b));
    sums.y.push(sums.y[i - 1] + d * Math.cos(b));
    sums.d.push(sums.d[i - 1] + d);
  }
  return sums;
};

/** Cap moyen et cohérence des pas `(from, to]`. */
const meanHeading = (s: StepSums, from: number, to: number): { headingDeg: number; coherence: number; distanceM: number } => {
  const x = s.x[to] - s.x[from];
  const y = s.y[to] - s.y[from];
  const distanceM = s.d[to] - s.d[from];
  return {
    headingDeg: normalizeAngle((Math.atan2(x, y) * 180) / Math.PI),
    coherence: distanceM > 0 ? Math.hypot(x, y) / distanceM : 0,
    distanceM,
  };
};

const describeLeg = (track: TrackPoint[], s: StepSums, from: number, to: number, options: LiveLegOptions): LiveLeg => {
  const { headingDeg, distanceM } = meanHeading(s, from, to);
  const durationS = (track[to].timeMs - track[from].timeMs) / 1000;
  let maxSpeedMs: number | null = null;
  if (durationS >= options.topDurationS) {
    const slice = track.slice(from, to + 1);
    const [top] = computeTopSegments(
      slice,
      buildCumulativeTrack(slice),
      { key: 'leg', label: '', value: options.topDurationS, kind: 'time' },
      (ms) => ms,
      { count: 1, decimals: 6 }
    );
    const value = Number(top?.val);
    if (isFinite(value)) maxSpeedMs = value;
  }
  return {
    startMs: track[from].timeMs,
    endMs: track[to].timeMs,
    distanceM,
    headingDeg: distanceM >= options.minDistanceM ? headingDeg : null,
    averageSpeedMs: durationS > 0 ? distanceM / durationS : null,
    maxSpeedMs,
  };
};

/** Découpe une trace continue (sans pause) en bords ; le dernier reste ouvert. */
const splitTrack = (
  track: TrackPoint[],
  options: LiveLegOptions
): { closed: LiveLeg[]; open: LiveLeg | null } => {
  const s = stepSums(track);
  const windowMs = options.windowS * 1000;
  const closed: LiveLeg[] = [];
  let legStart = 0;
  let turningSince: number | null = null;
  let w = 0;

  for (let i = 1; i < track.length; i++) {
    while (track[w].timeMs < track[i].timeMs - windowMs) w++;
    // Cadence lâche (règle 10) : une fenêtre vide lit le seul pas qui la traverse.
    const from = Math.min(w, i - 1);
    const recent = meanHeading(s, from, i);

    if (turningSince === null) {
      if (from <= legStart) continue;
      const leg = meanHeading(s, legStart, from);
      if (leg.distanceM < options.minDistanceM || recent.distanceM < options.minDistanceM) continue;
      if (Math.abs(angleDiff(recent.headingDeg, leg.headingDeg)) > options.minTurnDeg) {
        closed.push(describeLeg(track, s, legStart, from, options));
        turningSince = from;
      }
    } else {
      const settled =
        from >= turningSince &&
        track[i].timeMs - track[from].timeMs >= windowMs &&
        recent.distanceM >= options.minDistanceM &&
        recent.coherence >= options.stableCoherence;
      if (settled) {
        // Fin de virage encore dans la fenêtre : le bord part du premier pas aligné.
        legStart = from;
        while (
          legStart < i - 1 &&
          Math.abs(angleDiff(track[legStart + 1].bearing, recent.headingDeg)) > options.settleToleranceDeg
        ) legStart++;
        turningSince = null;
      } else if (track[i].timeMs - track[turningSince].timeMs > options.maxTurnS * 1000) {
        legStart = i;
        turningSince = null;
      }
    }
  }

  const last = track.length - 1;
  return { closed, open: turningSince === null ? describeLeg(track, s, legStart, last, options) : null };
};

/**
 * Bord en cours et bord précédent. Chaque trace est une portion sans pause :
 * une pause ferme le bord. Un bord trop court pour avoir un cap n'est pas
 * retenu comme précédent.
 */
export const computeLiveLegs = (tracks: TrackPoint[][], options: LiveLegOptions = LIVE_LEG_DEFAULTS): LiveLegs => {
  let previous: LiveLeg | null = null;
  let current: LiveLeg | null = null;
  tracks.forEach((track, t) => {
    const { closed, open } = splitTrack(track, options);
    const isLast = t === tracks.length - 1;
    const done = isLast || open === null ? closed : [...closed, open];
    for (const leg of done) if (leg.headingDeg !== null) previous = leg;
    if (isLast) current = open;
  });
  return { current, previous };
};
