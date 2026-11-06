import type { ImuRecording } from '../core/imuFile';
import { centredMean, fileUsOf, verticalAcceleration, type ImuWindow } from '../core/imuVertical';
import { capturedWindows } from '../core/pumping';
import type { GyroTurnDetection } from '../core/sportProfiles';
import { directionChanges, type DirectionChange } from './gpsTurns';

/**
 * Virages d'une vague mesurés par le gyroscope du téléphone fixé sur la
 * poitrine (lot 40). Un bottom turn ou un top turn dure environ une seconde :
 * le GPS, à une position par seconde, ne le voit pas (`surfing/gpsTurns.ts`),
 * le gyroscope si.
 *
 * Pour chaque vague entièrement couverte par la capture : verticale du monde
 * (`verticalAcceleration`, lue `leadS` avant et après la vague pour que le
 * filtre soit posé au départ), rotation du buste autour d'elle (`yawRate`),
 * lissée sur `smoothingS`, intégrée en cap relatif sur la vague ; un virage est
 * compté à chaque retournement d'au moins `minDeg` depuis l'extrême précédent
 * (hystérésis, `directionChanges`), et seulement si le buste a tourné de
 * `minDeg` à `minRateDegS` de moyenne au moins, quelque part entre cet extrême
 * et le suivant : en `minDeg / minRateDegS` secondes au plus. Une dérive
 * lente, même secouée par la rame ou le pumping (le buste oscille vite, mais
 * de peu), n'est pas un virage : la vitesse de pointe ne suffit pas (séance
 * témoin du 14/10, sup foil à plat : 60° en 5 à 20 s, pointes de 40 à 120°/s).
 * Tout en SI (secondes, radians) sauf les seuils, en degrés comme ceux du GPS.
 */

const DEG_PER_RAD = 180 / Math.PI;

/** Une vague : ses heures de début et de fin, en ms. */
export type TurnWave = { startMs: number; endMs: number };

/** Un retournement du cap du buste, compté ou écarté selon sa vitesse de rotation. */
export interface GyroTurn extends DirectionChange {
  /** Indice de l'extrême suivant, où le virage s'achève (le dernier pas si la vague finit avant). */
  until: number;
  /** Durée la plus courte où le buste a tourné de `minDeg` dans son sens, entre `from` et `until`, en secondes ; `null` : jamais en moins de `minDeg / minRateDegS`. */
  fastestS: number | null;
  /** Vrai si `fastestS` existe : un virage. */
  counted: boolean;
}

/** Cap du buste sur une vague, pas à pas de la grille des capteurs (le diagnostic du banc le lit). */
export interface WaveTurnTrace {
  /** Heure du premier pas, en ms, et pas de la grille, en secondes. */
  startMs: number;
  dt: number;
  /** Cap relatif, en degrés, et vitesse de rotation lissée, en °/s, sur chaque pas. */
  heading: Float64Array;
  rateDeg: Float64Array;
  /** Retournements d'au moins `minDeg` (indices dans `heading`). */
  changes: GyroTurn[];
}

/** Indice du dernier extrême du cap dans le sens `direction`, à partir de `from`. */
const extremeAfter = (heading: Float64Array, from: number, direction: 1 | -1): number => {
  let at = from;
  for (let k = from + 1; k < heading.length; k++) if (direction * (heading[k] - heading[at]) >= 0) at = k;
  return at;
};

/**
 * Plus petit nombre de pas, au plus `maxSteps`, en lequel le cap a tourné
 * d'au moins `minDeg` dans le sens `direction`, entre `from` et `until` ;
 * `null` si jamais.
 */
const fastestSteps = (heading: Float64Array, from: number, until: number, direction: 1 | -1, minDeg: number, maxSteps: number): number | null => {
  let best: number | null = null;
  for (let k = from + 1; k <= until; k++) {
    const limit = Math.max(from, k - (best === null ? maxSteps : best - 1));
    for (let i = k - 1; i >= limit; i--) {
      if (direction * (heading[k] - heading[i]) >= minDeg) {
        best = k - i;
        break;
      }
    }
  }
  return best;
};

/**
 * Cap du buste et retournements sur une vague ; `null` si la capture ne la
 * couvre pas en entier (`windows` : les fenêtres mesurées du fichier).
 */
export const waveTurnTrace = (
  rec: ImuRecording, d: GyroTurnDetection, wave: TurnWave, windows: readonly ImuWindow[] = capturedWindows(rec)
): WaveTurnTrace | null => {
  const fromUs = fileUsOf(rec, wave.startMs);
  const toUs = fileUsOf(rec, wave.endMs);
  if (!(toUs > fromUs)) return null;
  const w = windows.find(([a, b]) => a <= fromUs && b >= toUs);
  if (!w) return null;
  const v = verticalAcceleration(rec, d, Math.max(w[0], fromUs - d.leadS * 1e6), Math.min(w[1], toUs + d.leadS * 1e6));
  if (!v) return null;
  const half = Math.max(0, Math.round(d.smoothingS / v.dt / 2));
  const rate = centredMean(v.yawRate, half);
  const i0 = Math.max(0, Math.ceil((fromUs - v.startUs) / v.stepUs));
  const i1 = Math.min(v.n - 1, Math.floor((toUs - v.startUs) / v.stepUs));
  const len = Math.max(0, i1 - i0 + 1);
  const heading = new Float64Array(len);
  const rateDeg = new Float64Array(len);
  for (let k = 0; k < len; k++) {
    rateDeg[k] = rate[i0 + k] * DEG_PER_RAD;
    if (k > 0) heading[k] = heading[k - 1] + ((rateDeg[k - 1] + rateDeg[k]) / 2) * v.dt;
  }
  const found = directionChanges(heading, d.minDeg);
  const maxSteps = Math.floor(d.minDeg / d.minRateDegS / v.dt + 1e-9);
  const changes = found.map((c, j): GyroTurn => {
    const until = j + 1 < found.length ? found[j + 1].from : extremeAfter(heading, c.at, c.direction);
    const steps = fastestSteps(heading, c.from, until, c.direction, d.minDeg, maxSteps);
    return { ...c, until, fastestS: steps === null ? null : steps * v.dt, counted: steps !== null };
  });
  return { startMs: rec.header.clock.wallMs + (v.startUs + i0 * v.stepUs) / 1000, dt: v.dt, heading, rateDeg, changes };
};

/**
 * Virages du gyroscope de chaque vague, dans l'ordre des vagues ; `null` pour
 * une vague que la capture ne couvre pas en entier (elle garde ses virages du
 * GPS).
 */
export const gyroWaveTurns = (rec: ImuRecording, d: GyroTurnDetection, waves: readonly TurnWave[]): (number | null)[] => {
  const windows = capturedWindows(rec);
  return waves.map((wave) => {
    const trace = waveTurnTrace(rec, d, wave, windows);
    return trace ? trace.changes.filter((c) => c.counted).length : null;
  });
};
