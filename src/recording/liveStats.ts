import { accumulateElevation, computeElevationStats } from '../core/elevation';
import { computeKinematics } from '../core/kinematics';
import { MIN_ELEVATION_COVERAGE, buildCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { SAILING_SPORTS, type SportProfile } from '../core/sportProfiles';
import { computeTopSegments } from '../core/topSegments';
import type { RawTrackPoint, TrackPoint } from '../core/types';
import { computeCyclingEnergy, type CyclingEnergyParams } from '../cycling/energy';
import type { LocationFix } from '../platform/location';
import { computeEnergy, type EnergyParams } from '../running/energy';
import { computeGrades } from '../running/runningAnalytics';
import { EMPTY_LIVE_LEGS, computeLiveLegs, type LiveLegs } from './liveLegs';

/**
 * Statistiques affichées pendant l'enregistrement, calculées sur la trace en
 * cours avec la même chaîne que l'analyse (`computeKinematics`, dénivelé,
 * pente, tops, modèles d'énergie). Chaque segment est traité à part : rien ne
 * franchit une pause. Tout en unités SI ; la page convertit.
 */

/** Modèle de la puissance et de l'énergie en direct : celui de l'analyse de la famille. */
export type LiveEnergySetup =
  | {
    family: 'course';
    params: EnergyParams;
    /** Poids du pratiquant ; `null` : puissance et énergie par kilo. */
    massKg: number | null;
  }
  | { family: 'velo'; params: CyclingEnergyParams };

export interface LiveStatsOptions {
  /** Fenêtre glissante des tops de voile, du D+ récent et de la vitesse ascensionnelle, en secondes. */
  recentWindowS: number;
  /** Durées des tops de voile sur la fenêtre récente, en secondes. */
  topDurationsS: number[];
  /** Distance de l'allure « dernier kilomètre », en mètres. */
  lastDistanceM: number;
  /** Distance de la vitesse et du D+ des « derniers mètres », en mètres. */
  recentDistanceM: number;
  /** Durée de la vitesse max de la session, en secondes : une meilleure vitesse tenue, pas un point isolé. */
  maxDurationS: number;
  /** Fenêtre de la puissance en direct, en secondes. */
  powerWindowS: number;
  /** Temps enregistré dans la fenêtre récente au-dessous duquel la vitesse ascensionnelle n'est pas donnée, en secondes. */
  minClimbWindowS: number;
  /** Modèle d'énergie (course, vélo) ; absent : ni puissance ni énergie. */
  energy?: LiveEnergySetup;
}

export const LIVE_STATS_DEFAULTS: LiveStatsOptions = {
  recentWindowS: 300,
  topDurationsS: [5, 10],
  lastDistanceM: 1000,
  recentDistanceM: 300,
  maxDurationS: 2,
  powerWindowS: 15,
  minClimbWindowS: 60,
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
  /** Vitesse sur les `recentDistanceM` derniers mètres, en m/s ; `null` tant qu'ils ne sont pas parcourus. */
  recentDistanceSpeedMs: number | null;
  /** Meilleure vitesse de chaque durée de `topDurationsS` sur la fenêtre récente, en m/s, dans le même ordre. */
  recentTopsMs: (number | null)[];
  /** Meilleure vitesse tenue `maxDurationS` sur toute la session, en m/s. */
  maxSpeedMs: number | null;
  /** Dénivelé cumulé, `null` si l'altitude manque. */
  elevationGainM: number | null;
  elevationLossM: number | null;
  /** D+ sur la fenêtre récente, `null` si l'altitude manque. */
  recentGainM: number | null;
  /** D+ des `recentDistanceM` derniers mètres, `null` si l'altitude manque. */
  recentDistanceGainM: number | null;
  /**
   * Pente des derniers mètres, en fraction, sur la fenêtre de l'analyse
   * (`computeGrades`) ; `null` sans altitude ou avant qu'elle soit établie.
   */
  currentGrade: number | null;
  /** D+ récent par heure de temps enregistré dans la fenêtre récente, en m/h ; `null` sans altitude ou trop tôt. */
  climbRateMh: number | null;
  /** Puissance mécanique moyenne sur `powerWindowS`, en W (W/kg si `energyPerKg`) ; `null` sans modèle d'énergie. */
  recentPowerW: number | null;
  /** Énergie de l'effort depuis le départ, repos non compris, en J (J/kg si `energyPerKg`) ; `null` sans modèle d'énergie. */
  effortJ: number | null;
  /** Course sans poids renseigné : puissance et énergie par kilo. */
  energyPerKg: boolean;
  /** Bord en cours et bord précédent, en voile seulement. */
  legs: LiveLegs;
}

export const EMPTY_LIVE_STATS: LiveStats = {
  distanceM: 0,
  movingTimeMs: 0,
  currentSpeedMs: null,
  averageSpeedMs: null,
  lastDistanceSpeedMs: null,
  recentDistanceSpeedMs: null,
  recentTopsMs: [],
  maxSpeedMs: null,
  elevationGainM: null,
  elevationLossM: null,
  recentGainM: null,
  recentDistanceGainM: null,
  currentGrade: null,
  climbRateMh: null,
  recentPowerW: null,
  effortJ: null,
  energyPerKg: false,
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

/**
 * D+ des `targetM` derniers mètres, sur l'altitude lissée de chaque segment
 * (`smoothed`, dans l'ordre des segments) ; chaque segment est cumulé à part.
 */
const lastDistanceGain = (tracks: TrackPoint[][], smoothed: number[][], targetM: number, minGainM: number): number => {
  let dist = 0;
  let gainM = 0;
  for (let s = tracks.length - 1; s >= 0 && dist < targetM; s--) {
    const track = tracks[s];
    let start = track.length - 1;
    while (start > 0 && dist < targetM) {
      dist += segmentDistanceM(track, start);
      start--;
    }
    gainM += accumulateElevation(smoothed[s].slice(start), minGainM).gainM;
  }
  return gainM;
};

/** Dernière valeur finie d'un tableau, `null` s'il n'y en a pas. */
const lastFinite = (values: number[]): number | null => {
  for (let i = values.length - 1; i >= 0; i--) if (isFinite(values[i])) return values[i];
  return null;
};

/**
 * Pentes d'un segment en cours : `computeGrades` n'en donne pas sur la
 * demi-fenêtre finale, faute de points devant ; la dernière connue y est
 * reprise, sans quoi la puissance des dernières secondes compterait plat.
 */
const gradesUpToNow = (grades: number[]): number[] => {
  const last = lastFinite(grades);
  if (last === null) return grades;
  const out = [...grades];
  for (let i = out.length - 1; i >= 0 && !isFinite(out[i]); i--) out[i] = last;
  return out;
};

/**
 * Puissance moyenne des segments qui finissent dans les `windowS` dernières
 * secondes, pondérée par leur durée. Le dernier compte toujours : une cadence
 * lâche peut le laisser seul (règle 10). `null` si aucun n'a de puissance.
 */
const trailingMeanPower = (power: number[], track: TrackPoint[], windowS: number): number | null => {
  const lastMs = track[track.length - 1].timeMs;
  let energy = 0;
  let timeS = 0;
  for (let i = track.length - 1; i >= 1; i--) {
    if (i < track.length - 1 && lastMs - track[i].timeMs >= windowS * 1000) break;
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt > 0 && isFinite(power[i])) {
      energy += power[i] * dt;
      timeS += dt;
    }
  }
  return timeS > 0 ? energy / timeS : null;
};

/**
 * Puissance sur la fin du dernier segment et énergie de tous les segments,
 * avec le modèle de l'analyse ; toute position compte comme en mouvement (la
 * pause coupe déjà la trace), le repos est laissé de côté.
 */
const liveEnergy = (
  tracks: TrackPoint[][],
  grades: number[][],
  setup: LiveEnergySetup,
  windowS: number
): { recentPowerW: number | null; effortJ: number } => {
  let effortJ = 0;
  let power: number[] = [];
  for (let s = 0; s < tracks.length; s++) {
    const moving = tracks[s].map(() => true);
    if (setup.family === 'course') {
      const mass = setup.massKg ?? 1;
      const result = computeEnergy(tracks[s], grades[s], moving, setup.params, 0);
      effortJ += result.netJkg * mass;
      power = result.mechanicalPowerWkg.map((p) => p * mass);
    } else {
      const result = computeCyclingEnergy(tracks[s], grades[s], moving, setup.params, 0);
      effortJ += result.netJ;
      power = result.mechanicalPowerW;
    }
  }
  return { recentPowerW: trailingMeanPower(power, tracks[tracks.length - 1], windowS), effortJ };
};

/**
 * Meilleure vitesse sur `durationS`, parmi les points postérieurs à `sinceMs`
 * (toute la trace sans `sinceMs`). Segment par segment : rien ne franchit une pause.
 */
const bestTop = (tracks: TrackPoint[][], durationS: number, sinceMs?: number): number | null => {
  let best: number | null = null;
  for (const track of tracks) {
    const recent = sinceMs === undefined ? track : track.filter((p) => p.timeMs >= sinceMs);
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
  // Temps enregistré dans la fenêtre récente, pauses exclues, en secondes.
  let recentTimeS = 0;
  const smoothed: number[][] = [];
  // Pente en chaque point, par segment ; sans altitude, vide : le modèle d'énergie compte alors plat.
  const grades: number[][] = tracks.map(() => []);
  if (hasElevation) {
    tracks.forEach((track, s) => {
      const elevation = computeElevationStats(track, profile.elevation);
      gainM += elevation.gainM;
      lossM += elevation.lossM;
      const recent = elevation.smoothed.filter((_, i) => track[i].timeMs >= sinceMs);
      recentGainM += accumulateElevation(recent, profile.elevation.minGainM).gainM;
      const firstRecent = track.find((p) => p.timeMs >= sinceMs);
      if (firstRecent) recentTimeS += (track[track.length - 1].timeMs - firstRecent.timeMs) / 1000;
      smoothed.push(elevation.smoothed);
      grades[s] = gradesUpToNow(computeGrades(elevation.smoothed, buildCumulativeTrack(track)));
    });
  }
  const energy = options.energy ? liveEnergy(tracks, grades, options.energy, options.powerWindowS) : null;

  return {
    distanceM,
    movingTimeMs,
    currentSpeedMs: lastTrack[lastTrack.length - 1].smoothedSpeedMs,
    averageSpeedMs: movingTimeMs > 0 ? distanceM / (movingTimeMs / 1000) : null,
    lastDistanceSpeedMs: lastDistanceSpeed(tracks, options.lastDistanceM),
    recentDistanceSpeedMs: lastDistanceSpeed(tracks, options.recentDistanceM),
    recentTopsMs: options.topDurationsS.map((d) => bestTop(tracks, d, sinceMs)),
    maxSpeedMs: bestTop(tracks, options.maxDurationS),
    elevationGainM: hasElevation ? gainM : null,
    elevationLossM: hasElevation ? lossM : null,
    recentGainM: hasElevation ? recentGainM : null,
    recentDistanceGainM: hasElevation
      ? lastDistanceGain(tracks, smoothed, options.recentDistanceM, profile.elevation.minGainM)
      : null,
    currentGrade: hasElevation ? lastFinite(grades[grades.length - 1]) : null,
    climbRateMh: hasElevation && recentTimeS >= options.minClimbWindowS ? (recentGainM / recentTimeS) * 3600 : null,
    recentPowerW: energy?.recentPowerW ?? null,
    effortJ: energy?.effortJ ?? null,
    energyPerKg: options.energy?.family === 'course' && options.energy.massKg === null,
    legs: SAILING_SPORTS.includes(profile.id) ? computeLiveLegs(tracks) : EMPTY_LIVE_LEGS,
  };
};
