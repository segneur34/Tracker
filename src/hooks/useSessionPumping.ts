import { useEffect, useState } from 'react';
import { decodeImu, type ImuRecording } from '../core/imuFile';
import { hasSessionMotion, readSessionMotion, useLibrarySession } from './useSessionLibrary';

/**
 * Capteurs d'une session de surf, pour le pumping des vols (`surfing/pumping.ts`) :
 * son `.imu` lu et décodé à l'ouverture de l'analyse, si le pumping est coché.
 * Le pumping se recalcule à chaque seuil (il suit les vols) : rien n'est rangé
 * dans la fiche. Un seul fichier gardé en mémoire, celui de la session
 * ouverte, et libéré dès que plus aucune analyse ne le lit (27/10) : une
 * capture décodée pèse des dizaines de Mo.
 */

/**
 * `none` : pas de capteurs pour cette session, ou pumping décoché ;
 * `loading` : lecture en cours ; `ready` : mesures disponibles ; `error` :
 * lecture impossible (`error` en dit la raison).
 */
export type PumpingStatus = 'none' | 'loading' | 'ready' | 'error';

let cached: { file: string; recording: ImuRecording } | null = null;
let loading: { file: string; promise: Promise<ImuRecording> } | null = null;
/** Analyses montées qui lisent la capture : à zéro, elle est libérée. */
let readers = 0;

const load = (file: string): Promise<ImuRecording> => {
  if (loading?.file === file) return loading.promise;
  const promise = (async () => {
    const bytes = await readSessionMotion(file);
    if (!bytes) throw new Error('Fichier des capteurs introuvable.');
    const recording = await decodeImu(bytes);
    if (!recording) throw new Error('Fichier des capteurs illisible.');
    cached = { file, recording };
    return recording;
  })().finally(() => {
    if (loading?.file === file) loading = null;
  });
  loading = { file, promise };
  return promise;
};

export const useSessionPumping = (file: string | null, enabled: boolean) => {
  const session = useLibrarySession(file);
  const motion = file !== null && session !== undefined && hasSessionMotion(file);
  const wanted = enabled && motion && file !== null;
  const [state, setState] = useState<{ file: string; recording: ImuRecording | null; error: string | null } | null>(null);
  const hit = wanted && cached?.file === file ? cached.recording : null;

  useEffect(() => {
    readers++;
    return () => {
      readers--;
      if (readers === 0) cached = null;
    };
  }, []);

  useEffect(() => {
    if (!wanted || file === null || hit) return;
    let cancelled = false;
    load(file).then(
      (recording) => {
        if (!cancelled) setState({ file, recording, error: null });
      },
      (err: unknown) => {
        if (!cancelled) setState({ file, recording: null, error: err instanceof Error ? err.message : 'Lecture des capteurs impossible.' });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, file, hit]);

  const mine = state !== null && state.file === file ? state : null;
  const recording = wanted ? hit ?? mine?.recording ?? null : null;
  const error = wanted ? mine?.error ?? null : null;
  const status: PumpingStatus = !wanted ? 'none' : recording ? 'ready' : error ? 'error' : 'loading';
  return { status, recording, error, hasMotion: motion };
};
