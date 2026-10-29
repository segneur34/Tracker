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

/**
 * Nombre de changements de direction d'au moins `minDeg` entre les points
 * `start` et `end` : les caps des pas `start + 1` à `end`.
 */
export const countDirectionChanges = (track: TrackPoint[], start: number, end: number, minDeg: number): number => {
  if (end - start < 2) return 0;
  let heading = 0;
  let lo = 0;
  let hi = 0;
  let extreme = 0;
  let direction: -1 | 0 | 1 = 0;
  let turns = 0;
  for (let i = start + 2; i <= end; i++) {
    heading += signedDeltaHalfOpen(headingOf(track[i - 1]), headingOf(track[i]));
    if (direction === 0) {
      lo = Math.min(lo, heading);
      hi = Math.max(hi, heading);
      if (heading - lo >= minDeg) {
        direction = 1;
        extreme = heading;
        turns++;
      } else if (hi - heading >= minDeg) {
        direction = -1;
        extreme = heading;
        turns++;
      }
    } else if (direction === 1) {
      if (heading > extreme) extreme = heading;
      else if (extreme - heading >= minDeg) {
        direction = -1;
        extreme = heading;
        turns++;
      }
    } else {
      if (heading < extreme) extreme = heading;
      else if (heading - extreme >= minDeg) {
        direction = 1;
        extreme = heading;
        turns++;
      }
    }
  }
  return turns;
};
