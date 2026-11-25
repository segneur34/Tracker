import { resumeHeartRateSums, type HeartRatePoint, type HeartRateSumsState } from '../core/heartRate';
import {
  activityMaskStart, activityMaskStep, extendCumulativeTrack, segmentDistanceM, type ActivityMaskOptions, type ActivityMaskState,
} from '../core/sessionStats';
import type { HeartRateProfile } from '../core/sportProfiles';
import { WINDOW_SCAN_START, extendHoleCounts, scanBestWindow, type WindowScan } from '../core/topSegments';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import type { LocationFix } from '../platform/location';
import { resumeLiveLegs, type LiveLegSplit, type LiveLegsMemory } from './liveLegs';

/**
 * Ce qu'un segment de l'enregistrement apporte au direct (`liveStats.ts`),
 * calculé sur un segment qui ne fait que s'allonger : chaque cumul est gardé
 * d'un calcul à l'autre jusqu'au dernier point que la cinématique reprendra
 * tel quel (`KinematicsRun.frozenUpTo`), et seuls les points d'après sont
 * relus, avec les mêmes calculs dans le même ordre que le calcul entier
 * (distance, masque d'activité, vitesse max, bords) : les chiffres sont
 * identiques au bit près (`liveSegment.test.ts`). La FC, tirée des positions
 * et non de la trace, a son propre point de reprise. Dénivelé, pentes et
 * énergie restent refaits par `liveStats.ts` sur tout le segment en cours.
 */

export interface SegmentParts {
  /** Trace du segment ; vide sous deux positions. */
  track: TrackPoint[];
  /**
   * Distance et temps cumulés de la trace (`buildCumulativeTrack`). Tableaux
   * de la mémoire, prolongés sur place au calcul suivant : à lire avant lui.
   */
  cum: CumulativeTrack;
  distanceM: number;
  movingTimeMs: number;
  /** Distance et temps en action, avec un masque d'activité demandé. */
  active: { distanceM: number; timeMs: number } | null;
  heart: { sum: number; coveredS: number } | null;
  /** Meilleure vitesse tenue `maxDurationS` ; `null` si la trace est trop courte. */
  maxSpeedMs: number | null;
  /** Bords, en voile seulement. */
  legs: LiveLegSplit | null;
  /** Dates de la trace croissantes (au sens large) : une fenêtre récente s'y cherche par dichotomie. */
  ordered: boolean;
}

export interface SegmentSettings {
  /** Automate de la moyenne active (`thresholdMaskOptions`) ; `null` : elle n'est pas calculée. */
  mask: ActivityMaskOptions | null;
  /** Durée de la vitesse max, en secondes. */
  maxDurationS: number;
  heartRate: HeartRateProfile;
  /** Bords de voile. */
  sailing: boolean;
}

/** Ce qui ne dépend que des `frozen` premiers points de la trace, tant que `track[frozen - 1]` est `anchor`. */
interface TrackMemory {
  frozen: number;
  anchor: TrackPoint | null;
  /** Cumuls et comptes de trous, valables pour les `frozen` premiers points. */
  cum: CumulativeTrack;
  holes: number[];
  /** Pas où la date recule. */
  descents: number;
  mask: ActivityMaskState | null;
  activeTimeMs: number;
  activeDistanceM: number;
  scan: WindowScan;
  legs: LiveLegsMemory | null;
}

/** Points de FC tirés des positions, et l'état des sommes. */
interface HeartMemory {
  points: HeartRatePoint[];
  state: HeartRateSumsState;
}

/** Mémoire d'un segment en cours, rendue par `computeSegmentParts` et à lui repasser. */
export interface SegmentMemory {
  track: TrackMemory | null;
  heart: HeartMemory;
}

/** FC du segment, comme l'analyse : somme pondérée par le temps et temps couvert ; `null` sans FC. */
const heartOf = (fixes: ReadonlyArray<LocationFix>, params: HeartRateProfile, previous: HeartMemory | null) => {
  const points = previous ? previous.points : [];
  for (let i = points.length; i < fixes.length; i++) points.push({ timeMs: fixes[i].timeMs, hr: fixes[i].heartRateBpm });
  const { sums, state } = resumeHeartRateSums(points, params.smoothS, params.gapS, previous ? previous.state : null);
  // `heartRateStats` rend la moyenne, dont le calcul entier retire la somme : même arrondi ici.
  const heart = sums.coveredS === 0 ? null : { sum: (sums.sum / sums.coveredS) * sums.coveredS, coveredS: sums.coveredS };
  return { heart, memory: { points, state } };
};

/**
 * Apport d'un segment : `fixes` ses positions, `track` sa trace (vide sous
 * deux points), `frozenUpTo` le nombre de points de `track` que la prochaine
 * cinématique reprendra tels quels, `previous` la mémoire rendue par l'appel
 * précédent sur le même segment (mêmes positions au début, mêmes réglages),
 * consommée : ne reprendre que la dernière rendue.
 */
export const computeSegmentParts = (
  fixes: ReadonlyArray<LocationFix>,
  track: TrackPoint[],
  frozenUpTo: number,
  settings: SegmentSettings,
  previous: SegmentMemory | null
): { parts: SegmentParts; memory: SegmentMemory } => {
  const { heart, memory: heartMemory } = heartOf(fixes, settings.heartRate, previous ? previous.heart : null);
  const n = track.length;
  if (n < 2) {
    return {
      parts: {
        track, cum: { cumDist: [0], cumTime: [0] }, distanceM: 0, movingTimeMs: 0, active: settings.mask ? { distanceM: 0, timeMs: 0 } : null,
        heart, maxSpeedMs: null, legs: null, ordered: true,
      },
      memory: { track: null, heart: heartMemory },
    };
  }

  // Mémoire valable : au moins un point figé, mêmes premiers points (même objet au dernier figé), même choix de
  // masque. Sans point figé, la trace entière peut avoir changé (vitesse lissée du premier point comprise) : tout repart.
  const seen = previous?.track ?? null;
  const prev = seen && seen.frozen > 0 && seen.frozen <= n && track[seen.frozen - 1] === seen.anchor
    && (seen.mask === null) === (settings.mask === null) ? seen : null;
  const reused = prev ? prev.frozen : 0;
  const frozen = Math.min(frozenUpTo, n);

  const cum = extendCumulativeTrack(track, prev ? prev.cum : { cumDist: [0], cumTime: [0] }, Math.max(1, reused));
  const holes = extendHoleCounts(track, prev ? prev.holes : [0], reused);
  const maskOptions = settings.mask;
  const mask: ActivityMaskState | null = prev?.mask ? { ...prev.mask } : maskOptions ? activityMaskStart(track, maskOptions) : null;
  let descents = prev ? prev.descents : 0;
  let activeTimeMs = prev ? prev.activeTimeMs : 0;
  let activeDistanceM = prev ? prev.activeDistanceM : 0;

  // État avant le point `frozen` : il n'a lu que des points figés.
  let kept: Pick<TrackMemory, 'descents' | 'mask' | 'activeTimeMs' | 'activeDistanceM'> | null = null;
  for (let i = reused; ; i++) {
    if (i === frozen) kept = { descents, mask: mask ? { ...mask } : null, activeTimeMs, activeDistanceM };
    if (i >= n) break;
    if (i >= 1 && track[i].timeMs < track[i - 1].timeMs) descents++;
    if (mask && maskOptions && activityMaskStep(track, i, maskOptions, mask) && i >= 1) {
      // Comme `computeActiveTimeMs` et `computeActiveDistanceM`.
      activeTimeMs += track[i].timeMs - track[i - 1].timeMs;
      activeDistanceM += segmentDistanceM(track, i);
    }
  }

  const { best: maxSpeedMs, frozen: scan } = scanBestWindow(cum, holes, 0, settings.maxDurationS, prev ? prev.scan : WINDOW_SCAN_START, frozen);
  const legs = settings.sailing ? resumeLiveLegs(track, frozen, prev ? prev.legs : null) : null;

  return {
    parts: {
      track,
      cum,
      // Même somme, dans le même ordre, que la distance des pas mise bout à bout.
      distanceM: cum.cumDist[n - 1],
      movingTimeMs: track[n - 1].timeMs - track[0].timeMs,
      active: mask ? { distanceM: activeDistanceM, timeMs: activeTimeMs } : null,
      heart,
      maxSpeedMs,
      legs: legs ? legs.split : null,
      ordered: descents === 0,
    },
    memory: {
      track: kept ? { frozen, anchor: frozen > 0 ? track[frozen - 1] : null, cum, holes, scan, legs: legs ? legs.memory : null, ...kept } : null,
      heart: heartMemory,
    },
  };
};
