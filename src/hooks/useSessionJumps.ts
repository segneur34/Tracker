import { useEffect, useState } from 'react';
import { decodeImu } from '../core/imuFile';
import { JUMPS_CALC_VERSION, measureJumps, toSessionJump, type JumpDetection, type SessionJump } from '../core/jumps';
import { getSportProfile } from '../core/sportProfiles';
import type { SportType, TrackPoint } from '../core/types';
import { hasSessionMotion, librarySession, readSessionMotion, updateSessionRecord, useLibrarySession } from './useSessionLibrary';

/**
 * Sauts d'une session de voile (`core/jumps.ts`) : ceux de sa fiche s'ils sont
 * à jour, sinon calculés depuis son `.imu` à l'ouverture de l'analyse, puis
 * rangés dans la fiche (hors brouillon : ce n'est pas une saisie). Une session
 * sans `.imu` ni sauts rangés n'en a pas : l'onglet « sauts » ne paraît pas.
 */

/** Sauts calculés pendant ce lancement, par session et instant du premier point (fiche en lecture seule comprise). */
const computed = new Map<string, SessionJump[]>();
/** Calculs en cours, un seul par session. */
const searching = new Map<string, Promise<SessionJump[]>>();

/**
 * `none` : pas de mesure des sauts pour cette session ; `computing` : calcul
 * en cours ; `ready` : sauts connus (liste éventuellement vide) ; `error` :
 * calcul impossible (`error` en dit la raison).
 */
export type JumpsStatus = 'none' | 'computing' | 'ready' | 'error';

/** Laisse la page se dessiner avant un calcul de quelques dixièmes de seconde. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const compute = (key: string, file: string, track: TrackPoint[], detection: JumpDetection): Promise<SessionJump[]> => {
  let pending = searching.get(key);
  if (!pending) {
    pending = (async () => {
      await nextFrame();
      const bytes = await readSessionMotion(file);
      if (!bytes) throw new Error('Fichier des capteurs introuvable.');
      const recording = await decodeImu(bytes);
      if (!recording) throw new Error('Fichier des capteurs illisible.');
      const jumps = measureJumps(recording, detection, track).jumps.map(toSessionJump);
      computed.set(key, jumps);
      const session = librarySession(file);
      if (session && !session.readOnly) {
        updateSessionRecord(file, { jumps: { version: JUMPS_CALC_VERSION, computedAt: new Date().toISOString(), jumps } });
      }
      return jumps;
    })().finally(() => searching.delete(key));
    searching.set(key, pending);
  }
  return pending;
};

export const useSessionJumps = (file: string | null, track: TrackPoint[], sport: SportType) => {
  const session = useLibrarySession(file);
  const detection = getSportProfile(sport).jumps?.detection ?? null;
  const key = file !== null && track.length > 1 ? `${file}|${track[0].timeMs}` : null;
  const stored = session?.record.jumps;
  const current = stored && stored.version >= JUMPS_CALC_VERSION ? stored.jumps : null;
  const local = key !== null ? computed.get(key) : undefined;
  const motion = file !== null && hasSessionMotion(file);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [, setComputedCount] = useState(computed.size);
  const failed = failure !== null && failure.key === key ? failure.message : null;
  const eligible = key !== null && detection !== null && session !== undefined && motion && !current && !local && failed === null;
  // Fiche allégée, pas encore relue en entier : elle porte peut-être déjà les sauts, rien n'est calculé avant.
  const wanted = eligible && session?.partial !== true;

  useEffect(() => {
    if (!wanted || key === null || file === null || detection === null) return;
    let cancelled = false;
    compute(key, file, track, detection).then(
      () => {
        if (!cancelled) setComputedCount(computed.size);
      },
      (err: unknown) => {
        if (!cancelled) setFailure({ key, message: err instanceof Error ? err.message : 'Calcul des sauts impossible.' });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, key, file, detection, track]);

  const jumps = current ?? local ?? null;
  const status: JumpsStatus = jumps !== null ? 'ready' : failed !== null ? 'error' : eligible ? 'computing' : 'none';
  return { status, jumps: jumps ?? [], error: failed };
};
