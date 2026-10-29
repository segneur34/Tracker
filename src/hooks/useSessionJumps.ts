import { errorMessage } from '../core/basics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeImu } from '../core/imuFile';
import { JUMPS_CALC_VERSION, measureJumps, toSessionJump, type JumpDetection, type SessionJump } from '../core/jumps';
import type { Activity } from '../core/activities';
import { getSportProfile, type SportProfile } from '../core/sportProfiles';
import type { SportType, TrackPoint } from '../core/types';
import { effectiveJumpSettings } from './useSportSettings';
import { hasSessionMotion, librarySession, readSessionMotion, updateSessionRecord, useLibrarySession } from './useSessionLibrary';

/**
 * Sauts d'une session (voile, course, vélo ; `core/jumps.ts`) : ceux de sa fiche s'ils sont
 * à jour, sinon calculés depuis son `.imu` à l'ouverture de l'analyse, puis
 * rangés dans la fiche (hors brouillon : ce n'est pas une saisie). Une session
 * sans `.imu` ni sauts rangés n'en a pas : l'onglet « sauts » ne paraît pas.
 */

/**
 * Sauts calculés pendant ce lancement, par session et instant du premier point (fiche en lecture seule comprise) ;
 * `null` : la capture ne mesurait pas les sauts (cadence seule).
 */
const computed = new Map<string, SessionJump[] | null>();
/** Calculs en cours, un seul par session. */
const searching = new Map<string, Promise<SessionJump[] | null>>();

/**
 * `none` : pas de mesure des sauts pour cette session ; `computing` : calcul
 * en cours ; `ready` : sauts connus (liste éventuellement vide) ; `error` :
 * calcul impossible (`error` en dit la raison).
 */
export type JumpsStatus = 'none' | 'computing' | 'ready' | 'error';

/** Laisse la page se dessiner avant un calcul de quelques dixièmes de seconde. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const compute = (key: string, file: string, track: TrackPoint[], detection: JumpDetection): Promise<SessionJump[] | null> => {
  let pending = searching.get(key);
  if (!pending) {
    pending = (async () => {
      await nextFrame();
      const bytes = await readSessionMotion(file);
      if (!bytes) throw new Error('Fichier des capteurs introuvable.');
      const recording = await decodeImu(bytes);
      if (!recording) throw new Error('Fichier des capteurs illisible.');
      // Capture de la seule cadence : pas de sauts à chercher, et la fiche le retient.
      const measured = recording.header.setup.jumps !== false;
      const jumps = measured ? measureJumps(recording, detection, track).jumps.map(toSessionJump) : [];
      computed.set(key, measured ? jumps : null);
      const session = librarySession(file);
      if (session && !session.readOnly) {
        updateSessionRecord(file, {
          jumps: { version: JUMPS_CALC_VERSION, computedAt: new Date().toISOString(), jumps, ...(measured ? {} : { measured: false as const }) },
        });
      }
      return measured ? jumps : null;
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
  const notMeasured = stored?.measured === false || (key !== null && computed.get(key) === null);
  const current = stored && stored.version >= JUMPS_CALC_VERSION && stored.measured !== false ? stored.jumps : null;
  const local = key !== null ? computed.get(key) ?? undefined : undefined;
  const motion = file !== null && hasSessionMotion(file);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [, setComputedCount] = useState(computed.size);
  const failed = failure !== null && failure.key === key ? failure.message : null;
  const eligible = key !== null && detection !== null && session !== undefined && motion && !current && !local && !notMeasured && failed === null;
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
        if (!cancelled) setFailure({ key, message: errorMessage(err, 'Calcul des sauts impossible.') });
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

/** Surbrillance de l'onglet « sauts » : un saut par l'heure de son décollage, ou le podium (`podium`). */
export interface JumpsHighlight {
  shownIn: (panel: 'sauts') => string | null;
  show: (panel: 'sauts', key: string | null) => void;
}

/**
 * Sauts d'une analyse (voile, course, vélo) : ceux de la session (`useSessionJumps`)
 * montrés à la hauteur minimale de l'activité, pris au seuil d'activité ou plus,
 * et leur surbrillance sur la carte. L'onglet « sauts » ne paraît que si la
 * session en a (`visible`).
 */
export const useShownJumps = ({ file, track, profile, activity, thresholdMs, highlight }: {
  file: string | null;
  track: TrackPoint[];
  profile: Pick<SportProfile, 'id' | 'jumps'>;
  activity: Activity;
  /** Seuil d'activité de la session, en m/s. */
  thresholdMs: number;
  highlight: JumpsHighlight;
}) => {
  const state = useSessionJumps(file, track, profile.id);
  const minHeightM = effectiveJumpSettings(activity)?.minHeightM ?? profile.jumps?.defaultMinHeightM ?? 0;
  /** Sauts montrés : la hauteur minimale de l'activité atteinte, pris au seuil d'activité ou plus. */
  const jumps = useMemo(
    () => state.jumps.filter((j) => j.heightM >= minHeightM && (j.speedMs === null || j.speedMs >= thresholdMs)),
    [state.jumps, minHeightM, thresholdMs]
  );
  const shownKey = highlight.shownIn('sauts');
  const podiumShown = shownKey === 'podium';
  /** Saut montré, par l'heure de son décollage. */
  const shownJump = shownKey !== null && !podiumShown ? Number(shownKey) : null;
  const { show } = highlight;
  const showJump = useCallback((takeoffMs: number | null) => show('sauts', takeoffMs === null ? null : String(takeoffMs)), [show]);
  const togglePodium = useCallback(() => show('sauts', podiumShown ? null : 'podium'), [show, podiumShown]);
  return {
    status: state.status, error: state.error, jumps, hiddenCount: state.jumps.length - jumps.length, minHeightM,
    visible: state.status !== 'none', shownJump, podiumShown, showJump, togglePodium,
  };
};
