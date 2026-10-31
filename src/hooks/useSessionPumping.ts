import { errorMessage } from '../core/basics';
import { useEffect, useMemo, useState } from 'react';
import type { ImuRecording } from '../core/imuFile';
import {
  longestPumpSeries, measureFlightPumping, sessionPumpSeries, summarizePumping, type FlightPumping, type FlightSpan, type PumpDetection, type PumpingSeries,
} from '../core/pumping';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { cachedSessionMotion, loadSessionMotion, useSessionMotionReader } from './sessionMotion';
import { hasSessionMotion, useLibrarySession } from './useSessionLibrary';

/**
 * Capteurs d'une session sur foil, surf ou voile, pour le pumping des vols
 * (`core/pumping.ts`) : son `.imu` lu et décodé à l'ouverture de l'analyse
 * (de l'onglet « pumping » en voile), si le pumping est coché.
 * Le pumping se recalcule à chaque seuil (il suit les vols) : rien n'est rangé
 * dans la fiche. La capture est partagée avec les sauts (`loadSessionMotion`).
 */

/**
 * `none` : pas de capteurs pour cette session, ou pumping décoché ;
 * `loading` : lecture en cours ; `ready` : mesures disponibles ; `error` :
 * lecture impossible (`error` en dit la raison).
 */
export type PumpingStatus = 'none' | 'loading' | 'ready' | 'error';

export const useSessionPumping = (file: string | null, enabled: boolean) => {
  const session = useLibrarySession(file);
  const motion = file !== null && session !== undefined && hasSessionMotion(file);
  const wanted = enabled && motion && file !== null;
  const [state, setState] = useState<{ file: string; recording: ImuRecording | null; error: string | null } | null>(null);
  useSessionMotionReader();
  const hit = wanted ? cachedSessionMotion(file) : null;

  useEffect(() => {
    if (!wanted || file === null || hit) return;
    let cancelled = false;
    loadSessionMotion(file).then(
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

/** Aucune série : la même liste d'un rendu à l'autre. */
const NO_SERIES: PumpingSeries[] = [];

/**
 * Pumping des vols (voile, surf), mesuré sur la capture lue par `useSessionPumping` :
 * par vol (`byFlight`, par numéro), son résumé, les séries de coups de la
 * session, numérotées dans l'ordre (`series`), et les 3 plus longues
 * (`seriesPodium`), le haut de l'onglet ; les 3 plus longs vols (`podium`).
 * Il suit les vols, donc le seuil du brouillon.
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
  const series = useMemo(() => (byFlight ? sessionPumpSeries([...byFlight.values()]) : NO_SERIES), [byFlight]);
  const seriesPodium = useMemo(() => longestPumpSeries(series, 3), [series]);
  const podium = useMemo(() => [...flights].sort((a, b) => b.durationS - a.durationS).slice(0, 3), [flights]);
  return { byFlight, summary, series, seriesPodium, podium };
};
