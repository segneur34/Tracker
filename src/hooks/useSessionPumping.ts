import { errorMessage } from '../core/basics';
import { useEffect, useMemo, useState } from 'react';
import { decodeImu, type ImuRecording } from '../core/imuFile';
import { measureFlightPumping, summarizePumping, type FlightPumping, type FlightSpan, type PumpDetection } from '../core/pumping';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { hasSessionMotion, readSessionMotion, useLibrarySession } from './useSessionLibrary';

/**
 * Capteurs d'une session sur foil, surf ou voile, pour le pumping des vols
 * (`core/pumping.ts`) : son `.imu` lu et décodé à l'ouverture de l'analyse
 * (de l'onglet « pumping » en voile), si le pumping est coché.
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
        if (!cancelled) setState({ file, recording: null, error: errorMessage(err, 'Lecture des capteurs impossible.') });
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

/**
 * Pumping des vols (voile, surf), mesuré sur la capture lue par `useSessionPumping` :
 * par vol (`byFlight`, par numéro), son résumé, et les 3 plus longs vols
 * (`podium`), le haut de l'onglet. Il suit les vols, donc le seuil du brouillon.
 */
export const useFlightPumping = <F extends Pick<FlightSpan, 'n' | 'startMs' | 'endMs' | 'durationS'>>(
  recording: ImuRecording | null, detection: PumpDetection | null, track: TrackPoint[], cumulative: CumulativeTrack, flights: F[]
) => {
  const byFlight = useMemo(() => {
    if (!recording || !detection || flights.length === 0) return null;
    const list = measureFlightPumping(recording, detection, track, cumulative, flights);
    return new Map(list.flatMap((x): [number, FlightPumping][] => (x ? [[x.n, x]] : [])));
  }, [recording, detection, track, cumulative, flights]);
  const summary = useMemo(() => (byFlight ? summarizePumping([...byFlight.values()]) : null), [byFlight]);
  const podium = useMemo(() => [...flights].sort((a, b) => b.durationS - a.durationS).slice(0, 3), [flights]);
  return { byFlight, summary, podium };
};
