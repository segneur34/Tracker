import { signedDeltaHalfOpen } from '../core/angles';
import type { TrackPoint } from '../core/types';

/**
 * Grands changements de direction d'une vague, vus par le GPS (§10, point 97).
 *
 * À une position par seconde, un bottom turn ou un top turn, qui dure à peu
 * près une seconde, ne laisse qu'un point : seuls les grands virages (cutback,
 * demi-tour) se voient. Ce compte est donc expérimental, et l'interface le
 * dit ; les vrais virages viendront du gyroscope.
 *
 * Le cap de chaque pas est celui de l'appareil s'il est là (Doppler, juste
 * même à 1 Hz), sinon celui des positions. On le déroule, puis on compte les
 * rotations d'un seul sens d'au moins `minDeg` : un virage est compté chaque
 * fois que le cap s'éloigne de `minDeg` de son dernier extrême, dans le sens
 * opposé au virage précédent (hystérésis, qui ignore le tremblement du cap).
 */

const headingOf = (p: TrackPoint): number => p.courseDeg ?? p.bearing;

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
 * Nombre de changements de direction d'au moins `minDeg` entre les points
 * `start` et `end` : les caps des pas `start + 1` à `end`.
 */
export const countDirectionChanges = (track: TrackPoint[], start: number, end: number, minDeg: number): number => {
  if (end - start < 2) return 0;
  const heading = new Float64Array(end - start);
  for (let i = start + 2; i <= end; i++) {
    heading[i - start - 1] = heading[i - start - 2] + signedDeltaHalfOpen(headingOf(track[i - 1]), headingOf(track[i]));
  }
  return directionChanges(heading, minDeg).length;
};
