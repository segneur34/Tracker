import { decodeImu, encodeImu, selectImuWindows } from './imuFile';
import { pruneWindows, type JumpDetection } from './jumps';

/**
 * Élagage du `.imu` d'un enregistrement à son entrée dans la mémoire
 * (« Analyser », ou sortie de l'attente) : seules restent les mesures des
 * fenêtres autour des vols (`pruneWindows`), inscrites dans l'en-tête, et les
 * sauts calculés ensuite sont les mêmes. Un fichier illisible ou déjà élagué
 * est rendu tel quel. Une erreur remonte : l'appelant range alors la capture
 * complète, pour ne jamais perdre de mesure par erreur.
 */
export const pruneImuFile = async (bytes: Uint8Array, d: JumpDetection): Promise<Uint8Array> => {
  const recording = await decodeImu(bytes);
  if (!recording || recording.header.windows) return bytes;
  const selected = selectImuWindows(recording, pruneWindows(recording, d));
  return encodeImu(selected.header, selected.series, 1, true);
};
