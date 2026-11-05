import { accumulateElevation } from '../core/elevation';
import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';

/** Une tranche de distance de la trace (un kilomètre, ou un mille). */
export interface KilometerSplit {
  /** Rang, à partir de 1. */
  rank: number;
  /** Distance retenue de la tranche, en m : la longueur des tranches, moins pour la dernière. */
  distanceM: number;
  /** Durée de la tranche, pauses comprises (temps total), en s. */
  durationS: number;
  /** Temps en mouvement dans la tranche, en s ; `null` sans masque d'activité. */
  movingS: number | null;
  /** Vitesse moyenne sur le temps total de la tranche, en m/s. */
  speedMs: number;
  /** Dénivelés positif et négatif de la tranche, en m ; `null` sans altitude. */
  gainM: number | null;
  lossM: number | null;
  /** FC moyenne de la tranche, pondérée par le temps, en bpm ; `null` sans FC. */
  heartRateBpm: number | null;
  /** Dernière tranche, plus courte que les autres. */
  partial: boolean;
}

export interface KilometerSplitsOptions {
  /** Longueur d'une tranche, en m (1 000 m, ou 1 852 m en milles). */
  splitM: number;
  /** Altitude lissée, une par point (`ElevationStats.smoothed`) ; absente : pas de dénivelé. */
  elevation?: ReadonlyArray<number> | null;
  /** Hystérésis du dénivelé, en m (`ElevationProfile.minGainM`). */
  minGainM?: number;
  /** Masque d'activité, un par point (`thresholdActivityMask`) ; absent : pas de temps en mouvement. */
  active?: ReadonlyArray<boolean> | null;
  /** Dernière tranche plus courte que ce reste, en m, oubliée (bruit d'arrêt) ; défaut 10 m. */
  minLastM?: number;
}

/** Tranche en cours, avant de la fermer. */
interface Open {
  startDistM: number;
  durationS: number;
  movingS: number;
  hrWeightedS: number;
  hrS: number;
  altitudes: number[];
}

const open = (startDistM: number): Open => ({ startDistM, durationS: 0, movingS: 0, hrWeightedS: 0, hrS: 0, altitudes: [] });

/**
 * Découpe la trace en tranches de `splitM` de distance retenue (règle 6 :
 * `segmentDistanceM`), la dernière partielle. Le pas qui franchit une borne
 * est coupé au prorata de sa distance : la durée, le temps en mouvement et la
 * FC s'y partagent, une trace à 1 Hz et la même à 5 Hz donnent les mêmes
 * tranches. Les pauses restent dans la tranche où elles tombent (temps total).
 * Le dénivelé de chaque tranche reprend l'altitude lissée entre ses bornes,
 * avec l'hystérésis de la session (`accumulateElevation`).
 */
export const kilometerSplits = (track: TrackPoint[], options: KilometerSplitsOptions): KilometerSplit[] => {
  const { splitM, elevation = null, minGainM = 0, active = null, minLastM = 10 } = options;
  if (track.length < 2 || !(splitM > 0)) return [];
  const hasHr = track.some((p) => p.hr !== undefined && isFinite(p.hr) && p.hr > 0);
  const hasEle = elevation !== null && elevation.length === track.length && elevation.some((a) => isFinite(a));
  const splits: KilometerSplit[] = [];
  let cur = open(0);
  if (hasEle) cur.altitudes.push(elevation[0]);
  let distM = 0;

  const close = (endDistM: number, endAltitude: number | null, partial: boolean) => {
    const distanceM = endDistM - cur.startDistM;
    if (hasEle && endAltitude !== null) cur.altitudes.push(endAltitude);
    const elev = hasEle ? accumulateElevation(cur.altitudes.filter((a) => isFinite(a)), minGainM) : null;
    splits.push({
      rank: splits.length + 1,
      distanceM,
      durationS: cur.durationS,
      movingS: active ? cur.movingS : null,
      speedMs: cur.durationS > 0 ? distanceM / cur.durationS : 0,
      gainM: elev ? elev.gainM : null,
      lossM: elev ? elev.lossM : null,
      heartRateBpm: hasHr && cur.hrS > 0 ? cur.hrWeightedS / cur.hrS : null,
      partial,
    });
  };

  /** Ajoute une part `share` (0 à 1) du pas qui mène au point `i` à la tranche en cours. */
  const add = (i: number, dtS: number, share: number) => {
    const s = dtS * share;
    cur.durationS += s;
    if (active?.[i]) cur.movingS += s;
    const hr = track[i].hr;
    if (hasHr && hr !== undefined && isFinite(hr) && hr > 0) {
      cur.hrWeightedS += hr * s;
      cur.hrS += s;
    }
  };

  for (let i = 1; i < track.length; i++) {
    const dtS = Math.max(0, (track[i].timeMs - track[i - 1].timeMs) / 1000);
    const stepM = segmentDistanceM(track, i);
    const a0 = hasEle ? elevation[i - 1] : NaN;
    const a1 = hasEle ? elevation[i] : NaN;
    let done = 0;
    // Bornes franchies par ce pas : la tranche se ferme à l'instant de chacune, au prorata de la distance.
    while (stepM > 0 && distM + stepM >= cur.startDistM + splitM) {
      const boundM = cur.startDistM + splitM;
      const at = (boundM - distM) / stepM;
      add(i, dtS, at - done);
      const altitude = hasEle ? a0 + (a1 - a0) * at : null;
      close(boundM, altitude, false);
      cur = open(boundM);
      if (altitude !== null) cur.altitudes.push(altitude);
      done = at;
    }
    add(i, dtS, 1 - done);
    distM += stepM;
    if (hasEle) cur.altitudes.push(a1);
  }
  const rest = distM - cur.startDistM;
  if (rest >= minLastM && cur.durationS > 0) close(distM, null, true);
  return splits;
};
