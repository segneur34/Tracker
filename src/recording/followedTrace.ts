import { partitionPoint } from '../core/search';
import { projectOnSegment } from '../core/geoPlane';
import { cumulativeDistancesM, haversineDistance } from '../core/geo';
import { simplifyLatLon } from '../core/simplify';
import type { LatLon } from '../core/types';
import { routePoints } from '../planning/route';
import { recordToRoute, routeMarkGuide, type RouteRecord } from '../planning/routeRecord';
import type { MarkGuideSettings } from './markGuide';

/**
 * Trace suivie pendant un enregistrement : un itinéraire rangé ou une session
 * déjà enregistrée, dessinée sous la trace en cours pour s'y guider, avec la
 * distance restante le long de la trace (`followProgress`). Pas d'alerte hors
 * trace : décision de l'utilisateur.
 */

export type FollowedSource = 'route' | 'session';

export interface FollowedTrace {
  name: string;
  source: FollowedSource;
  /**
   * Activité de l'itinéraire ou de la session suivie, proposée pour
   * l'enregistrement qui la suit ; `null` : aucune.
   */
  activityId: string | null;
  points: LatLon[];
  /**
   * Points posés de l'itinéraire, départ compris, dans l'ordre : les balises
   * du guidage des balises (voile, surf) (`markGuide.ts`). Absentes pour une session suivie.
   */
  marks?: LatLon[];
  /** Bips d'approche propres au parcours suivi ; absents : ceux de l'activité. */
  markGuide?: MarkGuideSettings;
}

/** Positions exploitables seulement, sans le reste du point. */
const usable = (points: ReadonlyArray<LatLon>): LatLon[] =>
  points.filter((p) => isFinite(p.lat) && isFinite(p.lon)).map(({ lat, lon }) => ({ lat, lon }));

/** Trace faite des positions données ; `null` sous deux positions exploitables. Balises gardées s'il en reste. */
export const followedTraceFromPoints = (
  points: ReadonlyArray<LatLon>,
  name: string,
  source: FollowedSource,
  activityId: string | null = null,
  marks?: ReadonlyArray<LatLon>
): FollowedTrace | null => {
  const kept = usable(points);
  if (kept.length < 2) return null;
  const keptMarks = marks ? usable(marks) : [];
  return keptMarks.length > 0 ? { name, source, activityId, points: kept, marks: keptMarks } : { name, source, activityId, points: kept };
};

/**
 * Trace d'un itinéraire rangé : ses tronçons à la suite ; un tronçon jamais
 * calculé y figure en ligne droite, comme sur la page Itinéraires. Elle garde
 * l'activité choisie pour l'itinéraire, ses points en balises, et ses bips
 * d'approche s'il en a de propres.
 */
export const followedTraceFromRoute = (record: RouteRecord): FollowedTrace | null => {
  const route = recordToRoute(record);
  const trace = followedTraceFromPoints(routePoints(route), record.name, 'route', record.activityId, route.waypoints);
  const markGuide = routeMarkGuide(record);
  return trace && markGuide ? { ...trace, markGuide } : trace;
};

/**
 * Écart toléré quand la trace suivie est amincie pour être gardée sur
 * l'appareil, en mètres : très en deçà de l'écart qui la quitte
 * (`FOLLOW_DEFAULTS.maxOffsetM`), et du bruit du GPS.
 */
export const FOLLOWED_TRACE_TOLERANCE_M = 2;

/** Arrondi des positions gardées : 1e-6° vaut 0,1 m. */
const roundDeg = (deg: number): number => Math.round(deg * 1e6) / 1e6;

/**
 * Trace suivie amincie pour être gardée sur l'appareil (`tracker.followedTrace`) :
 * points simplifiés à `toleranceM` près, bouts compris (`simplifyLatLon`), et
 * positions arrondies. Trois heures à 1 Hz pèsent plusieurs centaines de Ko
 * sinon, réécrites avec chaque réglage sur le téléphone. Les balises ne
 * bougent jamais.
 */
export const thinFollowedTrace = (trace: FollowedTrace, toleranceM: number): FollowedTrace => ({
  ...trace,
  points: simplifyLatLon(trace.points, toleranceM).map((p) => ({ lat: roundDeg(p.lat), lon: roundDeg(p.lon) })),
});

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
    cum = cumulativeDistancesM(trace.points);
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
 * Projection de `p` sur le tronçon `i` de la trace (plan local de
 * `core/geoPlane.ts`), avec la distance le long de la trace du pied.
 */
const projectOnTrace = (p: LatLon, points: LatLon[], cum: number[], i: number): Projection => {
  const { t, distanceM } = projectOnSegment(p, points[i], points[i + 1]);
  return { offsetM: distanceM, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
};

/** Premier tronçon dont la fin est au-delà de `alongM` (recherche dichotomique). */
const firstSegmentReaching = (cum: number[], alongM: number): number =>
  partitionPoint(cum.length - 2, (i) => cum[i + 1] < alongM);

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
    const proj = projectOnTrace(p, points, cum, i);
    minOffsetM = Math.min(minOffsetM, proj.offsetM);
    if (proj.offsetM <= maxOffsetM && proj.alongM >= fromM) {
      if (!best || proj.offsetM < best.offsetM) best = proj;
    } else if (best) {
      break;
    }
  }
  return { anchor: best, minOffsetM };
};

/** État du suivi, position après position : l'avancement, et ce qui le fait bouger. */
interface FollowState {
  progressM: number | null;
  /** Distance faite depuis le dernier accrochage, en mètres. */
  travelledM: number;
  previous: LatLon | null;
  /** Hors trace : position du dernier essai, et écart minimal alors mesuré. */
  probe: LatLon | null;
  probeOffsetM: number;
}

const initialFollowState = (): FollowState => ({ progressM: null, travelledM: 0, previous: null, probe: null, probeOffsetM: 0 });

/** Avance le suivi d'une position. */
const stepFollow = (s: FollowState, p: LatLon, points: LatLon[], cum: number[], options: FollowOptions): void => {
  if (s.previous) s.travelledM += haversineDistance(s.previous.lat, s.previous.lon, p.lat, p.lon);
  s.previous = p;

  /** Accroche à la suite de la trace, depuis `fromM` ; rend faux si elle reste hors de portée. */
  const anchorAhead = (fromM: number): boolean => {
    // Tant que la position n'a pas bougé de quoi rejoindre la trace, inutile de la chercher.
    if (s.probe && haversineDistance(s.probe.lat, s.probe.lon, p.lat, p.lon) < s.probeOffsetM - options.maxOffsetM) return false;
    const { anchor, minOffsetM } = anchorFrom(p, points, cum, options.maxOffsetM, fromM);
    s.probe = p;
    s.probeOffsetM = minOffsetM;
    if (!anchor) return false;
    s.progressM = anchor.alongM;
    s.travelledM = 0;
    s.probe = null;
    return true;
  };

  if (s.progressM === null) {
    anchorAhead(0);
    return;
  }

  const lo = s.progressM - options.backM;
  const hi = s.progressM + options.aheadM + s.travelledM;
  let best: Projection | null = null;
  for (let i = firstSegmentReaching(cum, lo); i < points.length - 1 && cum[i] <= hi; i++) {
    const proj = projectOnTrace(p, points, cum, i);
    if (proj.offsetM <= options.maxOffsetM && proj.alongM >= lo && proj.alongM <= hi
      && (!best || proj.offsetM < best.offsetM)) best = proj;
  }
  if (best) {
    s.progressM = best.alongM;
    s.travelledM = 0;
    s.probe = null;
  } else {
    anchorAhead(hi);
  }
};

const progressOf = (s: FollowState, totalM: number): FollowProgress | null =>
  s.progressM === null ? null : { progressM: s.progressM, totalM, remainingM: Math.max(0, totalM - s.progressM) };

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
  const state = initialFollowState();
  for (const segment of segments) for (const p of segment) stepFollow(state, p, points, cum, options);
  return progressOf(state, cum[cum.length - 1]);
};

/** Suivi repris d'un appel à l'autre (`createFollowCursor`). */
export interface FollowCursor {
  /** L'avancement sur ces segments : celui de `followProgress`, sans relire ce qui l'a déjà été. */
  progress: (segments: ReadonlyArray<ReadonlyArray<LatLon>>) => FollowProgress | null;
}

/**
 * `followProgress` repris d'un appel à l'autre, pour le direct (27/10) : tant
 * que les segments ne font que s'allonger (segments fermés inchangés, dernier
 * segment prolongé, la dernière position lue de chacun étant le même objet),
 * seules les positions nouvelles sont lues ; sinon, tout est rejoué. Le
 * résultat est celui de `followProgress`.
 */
export const createFollowCursor = (trace: FollowedTrace, options: FollowOptions = FOLLOW_DEFAULTS): FollowCursor => {
  const { points } = trace;
  const cum = cumulativeOf(trace);
  const totalM = cum[cum.length - 1];
  let state = initialFollowState();
  /** Positions lues par segment, et la dernière lue de chacun. */
  let consumed: { count: number; last: LatLon | null }[] = [];
  return {
    progress(segments) {
      let resumable = segments.length >= consumed.length;
      for (let k = 0; resumable && k < consumed.length; k++) {
        const segment = segments[k];
        const { count, last } = consumed[k];
        const closed = k < consumed.length - 1;
        if (segment.length < count || (closed && segment.length !== count)) resumable = false;
        else if (count > 0 && segment[count - 1] !== last) resumable = false;
      }
      if (!resumable) {
        state = initialFollowState();
        consumed = [];
      }
      for (let k = 0; k < segments.length; k++) {
        const segment = segments[k];
        for (let i = consumed[k]?.count ?? 0; i < segment.length; i++) stepFollow(state, segment[i], points, cum, options);
        consumed[k] = { count: segment.length, last: segment.length > 0 ? segment[segment.length - 1] : null };
      }
      return progressOf(state, totalM);
    },
  };
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
