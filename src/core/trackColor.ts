import { meanFilterByTime } from './speedFilter';
import { speedGradientColor, type SpeedRangeMs } from './speedGradient';
import type { Treatment } from './sportProfiles';
import type { TrackPoint } from './types';

/**
 * Couleur de la trace par la vitesse, la même dans l'analyse et dans la
 * vignette de la bibliothèque : une seule fonction, pour qu'une session ait
 * une seule coloration.
 */

/**
 * Lissage de la vitesse de couleur, en secondes, par traitement. À pied et à
 * vélo, le GPS tremble à basse vitesse et la trace se bariolerait : une
 * moyenne de 15 s la rend lisible. En voile, la vitesse lissée du noyau
 * suffit, et une moyenne effacerait les accélérations courtes.
 */
export const TRACK_COLOR_SMOOTHING_S: Record<Treatment, number> = {
  voile: 0,
  course: 15,
  velo: 15,
};

/** Vitesse de couleur de chaque point, en m/s. */
export const trackColorSpeedsMs = (track: readonly TrackPoint[], treatment: Treatment): number[] => {
  const speeds = track.map((p) => p.smoothedSpeedMs);
  const windowS = TRACK_COLOR_SMOOTHING_S[treatment];
  return windowS > 0 ? meanFilterByTime(speeds, track.map((p) => p.timeMs), windowS) : speeds;
};

/** Un trait de la trace : deux points consécutifs et leur couleur (`TrackSegmentsLayer`). */
export interface ColoredSegment {
  positions: [[number, number], [number, number]];
  color: string;
}

/**
 * Traits d'une suite de points déjà munis de leur vitesse de couleur
 * (`trackColorSpeedsMs`), un par paire de points consécutifs, à la couleur du
 * point d'arrivée. La vignette y passe ses points échantillonnés : la vitesse
 * ayant été lissée sur la trace entière, la couleur ne dépend pas de
 * l'échantillonnage.
 */
export const coloredSegments = (
  points: readonly { lat: number; lon: number; colorMs: number }[],
  range: SpeedRangeMs
): ColoredSegment[] => {
  const segments: ColoredSegment[] = [];
  for (let k = 1; k < points.length; k++) {
    const from = points[k - 1];
    const to = points[k];
    segments.push({
      positions: [[from.lat, from.lon], [to.lat, to.lon]],
      color: speedGradientColor(to.colorMs, range.minMs, range.maxMs),
    });
  }
  return segments;
};

/** Traits de la trace colorée par la vitesse, comme l'analyse la dessine. */
export const trackColorSegments = (
  track: readonly TrackPoint[],
  treatment: Treatment,
  range: SpeedRangeMs
): ColoredSegment[] => {
  const speeds = trackColorSpeedsMs(track, treatment);
  return coloredSegments(track.map((p, i) => ({ lat: p.lat, lon: p.lon, colorMs: speeds[i] })), range);
};
