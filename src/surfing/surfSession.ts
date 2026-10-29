import { computeActivityMask } from '../core/sessionStats';
import { getActiveThresholds, type SportProfile, type SurfProfile } from '../core/sportProfiles';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { fromDisplaySpeed } from '../core/units';
import { analyzeSurf, summarizeSurf, type SurfAnalysis, type SurfSummary } from './surfAnalysis';

/**
 * Analyse d'une session de surf telle que la page et le résumé de la
 * bibliothèque la font, pour qu'ils donnent les mêmes chiffres : masques aux
 * seuils de la session, avec l'hystérésis du profil, puis découpage.
 */

/** Réglages effectifs d'une session, dans l'unité des seuils du profil (`thresholdUnit`). */
export interface SurfSessionSettings {
  /** Seuil de la glisse : de vague sans foil, de vol sur foil. */
  threshold: number;
  foil: boolean;
  /** Seuil de vague sur foil ; `null` : celui du profil. Ignoré sans foil. */
  waveThreshold: number | null;
}

export interface SurfSessionResult {
  /** Masque au seuil de la glisse : la vague, ou le vol sur foil. */
  rideMask: boolean[];
  analysis: SurfAnalysis;
  summary: SurfSummary;
}

const maskAt = (track: TrackPoint[], profile: SportProfile, threshold: number): boolean[] => {
  const { enter, exit } = getActiveThresholds(profile, threshold);
  const exitThresholdMs = fromDisplaySpeed(exit, profile.thresholdUnit);
  return computeActivityMask(track, {
    enterThresholdMs: fromDisplaySpeed(enter, profile.thresholdUnit),
    exitThresholdMs,
    minStateDurationS: profile.minStateDurationS,
    // Un trou de la trace (téléphone sous l'eau) n'est en glisse que s'il avance à la détente basse.
    gapMinSpeedMs: exitThresholdMs,
  });
};

/** Seuil de vague sur foil effectif, dans l'unité du profil. */
export const effectiveWaveThreshold = (surf: SurfProfile, waveThreshold: number | null): number =>
  waveThreshold ?? surf.foilWaveThreshold;

export const runSurfSession = (
  track: TrackPoint[], cum: CumulativeTrack, profile: SportProfile & { surf: SurfProfile }, settings: SurfSessionSettings
): SurfSessionResult => {
  const rideMask = maskAt(track, profile, settings.threshold);
  const waveMask = settings.foil ? maskAt(track, profile, effectiveWaveThreshold(profile.surf, settings.waveThreshold)) : null;
  const analysis = analyzeSurf(track, cum, rideMask, waveMask, { ...profile.surf, maxGapS: profile.maxGapS });
  return { rideMask, analysis, summary: summarizeSurf(track, cum, analysis, profile.surf.stillMs) };
};

/** Profil d'un calcul de surf, ou `null` pour un autre calcul. */
export const surfProfileOf = (profile: SportProfile): (SportProfile & { surf: SurfProfile }) | null =>
  profile.surf ? (profile as SportProfile & { surf: SurfProfile }) : null;
