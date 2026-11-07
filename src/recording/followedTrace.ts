import { smoothElevationAlong } from '../core/elevation';
import { partitionPoint } from '../core/search';
import { projectOnSegment } from '../core/geoPlane';
import { cumulativeDistancesM, haversineDistance } from '../core/geo';
import { simplifyAlongElevation } from '../core/simplify';
import type { LatLon } from '../core/types';
import { DEFAULT_IMPORT_SMOOTHING_M, routePoints } from '../planning/route';
import { recordToRoute, routeMarkGuide, type RouteRecord } from '../planning/routeRecord';
import type { MarkGuideSettings } from './markGuide';

/**
 * Trace suivie pendant un enregistrement : un itinéraire rangé ou une session
 * déjà enregistrée, dessinée sous la trace en cours pour s'y guider, avec la
 * distance restante le long de la trace (`followProgress`). L'avancement suit
 * la position de proche en proche ; il ne saute plus loin qu'une fois ce saut
 * confirmé par une avance réelle le long de la trace, pour qu'un bref hors-piste
 * près d'une autre partie ne la compte pas comme faite. Pas d'alerte hors trace :
 * décision de l'utilisateur.
 */

export type FollowedSource = 'route' | 'session';

/** Point de la trace suivie ; altitude en mètres quand l'itinéraire ou la session en donne une lisible. */
export interface FollowedPoint extends LatLon {
  eleM?: number;
}

export interface FollowedTrace {
  name: string;
  source: FollowedSource;
  /**
   * Activité de l'itinéraire ou de la session suivie, proposée pour
   * l'enregistrement qui la suit ; `null` : aucune.
   */
  activityId: string | null;
  points: FollowedPoint[];
  /**
   * Points posés de l'itinéraire, départ compris, dans l'ordre : les balises
   * du guidage des balises (voile, surf) (`markGuide.ts`). Absentes pour une session suivie.
   */
  marks?: LatLon[];
  /** Bips d'approche propres au parcours suivi ; absents : ceux de l'activité. */
  markGuide?: MarkGuideSettings;
}

/** Positions exploitables seulement, avec leur altitude si elle est lisible, sans le reste du point. */
const usable = (points: ReadonlyArray<FollowedPoint>): FollowedPoint[] =>
  points.filter((p) => isFinite(p.lat) && isFinite(p.lon)).map(({ lat, lon, eleM }) =>
    (typeof eleM === 'number' && isFinite(eleM) ? { lat, lon, eleM } : { lat, lon }));

/** Trace faite des positions données ; `null` sous deux positions exploitables. Balises gardées s'il en reste. */
export const followedTraceFromPoints = (
  points: ReadonlyArray<FollowedPoint>,
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
 * Trace d'une session déjà enregistrée. À terre (`land`), son altitude la suit :
 * celle du GPS, bruitée de quelques mètres, lissée sur `smoothingM` mètres le
 * long de la trace comme un GPX chargé en itinéraire (`routeFromTrack`), sur la
 * distance et non le nombre de points (règle 2). Ailleurs, les positions seules.
 */
export const followedTraceFromSession = (
  points: ReadonlyArray<LatLon & { ele?: number }>,
  name: string,
  activityId: string | null,
  { land, smoothingM = DEFAULT_IMPORT_SMOOTHING_M }: { land: boolean; smoothingM?: number }
): FollowedTrace | null => {
  if (!land) return followedTraceFromPoints(points, name, 'session', activityId);
  const located = points.filter((p) => isFinite(p.lat) && isFinite(p.lon));
  const smoothed = smoothElevationAlong(located.map((p) => p.ele ?? NaN), cumulativeDistancesM(located), smoothingM);
  return followedTraceFromPoints(located.map((p, i) => ({ lat: p.lat, lon: p.lon, eleM: smoothed[i] })), name, 'session', activityId);
};

/**
 * Écart toléré quand la trace suivie est amincie pour être gardée sur
 * l'appareil, en mètres : très en deçà de l'écart qui la quitte
 * (`FOLLOW_DEFAULTS.maxOffsetM`), et du bruit du GPS.
 */
export const FOLLOWED_TRACE_TOLERANCE_M = 2;

/**
 * Écart d'altitude toléré au même amincissement, en mètres : très en deçà du
 * plus petit dénivelé compté (`ELEVATION_PRESETS.route.minGainM`).
 */
export const FOLLOWED_TRACE_ELEVATION_TOLERANCE_M = 1;

/** Arrondi des positions gardées : 1e-6° vaut 0,1 m. */
const roundDeg = (deg: number): number => Math.round(deg * 1e6) / 1e6;

/** Arrondi des altitudes gardées : 0,1 m. */
const roundEle = (eleM: number): number => Math.round(eleM * 10) / 10;

/**
 * Trace suivie amincie pour être gardée sur l'appareil (`tracker.followedTrace`) :
 * points simplifiés à `toleranceM` près, bouts compris, relief à
 * `elevationToleranceM` près (`simplifyAlongElevation`), et valeurs arrondies.
 * Trois heures à 1 Hz pèsent plusieurs centaines de Ko sinon, réécrites avec
 * chaque réglage sur le téléphone. Les balises ne bougent jamais.
 */
export const thinFollowedTrace = (
  trace: FollowedTrace,
  toleranceM: number,
  elevationToleranceM: number = FOLLOWED_TRACE_ELEVATION_TOLERANCE_M
): FollowedTrace => ({
  ...trace,
  points: simplifyAlongElevation(trace.points, toleranceM, elevationToleranceM).map(({ lat, lon, eleM }) =>
    (eleM !== undefined ? { lat: roundDeg(lat), lon: roundDeg(lon), eleM: roundEle(eleM) } : { lat: roundDeg(lat), lon: roundDeg(lon) })),
});

export interface FollowOptions {
  /** Écart au-delà duquel une position n'est pas sur la trace, en mètres. */
  maxOffsetM: number;
  /** Recul toléré de l'avancement (bruit du GPS), en mètres. */
  backM: number;
  /**
   * Avance cherchée d'une position à la suivante, en plus de la distance entre
   * les deux, en mètres. Un accrochage dans cette avance est immédiat ; de même
   * le premier, s'il tombe à cette distance du départ au plus.
   */
  aheadM: number;
  /** Avance réelle le long de la trace qui valide un accrochage plus lointain, en mètres. */
  confirmAheadM: number;
  /**
   * Écart à la trace en deçà duquel deux passages à portée se valent, en mètres :
   * c'est alors la suite attendue qui tranche (demi-tour d'un aller-retour, croisement).
   */
  tieOffsetM: number;
}

export const FOLLOW_DEFAULTS: FollowOptions = {
  maxOffsetM: 60,
  backM: 30,
  aheadM: 100,
  confirmAheadM: 80,
  tieOffsetM: 10,
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
  /** Pied sur le tronçon, de 0 à 1 : 0 ou 1 quand il bute sur un bout. */
  t: number;
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
  return { t, offsetM: distanceM, alongM: cum[i] + t * (cum[i + 1] - cum[i]) };
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

/**
 * Passage de la trace retenu entre `loM` et `hiM`. Un tronçon dont le pied bute
 * sur le bout partagé avec un voisin plus proche n'est pas un passage. À écart
 * quasi égal (`tieOffsetM`), le plus proche de `expectedM`, ni le premier trouvé
 * ni celui de devant : l'aller et le retour d'un aller-retour se recouvrent, et
 * le demi-tour ne doit venir ni trop tôt ni jamais.
 */
const closestInWindow = (
  p: LatLon, points: LatLon[], cum: number[], options: FollowOptions, loM: number, hiM: number, expectedM: number
): Projection | null => {
  const seen: Projection[] = [];
  for (let i = firstSegmentReaching(cum, loM); i < points.length - 1 && cum[i] <= hiM; i++) seen.push(projectOnTrace(p, points, cum, i));
  const inRange = (f: Projection | undefined): f is Projection =>
    f !== undefined && f.offsetM <= options.maxOffsetM && f.alongM >= loM && f.alongM <= hiM;
  const feet = seen.filter((f, k) => {
    const before = seen[k - 1];
    const after = seen[k + 1];
    return inRange(f) && !(f.t === 0 && inRange(before) && before.offsetM < f.offsetM) && !(f.t === 1 && inRange(after) && after.offsetM < f.offsetM);
  });
  const minOffsetM = Math.min(...feet.map((f) => f.offsetM));
  let best: Projection | null = null;
  for (const f of feet) {
    if (f.offsetM > minOffsetM + options.tieOffsetM) continue;
    if (!best || Math.abs(f.alongM - expectedM) < Math.abs(best.alongM - expectedM)) best = f;
  }
  return best;
};

/** Accrochage lointain en attente de validation. */
interface PendingAnchor {
  /** Distance le long de la trace où il a été vu, et la plus loin atteinte depuis, en mètres. */
  startM: number;
  highM: number;
  /** Distance réellement faite depuis qu'il a été vu, en mètres. */
  travelledM: number;
}

/** État du suivi, position après position : l'avancement, et ce qui le fait bouger. */
interface FollowState {
  progressM: number | null;
  /** Distance faite depuis le dernier accrochage, en mètres. */
  travelledM: number;
  previous: LatLon | null;
  /** Hors trace : position du dernier essai, et écart minimal alors mesuré. */
  probe: LatLon | null;
  probeOffsetM: number;
  pending: PendingAnchor | null;
}

const initialFollowState = (): FollowState => ({ progressM: null, travelledM: 0, previous: null, probe: null, probeOffsetM: 0, pending: null });

/** Pose l'avancement. */
const settleAt = (s: FollowState, alongM: number): void => {
  s.progressM = alongM;
  s.travelledM = 0;
  s.probe = null;
  s.pending = null;
};

/**
 * Position hors de la fenêtre : l'avancement ne bouge pas, sauf accrochage
 * proche du départ ou accrochage lointain validé. Le candidat est le premier
 * passage à portée au-delà de la fenêtre, réexaminé à chaque position : perdu
 * s'il n'est plus à portée, repris de plus tôt s'il recule (au-delà du bruit,
 * `backM`) ou si un passage antérieur devient à portée. La validation demande
 * `confirmAheadM` gagnés le long de la trace et autant de distance réellement
 * faite : un pas de côté entre deux lacets ne compte pas, un long intervalle si.
 */
const seekFarAnchor = (s: FollowState, p: LatLon, hopM: number, points: LatLon[], cum: number[], options: FollowOptions): void => {
  if (s.pending) {
    s.pending.travelledM += hopM;
  } else if (s.probe && haversineDistance(s.probe.lat, s.probe.lon, p.lat, p.lon) < s.probeOffsetM - options.maxOffsetM) {
    // Tant que la position n'a pas bougé de quoi rejoindre la trace, inutile de la chercher.
    return;
  }
  const fromM = s.progressM === null ? 0 : s.progressM + options.aheadM;
  const { anchor, minOffsetM } = anchorFrom(p, points, cum, options.maxOffsetM, fromM);
  if (!anchor) {
    s.pending = null;
    s.probe = p;
    s.probeOffsetM = minOffsetM;
    return;
  }
  s.probe = null;
  if (s.progressM === null && anchor.alongM <= options.aheadM) {
    settleAt(s, anchor.alongM);
    return;
  }
  const { pending } = s;
  if (pending && anchor.alongM >= pending.highM - options.backM) {
    const next = closestInWindow(p, points, cum, options, pending.highM - options.backM, pending.highM + options.aheadM + hopM, pending.highM + hopM);
    if (next) {
      pending.highM = Math.max(pending.highM, next.alongM);
      if (Math.min(pending.highM - pending.startM, pending.travelledM) >= options.confirmAheadM) settleAt(s, next.alongM);
      return;
    }
  }
  s.pending = { startM: anchor.alongM, highM: anchor.alongM, travelledM: 0 };
};

/** Avance le suivi d'une position. */
const stepFollow = (s: FollowState, p: LatLon, points: LatLon[], cum: number[], options: FollowOptions): void => {
  const hopM = s.previous ? haversineDistance(s.previous.lat, s.previous.lon, p.lat, p.lon) : 0;
  s.travelledM += hopM;
  s.previous = p;
  if (s.progressM !== null) {
    const near = closestInWindow(p, points, cum, options, s.progressM - options.backM, s.progressM + options.aheadM + hopM, s.progressM + s.travelledM);
    if (near) {
      settleAt(s, near.alongM);
      return;
    }
  }
  seekFarAnchor(s, p, hopM, points, cum, options);
};

const progressOf = (s: FollowState, totalM: number): FollowProgress | null =>
  s.progressM === null ? null : { progressM: s.progressM, totalM, remainingM: Math.max(0, totalM - s.progressM) };

/**
 * Avancement le long de la trace suivie, rejoué sur toute la trace enregistrée
 * à chaque appel : sans état, il vaut aussi pour une session récupérée après
 * un plantage. Une position cherche d'abord la trace dans une fenêtre autour de
 * l'avancement, élargie du dernier intervalle seul (cadence variable) : à écart
 * quasi égal, c'est le passage le plus proche de la suite attendue qui compte,
 * et l'avancement ne saute ni à un croisement ni sur le retour d'un aller-retour.
 * Hors de cette fenêtre, il ne bouge pas : un accrochage plus loin (raccourci,
 * départ en cours de trace) n'est retenu qu'après `confirmAheadM` parcourus vers
 * l'avant le long de la trace, jamais en arrière, et un premier accrochage n'est
 * immédiat qu'à `aheadM` du départ au plus. Courir la trace à contresens ne fait
 * donc pas avancer (limite assumée). `null` tant qu'aucun accrochage n'est retenu.
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
