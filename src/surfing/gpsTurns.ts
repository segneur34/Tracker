import { signedDeltaHalfOpen } from '../core/angles';
import { haversineDistance, initialBearing } from '../core/geo';
import { detourSpikes } from '../core/kinematics';
import type { SurfTurnRules } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';

/**
 * Grands changements de direction d'une vague, vus par le GPS (§10, point 97).
 *
 * À une position par seconde, un bottom turn ou un top turn, qui dure à peu
 * près une seconde, ne laisse qu'un point : seuls les grands virages (cutback,
 * demi-tour) se voient. Ce compte est donc expérimental, et l'interface le
 * dit ; les virages du gyroscope les remplacent quand la capture existe.
 *
 * Le cap de chaque pas est celui de l'appareil s'il est là (Doppler, juste
 * même à 1 Hz), sinon celui des positions, lu sur une corde d'environ
 * `courseStrideS` : le cap d'un seul pas de 0,2 s suit le bruit du GPS, et une
 * même vague compterait plus de virages à 5 Hz qu'à 1 Hz (règle 2). On le
 * déroule, puis on compte les rotations d'un seul sens d'au moins `minDeg` :
 * un virage est compté chaque fois que le cap s'éloigne de `minDeg` de son
 * dernier extrême, dans le sens opposé au virage précédent (hystérésis, qui
 * ignore le tremblement du cap).
 *
 * Un virage relie deux glisses. Trois règles l'assurent, toutes en temps
 * (`SurfTurnRules` du profil, appliquées par l'analyse d'une session) :
 * - le cap n'est pas lu sous une vitesse plancher, où il ne vaut rien ;
 * - il n'est pas lu non plus pendant les premières secondes au-dessus de ce
 *   plancher, la mise en vitesse ;
 * - un changement de direction ne compte que s'il reste assez de glisse après
 *   la fin de sa rotation : sinon c'est la sortie de la vague, pas un virage.
 *   « Assez de glisse » : la vague continue au-dessus du plancher, en ligne
 *   droite ou non ; des virages enchaînés comptent tous, sauf au plus le
 *   dernier. La rotation finit à sa première pause (`rotationEnds`).
 */

/** Règles d'un virage, chacune facultative : absente, elle ne s'applique pas (le compte brut des rotations). */
export type TurnRules = Partial<SurfTurnRules>;

/** Corde trop courte pour porter un cap, en mètres : celui du pas est gardé. */
const CHORD_MIN_M = 0.01;

/**
 * Options du compte au GPS : les règles (absentes, le cap de chaque pas, sans
 * corde, et aucune règle), la fin de glisse si elle est déjà connue, et le trou
 * de la trace.
 */
export interface GpsTurnOptions extends TurnRules {
  /** Fin de glisse, en ms ; absente : `rideEndMsOf` au plancher de lecture. */
  rideEndMs?: number;
  /** Pas le plus long où une borne s'interpole, en secondes ; au-delà, c'est un trou. Défaut : aucun trou. */
  maxGapS?: number;
}

/** Un changement de direction : l'extrême d'où il part, et le point où il atteint `minDeg`. */
export interface DirectionChange {
  /** Indice du dernier extrême du cap (le début du virage). */
  from: number;
  /** Indice où le cap s'en est éloigné de `minDeg` (le virage est compté). */
  at: number;
  /** Sens de la rotation : 1 cap croissant, −1 décroissant. */
  direction: 1 | -1;
}

/**
 * Changements de direction d'au moins `minDeg` d'un cap déroulé (en degrés,
 * sans saut de 360°), par hystérésis : commun aux virages du GPS et à ceux du
 * gyroscope (`surfing/gyroTurns.ts`). Le premier cap sert de départ.
 */
export const directionChanges = (heading: ArrayLike<number>, minDeg: number): DirectionChange[] => {
  const out: DirectionChange[] = [];
  if (heading.length < 2) return out;
  let lo = heading[0];
  let hi = heading[0];
  let loAt = 0;
  let hiAt = 0;
  let extreme = heading[0];
  let extremeAt = 0;
  let direction: -1 | 0 | 1 = 0;
  for (let i = 1; i < heading.length; i++) {
    const h = heading[i];
    if (direction === 0) {
      if (h < lo) {
        lo = h;
        loAt = i;
      }
      if (h > hi) {
        hi = h;
        hiAt = i;
      }
      if (h - lo >= minDeg) {
        direction = 1;
        out.push({ from: loAt, at: i, direction });
        extreme = h;
        extremeAt = i;
      } else if (hi - h >= minDeg) {
        direction = -1;
        out.push({ from: hiAt, at: i, direction });
        extreme = h;
        extremeAt = i;
      }
    } else if (direction === 1) {
      if (h > extreme) {
        extreme = h;
        extremeAt = i;
      } else if (extreme - h >= minDeg) {
        direction = -1;
        out.push({ from: extremeAt, at: i, direction });
        extreme = h;
        extremeAt = i;
      }
    } else {
      if (h < extreme) {
        extreme = h;
        extremeAt = i;
      } else if (h - extreme >= minDeg) {
        direction = 1;
        out.push({ from: extremeAt, at: i, direction });
        extreme = h;
        extremeAt = i;
      }
    }
  }
  return out;
};

/**
 * Indice où s'achève la rotation de chaque changement de direction : sa
 * première pause. À partir du pas `at`, où le seuil est seulement atteint, la
 * rotation dure tant que le cap avance encore dans son sens d'au moins
 * `pauseRateDegS` sur la fenêtre qui suit : le plus petit écart entre deux
 * lectures qui couvre `pauseWindowS`, ou ce qui reste de lectures s'il n'y en
 * a plus autant ; l'avance s'y compare au taux fois la durée de l'écart. Ce
 * n'est pas un extrême du cap : un cap qui tremble ou dérive après le virage,
 * ou une sortie de vague dans le même sens que lui, plus tard, ne repoussent
 * pas la fin. `timeMsOf` : l'heure de chaque lecture, en ms.
 */
export const rotationEnds = (
  heading: ArrayLike<number>, timeMsOf: (i: number) => number, changes: readonly DirectionChange[],
  pauseRateDegS: number, pauseWindowS: number
): number[] => {
  const last = heading.length - 1;
  return changes.map((c) => {
    let k = c.at;
    let j = k;
    for (; k < last; k++) {
      if (j <= k) j = k + 1;
      while (j < last && timeMsOf(j) - timeMsOf(k) < pauseWindowS * 1000) j++;
      const spanS = (timeMsOf(j) - timeMsOf(k)) / 1000;
      if (c.direction * (heading[j] - heading[k]) < pauseRateDegS * spanS) break;
    }
    return k;
  });
};

const isGapStep = (track: TrackPoint[], i: number, maxGapS: number): boolean =>
  track[i].segmentStart === true || (track[i].timeMs - track[i - 1].timeMs) / 1000 > maxGapS;

/**
 * Cap des positions au point `i`, en degrés : celui de la corde depuis le
 * point dont l'heure est la plus proche de `strideMs` avant lui (la plus
 * longue à égalité), sans remonter au-delà d'un trou ni d'une reprise (la
 * corde s'arrête alors au premier point du morceau). La plus proche, et non
 * la première au-delà : sur une cadence irrégulière, celle-ci peut couvrir
 * plus de deux secondes et effacer un virage. Le cap du pas (`bearing`) est
 * gardé quand la corde n'a qu'un pas (1 Hz, long pas d'une cadence variable)
 * ou ne mesure presque rien. Une corde ne part ni n'arrive sur une position
 * qui a sauté (`spiked`, `positionSpikes`) : arrivée sautée, le cap du pas,
 * que le noyau a réparé ; départ sauté, le point d'avant.
 */
const chordHeading = (track: TrackPoint[], i: number, strideMs: number, maxGapS: number, spiked: ReadonlySet<number>): number => {
  const p = track[i];
  if (spiked.has(i)) return p.bearing;
  let j = i;
  while (j > 0 && !isGapStep(track, j, maxGapS) && p.timeMs - track[j].timeMs < strideMs) j--;
  const beyond = p.timeMs - track[j].timeMs - strideMs;
  if (j < i - 1 && beyond > 0 && strideMs - (p.timeMs - track[j + 1].timeMs) < beyond) j++;
  if (spiked.has(j)) {
    if (j === 0 || isGapStep(track, j, maxGapS)) return p.bearing;
    j--;
  }
  if (j >= i - 1) return p.bearing;
  const a = track[j];
  if (haversineDistance(a.lat, a.lon, p.lat, p.lon) < CHORD_MIN_M) return p.bearing;
  return initialBearing(a.lat, a.lon, p.lat, p.lon);
};

const NO_SPIKES: ReadonlySet<number> = new Set();

/**
 * Indices des positions qui ont sauté puis sont revenues, autour des points
 * `start` à `end` : la règle du noyau (`detourSpikes`), avec ses valeurs par
 * défaut, celles du surf, qui n'accorde pas ses filtres à l'allure de la
 * session. Le noyau a réparé le cap de ces points (sauf vitesse Doppler). Les
 * sauts se cherchent aussi `marginMs` en deçà de la première corde possible
 * (`SurfTurnRules.spikeSearchMarginS`) : la recherche voit le même
 * enchaînement que le noyau.
 */
const positionSpikes = (track: TrackPoint[], start: number, end: number, strideMs: number, marginMs: number): Set<number> => {
  let lo = start;
  while (lo > 0 && track[start].timeMs - track[lo - 1].timeMs <= strideMs + marginMs) lo--;
  const hi = Math.min(track.length - 1, end + 1);
  const slice = track.slice(lo, hi + 1);
  return new Set(detourSpikes(slice, slice.map((p) => p.timeMs)).map((k) => k + lo));
};

/**
 * Instant, en ms, où la vitesse lissée passe `floorMs` sur le pas `i` (du
 * point `i − 1` au point `i`, l'un dessous, l'autre pas), interpolé en temps.
 * Un trou de la trace ne s'interpole pas : l'instant est celui du point qui
 * est au-dessus du plancher.
 */
const floorCrossingMs = (track: TrackPoint[], i: number, floorMs: number, maxGapS: number): number => {
  const a = track[i - 1];
  const b = track[i];
  if (isGapStep(track, i, maxGapS)) return a.smoothedSpeedMs >= floorMs ? a.timeMs : b.timeMs;
  return a.timeMs + ((floorMs - a.smoothedSpeedMs) / (b.smoothedSpeedMs - a.smoothedSpeedMs)) * (b.timeMs - a.timeMs);
};

/**
 * Fin de glisse d'une vague entre les points `start` et `end`, en ms : le
 * dernier instant où la vitesse lissée tient le plancher `floorMs`, interpolé
 * entre deux points. C'est la fin de la vague si son dernier point le tient,
 * son début si aucun ne le tient.
 */
export const rideEndMsOf = (track: TrackPoint[], start: number, end: number, floorMs: number, maxGapS = Infinity): number => {
  let k = end;
  while (k >= start && track[k].smoothedSpeedMs < floorMs) k--;
  if (k < start) return track[start].timeMs;
  return k === end ? track[end].timeMs : floorCrossingMs(track, k + 1, floorMs, maxGapS);
};

/**
 * Instant, en ms, depuis lequel la vitesse tient le plancher au point `k`,
 * qui le tient : le passage du plancher, interpolé, cherché en arrière jusque
 * devant la vague (une vague prise en vol est lancée depuis longtemps), sans
 * remonter plus de `settleMs`, qui suffit à dire la mise en vitesse finie.
 */
const aboveFloorSinceMs = (track: TrackPoint[], k: number, floorMs: number, settleMs: number, maxGapS: number): number => {
  let j = k;
  while (
    j > 0 && !isGapStep(track, j, maxGapS) && track[j - 1].smoothedSpeedMs >= floorMs && track[k].timeMs - track[j].timeMs < settleMs
  ) j--;
  if (j === 0 || isGapStep(track, j, maxGapS) || track[j - 1].smoothedSpeedMs >= floorMs) return track[j].timeMs;
  return floorCrossingMs(track, j, floorMs, maxGapS);
};

/** Un changement de direction d'une vague, vu par le GPS, compté ou écarté selon la glisse qui le suit. */
export interface GpsTurn {
  /** Heures, en ms, de l'extrême d'où il part, du pas où il atteint `minDeg`, et de la fin de sa rotation. */
  fromMs: number;
  atMs: number;
  endMs: number;
  /** Sens de la rotation : 1 cap croissant, −1 décroissant. */
  direction: 1 | -1;
  /** Glisse restante, en secondes, de la fin de la rotation à la fin de glisse de la vague. */
  rideAfterS: number;
  /** Vrai s'il reste assez de glisse après la rotation : un virage. */
  counted: boolean;
}

/**
 * Changements de direction d'au moins `minDeg` entre les points `start` et
 * `end` : les caps des pas `start + 1` à `end`, chacun à l'heure de son point
 * d'arrivée. Avec les règles `o` (aucune par défaut) : un pas n'est lu que si
 * son point d'arrivée tient le plancher et la mise en vitesse est passée (elle
 * ne se juge qu'une fois : un repassage sous le plancher en cours de vague ne
 * la relance pas), et un changement ne compte que suivi d'assez de glisse. Sur
 * un long pas (cadence variable), la glisse restante se mesure depuis le point
 * d'arrivée du dernier pas lu : elle peut être surestimée d'un pas. Sans cap
 * de l'appareil, chaque point se lit au cap de la corde d'environ
 * `courseStrideS` qui y mène (`chordHeading`) : la même vague compte les mêmes
 * virages à 1 Hz et à 5 Hz.
 */
export const gpsTurnsOf = (
  track: TrackPoint[], start: number, end: number, minDeg: number, o: GpsTurnOptions = {}
): GpsTurn[] => {
  if (end - start < 2) return [];
  const floorMs = o.courseMinSpeedMs ?? 0;
  const settleMs = (o.settleS ?? 0) * 1000;
  const minRideAfterMs = (o.minRideAfterS ?? 0) * 1000;
  const maxGapS = o.maxGapS ?? Infinity;
  const strideMs = (o.courseStrideS ?? 0) * 1000;
  let first = start;
  while (first <= end && track[first].smoothedSpeedMs < floorMs) first++;
  if (first > end) return [];
  const readFromMs = aboveFloorSinceMs(track, first, floorMs, settleMs, maxGapS) + settleMs;
  const heading: number[] = [];
  const timeMs: number[] = [];
  let lastRead = 0;
  let spiked: Set<number> | null = null;
  for (let i = start + 1; i <= end; i++) {
    const p = track[i];
    if (p.smoothedSpeedMs < floorMs || p.timeMs < readFromMs) continue;
    if (p.courseDeg === undefined && strideMs > 0) spiked ??= positionSpikes(track, start, end, strideMs, (o.spikeSearchMarginS ?? 0) * 1000);
    const read = p.courseDeg ?? (strideMs > 0 ? chordHeading(track, i, strideMs, maxGapS, spiked ?? NO_SPIKES) : p.bearing);
    heading.push(heading.length === 0 ? 0 : heading[heading.length - 1] + signedDeltaHalfOpen(lastRead, read));
    timeMs.push(p.timeMs);
    lastRead = read;
  }
  const changes = directionChanges(heading, minDeg);
  if (changes.length === 0) return [];
  const rideEndMs = o.rideEndMs ?? rideEndMsOf(track, start, end, floorMs, maxGapS);
  const ends = rotationEnds(heading, (i) => timeMs[i], changes, o.pauseRateDegS ?? 0, o.pauseWindowS ?? 0);
  return changes.map((c, j) => {
    const rideAfterMs = rideEndMs - timeMs[ends[j]];
    return {
      fromMs: timeMs[c.from], atMs: timeMs[c.at], endMs: timeMs[ends[j]], direction: c.direction,
      rideAfterS: rideAfterMs / 1000, counted: rideAfterMs >= minRideAfterMs,
    };
  });
};

/** Nombre de virages du GPS entre les points `start` et `end` : les changements de direction comptés de `gpsTurnsOf`. */
export const countDirectionChanges = (
  track: TrackPoint[], start: number, end: number, minDeg: number, o: GpsTurnOptions = {}
): number => gpsTurnsOf(track, start, end, minDeg, o).filter((c) => c.counted).length;
