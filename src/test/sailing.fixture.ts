import { computeKinematics } from '../core/kinematics';
import { kinematicsOptionsOf, referenceSpeedMs, scalesFiltersToSession } from '../core/sessionSpeed';
import { buildCumulativeTrack } from '../core/sessionStats';
import { getSportProfile } from '../core/sportProfiles';
import type { CumulativeTrack, RawTrackPoint, SportType, TrackPoint } from '../core/types';
import { knotsToMs } from '../core/units';
import { angleDiff } from '../core/angles';
import type { PointData } from '../sailing/pointData';
import type { ManeuverStats } from '../sailing/maneuvers';
import type { WindEstimate } from '../sailing/wind';
import { analyzeSailingSession } from '../sailing/sailingSession';
import type { SessionStats } from '../sailing/types';
import { M_PER_DEG_LAT, mPerDegLon } from './geo.fixture';
import { GPX_EDITORS, corpusSegmentsOf, type CorpusMeta, type GpxEditor } from './gpx/corpus';

/**
 * Sessions de voile synthétiques réalistes, passées par la chaîne réelle de
 * l'application (positions intégrées depuis le cap et la vitesse, bruit GPS
 * et Doppler, `computeKinematics` accordé à l'allure, puis
 * `analyzeSailingSession`, la chaîne de `useSailingSession` : estimation du
 * vent et deux passes de détection). Reprise des sondes de l'audit du 03/11
 * (`C1-lib`). Fichier de test seulement : rien de l'application ne l'importe.
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

// ---------------------------------------------------------------------------
// Sessions par bords en `PointData` (cap et vitesse imposés), de `maneuvers.test.ts`
// ---------------------------------------------------------------------------

/** Départ des traces de `buildLegSession` (et des `buildTrack` de `maneuvers.test.ts`). */
export const TRACK_START_MS = Date.parse('2026-01-01T10:00:00Z');

/**
 * La même polaire à l'échelle d'un support lent : 1,2 nœud dans le cône,
 * 4,8 au près, 7,2 au largue, 6 au portant, 4 au vent arrière. Sous le seuil
 * de 5 nœuds du wingfoil, une telle session est presque invisible à la
 * polaire, et tous ses empannages passent pour ratés.
 */
export const slowPolar = (twa: number): number => wingPolar(twa) / 2.5;

/** Vitesse de la polaire du wingfoil selon le cap, pour un vent fixe ou variable dans le temps. */
export const polarSpeed = (windDir: number | ((t: number) => number)) => (t: number, bearing: number): number => {
  const wind = typeof windDir === 'function' ? windDir(t) : windDir;
  return wingPolar(Math.abs(angleDiff(bearing, wind)));
};

/**
 * Session réaliste par bords : chaque bord a un angle au vent signé (positif à
 * tribord du vent, négatif à bâbord) et une durée. Les transitions durent
 * `transitionS` et le cap y passe par l'arc court, donc par le vent pour un
 * virement et par le vent arrière pour un empannage. La vitesse suit la
 * polaire, ce qui fait chuter le virement à 3 nœuds et non l'empannage.
 * Le cap et la vitesse sont imposés directement (pas de `computeKinematics`).
 */
export const buildLegSession = (
  legs: Leg[],
  windAt: (t: number) => number,
  options: {
    transitionS?: number;
    stepS?: number;
    currentKn?: number;
    currentDir?: number;
    /** Polaire du support, pour fabriquer une session plus lente qu'un wingfoil. */
    polar?: (twa: number) => number;
    /**
     * Intègre la position à partir du cap et de la vitesse, au lieu de la
     * faire avancer le long d'une ligne arbitraire. Indispensable dès qu'un
     * calcul lit les positions, comme la distance d'une manœuvre. Laissé
     * optionnel pour ne pas déplacer les distances des tests écrits avant lui.
     */
    integratePosition?: boolean;
  } = {}
): PointData[] => {
  const transitionS = options.transitionS ?? 6;
  const stepS = options.stepS ?? 1;
  const polar = options.polar ?? wingPolar;
  let lat = 43.6;
  let lon = 3.8;

  // Angle au vent en fonction du temps, avec transitions linéaires.
  const twaAt = (t: number): number => {
    let elapsed = 0;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const legEnd = elapsed + leg.durationS;
      if (t < legEnd - transitionS || i === legs.length - 1) return leg.twa;
      if (t < legEnd) {
        const next = legs[i + 1].twa;
        const ratio = (t - (legEnd - transitionS)) / transitionS;
        return leg.twa + angleDiff(next, leg.twa) * ratio;
      }
      elapsed = legEnd;
    }
    return legs[legs.length - 1].twa;
  };

  const totalS = legs.reduce((a, l) => a + l.durationS, 0);
  const points: PointData[] = [];

  for (let t = 0; t <= totalS; t += stepS) {
    const wind = windAt(t);
    const twa = twaAt(t);
    const heading = ((wind + twa) % 360 + 360) % 360;
    const boatSpeed = polar(Math.abs(angleDiff(heading, wind)));

    // Le courant s'ajoute vectoriellement : cap et vitesse sur le fond.
    let bearing = heading;
    let speed = boatSpeed;
    if (options.currentKn) {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const vx = boatSpeed * Math.sin(toRad(heading)) + options.currentKn * Math.sin(toRad(options.currentDir ?? 90));
      const vy = boatSpeed * Math.cos(toRad(heading)) + options.currentKn * Math.cos(toRad(options.currentDir ?? 90));
      bearing = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360;
      speed = Math.sqrt(vx * vx + vy * vy);
    }

    const timeMs = TRACK_START_MS + Math.round(t * 1000);
    points.push({
      lat: options.integratePosition ? lat : 43.6,
      lon: options.integratePosition ? lon : 3.8 + t * 0.0001,
      timeMs,
      smoothedSpeed: speed,
      bearing,
    });

    if (options.integratePosition) {
      const meters = speed * 0.514444 * stepS;
      const rad = (bearing * Math.PI) / 180;
      lat += (meters * Math.cos(rad)) / M_PER_DEG_LAT;
      lon += (meters * Math.sin(rad)) / mPerDegLon(lat);
    }
  }
  return points;
};

/**
 * `count` bords de près alternés (count - 1 virements), puis une abattée sur
 * le même bord, un empannage, et une remontée sur le même bord. Aucun virage
 * de 180° : chaque transition a un sens sans ambiguïté.
 */
export const upwindDownwindLegs = (count: number, legDurationS = 180): Leg[] => {
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) {
    legs.push({ twa: i % 2 === 0 ? 45 : -45, durationS: legDurationS });
  }
  const side = legs[legs.length - 1].twa > 0 ? 1 : -1;
  legs.push({ twa: side * 135, durationS: legDurationS });
  legs.push({ twa: -side * 135, durationS: legDurationS });
  legs.push({ twa: -side * 45, durationS: legDurationS });
  return legs;
};

// ---------------------------------------------------------------------------
// Sessions intégrées à 50 Hz, passées par la chaîne réelle
// ---------------------------------------------------------------------------

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

/**
 * Fichier GPX d'une trace brute au format d'un éditeur du corpus (`test/gpx/corpus.ts`) : `simple` (position, heure,
 * vitesse Doppler), `garmin-connect`, `strava`, `waterspeed`… ; un `<trkseg>` par `segmentStart`. Ce que le format
 * n'écrit pas (la vitesse chez Strava) est perdu, comme dans un vrai export.
 */
export const gpxOf = (raw: RawTrackPoint[], editor: GpxEditor = 'simple', meta?: CorpusMeta): string =>
  GPX_EDITORS[editor](corpusSegmentsOf(raw), meta);

/** Fichier GPX d'une trace brute (position, heure, vitesse Doppler), tel que `parseGpx` le lit : `gpxOf` au format simple. */
export const rawToGpx = (raw: RawTrackPoint[]): string => gpxOf(raw);

/** Trace d'une session synthétique passée par la cinématique de l'application, accordée à son allure comme dans les hooks. */
export interface SailTrack {
  track: TrackPoint[];
  cumulative: CumulativeTrack;
  /** Allure de la session (`core/sessionSpeed.ts`), en m/s. */
  referenceSpeedMs: number;
}

/** Cinématique d'une trace brute de voile (`computeKinematics` accordé à l'allure, règle 4), et son cumul. */
export const sailTrackOf = (raw: RawTrackPoint[], sport: SportType = 'wingfoil'): SailTrack => {
  const profile = getSportProfile(sport);
  const referenceMs = referenceSpeedMs(raw);
  const track = computeKinematics(raw, kinematicsOptionsOf(profile, { scaleToSession: scalesFiltersToSession(profile), referenceMs }));
  return { track, cumulative: buildCumulativeTrack(track), referenceSpeedMs: referenceMs };
};

/** La même, pour une session décrite par ses bords (`sailRaw`). */
export const sailTrack = (spec: SailSpec, sport: SportType = 'wingfoil'): SailTrack => sailTrackOf(sailRaw(spec), sport);

// ---------------------------------------------------------------------------
// Chaîne de `useSailingSession`, hors React : `analyzeSailingSession`
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
  const { track, cumulative, referenceSpeedMs: referenceMs } = sailTrackOf(raw, sport);
  const a = analyzeSailingSession(track, {
    sport,
    referenceSpeedMs: referenceMs,
    cumulative,
    activityThresholdKn: null,
    sessionThresholdKn: options.thresholdKn ?? null,
    windDeg: options.windDeg ?? null,
  });
  if (!a.windEstimate) throw new Error('analyzeSailing : trace vide');
  return {
    track,
    points: a.trackData,
    referenceKn: a.referenceSpeedKn,
    activeKn: a.thresholds.activeKn,
    flightKn: a.thresholds.flightKn,
    minEntrySpeedKn: a.maneuverThresholds.minEntrySpeedKn,
    polarMinSpeedKn: a.maneuverThresholds.polarMinSpeedKn,
    windEstimate: a.windEstimate,
    currentWind: a.currentWindValue,
    maneuvers: a.maneuverStats,
    stats: a.stats ?? ({ tops: a.tops } as SessionStats),
  };
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
