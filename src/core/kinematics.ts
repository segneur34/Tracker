import {
  DEFAULT_MAX_ACCELERATION,
  DEFAULT_MEDIAN_WINDOW_S,
  clampByAcceleration,
  median,
  medianFilterByTime,
} from './speedFilter';
import type { RawTrackPoint, SpeedSource, TrackPoint } from './types';
import { MS_TO_KMH, MS_TO_KNOTS } from './units';

/** Rayon terrestre moyen en mètres. */
export const EARTH_RADIUS_M = 6371e3;

export const toRad = (value: number): number => (value * Math.PI) / 180;
export const toDeg = (value: number): number => (value * 180) / Math.PI;

/** Distance orthodromique entre deux positions, en mètres. */
export const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

/** Cap initial entre deux positions, en degrés depuis le nord, sens horaire. */
export const initialBearing = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

/**
 * Distance de `p` au segment [`a`, `b`], en mètres, mesurée en plan local
 * équirectangulaire centré sur `p` : exact à mieux que le mètre sur quelques
 * kilomètres. Segment réduit à un point : distance à ce point.
 */
export const distanceToSegmentM = (
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number => {
  const cosLat = Math.cos(toRad(p.lat));
  const ax = toRad(a.lon - p.lon) * cosLat * EARTH_RADIUS_M;
  const ay = toRad(a.lat - p.lat) * EARTH_RADIUS_M;
  const dx = toRad(b.lon - p.lon) * cosLat * EARTH_RADIUS_M - ax;
  const dy = toRad(b.lat - p.lat) * EARTH_RADIUS_M - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
};

/** Convertit un horodatage de point en millisecondes depuis l'époque. */
export const pointTimeMs = (time: string | Date): number =>
  typeof time === 'string' ? new Date(time).getTime() : time.getTime();

/**
 * Dates des points, en millisecondes, avec les points d'une même date répartis
 * régulièrement jusqu'à la date suivante. Certaines applications tronquent
 * l'heure à la seconde : à 5 Hz, cinq points partagent alors la même date, les
 * quatre pas de durée nulle n'ont pas de vitesse et celui qui franchit la
 * seconde ne porte qu'un cinquième du chemin (27/10). Une suite de `n` points
 * de date `T` suivie d'une date `T' > T` prend `T + k × (T' − T) / n` ; un point
 * à la même position que le précédent de la suite (vrai doublon) garde la date
 * de celui-ci, son pas reste nul. La dernière suite de la trace s'étale sur
 * l'écart qui la précède ; rien si elle commence la trace.
 */
export const spreadEqualTimes = (
  points: { lat: number; lon: number }[],
  timesMs: number[]
): number[] => {
  const spread = timesMs.slice();
  let start = 0;
  while (start < timesMs.length) {
    let end = start + 1;
    while (end < timesMs.length && timesMs[end] === timesMs[start]) end++;
    const n = end - start;
    if (n >= 2) {
      const t = timesMs[start];
      let spanMs = 0;
      if (end < timesMs.length) spanMs = timesMs[end] > t ? timesMs[end] - t : 0;
      else if (start >= 1 && t > timesMs[start - 1]) spanMs = t - timesMs[start - 1];
      if (spanMs > 0) {
        for (let k = 1; k < n; k++) {
          const i = start + k;
          const same = points[i].lat === points[i - 1].lat && points[i].lon === points[i - 1].lon;
          spread[i] = same ? spread[i - 1] : t + (k * spanMs) / n;
        }
      }
    }
    start = end;
  }
  return spread;
};

/** Unité dans laquelle un fichier exprime la vitesse de l'appareil. */
export type DeviceSpeedUnit = 'ms' | 'kmh' | 'kn';

/** Facteur multiplicatif pour ramener une vitesse appareil en m/s. */
export const DEVICE_SPEED_FACTOR: Record<DeviceSpeedUnit, number> = {
  ms: 1,
  kmh: 1 / MS_TO_KMH,
  kn: 1 / MS_TO_KNOTS,
};

/** Nombre minimal de points comparables pour trancher sur l'unité. */
const UNIT_DETECTION_MIN_SAMPLES = 10;
/** Vitesse dérivée minimale, en m/s, pour qu'un point serve à la détection. */
const UNIT_DETECTION_MIN_DERIVED_MS = 1;

/**
 * Devine l'unité de la vitesse fournie par l'appareil.
 *
 * La norme GPX veut des m/s, mais certaines applications écrivent des km/h,
 * plus rarement des nœuds. Lue en m/s, une vitesse en km/h paraît 3,6 fois
 * trop grande : toute la trace passe pour un sprint. On compare la vitesse
 * de l'appareil à la vitesse dérivée des positions, dont l'unité est sûre, et
 * on retient l'unité dont le facteur explique le mieux le rapport médian.
 */
export const detectDeviceSpeedUnit = (
  deviceSpeedsMs: (number | undefined)[],
  derivedSpeedsMs: number[]
): DeviceSpeedUnit => {
  const ratios: number[] = [];
  for (let i = 0; i < deviceSpeedsMs.length; i++) {
    const device = deviceSpeedsMs[i];
    const derived = derivedSpeedsMs[i];
    if (device === undefined || device <= 0 || derived < UNIT_DETECTION_MIN_DERIVED_MS) continue;
    ratios.push(device / derived);
  }
  if (ratios.length < UNIT_DETECTION_MIN_SAMPLES) return 'ms';

  const ratio = median(ratios);
  let best: DeviceSpeedUnit = 'ms';
  let bestDistance = Infinity;
  for (const unit of Object.keys(DEVICE_SPEED_FACTOR) as DeviceSpeedUnit[]) {
    // Comparaison en logarithme : un rapport de 3,6 est aussi loin de 1 que
    // 1 l'est de 0,28, ce qui rend le choix symétrique.
    const distance = Math.abs(Math.log(ratio) - Math.log(1 / DEVICE_SPEED_FACTOR[unit]));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = unit;
    }
  }
  return best;
};

/** Unité de la vitesse appareil d'une trace brute, ou `null` si elle n'en porte pas. */
export const detectTrackDeviceSpeedUnit = (points: RawTrackPoint[]): DeviceSpeedUnit | null => {
  if (!points.some((p) => p.speedMs !== undefined)) return null;
  const timesMs = spreadEqualTimes(points, points.map((p) => pointTimeMs(p.time)));
  const derived: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    derived.push(
      dt > 0
        ? haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon) / dt
        : 0
    );
  }
  return detectDeviceSpeedUnit(points.map((p) => p.speedMs), derived);
};

/**
 * Détour maximal par un point, en fois le chemin direct entre ses voisins.
 * Au-delà, et si la vitesse qu'il donne est impossible, la position a sauté.
 */
export const DEFAULT_MAX_DETOUR_RATIO = 3;

/** Plancher du chemin direct, en mètres : à l'arrêt, les voisins se confondent. */
const DETOUR_FLOOR_M = 1;

/**
 * Indices des points dont la position a sauté puis est revenue : le détour par
 * le point dépasse `maxDetourRatio` fois le chemin direct entre ses voisins, et
 * la vitesse d'entrée ou de sortie s'écarte de la vitesse directe de plus que
 * `maxAccel`. Le rapport ne dépend ni de la cadence ni de l'allure, et le test
 * ne regarde que les deux voisins, quel que soit leur écart de temps : un point
 * déplacé suivi d'un trou échappe à `clampByAcceleration`, qui cherche le
 * retour dans les 3 s (session Komoot à 41 nd, §10). La seconde condition
 * garde un vrai demi-tour serré, parcouru à vitesse constante. Deux points de
 * suite ne sont jamais écartés : le suivant d'un point écarté est sauté. Un
 * point de reprise après une pause (`segmentStart`), ou qui la précède, n'est
 * pas testé : son pas enjambe la pause.
 */
export const detourSpikes = (
  points: { lat: number; lon: number; segmentStart?: boolean }[],
  timesMs: number[],
  maxDetourRatio: number = DEFAULT_MAX_DETOUR_RATIO,
  maxAccel: number = DEFAULT_MAX_ACCELERATION
): number[] => {
  const spikes: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    if (points[i].segmentStart || points[i + 1].segmentStart) continue;
    const dtIn = (timesMs[i] - timesMs[i - 1]) / 1000;
    const dtOut = (timesMs[i + 1] - timesMs[i]) / 1000;
    if (dtIn <= 0 || dtOut <= 0) continue;
    const [p0, p1, p2] = [points[i - 1], points[i], points[i + 1]];
    const inM = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon);
    const outM = haversineDistance(p1.lat, p1.lon, p2.lat, p2.lon);
    const directM = haversineDistance(p0.lat, p0.lon, p2.lat, p2.lon);
    if ((inM + outM) / Math.max(directM, DETOUR_FLOOR_M) <= maxDetourRatio) continue;
    const directMs = directM / (dtIn + dtOut);
    const accel = Math.max((inM / dtIn - directMs) / dtIn, (outM / dtOut - directMs) / dtOut);
    if (accel <= maxAccel) continue;
    spikes.push(i);
    i++;
  }
  return spikes;
};

export interface KinematicsOptions {
  /** Largeur du filtre médian appliqué à la vitesse, en secondes. */
  medianWindowSeconds?: number;
  /** Détour maximal par un point, en fois le chemin direct entre ses voisins (`detourSpikes`). */
  maxDetourRatio?: number;
  /** Accélération maximale plausible, en m/s². */
  maxAcceleration?: number;
  /** Vitesse maximale plausible pour le support, en m/s. */
  maxSpeedMs?: number;
  /** Ignorer la vitesse de l'appareil et toujours dériver depuis les positions. */
  forceDerivedSpeed?: boolean;
  /**
   * Pas plus long que cette durée : trou de la trace, en secondes (`SportProfile.maxGapS`).
   * Défaut `Infinity` : sans profil, aucun pas n'est un trou.
   */
  maxGapS?: number;
}

/**
 * Pas d'un trou de la trace : sa distance est bornée par la corde du pas
 * multipliée par ce facteur, sans dimension (27/10). La vitesse lue à la
 * reprise ne dit rien de ce qui s'est passé pendant le trou : intégrée sur
 * toute sa durée, une reprise à 20 nœuds après 45 min d'arrêt ajouterait 27 km.
 */
export const GAP_CHORD_FACTOR = 1.5;

/** Pas plus court que cette corde, en mètres : positions identiques, le pas n'a pas de cap. */
const NULL_STEP_M = 0.01;

/**
 * Calcule vitesse et cap pour chaque point d'une trace, en m/s.
 *
 * La vitesse retenue est celle de l'appareil lorsqu'elle existe : elle vient
 * du décalage Doppler du signal satellite et ne souffre pas des sauts de
 * position. À défaut, elle est dérivée des positions successives, puis
 * écrêtée sur l'accélération et filtrée par médiane temporelle.
 *
 * Les points d'une même date sont d'abord répartis dans leur intervalle
 * (`spreadEqualTimes`) : les `timeMs` rendus sont ces dates réparties. Un pas
 * plus long que `maxGapS` (trou de la trace) porte `gapDistanceM`.
 */
export const computeKinematics = (
  points: RawTrackPoint[],
  options: KinematicsOptions = {}
): TrackPoint[] => {
  if (points.length < 2) return [];

  const medianWindowSeconds = options.medianWindowSeconds ?? DEFAULT_MEDIAN_WINDOW_S;
  const maxAcceleration = options.maxAcceleration ?? DEFAULT_MAX_ACCELERATION;
  const maxGapS = options.maxGapS ?? Infinity;

  const useDeviceSpeed =
    !options.forceDerivedSpeed && points.some((p) => p.speedMs !== undefined);
  const speedSource: SpeedSource = useDeviceSpeed ? 'doppler' : 'derived';

  const timesMs = spreadEqualTimes(points, points.map((p) => pointTimeMs(p.time)));
  const derivedSpeeds: number[] = [0];
  const chordsM: number[] = [0];
  // Cap de chaque pas ; `NaN` pour un pas nul (positions identiques), qui n'a pas de direction.
  const bearings: number[] = [NaN];

  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    const chordM = haversineDistance(p0.lat, p0.lon, p1.lat, p1.lon);
    chordsM.push(chordM);
    derivedSpeeds.push(dt > 0 ? chordM / dt : 0);
    bearings.push(chordM < NULL_STEP_M ? NaN : initialBearing(p0.lat, p0.lon, p1.lat, p1.lon));
  }

  // Reprise après une pause : le pas qui y mène enjambe la pause, ni sa vitesse
  // ni son cap ne disent rien. Le point prend ceux du pas suivant, comme le
  // premier point de la trace ; une reprise en dernier point, ceux du pas précédent.
  for (let i = points.length - 2; i >= 1; i--) {
    if (!points[i].segmentStart) continue;
    derivedSpeeds[i] = derivedSpeeds[i + 1];
    bearings[i] = bearings[i + 1];
  }
  const last = points.length - 1;
  if (last >= 2 && points[last].segmentStart) {
    derivedSpeeds[last] = derivedSpeeds[last - 1];
    bearings[last] = bearings[last - 1];
  }

  // Pas nul : il garde le cap du pas précédent (un arrêt sur place ne tourne pas
  // au nord) ; les premiers pas nuls prennent celui du premier pas qui avance.
  const firstBearing = bearings.find((b) => !Number.isNaN(b)) ?? 0;
  for (let i = 1; i < bearings.length; i++) {
    if (Number.isNaN(bearings[i])) bearings[i] = i === 1 ? firstBearing : bearings[i - 1];
  }

  // Position qui saute puis revient : les deux intervalles du point prennent
  // la vitesse et le cap du chemin direct entre ses voisins. Le point reste
  // sur la carte ; seule sa vitesse tirée des positions change. Un point qui a
  // sa vitesse Doppler n'est pas touché, son cap non plus.
  for (const i of detourSpikes(points, timesMs, options.maxDetourRatio, maxAcceleration)) {
    if (useDeviceSpeed && points[i].speedMs !== undefined) continue;
    const p0 = points[i - 1];
    const p2 = points[i + 1];
    const directMs =
      haversineDistance(p0.lat, p0.lon, p2.lat, p2.lon) / ((timesMs[i + 1] - timesMs[i - 1]) / 1000);
    const bearing = initialBearing(p0.lat, p0.lon, p2.lat, p2.lon);
    derivedSpeeds[i] = derivedSpeeds[i + 1] = directMs;
    bearings[i] = bearings[i + 1] = bearing;
  }

  // L'unité de la vitesse appareil n'est pas garantie : on la déduit.
  const deviceUnit = useDeviceSpeed
    ? detectDeviceSpeedUnit(points.map((p) => p.speedMs), derivedSpeeds)
    : 'ms';
  const deviceFactor = DEVICE_SPEED_FACTOR[deviceUnit];

  const rawSpeeds = points.map((p, i) => {
    if (!useDeviceSpeed) return derivedSpeeds[i];
    // Repli sur la vitesse dérivée pour les points où l'appareil n'a rien fourni.
    return p.speedMs === undefined ? derivedSpeeds[i] : p.speedMs * deviceFactor;
  });

  // Sans vitesse appareil, le premier point n'a pas de vitesse propre. Lui
  // donner zéro créerait un faux démarrage brutal que l'écrêtage prendrait
  // pour une aberration : on lui prête la vitesse du second point.
  if (!useDeviceSpeed && rawSpeeds.length > 1) rawSpeeds[0] = rawSpeeds[1];

  // Le premier point n'a pas de cap propre non plus. Un nord arbitraire
  // ferait, sur une trace qui démarre en route, un virage de premier point
  // que l'analyse des manœuvres prenait pour un virement : on lui prête le
  // cap du second.
  bearings[0] = bearings[1];

  const clamped = clampByAcceleration(rawSpeeds, timesMs, {
    maxAccel: maxAcceleration,
    maxSpeedMs: options.maxSpeedMs,
  });
  const smoothed = medianFilterByTime(clamped, timesMs, medianWindowSeconds);

  // Trou de la trace : la distance du pas est bornée par sa corde (`GAP_CHORD_FACTOR`).
  const gapDistances = points.map((p, i) => {
    if (i === 0 || p.segmentStart) return undefined;
    const dt = (timesMs[i] - timesMs[i - 1]) / 1000;
    if (!(dt > maxGapS)) return undefined;
    return Math.min(clamped[i] * dt, chordsM[i] * GAP_CHORD_FACTOR);
  });

  return points.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    time: p.time,
    timeMs: timesMs[i],
    ele: p.ele,
    hr: p.hr,
    cadence: p.cadence,
    speedMs: clamped[i],
    smoothedSpeedMs: smoothed[i],
    bearing: bearings[i],
    ...(p.courseDeg !== undefined ? { courseDeg: p.courseDeg } : {}),
    speedSource,
    ...(p.segmentStart ? { segmentStart: true as const } : {}),
    ...(gapDistances[i] !== undefined ? { gapDistanceM: gapDistances[i] } : {}),
  }));
};
