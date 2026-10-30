import { useEffect } from 'react';
import { decodeImu, type ImuRecording } from '../core/imuFile';
import { readSessionMotion } from './useSessionLibrary';

/**
 * Capteurs d'une session (`.imu`) lus et décodés une seule fois pour les
 * sauts et le pumping. Un seul fichier gardé en mémoire, celui de la session
 * ouverte, et libéré dès que plus aucune analyse ne le lit (27/10) : une
 * capture décodée pèse des dizaines de Mo.
 */

let cached: { file: string; recording: ImuRecording } | null = null;
let loading: { file: string; promise: Promise<ImuRecording> } | null = null;
/** Analyses montées qui lisent la capture : à zéro, elle est libérée. */
let readers = 0;

/** Capture décodée gardée en mémoire pour ce fichier, sinon `null`. */
export const cachedSessionMotion = (file: string): ImuRecording | null => (cached?.file === file ? cached.recording : null);

/** Lit et décode le `.imu` d'une session, ou rend celui déjà décodé ; une seule lecture à la fois par fichier. */
export const loadSessionMotion = (file: string): Promise<ImuRecording> => {
  const hit = cachedSessionMotion(file);
  if (hit) return Promise.resolve(hit);
  if (loading?.file === file) return loading.promise;
  const promise = (async () => {
    const bytes = await readSessionMotion(file);
    if (!bytes) throw new Error('Fichier des capteurs introuvable.');
    const recording = await decodeImu(bytes);
    if (!recording) throw new Error('Fichier des capteurs illisible.');
    // Plus aucune analyse ne lit la capture (page quittée pendant la lecture) : elle n'est pas gardée.
    if (readers > 0) cached = { file, recording };
    return recording;
  })().finally(() => {
    if (loading?.file === file) loading = null;
  });
  loading = { file, promise };
  return promise;
};

/** Tient la capture en mémoire tant que l'analyse qui l'appelle est montée. */
export const useSessionMotionReader = (): void => {
  useEffect(() => {
    readers++;
    return () => {
      readers--;
      if (readers === 0) cached = null;
    };
  }, []);
};
