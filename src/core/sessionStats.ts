import { computeElevationStats, type ElevationStats } from './elevation';
import { ELEVATION_PRESETS, type ElevationProfile } from './sportProfiles';
import type { BaseSessionStats, CumulativeTrack, TrackPoint } from './types';
import { formatDuration } from './units';

/**
 * Distance parcourue sur le segment qui mène au point `i`, en mètres.
 *
 * La distance est l'intégrale de la vitesse retenue, et non une somme de
 * distances orthodromiques brutes. Les deux coïncident exactement tant que la
 * vitesse n'a pas été écrêtée, mais sur un point aberrant la version intégrée
 * utilise la vitesse corrigée au lieu de propager le saut de position. Quand
 * l'appareil fournit une vitesse Doppler, c'est elle qui est intégrée, ce qui
 * est la méthode la plus juste.
 *
 * Conséquence voulue : une seule source de vérité pour la distance, cohérente
 * avec les vitesses affichées. La distance annoncée par le fichier GPX n'est
 * plus utilisée.
 */
export const segmentDistanceM = (track: TrackPoint[], i: number): number => {
  if (i <= 0) return 0;
  const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
  return dt > 0 ? track[i].speedMs * dt : 0;
};

/** Distance et temps cumulés le long de la trace. */
export const buildCumulativeTrack = (track: TrackPoint[]): CumulativeTrack => {
  const cumDist = [0];
  const cumTime = [0];

  for (let i = 1; i < track.length; i++) {
    const deltaS = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    cumTime.push(cumTime[i - 1] + deltaS);
    cumDist.push(cumDist[i - 1] + segmentDistanceM(track, i));
  }

  return { cumDist, cumTime };
};

/** Durée totale de la session, en millisecondes. */
export const computeTotalTimeMs = (track: TrackPoint[]): number => {
  if (track.length === 0) return 0;
  return track[track.length - 1].timeMs - track[0].timeMs;
};

export interface ActivityMaskOptions {
  /** Vitesse, en m/s, au-dessus de laquelle l'activité démarre. */
  enterThresholdMs: number;
  /** Vitesse, en m/s, en dessous de laquelle l'activité s'arrête. */
  exitThresholdMs: number;
  /** Durée minimale de confirmation avant tout changement d'état, en secondes. */
  minStateDurationS?: number;
}

/**
 * Détermine point par point si le pratiquant est en action.
 *
 * Deux seuils distincts, à la manière d'un trigger de Schmitt : il faut
 * dépasser le seuil haut pour démarrer et repasser sous le seuil bas pour
 * s'arrêter. Sans cette hystérésis, une vitesse qui stagne autour de la limite
 * fait osciller le compteur à chaque point et gonfle artificiellement le
 * nombre de transitions.
 *
 * Une durée minimale de confirmation évite en plus qu'un point isolé ne
 * déclenche un changement d'état.
 */
export const computeActivityMask = (
  track: TrackPoint[],
  options: ActivityMaskOptions
): boolean[] => {
  const minStateDurationS = options.minStateDurationS ?? 0;
  const mask = new Array<boolean>(track.length).fill(false);

  let active = false;
  let pendingSinceMs: number | null = null;

  for (let i = 0; i < track.length; i++) {
    const speed = track[i].smoothedSpeedMs;
    const candidate: boolean = active
      ? speed >= options.exitThresholdMs
      : speed >= options.enterThresholdMs;

    if (candidate !== active) {
      if (pendingSinceMs === null) {
        pendingSinceMs = track[i].timeMs;
      }
      if ((track[i].timeMs - pendingSinceMs) / 1000 >= minStateDurationS) {
        active = candidate;
        pendingSinceMs = null;
      }
    } else {
      pendingSinceMs = null;
    }

    mask[i] = active;
  }

  return mask;
};

/** Temps passé en action, en millisecondes. */
export const computeActiveTimeMs = (track: TrackPoint[], mask: boolean[]): number => {
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    if (mask[i]) total += track[i].timeMs - track[i - 1].timeMs;
  }
  return total;
};

/** Distance parcourue en action, en mètres. */
export const computeActiveDistanceM = (track: TrackPoint[], mask: boolean[]): number => {
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    if (mask[i]) total += segmentDistanceM(track, i);
  }
  return total;
};

export interface BaseSessionStatsOptions extends ActivityMaskOptions {
  /** Cumuls déjà calculés, pour éviter un second parcours. */
  cumulative?: CumulativeTrack;
  /** Masque d'activité déjà calculé. */
  activityMask?: boolean[];
  /** Réglage du dénivelé. Preset route par défaut. */
  elevation?: ElevationProfile;
  /** Dénivelé déjà calculé, pour éviter un second parcours. */
  elevationStats?: ElevationStats;
}

/** Part minimale de points avec altitude pour publier un dénivelé. */
const MIN_ELEVATION_COVERAGE = 0.5;

/** Statistiques valables pour tous les supports. */
export const buildBaseSessionStats = (
  track: TrackPoint[],
  options: BaseSessionStatsOptions
): BaseSessionStats => {
  const cum = options.cumulative ?? buildCumulativeTrack(track);
  const mask = options.activityMask ?? computeActivityMask(track, options);
  const elevation =
    options.elevationStats ?? computeElevationStats(track, options.elevation ?? ELEVATION_PRESETS.route);

  const totalDistanceM = cum.cumDist[cum.cumDist.length - 1] ?? 0;
  const activeDistanceM = computeActiveDistanceM(track, mask);
  const totalTimeMs = computeTotalTimeMs(track);
  const activeTimeMs = computeActiveTimeMs(track, mask);
  const hasElevation = elevation.coverage >= MIN_ELEVATION_COVERAGE;

  return {
    distance: (totalDistanceM / 1000).toFixed(2),
    activeDistance: (activeDistanceM / 1000).toFixed(2),
    totalTime: formatDuration(totalTimeMs),
    activeTime: formatDuration(activeTimeMs),
    activeRatio: totalTimeMs > 0 ? ((activeTimeMs / totalTimeMs) * 100).toFixed(1) : '0.0',
    speedSource: track[0]?.speedSource ?? 'derived',
    elevationGain: hasElevation ? Math.round(elevation.gainM).toString() : '-',
    elevationLoss: hasElevation ? Math.round(elevation.lossM).toString() : '-',
    elevationMin: hasElevation ? Math.round(elevation.minEleM).toString() : '-',
    elevationMax: hasElevation ? Math.round(elevation.maxEleM).toString() : '-',
    hasElevation,
  };
};
