import { EARTH_RADIUS_M, haversineDistance, toRad } from '../core/kinematics';
import { cumulativeDistances, routePoints } from '../planning/route';
import { recordToRoute, type RouteRecord } from '../planning/routeRecord';

/**
 * Trace suivie pendant un enregistrement : un itinéraire rangé ou une session
 * déjà enregistrée, dessinée sous la trace en cours pour s'y guider, avec la
 * distance restante le long de la trace (`followProgress`). Pas d'alerte hors
 * trace : décision de l'utilisateur.
 */

export type FollowedSource = 'route' | 'session';

interface LatLon {
  lat: number;
  lon: number;
}

export interface FollowedTrace {
  name: string;
  source: FollowedSource;
  points: LatLon[];
}

/** Trace faite des positions données ; `null` sous deux positions exploitables. */
export const followedTraceFromPoints = (
  points: ReadonlyArray<LatLon>,
  name: string,
  source: FollowedSource
): FollowedTrace | null => {
  const kept = points
    .filter((p) => isFinite(p.lat) && isFinite(p.lon))
    .map(({ lat, lon }) => ({ lat, lon }));
  return kept.length >= 2 ? { name, source, points: kept } : null;
};

/**
 * Trace d'un itinéraire rangé : ses tronçons à la suite ; un tronçon jamais
 * calculé y figure en ligne droite, comme sur la page Itinéraires.
 */
export const followedTraceFromRoute = (record: RouteRecord): FollowedTrace | null =>
  followedTraceFromPoints(routePoints(recordToRoute(record)), record.name, 'route');

export interface FollowOptions {
  /** Écart au-delà duquel une position n'est pas sur la trace, en mètres. */
  maxOffsetM: number;
  /** Recul toléré de l'avancement (bruit du GPS), en mètres. */
  backM: number;
  /** Avance cherchée au-delà de la distance parcourue depuis le dernier accrochage, en mètres. */
  aheadM: number;
}

export const FOLLOW_DEFAULTS: FollowOptions = {
  maxOffsetM: 60,
  backM: 30,
  aheadM: 100,
};

export interface FollowProgress {
  /** Distance faite le long de la trace, en mètres. */
  progressM: number;
  totalM: number;
  remainingM: number;
}

/** Distances cumulées d'une trace, calculées une fois par trace. */
const cumulativeCache = new WeakMap<FollowedTrace, number[]>();

const cumulativeOf = (trace: FollowedTrace): number[] => {
  let cum = cumulativeCache.get(trace);
  if (!cum) {
    cum = cumulativeDistances(trace.points);
    cumulativeCache.set(trace, cum);
  }
  return cum;
};

/** Longueur de la trace, en mètres. */
export const followedTraceLengthM = (trace: FollowedTrace): number => {
  const cum = cumulativeOf(trace);
  return cum[cum.length - 1];
};

interface Projection {
  /** Écart de la position au tronçon, en mètres. */
  offsetM: number;
  /** Distance le long de la trace du point projeté, en mètres. */
  alongM: number;
}

/**
 * Projection de `p` sur le tronçon `i` de la trace, en plan local
 * équirectangulaire centré sur `p` : exact à mieux que le mètre aux échelles
 * d'un écart à la trace.
 */
const projectOnSegment = (p: LatLon, points: LatLon[], cum: number[], i: number): Projection => {
  const cosLat = Math.cos(toRad(p.lat));
  const x = (q: LatLon) => toRad(q.lon - p.lon) * cosLat * EARTH_RADIUS_M;
  const y = (q: LatLon) => toRad(q.lat - p.lat) * EARTH_RADIUS_M;
  const ax = x(points[i]);
  const ay = y(points[i]);
  const dx = x(points[i + 1]) - ax;
  const dy = y(points[i + 1]) - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
  return {
    offsetM: Math.hypot(ax + t * dx, ay + t * dy),
    alongM: cum[i] + t * (cum[i + 1] - cum[i]),
  };
};

/** Premier tronçon dont la fin est au-delà de `alongM` (recherche dichotomique). */
const firstSegmentReaching = (cum: number[], alongM: number): number => {
  let lo = 0;
  let hi = cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid + 1] < alongM) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/**
 * Accrochage à partir de `fromM` : parmi les tronçons à portée, la première
 * suite continue dans l'ordre de la trace, et le plus proche de cette suite.
 * Une boucle dont le départ et l'arrivée se confondent part ainsi de 0, non de
 * sa longueur. Rend aussi l'écart le plus faible, qui dit jusqu'où la position
 * peut bouger sans pouvoir rejoindre la trace.
 */
const anchorFrom = (
  p: LatLon, points: LatLon[], cum: number[], maxOffsetM: number, fromM: number
): { anchor: Projection | null; minOffsetM: number } => {
  let best: Projection | null = null;
  let minOffsetM = Infinity;
  for (let i = firstSegmentReaching(cum, fromM); i < points.length - 1; i++) {
    const proj = projectOnSegment(p, points, cum, i);
    minOffsetM = Math.min(minOffsetM, proj.offsetM);
    if (proj.offsetM <= maxOffsetM && proj.alongM >= fromM) {
      if (!best || proj.offsetM < best.offsetM) best = proj;
    } else if (best) {
      break;
    }
  }
  return { anchor: best, minOffsetM };
};

/**
 * Avancement le long de la trace suivie, rejoué sur toute la trace enregistrée
 * à chaque appel : sans état, il vaut aussi pour une session récupérée après
 * un plantage. Après le premier accrochage, une position cherche d'abord la
 * trace dans une fenêtre autour de l'avancement, élargie de la distance faite
 * depuis le dernier accrochage : l'avancement ne saute ni à un croisement ni
 * sur le retour d'un aller-retour. Hors de cette fenêtre, l'avancement ne
 * bouge pas tant que la position n'approche pas la suite de la trace ; il s'y
 * raccroche alors (raccourci), jamais en arrière. `null` tant que la trace
 * n'a pas été rejointe.
 */
export const followProgress = (
  trace: FollowedTrace,
  segments: ReadonlyArray<ReadonlyArray<LatLon>>,
  options: FollowOptions = FOLLOW_DEFAULTS
): FollowProgress | null => {
  const { points } = trace;
  const cum = cumulativeOf(trace);
  const totalM = cum[cum.length - 1];

  let progressM: number | null = null;
  let travelledM = 0;
  let previous: LatLon | null = null;
  // Hors trace : position du dernier essai, et écart minimal alors mesuré.
  let probe: LatLon | null = null;
  let probeOffsetM = 0;

  for (const segment of segments) {
    for (const p of segment) {
      if (previous) travelledM += haversineDistance(previous.lat, previous.lon, p.lat, p.lon);
      previous = p;

      /** Accroche à la suite de la trace, depuis `fromM` ; rend faux si elle reste hors de portée. */
      const anchorAhead = (fromM: number): boolean => {
        // Tant que la position n'a pas bougé de quoi rejoindre la trace, inutile de la chercher.
        if (probe && haversineDistance(probe.lat, probe.lon, p.lat, p.lon) < probeOffsetM - options.maxOffsetM) return false;
        const { anchor, minOffsetM } = anchorFrom(p, points, cum, options.maxOffsetM, fromM);
        probe = p;
        probeOffsetM = minOffsetM;
        if (!anchor) return false;
        progressM = anchor.alongM;
        travelledM = 0;
        probe = null;
        return true;
      };

      if (progressM === null) {
        anchorAhead(0);
        continue;
      }

      const lo = progressM - options.backM;
      const hi = progressM + options.aheadM + travelledM;
      let best: Projection | null = null;
      for (let i = firstSegmentReaching(cum, lo); i < points.length - 1 && cum[i] <= hi; i++) {
        const proj = projectOnSegment(p, points, cum, i);
        if (proj.offsetM <= options.maxOffsetM && proj.alongM >= lo && proj.alongM <= hi
          && (!best || proj.offsetM < best.offsetM)) best = proj;
      }
      if (best) {
        progressM = best.alongM;
        travelledM = 0;
        probe = null;
      } else {
        anchorAhead(hi);
      }
    }
  }

  return progressM === null ? null : { progressM, totalM, remainingM: Math.max(0, totalM - progressM) };
};

/**
 * Trace coupée à `progressM` : la partie faite et le reste, qui partagent le
 * point de coupe. Pour la carte.
 */
export const splitFollowedTrace = (
  trace: FollowedTrace,
  progressM: number
): { done: LatLon[]; remaining: LatLon[] } => {
  const { points } = trace;
  const cum = cumulativeOf(trace);
  if (progressM <= 0) return { done: [], remaining: points };
  if (progressM >= cum[cum.length - 1]) return { done: points, remaining: [] };
  const i = firstSegmentReaching(cum, progressM);
  const span = cum[i + 1] - cum[i];
  const t = span > 0 ? (progressM - cum[i]) / span : 0;
  const cut = {
    lat: points[i].lat + t * (points[i + 1].lat - points[i].lat),
    lon: points[i].lon + t * (points[i + 1].lon - points[i].lon),
  };
  return { done: [...points.slice(0, i + 1), cut], remaining: [cut, ...points.slice(i + 1)] };
};
