import type { ImuRecording } from '../core/imuFile';
import { pruneImu } from '../core/imuPrune';
import { captureBounds, fileUsOf, mergeWindows, type ImuWindow } from '../core/imuVertical';
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
 * la capture. Une capture déjà élaguée rend ses fenêtres.
 */
export const surfPruneWindows = (rec: ImuRecording, rides: Pick<SurfSpan, 'startMs' | 'endMs'>[], marginS: number): ImuWindow[] => {
  if (rec.header.windows) return rec.header.windows;
  const bounds = captureBounds(rec);
  if (!bounds) return [];
  const windows: ImuWindow[] = [];
  for (const r of rides) {
    const a = Math.max(bounds[0], fileUsOf(rec, r.startMs - marginS * 1000));
    const b = Math.min(bounds[1], fileUsOf(rec, r.endMs + marginS * 1000));
    if (a < b) windows.push([a, b]);
  }
  return mergeWindows(windows);
};

/**
 * Élagage du `.imu` d'un enregistrement de surf à son entrée dans la mémoire.
 * Un fichier illisible ou déjà élagué est rendu tel quel ; une erreur remonte
 * (l'appelant range alors la capture complète).
 */
export const pruneSurfImu = (bytes: Uint8Array, rides: Pick<SurfSpan, 'startMs' | 'endMs'>[], marginS: number): Promise<Uint8Array> =>
  pruneImu(bytes, (recording) => surfPruneWindows(recording, rides, marginS));
