import { useCallback, useMemo, useState } from 'react';
import { parseGpx } from '../core/gpxParser';
import { computeKinematics, detectTrackDeviceSpeedUnit, type KinematicsOptions } from '../core/kinematics';
import {
  referenceSpeedMs as sessionReferenceSpeedMs,
  samplingIntervalS,
  sessionFilterThresholds,
} from '../core/sessionSpeed';
import type { RawTrackPoint, TrackPoint } from '../core/types';

/**
 * Ingestion générique d'une trace GPX. Aucune notion de sport ici : le hook
 * lit le fichier, calcule la kinématique et s'arrête là. Chaque module de
 * support construit ensuite ses propres statistiques par-dessus.
 */

export interface GpxSessionOptions extends KinematicsOptions {
  /**
   * Accorde les seuils de filtrage à l'allure de la session plutôt que de
   * s'en tenir à ceux du support. Une accélération et un plafond calibrés pour
   * un support rapide laissent passer, sur une session lente, des pics
   * d'enregistrement qui fabriquent ensuite des manœuvres inexistantes.
   */
  scaleFiltersToSession?: boolean;
  /** Allure de session imposée par l'utilisateur, en m/s, au lieu de celle déduite. */
  referenceSpeedOverrideMs?: number;
}

export interface GpxSessionState {
  fileName: string | null;
  trackName: string | null;
  rawPoints: RawTrackPoint[];
  /** Vrai si la vitesse vient de l'appareil (Doppler) et non des positions. */
  hasDeviceSpeed: boolean;
  /** Message d'erreur de lecture, le cas échéant. */
  error: string | null;
}

const EMPTY_STATE: GpxSessionState = {
  fileName: null,
  trackName: null,
  rawPoints: [],
  hasDeviceSpeed: false,
  error: null,
};

/**
 * Seuls les points bruts sont conservés en état. La trace enrichie est
 * dérivée : changer une fenêtre de filtrage recalcule la kinématique sans
 * relire le fichier.
 */
export const useGpxSession = (kinematicsOptions: GpxSessionOptions = {}) => {
  const [session, setSession] = useState<GpxSessionState>(EMPTY_STATE);
  const {
    medianWindowSeconds,
    maxAcceleration,
    maxSpeedMs,
    forceDerivedSpeed,
    scaleFiltersToSession,
    referenceSpeedOverrideMs,
  } = kinematicsOptions;

  /**
   * Allure de la session, en m/s : déduite de la trace, ou imposée. Elle est
   * calculée sur les vitesses brutes, puisque c'est le filtrage qui en dépend.
   */
  const referenceSpeedMs = useMemo(
    () => referenceSpeedOverrideMs ?? sessionReferenceSpeedMs(session.rawPoints),
    [session.rawPoints, referenceSpeedOverrideMs]
  );

  const track: TrackPoint[] = useMemo(() => {
    // Sans mise à l'échelle, les seuils restent ceux qu'on a reçus : c'est le
    // comportement du module course, qu'on ne touche pas.
    const scaled = scaleFiltersToSession
      ? sessionFilterThresholds(referenceSpeedMs, maxSpeedMs ?? Infinity)
      : { maxAcceleration, maxSpeedMs };
    return computeKinematics(session.rawPoints, {
      medianWindowSeconds,
      maxAcceleration: scaled.maxAcceleration,
      maxSpeedMs: scaled.maxSpeedMs,
      forceDerivedSpeed,
    });
  }, [
    session.rawPoints,
    medianWindowSeconds,
    maxAcceleration,
    maxSpeedMs,
    forceDerivedSpeed,
    scaleFiltersToSession,
    referenceSpeedMs,
  ]);

  /** Intervalle médian entre deux points, en secondes : la cadence d'enregistrement. */
  const samplingS = useMemo(() => samplingIntervalS(session.rawPoints), [session.rawPoints]);

  /** Identité de la session : nom de trace et instant du premier point, pour y rattacher des notes ou forcer un remontage de carte. */
  const sessionKey = useMemo(() => {
    if (track.length === 0) return null;
    return `${session.trackName ?? session.fileName ?? 'session'}|${track[0].timeMs}`;
  }, [track, session.trackName, session.fileName]);

  /** Unité dans laquelle le fichier exprime la vitesse de l'appareil, si elle existe. */
  const deviceSpeedUnit = useMemo(() => detectTrackDeviceSpeedUnit(session.rawPoints), [session.rawPoints]);

  const loadGpxContent = useCallback((gpxContent: string, fileName: string | null = null) => {
    try {
      const { rawPoints, trackName, hasDeviceSpeed } = parseGpx(gpxContent);
      setSession({
        fileName,
        trackName: trackName ?? null,
        rawPoints,
        hasDeviceSpeed,
        error: rawPoints.length < 2 ? 'Le fichier ne contient pas assez de points horodatés.' : null,
      });
    } catch (err) {
      setSession({
        ...EMPTY_STATE,
        fileName,
        error: err instanceof Error ? err.message : 'Lecture du fichier impossible.',
      });
    }
  }, []);

  const reset = useCallback(() => setSession(EMPTY_STATE), []);

  return {
    ...session,
    track,
    referenceSpeedMs,
    samplingS,
    sessionKey,
    deviceSpeedUnit,
    hasTrack: track.length > 0,
    loadGpxContent,
    reset,
  };
};
