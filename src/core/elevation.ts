import { linearSmoothByTime } from './speedFilter';
import type { ElevationProfile } from './sportProfiles';
import type { TrackPoint } from './types';

/**
 * Dénivelé à partir de l'altitude enregistrée.
 *
 * L'altitude GPS est très bruitée, et l'altitude barométrique dérive. Une
 * somme naïve des écarts positifs entre points consécutifs peut doubler le
 * dénivelé réel. Deux protections, dans cet ordre :
 *
 * 1. un lissage passe-bas sur une fenêtre temporelle, par ajustement linéaire
 *    local, qui gomme le bruit haute fréquence sans raboter les pentes en
 *    bord de trace ;
 * 2. un accumulateur à seuil : une montée ou une descente n'est comptée que
 *    lorsqu'un renversement de pente d'au moins `minGainM` la confirme. Les
 *    oscillations plus petites que le seuil ne comptent jamais, mais une
 *    montée lente et continue est comptée en entier, du creux au sommet.
 */

export interface ElevationStats {
  /** Dénivelé positif cumulé, en mètres. */
  gainM: number;
  /** Dénivelé négatif cumulé, en mètres. */
  lossM: number;
  minEleM: number;
  maxEleM: number;
  /** Altitude lissée point par point, `NaN` là où l'altitude manque. */
  smoothed: number[];
  /** Part des points portant une altitude. */
  coverage: number;
}

export const EMPTY_ELEVATION: ElevationStats = {
  gainM: 0,
  lossM: 0,
  minEleM: 0,
  maxEleM: 0,
  smoothed: [],
  coverage: 0,
};

/** Altitude lissée sur une fenêtre temporelle, en ignorant les points sans altitude. */
export const smoothElevation = (track: TrackPoint[], smoothingSeconds: number): number[] => {
  const indices: number[] = [];
  const values: number[] = [];
  const times: number[] = [];

  track.forEach((p, i) => {
    if (p.ele !== undefined && isFinite(p.ele)) {
      indices.push(i);
      values.push(p.ele);
      times.push(p.timeMs);
    }
  });

  const out = new Array<number>(track.length).fill(NaN);
  if (values.length === 0) return out;

  const filtered = linearSmoothByTime(values, times, smoothingSeconds);
  indices.forEach((trackIndex, k) => {
    out[trackIndex] = filtered[k];
  });
  return out;
};

/**
 * Cumul du dénivelé par détection de renversements confirmés.
 *
 * On suit l'extremum courant dans le sens de la pente. Quand l'altitude s'en
 * écarte de plus de `minGainM` dans l'autre sens, le tronçon est confirmé et
 * compté de l'ancre au sommet ou au creux. La dernière pente en cours est
 * comptée à la fin, quelle que soit son amplitude.
 */
export const accumulateElevation = (
  altitudes: number[],
  minGainM: number
): { gainM: number; lossM: number } => {
  const valid = altitudes.filter((a) => isFinite(a));
  if (valid.length < 2) return { gainM: 0, lossM: 0 };

  let gainM = 0;
  let lossM = 0;
  let anchor = valid[0];
  let extreme = valid[0];
  let direction: 'up' | 'down' | null = null;

  for (let i = 1; i < valid.length; i++) {
    const a = valid[i];

    if (direction === null) {
      if (a - anchor >= minGainM) {
        direction = 'up';
        extreme = a;
      } else if (anchor - a >= minGainM) {
        direction = 'down';
        extreme = a;
      }
    } else if (direction === 'up') {
      if (a > extreme) {
        extreme = a;
      } else if (extreme - a >= minGainM) {
        gainM += extreme - anchor;
        anchor = extreme;
        direction = 'down';
        extreme = a;
      }
    } else {
      if (a < extreme) {
        extreme = a;
      } else if (a - extreme >= minGainM) {
        lossM += anchor - extreme;
        anchor = extreme;
        direction = 'up';
        extreme = a;
      }
    }
  }

  if (direction === 'up') gainM += extreme - anchor;
  if (direction === 'down') lossM += anchor - extreme;

  return { gainM, lossM };
};

export const computeElevationStats = (
  track: TrackPoint[],
  profile: ElevationProfile
): ElevationStats => {
  if (track.length === 0) return EMPTY_ELEVATION;

  const withEle = track.filter((p) => p.ele !== undefined && isFinite(p.ele)).length;
  if (withEle < 2) return { ...EMPTY_ELEVATION, coverage: withEle / track.length };

  const smoothed = smoothElevation(track, profile.smoothingSeconds);
  const { gainM, lossM } = accumulateElevation(smoothed, profile.minGainM);

  // Boucle plutôt que Math.min(...tableau) : une longue trace dépasserait la
  // limite d'arguments d'un appel de fonction.
  let minEleM = Infinity;
  let maxEleM = -Infinity;
  for (const a of smoothed) {
    if (!isFinite(a)) continue;
    if (a < minEleM) minEleM = a;
    if (a > maxEleM) maxEleM = a;
  }

  return {
    gainM,
    lossM,
    minEleM,
    maxEleM,
    smoothed,
    coverage: withEle / track.length,
  };
};
