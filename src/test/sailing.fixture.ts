import { computeKinematics } from '../core/kinematics';
import { kinematicsOptionsOf, referenceSpeedMs, scalesFiltersToSession } from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import { getSportProfile } from '../core/sportProfiles';
import type { RawTrackPoint, SportType, TrackPoint } from '../core/types';
import { knotsToMs, msToKnots } from '../core/units';
import { angleDiff } from '../core/angles';
import { trackToPointData, type PointData } from '../sailing/pointData';
import {
  WIND_LOCAL_MAX_GAP_MIN,
  classifyManeuvers,
  estimateWind,
  prepareManeuverDetection,
  windSamplesFrom,
  type ManeuverStats,
} from '../sailing/maneuvers';
import { buildWindTimeline, prepareWindPolar, type WindEstimate } from '../sailing/wind';
import { resolveSailingThresholds, sessionManeuverThresholds } from '../sailing/sailingConfig';
import { buildSailingSessionStats, computeSailingTops } from '../sailing/sailingStats';
import type { SessionStats } from '../sailing/types';
import { M_PER_DEG_LAT, mPerDegLon } from './geo.fixture';

/**
 * Sessions de voile synthétiques réalistes, passées par la chaîne réelle de
 * l'application (positions intégrées depuis le cap et la vitesse, bruit GPS
 * et Doppler, `computeKinematics` accordé à l'allure, estimation du vent et
 * deux passes de détection comme `useSailingSession`). Reprise des sondes de
 * l'audit du 03/11 (`C1-lib`). Fichier de test seulement : rien de
 * l'application ne l'importe.
 */

export const SAIL_ORIGIN = { lat: 43.5, lon: 3.8 };
export const SAIL_T0 = Date.parse('2026-06-01T10:00:00Z');
/** Inertie de la vitesse du générateur, en secondes : 12 → 3 nd en 2 à 3 s, comme une planche qui perd le vol. */
export const SPEED_TAU_S = 0.8;

/** Polaire simplifiée d'un wingfoil (vitesse en nœuds par angle au vent), celle de `maneuvers.test.ts`. */
export const wingPolar = (twa: number): number => {
  if (twa < 35) return 3;
  if (twa < 60) return 12;
  if (twa < 110) return 18;
  if (twa < 150) return 15;
  return 10;
};

export interface Leg {
  /** Angle au vent signé : positif à tribord du vent. */
  twa: number;
  durationS: number;
}

export interface NoiseLevel {
  positionM: number;
  headingDeg: number;
  dopplerMs: number;
}

export const REALISTIC_NOISE: NoiseLevel = { positionM: 0.5, headingDeg: 1.5, dopplerMs: 0.15 };
export const NO_NOISE: NoiseLevel = { positionM: 0, headingDeg: 0, dopplerMs: 0 };

export interface SailSpec {
  windDeg: number;
  legs: Leg[];
  transitionS?: number;
  hz?: number;
  noise?: NoiseLevel;
  seed?: number;
  polar?: (twa: number) => number;
  startMs?: number;
  /** Vitesse Doppler dans le fichier (vrai par défaut). */
  doppler?: boolean;
  /** Inertie de la vitesse, en secondes ; 0 : la vitesse suit la polaire sans aucune inertie (décélération brutale). */
  speedTauS?: number;
}

/** Générateur pseudo-aléatoire à graine (mulberry32). */
export const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const gaussOf = (random: () => number) => () => {
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
};

/** `count` bords de près alternés (±45), puis le même nombre de bords de largue alternés (±135). */
export const upDownLegs = (count: number, legS = 90): Leg[] => {
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) legs.push({ twa: i % 2 === 0 ? 45 : -45, durationS: legS });
  const side = legs[legs.length - 1].twa > 0 ? 1 : -1;
  for (let i = 0; i < count; i++) legs.push({ twa: (i % 2 === 0 ? side : -side) * 135, durationS: legS });
  return legs;
};

/**
 * Session synthétique : le cap suit les bords (transition linéaire par l'arc
 * court, donc par le vent au virement et par le vent arrière à l'empannage),
 * la vitesse suit la polaire, la position est intégrée à 50 Hz puis
 * échantillonnée à `hz`. Le bruit de trajectoire (erreur GPS lente,
 * oscillation du cap) a sa propre graine : la trajectoire est la même à 1 Hz
 * et à 5 Hz, seul l'échantillonnage change. Le bruit Doppler a la sienne.
 */
export const sailRaw = (spec: SailSpec): RawTrackPoint[] => {
  const transitionS = spec.transitionS ?? 5;
  const hz = spec.hz ?? 1;
  const noise = spec.noise ?? REALISTIC_NOISE;
  const polar = spec.polar ?? wingPolar;
  const startMs = spec.startMs ?? SAIL_T0;
  const tauS = spec.speedTauS ?? SPEED_TAU_S;
  const pathGauss = gaussOf(seededRandom(spec.seed ?? 7));
  const dopplerGauss = gaussOf(seededRandom((spec.seed ?? 7) + 1000));

  const twaAt = (t: number): number => {
    let elapsed = 0;
    for (let i = 0; i < spec.legs.length; i++) {
      const leg = spec.legs[i];
      const legEnd = elapsed + leg.durationS;
      if (t < legEnd - transitionS || i === spec.legs.length - 1) return leg.twa;
      if (t < legEnd) {
        const next = spec.legs[i + 1].twa;
        const ratio = (t - (legEnd - transitionS)) / transitionS;
        return leg.twa + angleDiff(next, leg.twa) * ratio;
      }
      elapsed = legEnd;
    }
    return spec.legs[spec.legs.length - 1].twa;
  };
  const totalS = spec.legs.reduce((a, l) => a + l.durationS, 0);

  const dt = 0.02;
  const decay = (value: number, decayS: number, sigma: number) =>
    value - (value / decayS) * dt + sigma * Math.sqrt((2 * dt) / decayS) * pathGauss();
  let north = 0;
  let east = 0;
  let errN = 0;
  let errE = 0;
  let wobble = 0;
  let nextSampleS = 0;
  let speedMs = knotsToMs(polar(Math.abs(spec.legs[0].twa)));
  const raw: RawTrackPoint[] = [];
  for (let s = 0; s <= totalS + 1e-9; s += dt) {
    const twa = twaAt(s);
    const heading = ((spec.windDeg + twa) % 360 + 360) % 360;
    const targetMs = knotsToMs(polar(Math.abs(angleDiff(heading, spec.windDeg))));
    speedMs = tauS > 0 ? speedMs + ((targetMs - speedMs) * dt) / tauS : targetMs;
    errN = decay(errN, 10, noise.positionM);
    errE = decay(errE, 10, noise.positionM);
    wobble = decay(wobble, 3, noise.headingDeg);
    const rad = ((heading + wobble) * Math.PI) / 180;
    north += speedMs * Math.cos(rad) * dt;
    east += speedMs * Math.sin(rad) * dt;
    if (s >= nextSampleS - 1e-9) {
      const lat = SAIL_ORIGIN.lat + (north + errN) / M_PER_DEG_LAT;
      const lon = SAIL_ORIGIN.lon + (east + errE) / mPerDegLon(SAIL_ORIGIN.lat);
      const timeMs = startMs + Math.round(s * 1000);
      raw.push({
        lat,
        lon,
        time: new Date(timeMs).toISOString(),
        ...(spec.doppler === false ? {} : { speedMs: Math.max(0, speedMs + noise.dopplerMs * dopplerGauss()) }),
      });
      nextSampleS += 1 / hz;
    }
  }
  return raw;
};

export const rawTimeOf = (p: RawTrackPoint): number => (typeof p.time === 'string' ? Date.parse(p.time) : p.time.getTime());

/** Trou : les points dont la date est dans ]fromS ; toS[ depuis le départ sont retirés. */
export const holeRaw = (raw: RawTrackPoint[], fromS: number, toS: number): RawTrackPoint[] => {
  const start = rawTimeOf(raw[0]);
  return raw.filter((p) => {
    const t = (rawTimeOf(p) - start) / 1000;
    return !(t > fromS && t < toS);
  });
};

/**
 * Enregistreur économique (cadence Komoot) : bords échantillonnés toutes les
 * 6 s, et chaque virage entier dans un silence de `silenceS`, par la chaîne
 * réelle (`computeKinematics` pose le cap du point de reprise).
 */
export const komootRaw = (windDeg: number, legs: Leg[], silenceS: number): RawTrackPoint[] => {
  const dense = sailRaw({ windDeg, legs, hz: 1, noise: NO_NOISE, transitionS: 4 });
  const out: RawTrackPoint[] = [];
  let elapsed = 0;
  const bounds = legs.map((l) => (elapsed += l.durationS));
  for (const p of dense) {
    const t = (rawTimeOf(p) - SAIL_T0) / 1000;
    const nearTurn = bounds.some((b) => t > b - silenceS / 2 - 2 && t < b + silenceS / 2 - 2);
    if (nearTurn) continue;
    if (Math.round(t) % 6 !== 0) continue;
    out.push(p);
  }
  return out;
};

/** Fichier GPX d'une trace brute (position, heure, vitesse Doppler), tel que `parseGpx` le lit. */
export const rawToGpx = (raw: RawTrackPoint[]): string => {
  const points = raw.map((p) => {
    const time = typeof p.time === 'string' ? p.time : p.time.toISOString();
    const speed = p.speedMs === undefined ? '' : `<extensions><speed>${p.speedMs}</speed></extensions>`;
    return `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${time}</time>${speed}</trkpt>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points.join('')}</trkseg></trk></gpx>`;
};

// ---------------------------------------------------------------------------
// Chaîne de `useSailingSession`, hors React
// ---------------------------------------------------------------------------

export interface SailingAnalysis {
  track: TrackPoint[];
  points: PointData[];
  referenceKn: number;
  activeKn: number;
  flightKn: number | undefined;
  minEntrySpeedKn: number;
  polarMinSpeedKn: number;
  windEstimate: WindEstimate;
  /** Vent retenu : saisi, sinon l'estimation fiable, sinon `null`. */
  currentWind: number | null;
  maneuvers: ManeuverStats | null;
  stats: SessionStats;
}

export interface AnalyzeOptions {
  sport?: SportType;
  /** Vent saisi ; `undefined` : estimé. */
  windDeg?: number;
  /** Seuil d'activité de la session ; `undefined` : suggestion. */
  thresholdKn?: number;
}

export const analyzeSailing = (raw: RawTrackPoint[], options: AnalyzeOptions = {}): SailingAnalysis => {
  const sport = options.sport ?? 'wingfoil';
  const profile = getSportProfile(sport);
  const referenceMs = referenceSpeedMs(raw);
  const track = computeKinematics(raw, kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs }));
  const points = trackToPointData(track);
  const referenceKn = msToKnots(referenceMs);
  const thresholds = resolveSailingThresholds(profile, null, options.thresholdKn ?? null, referenceKn);
  const activeKn = thresholds.activeKn;
  const flightKn = thresholds.flightKn;
  const mt = sessionManeuverThresholds(sport, referenceKn);
  const stillSpeedKn = profile.stillThreshold;
  const detection = prepareManeuverDetection(points, { minEntrySpeedKn: mt.minEntrySpeedKn, stillSpeedKn });
  const polarStage = prepareWindPolar(points, mt.polarMinSpeedKn, mt.minEntrySpeedKn);
  const windEstimate = estimateWind(points, {
    minSpeedKn: mt.polarMinSpeedKn,
    successThresholdKn: activeKn,
    minEntrySpeedKn: mt.minEntrySpeedKn,
    flightThresholdKn: flightKn,
    stillSpeedKn,
    detection,
    polarStage,
  });
  const currentWind = options.windDeg !== undefined ? ((options.windDeg % 360) + 360) % 360 : windEstimate.reliable ? windEstimate.direction : null;

  let maneuvers: ManeuverStats | null = null;
  if (currentWind !== null && points.length > 0) {
    const classification = { successThresholdKn: activeKn, flightThresholdKn: flightKn };
    const first = classifyManeuvers(detection, currentWind, classification);
    const timeline = buildWindTimeline(
      windSamplesFrom(first).map((m) => ({ timeMs: m.timeMs, direction: m.localWind })),
      currentWind,
      WIND_LOCAL_MAX_GAP_MIN * 60 * 1000
    );
    maneuvers = classifyManeuvers(detection, timeline, classification);
  }
  const cumulative = buildCumulativeTrack(track);
  const tops = computeSailingTops(track, cumulative);
  const stats = buildSailingSessionStats(track, { sport, activeThresholdKn: activeKn, cumulative, tops }) ?? ({ tops } as SessionStats);
  return { track, points, referenceKn, activeKn, flightKn, minEntrySpeedKn: mt.minEntrySpeedKn, polarMinSpeedKn: mt.polarMinSpeedKn, windEstimate, currentWind, maneuvers, stats };
};

/** Comptes d'une analyse, pour les comparer d'une transformation à l'autre. */
export const counts = (a: SailingAnalysis) => ({
  tackSuccess: a.maneuvers?.tackSuccess ?? -1,
  tackFail: a.maneuvers?.tackFail ?? -1,
  jibeSuccess: a.maneuvers?.jibeSuccess ?? -1,
  jibeFail: a.maneuvers?.jibeFail ?? -1,
  undecided: a.maneuvers?.undecided ?? -1,
  rejected: a.maneuvers?.rejected ?? null,
});

export const tacksOf = (a: SailingAnalysis): number => (a.maneuvers ? a.maneuvers.tackSuccess + a.maneuvers.tackFail : -1);
export const jibesOf = (a: SailingAnalysis): number => (a.maneuvers ? a.maneuvers.jibeSuccess + a.maneuvers.jibeFail : -1);

export const topSpeeds = (a: SailingAnalysis): Record<string, number | null> =>
  Object.fromEntries(Object.entries(a.stats.tops).map(([k, v]) => [k, v[0]?.speed ?? null]));

/** Écart absolu entre deux directions, en degrés. */
export const degApart = (a: number, b: number): number => Math.abs(angleDiff(a, b));
