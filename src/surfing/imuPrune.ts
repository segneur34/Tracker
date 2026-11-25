import type { ImuRecording } from '../core/imuFile';
import { pruneImu } from '../core/imuPrune';
import { fileUsOf, measuredPieces, mergeWindows, type ImuWindow } from '../core/imuVertical';
import type { SurfSpan } from './surfAnalysis';

/**
 * Élagage du `.imu` d'une session de surf autour de ses glisses (point 104),
 * propre au surf (l'enveloppe commune est `pruneImu`) ; la mesure du pumping,
 * commune au surf et à la voile, est dans `core/pumping.ts`. Instants du
 * fichier en µs, heures en ms.
 */

/**
 * Fenêtres à garder d'une capture de surf : `marginS` de part et d'autre de
 * chaque glisse (vol, ou vague sans foil), fusionnées et rognées aux bords de
 * leur morceau de capture (`measuredPieces`, coupée aux silences de plus de
 * `breakS` secondes) : une glisse à cheval sur le trou d'une capture reprise
 * après une coupure donne une fenêtre de chaque côté, aucune à travers. Une
 * capture déjà élaguée rend ses fenêtres.
 */
export const surfPruneWindows = (
  rec: ImuRecording, rides: Pick<SurfSpan, 'startMs' | 'endMs'>[], marginS: number, breakS: number
): ImuWindow[] => {
  if (rec.header.windows) return rec.header.windows;
  const windows: ImuWindow[] = [];
  for (const [first, last] of measuredPieces(rec, breakS)) {
    for (const r of rides) {
      const a = Math.max(first, fileUsOf(rec, r.startMs - marginS * 1000));
      const b = Math.min(last, fileUsOf(rec, r.endMs + marginS * 1000));
      if (a < b) windows.push([a, b]);
    }
  }
  return mergeWindows(windows);
};

/**
 * Élagage du `.imu` d'un enregistrement de surf à son entrée dans la mémoire.
 * Un fichier illisible ou déjà élagué est rendu tel quel ; une erreur remonte
 * (l'appelant range alors la capture complète).
 */
export const pruneSurfImu = (
  bytes: Uint8Array, rides: Pick<SurfSpan, 'startMs' | 'endMs'>[], marginS: number, breakS: number
): Promise<Uint8Array> =>
  pruneImu(bytes, (recording) => surfPruneWindows(recording, rides, marginS, breakS));
