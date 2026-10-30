import { errorMessage } from '../core/basics';
import { useCallback, useMemo, useState } from 'react';
import { parseGpx } from '../core/gpxParser';
import { computeKinematics, detectTrackDeviceSpeedUnit } from '../core/kinematics';
import {
  referenceSpeedMs as sessionReferenceSpeedMs,
  kinematicsOptionsOf,
  samplingIntervalS,
  scalesFiltersToSession,
  type KinematicsProfile,
} from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import type { RawTrackPoint, TrackPoint } from '../core/types';

/**
 * Ingestion générique d'une trace GPX. Aucune notion de sport ici : le hook
 * lit le fichier, calcule la kinématique et s'arrête là. Chaque module de
 * support construit ensuite ses propres statistiques par-dessus.
 */

export interface GpxSessionOptions {
  /**
   * Profil du calcul de la session : ses filtres (`kinematicsOptionsOf`),
   * accordés en voile à l'allure de la session (`scalesFiltersToSession`),
   * comme le résumé de la bibliothèque. Absent : aucun filtre.
   */
  profile?: KinematicsProfile;
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
  const { profile, referenceSpeedOverrideMs } = kinematicsOptions;

  /** Unité dans laquelle le fichier exprime la vitesse de l'appareil, si elle existe : détectée une fois, pour l'allure aussi. */
  const deviceSpeedUnit = useMemo(() => detectTrackDeviceSpeedUnit(session.rawPoints), [session.rawPoints]);

  /**
   * Allure de la session, en m/s : déduite de la trace, ou imposée. Elle est
   * calculée sur les vitesses brutes, puisque c'est le filtrage qui en dépend.
   */
  const referenceSpeedMs = useMemo(
    () => referenceSpeedOverrideMs ?? sessionReferenceSpeedMs(session.rawPoints, deviceSpeedUnit),
    [session.rawPoints, referenceSpeedOverrideMs, deviceSpeedUnit]
  );

  const track: TrackPoint[] = useMemo(
    () => computeKinematics(
      session.rawPoints,
      profile ? kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs: referenceSpeedMs }) : {}
    ),
    [session.rawPoints, profile, referenceSpeedMs]
  );

  /** Distance et temps cumulés le long de la trace, calculés une fois par trace pour tout le module. */
  const cumulative = useMemo(() => buildCumulativeTrack(track), [track]);

  /** Intervalle médian entre deux points, en secondes : la cadence d'enregistrement. */
  const samplingS = useMemo(() => samplingIntervalS(session.rawPoints), [session.rawPoints]);

  /** Identité de la trace chargée : nom de trace et instant du premier point. Clé de remontage de la carte, et marque d'une nouvelle trace. */
  const sessionKey = useMemo(() => {
    if (track.length === 0) return null;
    return `${session.trackName ?? session.fileName ?? 'session'}|${track[0].timeMs}`;
  }, [track, session.trackName, session.fileName]);

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
        error: errorMessage(err, 'Lecture du fichier impossible.'),
      });
    }
  }, []);

  return {
    ...session,
    track,
    cumulative,
    referenceSpeedMs,
    samplingS,
    sessionKey,
    deviceSpeedUnit,
    loadGpxContent,
  };
};
