import { angleDiff, normalizeDeg, toDeg, toRad } from '../core/angles';
import { buildCumulativeTrack, extendCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { WINDOW_SCAN_START, computeTopSegments, extendHoleCounts, scanBestWindow, type WindowScan } from '../core/topSegments';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { MANEUVER_MAX_STEP_S, MANEUVER_MIN_DISTANCE_M, MANEUVER_MIN_TURN_DEG, MANEUVER_WINDOW_S } from '../sailing/sailingConfig';

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
export interface StepSums {
  x: number[];
  y: number[];
  d: number[];
}

/** Prolonge sur place les cumuls des pas : ceux des `from` premiers points (au moins un) sont gardés. */
const extendStepSums = (track: TrackPoint[], sums: StepSums, from: number): StepSums => {
  sums.x.length = sums.y.length = sums.d.length = Math.max(1, from);
  for (let i = sums.d.length; i < track.length; i++) {
    const d = segmentDistanceM(track, i);
    const b = toRad(track[i].bearing);
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
    headingDeg: normalizeDeg(toDeg(Math.atan2(x, y))),
    coherence: distanceM > 0 ? Math.hypot(x, y) / distanceM : 0,
    distanceM,
  };
};

/**
 * Bord des points `from` à `to`. Sa vitesse max est celle de `openMax` pour
 * le bord ouvert (balayage gardé d'un calcul à l'autre, `OpenLegMemory`),
 * relue sur le bord sinon.
 */
const describeLeg = (
  track: TrackPoint[], s: StepSums, from: number, to: number, options: LiveLegOptions, openMax?: number | null
): LiveLeg => {
  const { headingDeg, distanceM } = meanHeading(s, from, to);
  const durationS = (track[to].timeMs - track[from].timeMs) / 1000;
  let maxSpeedMs: number | null = null;
  if (durationS >= options.topDurationS && openMax !== undefined) maxSpeedMs = openMax;
  else if (durationS >= options.topDurationS) {
    const slice = track.slice(from, to + 1);
    const [top] = computeTopSegments(
      slice,
      buildCumulativeTrack(slice),
      { key: 'leg', label: '', value: options.topDurationS, kind: 'time' },
      (ms) => ms,
      { count: 1, decimals: 6 }
    );
    maxSpeedMs = top?.speed ?? null;
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

/** Où en est l'automate des bords : prochain point, début de la fenêtre du cap récent, bord en cours ou virage, bords fermés. */
interface SplitState {
  next: number;
  w: number;
  legStart: number;
  turningSince: number | null;
  closed: LiveLeg[];
}

/** Cumuls et balayage de la vitesse max du bord ouvert, en indices comptés depuis son début `legStart`. */
interface OpenLegMemory {
  legStart: number;
  cum: CumulativeTrack;
  scan: WindowScan;
}

/**
 * Ce qui est gardé d'un découpage à l'autre d'une trace qui s'allonge : les
 * cumuls des pas, l'automate après le point `frozen - 1`, et le bord ouvert.
 * Ne vaut que si les `frozen` premiers points n'ont pas changé.
 */
export interface LiveLegsMemory {
  frozen: number;
  sums: StepSums;
  split: SplitState;
  open: OpenLegMemory | null;
  /** Comptes de trous de la trace (`extendHoleCounts`), pour la vitesse max du bord ouvert. */
  holes: number[];
}

/**
 * Découpe une trace continue (sans pause) en bords ; le dernier reste ouvert.
 * Repris de `previous`, seuls les points d'après son `frozen` sont relus.
 * Rend l'automate après le point `frozen - 1` (`null` s'il ne peut l'être).
 */
const splitTrack = (
  track: TrackPoint[],
  options: LiveLegOptions,
  frozen: number,
  previous: LiveLegsMemory | null
): { split: LiveLegSplit; memory: LiveLegsMemory | null } => {
  /** Points repris tels quels du calcul précédent. */
  const reused = previous ? previous.frozen : 0;
  const s = extendStepSums(track, previous ? previous.sums : { x: [0], y: [0], d: [0] }, reused);
  const holes = extendHoleCounts(track, previous ? previous.holes : [0], reused);
  const windowMs = options.windowS * 1000;
  const start: SplitState = previous ? previous.split : { next: 1, w: 0, legStart: 0, turningSince: null, closed: [] };
  const closed = start.closed.slice();
  let legStart = start.legStart;
  let turningSince = start.turningSince;
  let w = start.w;
  // État avant le pas `frozen` : les pas d'avant n'ont lu que des points figés, ils ne changeront plus.
  let kept: SplitState | null = null;
  let keptClosed = 0;

  for (let i = start.next; ; i++) {
    if (i === frozen) {
      kept = { next: i, w, legStart, turningSince, closed: [] };
      keptClosed = closed.length;
    }
    if (i >= track.length) break;
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
  if (kept) kept.closed = closed.slice(0, keptClosed);

  const last = track.length - 1;
  let open: LiveLeg | null = null;
  let openMemory: OpenLegMemory | null = null;
  if (turningSince === null) {
    // Vitesse max du bord ouvert : cumuls du bord, comme ceux de sa tranche (`describeLeg`), prolongés et balayés depuis l'état gardé.
    const seen = previous?.open?.legStart === legStart ? previous.open : null;
    const keepLocal = seen ? Math.max(1, Math.min(seen.cum.cumDist.length, reused - legStart)) : 1;
    const cum = extendCumulativeTrack(track, seen ? seen.cum : { cumDist: [0], cumTime: [0] }, keepLocal, legStart);
    const scanFrom = seen && keepLocal > 1 ? seen.scan : WINDOW_SCAN_START;
    const { best, frozen: scan } = scanBestWindow(cum, holes, legStart, options.topDurationS, scanFrom, frozen - legStart);
    open = describeLeg(track, s, legStart, last, options, best);
    openMemory = { legStart, cum, scan };
  }
  const memory = kept && frozen >= 2 ? { frozen, sums: s, split: kept, open: openMemory, holes } : null;
  return { split: { closed, open }, memory };
};

/** Bords d'une trace continue (sans pause) : les fermés, et le dernier, ouvert (`null` pendant une manœuvre). */
export interface LiveLegSplit {
  closed: LiveLeg[];
  open: LiveLeg | null;
}

/** Bords d'une trace continue. */
export const splitLiveLegs = (track: TrackPoint[], options: LiveLegOptions = LIVE_LEG_DEFAULTS): LiveLegSplit => splitTrack(track, options, 0, null).split;

/**
 * Les bords de `splitLiveLegs`, repris sur une trace qui ne fait que
 * s'allonger (direct de l'enregistrement) : `previous` est la mémoire rendue
 * par l'appel précédent, valable si les `previous.frozen` premiers points de
 * `track` sont les mêmes ; `frozen` dit combien de points de `track` le
 * prochain appel trouvera inchangés (`KinematicsRun.frozenUpTo`). Seuls les
 * points d'après sont relus, avec les mêmes calculs dans le même ordre : le
 * découpage est celui du calcul entier. `previous` est consommé (ses
 * tableaux sont prolongés) : ne reprendre que la dernière mémoire rendue.
 */
export const resumeLiveLegs = (
  track: TrackPoint[],
  frozen: number,
  previous: LiveLegsMemory | null,
  options: LiveLegOptions = LIVE_LEG_DEFAULTS
): { split: LiveLegSplit; memory: LiveLegsMemory | null } =>
  splitTrack(track, options, Math.min(frozen, track.length), previous && previous.frozen <= track.length ? previous : null);

/**
 * Bord en cours et bord précédent, à partir des bords de chaque segment, dans
 * l'ordre. Une pause ferme le bord. Un bord trop court pour avoir un cap n'est
 * pas retenu comme précédent.
 */
export const combineLiveLegs = (splits: ReadonlyArray<LiveLegSplit>): LiveLegs => {
  let previous: LiveLeg | null = null;
  let current: LiveLeg | null = null;
  splits.forEach(({ closed, open }, t) => {
    const isLast = t === splits.length - 1;
    const done = isLast || open === null ? closed : [...closed, open];
    for (const leg of done) if (leg.headingDeg !== null) previous = leg;
    if (isLast) current = open;
  });
  return { current, previous };
};
