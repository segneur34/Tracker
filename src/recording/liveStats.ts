import { accumulateElevation, computeElevationStats, type ElevationStats } from '../core/elevation';
import { heartRateStats, smoothHeartRate } from '../core/heartRate';
import { resumeKinematics, type KinematicsRun } from '../core/kinematics';
import { MIN_ELEVATION_COVERAGE, buildCumulativeTrack, segmentDistanceM } from '../core/sessionStats';
import { SAILING_SPORTS, type HeartRateProfile, type SportProfile } from '../core/sportProfiles';
import { bestWindowSpeedMs } from '../core/topSegments';
import type { CumulativeTrack, RawTrackPoint, TrackPoint } from '../core/types';
import { computeCyclingEnergy, type CyclingEnergyParams } from '../cycling/energy';
import type { LocationFix } from '../platform/location';
import { computeEnergy, type EnergyParams } from '../running/energy';
import { computeGrades } from '../core/grade';
import { EMPTY_LIVE_LEGS, combineLiveLegs, splitLiveLegs, type LiveLegSplit, type LiveLegs } from './liveLegs';

/**
 * Statistiques affichées pendant l'enregistrement, calculées sur la trace en
 * cours avec la même chaîne que l'analyse (`computeKinematics`, dénivelé,
 * pente, tops, modèles d'énergie). Chaque segment est traité à part : rien ne
 * franchit une pause. Tout en unités SI ; la page convertit.
 *
 * Avec une mémoire (`LiveStatsMemory`, tenue par `useLiveRecording`), un
 * segment fermé n'est calculé qu'une fois et le segment en cours reprend sa
 * cinématique là où elle en était (`resumeKinematics`) : le coût de chaque
 * recalcul ne croît plus avec la durée que par le reste du segment en cours
 * (dénivelé, FC, énergie, tops), bien plus léger (27/10). Le résultat est
 * celui du calcul sans mémoire (`liveStats.test.ts`).
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
  /** FC moyenne depuis le départ, pondérée par le temps, en bpm ; `null` sans ceinture. */
  averageHeartRateBpm: number | null;
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
  averageHeartRateBpm: null,
};

const toRawPoint = (fix: LocationFix): RawTrackPoint => {
  const time = new Date(fix.timeMs);
  // Date lue une fois (lot 56) : celle de `time`, que `Date` arrondit à la milliseconde.
  return { lat: fix.lat, lon: fix.lon, time, rawTimeMs: time.getTime(), ele: fix.altitudeM, speedMs: fix.speedMs };
};

/** FC d'un segment, comme l'analyse : somme pondérée par le temps et temps couvert ; `null` sans FC. */
const heartPart = (
  segment: ReadonlyArray<Pick<LocationFix, 'timeMs' | 'heartRateBpm'>>, params: HeartRateProfile
): { sum: number; coveredS: number } | null => {
  const points = segment.map((fix) => ({ timeMs: fix.timeMs, hr: fix.heartRateBpm }));
  const stats = heartRateStats(points, smoothHeartRate(points, params.smoothS, params.gapS), params.gapS);
  return stats === null ? null : { sum: stats.avgBpm * stats.coveredS, coveredS: stats.coveredS };
};

/**
 * Direct d'une session sans position (muscu, lot I du 25/10) : la FC moyenne
 * depuis le départ, comme l'analyse, et le temps enregistré hors pauses ; ni
 * distance ni vitesse.
 */
export const heartOnlyLiveStats = (
  segments: ReadonlyArray<ReadonlyArray<Pick<LocationFix, 'timeMs' | 'heartRateBpm'>>>, params: HeartRateProfile
): LiveStats => {
  let sum = 0;
  let coveredS = 0;
  let movingTimeMs = 0;
  for (const segment of segments) {
    if (segment.length > 1) movingTimeMs += segment[segment.length - 1].timeMs - segment[0].timeMs;
    const part = heartPart(segment, params);
    if (part === null) continue;
    sum += part.sum;
    coveredS += part.coveredS;
  }
  return { ...EMPTY_LIVE_STATS, movingTimeMs, averageHeartRateBpm: coveredS > 0 ? sum / coveredS : null };
};

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
 * Puissance et énergie d'un segment, avec le modèle de l'analyse ; toute
 * position compte comme en mouvement (la pause coupe déjà la trace), le repos
 * est laissé de côté.
 */
const segmentEnergy = (track: TrackPoint[], grades: number[], setup: LiveEnergySetup): { effortJ: number; power: number[] } => {
  const moving = track.map(() => true);
  if (setup.family === 'course') {
    const mass = setup.massKg ?? 1;
    const result = computeEnergy(track, grades, moving, setup.params, 0);
    return { effortJ: result.netJkg * mass, power: result.mechanicalPowerWkg.map((p) => p * mass) };
  }
  const result = computeCyclingEnergy(track, grades, moving, setup.params, 0);
  return { effortJ: result.netJ, power: result.mechanicalPowerW };
};

/**
 * Meilleure vitesse sur `durationS`, parmi les points postérieurs à `sinceMs`.
 * Segment par segment : rien ne franchit une pause ; un segment fini avant
 * `sinceMs` n'est pas relu.
 */
const bestRecentTop = (tracks: TrackPoint[][], durationS: number, sinceMs: number): number | null => {
  let best: number | null = null;
  for (const track of tracks) {
    if (track[track.length - 1].timeMs < sinceMs) continue;
    const recent = track.filter((p) => p.timeMs >= sinceMs);
    const value = bestWindowSpeedMs(recent, buildCumulativeTrack(recent), durationS);
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
};

/** Ce qu'un segment apporte au direct ; calculé une fois pour un segment fermé. */
interface SegmentParts {
  /** Trace du segment ; vide sous deux positions. */
  track: TrackPoint[];
  cum: CumulativeTrack;
  pointCount: number;
  withEle: number;
  distanceM: number;
  movingTimeMs: number;
  heart: { sum: number; coveredS: number } | null;
  /** Meilleure vitesse tenue `maxDurationS` ; `null` si la trace est trop courte. */
  maxSpeedMs: number | null;
  /** Bords, en voile seulement. */
  legs: LiveLegSplit | null;
  /** Dénivelé et pentes, demandés quand l'altitude est établie. */
  elevation: { stats: ElevationStats; grades: number[] } | null;
  /** Énergie, demandée avec un modèle, selon que les pentes étaient connues. */
  energy: { graded: boolean; effortJ: number; power: number[] } | null;
}

/** Un segment de l'enregistrement, tel que vu la dernière fois, et ce qui en a été calculé. */
interface SegmentEntry {
  fixes: ReadonlyArray<LocationFix>;
  raw: RawTrackPoint[];
  run: KinematicsRun | null;
  parts: SegmentParts | null;
}

/** Mémoire du direct d'une session, à créer par `createLiveStatsMemory` et à passer à `computeLiveStats`. */
export interface LiveStatsMemory {
  /** Profil et réglages du dernier calcul : s'ils changent, tout est refait. */
  key: string;
  entries: SegmentEntry[];
}

export const createLiveStatsMemory = (): LiveStatsMemory => ({ key: '', entries: [] });

/** Les positions déjà vues sont les mêmes objets, au début du segment. */
const samePrefix = (seen: ReadonlyArray<LocationFix>, segment: ReadonlyArray<LocationFix>): boolean => {
  if (segment.length < seen.length) return false;
  for (let k = 0; k < seen.length; k++) if (segment[k] !== seen[k]) return false;
  return true;
};

export const computeLiveStats = (
  segments: LocationFix[][],
  profile: SportProfile,
  options: LiveStatsOptions = LIVE_STATS_DEFAULTS,
  memory?: LiveStatsMemory
): LiveStats => {
  const mem = memory ?? createLiveStatsMemory();
  const key = `${profile.id}|${JSON.stringify(options)}`;
  if (mem.key !== key) {
    mem.key = key;
    mem.entries = [];
  }
  const kinematicsOptions = {
    medianWindowSeconds: profile.medianWindowSeconds,
    maxSpeedMs: profile.maxPlausibleSpeedMs,
    maxGapS: profile.maxGapS,
  };

  // Un segment déjà vu tel quel garde tout ; prolongé, il reprend sa cinématique ; autre, il repart de zéro.
  const entries: SegmentEntry[] = segments.map((segment, k) => {
    const seen = mem.entries[k];
    const entry: SegmentEntry = seen && samePrefix(seen.fixes, segment) ? seen : { fixes: [], raw: [], run: null, parts: null };
    if (entry.fixes.length !== segment.length) {
      for (let i = entry.raw.length; i < segment.length; i++) entry.raw.push(toRawPoint(segment[i]));
      entry.fixes = segment;
      entry.run = resumeKinematics(entry.raw, kinematicsOptions, entry.run);
      entry.parts = null;
    }
    return entry;
  });
  mem.entries = entries;

  const sailing = SAILING_SPORTS.includes(profile.id);
  for (const entry of entries) {
    if (entry.parts) continue;
    const track = entry.run && entry.run.track.length >= 2 ? entry.run.track : [];
    const cum = buildCumulativeTrack(track);
    let distanceM = 0;
    for (let i = 1; i < track.length; i++) distanceM += segmentDistanceM(track, i);
    entry.parts = {
      track,
      cum,
      pointCount: entry.fixes.length,
      withEle: entry.fixes.filter((f) => f.altitudeM !== undefined && isFinite(f.altitudeM)).length,
      distanceM,
      movingTimeMs: track.length >= 2 ? track[track.length - 1].timeMs - track[0].timeMs : 0,
      heart: heartPart(entry.fixes, profile.heartRate),
      maxSpeedMs: bestWindowSpeedMs(track, cum, options.maxDurationS),
      legs: sailing && track.length >= 2 ? splitLiveLegs(track) : null,
      elevation: null,
      energy: null,
    };
  }
  // Un segment fermé ne reprend jamais : ses étapes intermédiaires et ses points bruts ne servent plus.
  for (let k = 0; k < entries.length - 1; k++) {
    entries[k].run = null;
    entries[k].raw = [];
  }

  const active = entries.map((e) => e.parts!).filter((p) => p.track.length >= 2);
  if (active.length === 0) return { ...EMPTY_LIVE_STATS, recentTopsMs: options.topDurationsS.map(() => null) };
  const tracks = active.map((p) => p.track);

  let distanceM = 0;
  let movingTimeMs = 0;
  for (const p of active) {
    distanceM += p.distanceM;
    movingTimeMs += p.movingTimeMs;
  }

  const lastTrack = tracks[tracks.length - 1];
  const lastMs = lastTrack[lastTrack.length - 1].timeMs;
  const sinceMs = lastMs - options.recentWindowS * 1000;

  let pointCount = 0;
  let withEle = 0;
  for (const entry of entries) {
    pointCount += entry.parts!.pointCount;
    withEle += entry.parts!.withEle;
  }
  const hasElevation = withEle / pointCount >= MIN_ELEVATION_COVERAGE;
  let gainM = 0;
  let lossM = 0;
  let recentGainM = 0;
  // Temps enregistré dans la fenêtre récente, pauses exclues, en secondes.
  let recentTimeS = 0;
  const smoothed: number[][] = [];
  // Pente en chaque point, par segment ; sans altitude, vide : le modèle d'énergie compte alors plat.
  const grades: number[][] = active.map(() => []);
  if (hasElevation) {
    active.forEach((p, s) => {
      const { track } = p;
      p.elevation ??= (() => {
        const stats = computeElevationStats(track, profile.elevation);
        return { stats, grades: gradesUpToNow(computeGrades(stats.smoothed, p.cum, profile.grade.halfWindowM)) };
      })();
      const elevation = p.elevation.stats;
      gainM += elevation.gainM;
      lossM += elevation.lossM;
      // Un segment fini avant la fenêtre récente n'y apporte rien.
      if (track[track.length - 1].timeMs >= sinceMs) {
        const recent = elevation.smoothed.filter((_, i) => track[i].timeMs >= sinceMs);
        recentGainM += accumulateElevation(recent, profile.elevation.minGainM).gainM;
        const firstRecent = track.find((q) => q.timeMs >= sinceMs);
        if (firstRecent) recentTimeS += (track[track.length - 1].timeMs - firstRecent.timeMs) / 1000;
      }
      smoothed.push(elevation.smoothed);
      grades[s] = p.elevation.grades;
    });
  }

  let effortJ: number | null = null;
  let recentPowerW: number | null = null;
  if (options.energy) {
    effortJ = 0;
    active.forEach((p, s) => {
      if (!p.energy || p.energy.graded !== hasElevation) p.energy = { graded: hasElevation, ...segmentEnergy(p.track, grades[s], options.energy!) };
      effortJ! += p.energy.effortJ;
    });
    recentPowerW = trailingMeanPower(active[active.length - 1].energy!.power, lastTrack, options.powerWindowS);
  }

  let maxSpeedMs: number | null = null;
  for (const p of active) if (p.maxSpeedMs !== null && (maxSpeedMs === null || p.maxSpeedMs > maxSpeedMs)) maxSpeedMs = p.maxSpeedMs;

  let heartSum = 0;
  let heartCoveredS = 0;
  for (const entry of entries) {
    const heart = entry.parts!.heart;
    if (heart === null) continue;
    heartSum += heart.sum;
    heartCoveredS += heart.coveredS;
  }

  return {
    distanceM,
    movingTimeMs,
    currentSpeedMs: lastTrack[lastTrack.length - 1].smoothedSpeedMs,
    averageSpeedMs: movingTimeMs > 0 ? distanceM / (movingTimeMs / 1000) : null,
    lastDistanceSpeedMs: lastDistanceSpeed(tracks, options.lastDistanceM),
    recentDistanceSpeedMs: lastDistanceSpeed(tracks, options.recentDistanceM),
    recentTopsMs: options.topDurationsS.map((d) => bestRecentTop(tracks, d, sinceMs)),
    maxSpeedMs,
    elevationGainM: hasElevation ? gainM : null,
    elevationLossM: hasElevation ? lossM : null,
    recentGainM: hasElevation ? recentGainM : null,
    recentDistanceGainM: hasElevation
      ? lastDistanceGain(tracks, smoothed, options.recentDistanceM, profile.elevation.minGainM)
      : null,
    currentGrade: hasElevation ? lastFinite(grades[grades.length - 1]) : null,
    climbRateMh: hasElevation && recentTimeS >= options.minClimbWindowS ? (recentGainM / recentTimeS) * 3600 : null,
    recentPowerW,
    effortJ,
    energyPerKg: options.energy?.family === 'course' && options.energy.massKg === null,
    legs: sailing ? combineLiveLegs(active.map((p) => p.legs!)) : EMPTY_LIVE_LEGS,
    averageHeartRateBpm: heartCoveredS > 0 ? heartSum / heartCoveredS : null,
  };
};
