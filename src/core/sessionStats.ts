import { computeElevationStats, type ElevationStats } from './elevation';
import { ELEVATION_PRESETS, getActiveThresholds, hasActiveThreshold, type ElevationProfile, type SportProfile } from './sportProfiles';
import type { BaseSessionStats, CumulativeTrack, TrackPoint } from './types';
import { formatDuration, fromDisplaySpeed } from './units';

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
 *
 * Exception, le trou de la trace (pas plus long que `maxGapS`) : la vitesse
 * lue à la reprise ne dit rien du trou, sa distance est bornée par la corde du
 * pas (`gapDistanceM`, posé par `computeKinematics`).
 */
export const segmentDistanceM = (track: TrackPoint[], i: number): number => {
  // Reprise après une pause : le pas couvre la pause, rien n'y est parcouru.
  if (i <= 0 || track[i].segmentStart) return 0;
  const gap = track[i].gapDistanceM;
  if (gap !== undefined) return gap;
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
  /**
   * Vitesse moyenne, en m/s, sous laquelle un trou de la trace (pas qui porte
   * `gapDistanceM`) est un arrêt sans point, hors action. Défaut : `exitThresholdMs`.
   */
  gapMinSpeedMs?: number;
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
 *
 * Le pas qui reprend après une pause de l'enregistrement (`segmentStart`)
 * n'est jamais en action : ni temps, ni distance, ni énergie n'y sont comptés.
 * Le pas d'un trou de la trace (`gapDistanceM`) ne l'est que si sa vitesse
 * moyenne, distance retenue sur durée, atteint `gapMinSpeedMs` : l'appareil qui
 * cesse d'écrire à l'arrêt laisse un trou immobile, qu'aucune vitesse lissée ne
 * voit (celle du point de reprise est déjà celle du mouvement). Dans les deux
 * cas, l'automate lit toujours la vitesse lissée du point.
 */
export const computeActivityMask = (
  track: TrackPoint[],
  options: ActivityMaskOptions
): boolean[] => {
  const minStateDurationS = options.minStateDurationS ?? 0;
  const gapMinSpeedMs = options.gapMinSpeedMs ?? options.exitThresholdMs;
  const mask = new Array<boolean>(track.length).fill(false);

  // L'état de départ est celui du premier point : une trace qui commence en
  // mouvement n'attend pas la confirmation pour compter ses premières secondes.
  let active = track.length > 0 && track[0].smoothedSpeedMs >= options.enterThresholdMs;
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

    const gap = track[i].gapDistanceM;
    const stillGap = gap !== undefined && i > 0 && gap / ((track[i].timeMs - track[i - 1].timeMs) / 1000) < gapMinSpeedMs;
    mask[i] = active && !track[i].segmentStart && !stillGap;
  }

  return mask;
};

/**
 * Masque d'activité d'un calcul à ce seuil, dans l'unité de son profil.
 * Seuil réglé à 0 (aucun seuil) : un arrêt complet est tout de même ôté, au
 * plancher d'arrêt du profil (`stillThreshold`, décision du 27/10). Bateau,
 * sans seuil : toute la trace est en navigation, hors pauses de
 * l'enregistrement et trous immobiles (jugés au même plancher). Partout, un
 * trou de la trace n'est en action que si sa vitesse moyenne atteint la
 * détente basse.
 */
export const thresholdActivityMask = (track: TrackPoint[], profile: SportProfile, threshold: number): boolean[] => {
  if (!hasActiveThreshold(profile)) {
    return computeActivityMask(track, {
      enterThresholdMs: 0,
      exitThresholdMs: 0,
      gapMinSpeedMs: fromDisplaySpeed(getActiveThresholds(profile, profile.stillThreshold).exit, profile.thresholdUnit),
    });
  }
  const effective = threshold > 0 ? threshold : profile.stillThreshold;
  const { enter, exit } = getActiveThresholds(profile, effective);
  const exitThresholdMs = fromDisplaySpeed(exit, profile.thresholdUnit);
  return computeActivityMask(track, {
    enterThresholdMs: fromDisplaySpeed(enter, profile.thresholdUnit),
    exitThresholdMs,
    minStateDurationS: profile.minStateDurationS,
    gapMinSpeedMs: exitThresholdMs,
  });
};

/**
 * Une suite continue du masque d'activité, en index de points : `start` est le
 * point d'où elle part (celui qui précède le premier point en action, le pas
 * qui y mène étant compté), `end` le dernier point en action. Sa durée est
 * `timeMs[end] − timeMs[start]`, sa distance `cumDist[end] − cumDist[start]`,
 * comme les cumuls de `computeActiveTimeMs` et `computeActiveDistanceM`.
 */
export interface ActiveRun {
  start: number;
  end: number;
}

/**
 * Suites du masque d'activité. Un pas plus long que `maxGapS` (un trou de la
 * trace) n'est jamais en action : il coupe la suite en cours. Avec `from` et
 * `to`, seuls les pas qui mènent aux points `from` à `to` comptent (les vagues
 * d'un vol en surf) : le même résultat qu'un masque faux hors de ces bornes,
 * sans parcourir toute la trace.
 */
export const activeRuns = (
  track: TrackPoint[],
  mask: boolean[],
  maxGapS = Infinity,
  from = 1,
  to = track.length - 1
): ActiveRun[] => {
  const runs: ActiveRun[] = [];
  let start: number | null = null;
  const last = Math.min(to, track.length - 1);
  for (let i = Math.max(1, from); i <= last; i++) {
    const active = mask[i] && (track[i].timeMs - track[i - 1].timeMs) / 1000 <= maxGapS;
    if (active && start === null) start = i - 1;
    if (!active && start !== null) {
      runs.push({ start, end: i - 1 });
      start = null;
    }
  }
  if (start !== null) runs.push({ start, end: last });
  return runs;
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
export const MIN_ELEVATION_COVERAGE = 0.5;

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
    distanceM: totalDistanceM,
    activeDistanceM,
    totalTime: formatDuration(totalTimeMs),
    activeTime: formatDuration(activeTimeMs),
    activeRatio: totalTimeMs > 0 ? ((activeTimeMs / totalTimeMs) * 100).toFixed(1) : '0.0',
    avgSpeedMs: totalTimeMs > 0 ? totalDistanceM / (totalTimeMs / 1000) : null,
    activeAvgSpeedMs: activeTimeMs > 0 ? activeDistanceM / (activeTimeMs / 1000) : null,
    speedSource: track[0]?.speedSource ?? 'derived',
    elevationGain: hasElevation ? Math.round(elevation.gainM).toString() : '-',
    elevationLoss: hasElevation ? Math.round(elevation.lossM).toString() : '-',
    elevationMin: hasElevation ? Math.round(elevation.minEleM).toString() : '-',
    elevationMax: hasElevation ? Math.round(elevation.maxEleM).toString() : '-',
    hasElevation,
  };
};
