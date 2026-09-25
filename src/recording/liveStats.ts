import { accumulateElevation, computeElevationStats } from '../core/elevation';
import { computeKinematics } from '../core/kinematics';
import { MIN_ELEVATION_COVERAGE, buildCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { SAILING_SPORTS, type SportProfile } from '../core/sportProfiles';
import { computeTopSegments } from '../core/topSegments';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import type { LocationFix } from '../platform/location';
import { EMPTY_LIVE_LEGS, computeLiveLegs, type LiveLegs } from './liveLegs';

/**
 * Statistiques affichées pendant l'enregistrement, calculées sur la trace en
 * cours avec la même chaîne que l'analyse (`computeKinematics`, dénivelé,
 * tops). Chaque segment est traité à part : rien ne franchit une pause.
 * Tout en unités SI ; la page convertit.
 */

export interface LiveStatsOptions {
  /** Fenêtre glissante des tops de voile et du D+ récent, en secondes. */
  recentWindowS: number;
  /** Durées des tops de voile sur la fenêtre récente, en secondes. */
  topDurationsS: number[];
  /** Distance de l'allure « dernier kilomètre », en mètres. */
  lastDistanceM: number;
}

export const LIVE_STATS_DEFAULTS: LiveStatsOptions = {
  recentWindowS: 300,
  topDurationsS: [5, 10],
  lastDistanceM: 1000,
};

export interface LiveStats {
  distanceM: number;
  /** Temps enregistré hors pauses, en millisecondes. */
  movingTimeMs: number;
  /** Vitesse filtrée du dernier point, en m/s. */
  currentSpeedMs: number | null;
  /** Vitesse moyenne hors pauses, en m/s. */
  averageSpeedMs: number | null;
  /** Vitesse sur les `lastDistanceM` derniers mètres, en m/s ; `null` tant qu'ils ne sont pas parcourus. */
  lastDistanceSpeedMs: number | null;
  /** Meilleure vitesse de chaque durée de `topDurationsS` sur la fenêtre récente, en m/s, dans le même ordre. */
  recentTopsMs: (number | null)[];
  /** Dénivelé cumulé, `null` si l'altitude manque. */
  elevationGainM: number | null;
  elevationLossM: number | null;
  /** D+ sur la fenêtre récente, `null` si l'altitude manque. */
  recentGainM: number | null;
  /** Bord en cours et bord précédent, en voile seulement. */
  legs: LiveLegs;
}

export const EMPTY_LIVE_STATS: LiveStats = {
  distanceM: 0,
  movingTimeMs: 0,
  currentSpeedMs: null,
  averageSpeedMs: null,
  lastDistanceSpeedMs: null,
  recentTopsMs: [],
  elevationGainM: null,
  elevationLossM: null,
  recentGainM: null,
  legs: EMPTY_LIVE_LEGS,
};

const toRawPoint = (fix: LocationFix): RawTrackPoint => ({
  lat: fix.lat,
  lon: fix.lon,
  time: new Date(fix.timeMs),
  ele: fix.altitudeM,
  speedMs: fix.speedMs,
});

/** Vitesse sur les `targetM` derniers mètres, en remontant les segments ; `null` s'ils ne suffisent pas. */
const lastDistanceSpeed = (tracks: TrackPoint[][], targetM: number): number | null => {
  let dist = 0;
  let timeS = 0;
  for (let s = tracks.length - 1; s >= 0; s--) {
    const track = tracks[s];
    for (let i = track.length - 1; i >= 1; i--) {
      const d = segmentDistanceM(track, i);
      const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
      if (d > 0 && dist + d >= targetM) {
        timeS += (dt * (targetM - dist)) / d;
        return timeS > 0 ? targetM / timeS : null;
      }
      dist += d;
      timeS += dt;
    }
  }
  return null;
};

/** Meilleure vitesse sur `durationS`, parmi les points postérieurs à `sinceMs`. */
const recentTop = (tracks: TrackPoint[][], sinceMs: number, durationS: number): number | null => {
  let best: number | null = null;
  for (const track of tracks) {
    const recent = track.filter((p) => p.timeMs >= sinceMs);
    if (recent.length < 2) continue;
    const [top] = computeTopSegments(
      recent,
      buildCumulativeTrack(recent),
      { key: 'live', label: '', value: durationS, kind: 'time' },
      (ms) => ms,
      { count: 1, decimals: 6 }
    );
    const value = Number(top.val);
    if (isFinite(value) && (best === null || value > best)) best = value;
  }
  return best;
};

export const computeLiveStats = (
  segments: LocationFix[][],
  profile: SportProfile,
  options: LiveStatsOptions = LIVE_STATS_DEFAULTS
): LiveStats => {
  const tracks = segments
    .map((segment) =>
      computeKinematics(segment.map(toRawPoint), {
        medianWindowSeconds: profile.medianWindowSeconds,
        maxSpeedMs: profile.maxPlausibleSpeedMs,
      })
    )
    .filter((t) => t.length >= 2);
  if (tracks.length === 0) return { ...EMPTY_LIVE_STATS, recentTopsMs: options.topDurationsS.map(() => null) };

  let distanceM = 0;
  let movingTimeMs = 0;
  for (const track of tracks) {
    for (let i = 1; i < track.length; i++) distanceM += segmentDistanceM(track, i);
    movingTimeMs += track[track.length - 1].timeMs - track[0].timeMs;
  }

  const lastTrack = tracks[tracks.length - 1];
  const lastMs = lastTrack[lastTrack.length - 1].timeMs;
  const sinceMs = lastMs - options.recentWindowS * 1000;

  const pointCount = segments.reduce((n, s) => n + s.length, 0);
  const withEle = segments.reduce((n, s) => n + s.filter((f) => f.altitudeM !== undefined && isFinite(f.altitudeM)).length, 0);
  const hasElevation = withEle / pointCount >= MIN_ELEVATION_COVERAGE;
  let gainM = 0;
  let lossM = 0;
  let recentGainM = 0;
  if (hasElevation) {
    for (const track of tracks) {
      const elevation = computeElevationStats(track, profile.elevation);
      gainM += elevation.gainM;
      lossM += elevation.lossM;
      const recent = elevation.smoothed.filter((_, i) => track[i].timeMs >= sinceMs);
      recentGainM += accumulateElevation(recent, profile.elevation.minGainM).gainM;
    }
  }

  return {
    distanceM,
    movingTimeMs,
    currentSpeedMs: lastTrack[lastTrack.length - 1].smoothedSpeedMs,
    averageSpeedMs: movingTimeMs > 0 ? distanceM / (movingTimeMs / 1000) : null,
    lastDistanceSpeedMs: lastDistanceSpeed(tracks, options.lastDistanceM),
    recentTopsMs: options.topDurationsS.map((d) => recentTop(tracks, sinceMs, d)),
    elevationGainM: hasElevation ? gainM : null,
    elevationLossM: hasElevation ? lossM : null,
    recentGainM: hasElevation ? recentGainM : null,
    legs: SAILING_SPORTS.includes(profile.id) ? computeLiveLegs(tracks) : EMPTY_LIVE_LEGS,
  };
};
