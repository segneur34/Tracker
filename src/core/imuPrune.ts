import { decodeImu, encodeImu, selectImuWindows, type ImuRecording } from './imuFile';
import type { ImuWindow } from './imuVertical';
import { pruneWindows, type JumpDetection } from './jumps';

/**
 * Élagage d'un `.imu` à son entrée dans la mémoire : seules restent les
 * mesures des fenêtres données par `windowsOf`, inscrites dans l'en-tête. Un
 * fichier illisible ou déjà élagué est rendu tel quel. Une erreur remonte :
 * l'appelant range alors la capture complète, pour ne jamais perdre de mesure
 * par erreur.
 */
export const pruneImu = async (bytes: Uint8Array, windowsOf: (recording: ImuRecording) => ImuWindow[]): Promise<Uint8Array> => {
  const recording = await decodeImu(bytes);
  if (!recording || recording.header.windows) return bytes;
  const selected = selectImuWindows(recording, windowsOf(recording));
  return encodeImu(selected.header, selected.series, 1, true);
};

/**
 * Élagage du `.imu` d'un enregistrement (« Analyser », ou sortie de
 * l'attente) autour des vols (`pruneWindows`) : les sauts calculés ensuite
 * sont les mêmes.
 */
export const pruneImuFile = (bytes: Uint8Array, d: JumpDetection): Promise<Uint8Array> =>
  pruneImu(bytes, (recording) => pruneWindows(recording, d));
