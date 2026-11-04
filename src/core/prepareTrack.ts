import { parseGpx } from './gpxParser';
import { computeKinematics, detectTrackDeviceSpeedUnit, type DeviceSpeedUnit } from './kinematics';
import {
  referenceSpeedMs as sessionReferenceSpeedMs,
  kinematicsOptionsOf,
  samplingIntervalS,
  scalesFiltersToSession,
  type KinematicsProfile,
} from './sessionSpeed';
import { buildCumulativeTrack } from './sessionStats';
import type { CumulativeTrack, RawTrackPoint, TrackPoint } from './types';

/**
 * Préparation d'une trace pour l'analyse (lot 126 B) : la lecture du GPX et
 * la cinématique que `useGpxSession` dérivait en `useMemo`, en une fonction
 * pure, appelée hors du fil de l'affichage (`library/trackWorker.ts`) ou en
 * ligne, avec les mêmes chiffres. Aucune notion de sport ici, au-delà des
 * filtres du profil.
 */

export interface PrepareTrackOptions {
  /** Fichier de la session, pour la clé de la trace quand le GPX n'a pas de nom. */
  fileName?: string | null;
  /**
   * Profil du calcul de la session : ses filtres (`kinematicsOptionsOf`),
   * accordés en voile à l'allure de la session (`scalesFiltersToSession`),
   * comme le résumé de la bibliothèque. Absent : aucun filtre. Réduit aux
   * champs des filtres (`kinematicsProfileOf`) : il traverse un message.
   */
  profile?: KinematicsProfile;
  /** Allure de session imposée par l'utilisateur, en m/s, au lieu de celle déduite. */
  referenceSpeedOverrideMs?: number;
}

/** Ce que la trace lue donne à l'analyse : des objets simples, sans fonction ni classe (clonage structuré). */
export interface PreparedTrack {
  trackName: string | null;
  rawPoints: RawTrackPoint[];
  /** Vrai si la vitesse vient de l'appareil (Doppler) et non des positions. */
  hasDeviceSpeed: boolean;
  /** Unité dans laquelle le fichier exprime la vitesse de l'appareil, si elle existe. */
  deviceSpeedUnit: DeviceSpeedUnit | null;
  /** Allure de la session, en m/s : imposée, sinon déduite des vitesses brutes. */
  referenceSpeedMs: number;
  track: TrackPoint[];
  /** Distance et temps cumulés le long de la trace. */
  cumulative: CumulativeTrack;
  /** Intervalle médian entre deux points, en secondes : la cadence d'enregistrement. */
  samplingS: number;
  /** Identité de la trace : nom de trace (sinon du fichier) et instant du premier point ; `null` sans point. */
  sessionKey: string | null;
}

/** Champs des filtres de la cinématique, seuls lus d'un profil : un objet simple, qui traverse un message. */
export const kinematicsProfileOf = (profile: KinematicsProfile): KinematicsProfile => ({
  id: profile.id,
  medianWindowSeconds: profile.medianWindowSeconds,
  maxDetourRatio: profile.maxDetourRatio,
  maxPlausibleSpeedMs: profile.maxPlausibleSpeedMs,
  maxGapS: profile.maxGapS,
});

/**
 * Cinématique de points déjà lus : unité de la vitesse de l'appareil, allure
 * (imposée, sinon déduite des vitesses brutes, puisque le filtrage en
 * dépend), trace filtrée, cumuls, cadence et clé.
 */
export const prepareRawTrack = (
  rawPoints: RawTrackPoint[],
  { trackName, hasDeviceSpeed }: { trackName: string | null; hasDeviceSpeed: boolean },
  { fileName = null, profile, referenceSpeedOverrideMs }: PrepareTrackOptions = {}
): PreparedTrack => {
  const deviceSpeedUnit = detectTrackDeviceSpeedUnit(rawPoints);
  const referenceSpeedMs = referenceSpeedOverrideMs ?? sessionReferenceSpeedMs(rawPoints, deviceSpeedUnit);
  const track = computeKinematics(
    rawPoints,
    profile ? kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs: referenceSpeedMs }) : {}
  );
  return {
    trackName,
    rawPoints,
    hasDeviceSpeed,
    deviceSpeedUnit,
    referenceSpeedMs,
    track,
    cumulative: buildCumulativeTrack(track),
    samplingS: samplingIntervalS(rawPoints),
    sessionKey: track.length === 0 ? null : `${trackName ?? fileName ?? 'session'}|${track[0].timeMs}`,
  };
};

/** Lit un GPX et prépare sa trace (`prepareRawTrack`). Lève la même erreur que `parseGpx` sur un XML illisible. */
export const prepareTrack = (gpxText: string, options: PrepareTrackOptions = {}): PreparedTrack => {
  const { rawPoints, trackName, hasDeviceSpeed } = parseGpx(gpxText);
  return prepareRawTrack(rawPoints, { trackName: trackName ?? null, hasDeviceSpeed }, options);
};
