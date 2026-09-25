import { accumulateElevation } from '../core/elevation';
import { haversineDistance } from '../core/kinematics';
import { computeGrades } from '../running/runningAnalytics';

/**
 * Itinéraire planifié : des points de passage posés par l'utilisateur, reliés
 * deux à deux par des tronçons. Un tronçon suit les chemins de la carte
 * (calcul par un serveur, `brouter.ts`) ou va en ligne droite.
 *
 * Toutes les opérations sont pures : elles rendent un nouvel itinéraire, où
 * les tronçons à recalculer sont marqués `pending`. Un tronçon en attente
 * garde une géométrie provisoire (la ligne droite, ou l'ancien tracé quand on
 * inverse le sens) pour que la carte ne clignote pas.
 *
 * Unités SI (règle 1) : mètres, degrés décimaux.
 */

export interface Waypoint {
  lat: number;
  lon: number;
}

/** Façon de relier deux points : à pied, à vélo, en VTT, ou en ligne droite. */
export type RouteMode = 'foot' | 'bike' | 'mtb' | 'straight';

export const ROUTE_MODES: RouteMode[] = ['foot', 'bike', 'mtb', 'straight'];

export const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  foot: 'À pied',
  bike: 'Vélo',
  mtb: 'VTT',
  straight: 'Ligne droite',
};

export const isRouteMode = (value: unknown): value is RouteMode =>
  typeof value === 'string' && (ROUTE_MODES as string[]).includes(value);

/** Point de la géométrie d'un tronçon ; altitude en mètres quand le calcul la fournit. */
export interface RoutePoint {
  lat: number;
  lon: number;
  eleM?: number;
}

/** `pending` : à calculer ; `ready` : géométrie définitive ; `error` : le calcul a échoué, ligne droite gardée. */
export type LegStatus = 'pending' | 'ready' | 'error';

export interface RouteLeg {
  mode: RouteMode;
  status: LegStatus;
  /** Géométrie, du point de départ du tronçon à son point d'arrivée. */
  points: RoutePoint[];
  /** Raison de l'échec, en clair, si `status` vaut `error`. */
  error?: string;
}

/** `legs[i]` relie `waypoints[i]` à `waypoints[i + 1]` : un tronçon de moins que de points. */
export interface PlannedRoute {
  waypoints: Waypoint[];
  legs: RouteLeg[];
}

export const EMPTY_ROUTE: PlannedRoute = { waypoints: [], legs: [] };

/** Tronçon neuf entre deux points : prêt s'il va en ligne droite, à calculer sinon. */
export const newLeg = (from: Waypoint, to: Waypoint, mode: RouteMode): RouteLeg => ({
  mode,
  status: mode === 'straight' ? 'ready' : 'pending',
  points: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
});

/** Ajoute un point à la fin ; le tronçon qui y mène prend le mode donné. */
export const addWaypoint = (route: PlannedRoute, waypoint: Waypoint, mode: RouteMode): PlannedRoute => {
  const last = route.waypoints[route.waypoints.length - 1];
  return {
    waypoints: [...route.waypoints, waypoint],
    legs: last ? [...route.legs, newLeg(last, waypoint, mode)] : route.legs,
  };
};

/** Insère un point au milieu du tronçon `legIndex`, qui devient deux tronçons du même mode. */
export const insertWaypoint = (route: PlannedRoute, legIndex: number, waypoint: Waypoint): PlannedRoute => {
  const leg = route.legs[legIndex];
  if (!leg) return route;
  const from = route.waypoints[legIndex];
  const to = route.waypoints[legIndex + 1];
  return {
    waypoints: [...route.waypoints.slice(0, legIndex + 1), waypoint, ...route.waypoints.slice(legIndex + 1)],
    legs: [
      ...route.legs.slice(0, legIndex),
      newLeg(from, waypoint, leg.mode),
      newLeg(waypoint, to, leg.mode),
      ...route.legs.slice(legIndex + 1),
    ],
  };
};

/**
 * Déplace un point : seuls les tronçons qui le touchent sont à recalculer.
 * Sur une boucle, départ et arrivée ne font qu'un point : ils bougent ensemble
 * et la boucle reste fermée.
 */
export const moveWaypoint = (route: PlannedRoute, index: number, waypoint: Waypoint): PlannedRoute => {
  const last = route.waypoints.length - 1;
  if (index < 0 || index > last) return route;
  const moved = isLooped(route) && (index === 0 || index === last) ? [0, last] : [index];
  const waypoints = route.waypoints.map((w, i) => (moved.includes(i) ? waypoint : w));
  const legs = route.legs.map((leg, i) =>
    moved.includes(i) || moved.includes(i + 1) ? newLeg(waypoints[i], waypoints[i + 1], leg.mode) : leg
  );
  return { waypoints, legs };
};

/**
 * Retire un point. Au milieu, ses deux tronçons sont remplacés par un seul,
 * qui garde le mode de celui qui arrivait au point.
 */
export const removeWaypoint = (route: PlannedRoute, index: number): PlannedRoute => {
  const n = route.waypoints.length;
  if (index < 0 || index >= n) return route;
  const waypoints = route.waypoints.filter((_, i) => i !== index);
  if (index === 0) return { waypoints, legs: route.legs.slice(1) };
  if (index === n - 1) return { waypoints, legs: route.legs.slice(0, -1) };
  const merged = newLeg(route.waypoints[index - 1], route.waypoints[index + 1], route.legs[index - 1].mode);
  return { waypoints, legs: [...route.legs.slice(0, index - 1), merged, ...route.legs.slice(index + 1)] };
};

/** Change le mode d'un tronçon, qui est alors recalculé. */
export const setLegMode = (route: PlannedRoute, legIndex: number, mode: RouteMode): PlannedRoute => {
  const leg = route.legs[legIndex];
  if (!leg || leg.mode === mode) return route;
  const legs = route.legs.map((l, i) =>
    i === legIndex ? newLeg(route.waypoints[i], route.waypoints[i + 1], mode) : l
  );
  return { ...route, legs };
};

/**
 * Parcours dans l'autre sens. Les tronçons calculés sont recalculés (un sens
 * unique peut changer le trajet à vélo) ; en attendant, ils gardent leur
 * tracé retourné.
 */
export const reverseRoute = (route: PlannedRoute): PlannedRoute => ({
  waypoints: [...route.waypoints].reverse(),
  legs: [...route.legs].reverse().map((leg) => ({
    mode: leg.mode,
    status: leg.mode === 'straight' ? 'ready' : 'pending',
    points: [...leg.points].reverse(),
  })),
});

/** Vrai si le dernier point est au départ : l'itinéraire est déjà bouclé. */
export const isLooped = (route: PlannedRoute): boolean => {
  const n = route.waypoints.length;
  return n >= 3 && route.waypoints[0].lat === route.waypoints[n - 1].lat && route.waypoints[0].lon === route.waypoints[n - 1].lon;
};

/** Boucle : un dernier tronçon ramène au départ. Sans effet sous deux points, ni sur un itinéraire déjà bouclé. */
export const closeLoop = (route: PlannedRoute, mode: RouteMode): PlannedRoute =>
  route.waypoints.length < 2 || isLooped(route) ? route : addWaypoint(route, route.waypoints[0], mode);

/**
 * Change la place d'un point dans l'ordre du parcours. Un tronçon dont les
 * deux extrémités n'ont pas changé est gardé tel quel ; les autres sont
 * recalculés, avec le mode du tronçon qui occupait leur place.
 */
export const reorderWaypoint = (route: PlannedRoute, from: number, to: number): PlannedRoute => {
  const n = route.waypoints.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return route;
  const waypoints = [...route.waypoints];
  const [moved] = waypoints.splice(from, 1);
  waypoints.splice(to, 0, moved);
  const legs = waypoints.slice(1).map((w, i) => {
    const kept = route.legs.find((_, j) => route.waypoints[j] === waypoints[i] && route.waypoints[j + 1] === w);
    return kept ?? newLeg(waypoints[i], w, route.legs[i].mode);
  });
  return { waypoints, legs };
};

/**
 * Clé d'un tronçon : ses deux extrémités et son mode. Un résultat de calcul
 * n'est appliqué que si le tronçon a toujours la même clé (le point a pu
 * bouger pendant la requête) ; elle sert aussi de clé de cache.
 */
export const legKey = (route: PlannedRoute, legIndex: number): string | null => {
  const leg = route.legs[legIndex];
  const from = route.waypoints[legIndex];
  const to = route.waypoints[legIndex + 1];
  if (!leg || !from || !to) return null;
  return `${from.lat},${from.lon}>${to.lat},${to.lon}:${leg.mode}`;
};

/** Indices des tronçons en attente qui portent cette clé (un point a pu être inséré avant eux entre-temps). */
const pendingWithKey = (route: PlannedRoute, key: string): number[] =>
  route.legs.flatMap((l, i) => (l.status === 'pending' && legKey(route, i) === key ? [i] : []));

/**
 * Géométrie calculée pour la clé `key`, posée sur les tronçons en attente qui
 * la portent encore ; itinéraire inchangé si aucun ne la porte plus.
 */
export const withLegResult = (route: PlannedRoute, key: string, points: RoutePoint[]): PlannedRoute => {
  const targets = pendingWithKey(route, key);
  if (targets.length === 0 || points.length < 2) return route;
  return { ...route, legs: route.legs.map((l, i) => (targets.includes(i) ? { mode: l.mode, status: 'ready', points } : l)) };
};

/** Échec du calcul pour la clé `key` : la ligne droite reste, avec la raison. */
export const withLegError = (route: PlannedRoute, key: string, message: string): PlannedRoute => {
  const targets = pendingWithKey(route, key);
  if (targets.length === 0) return route;
  return {
    ...route,
    legs: route.legs.map((l, i) =>
      targets.includes(i) ? { ...newLeg(route.waypoints[i], route.waypoints[i + 1], l.mode), status: 'error', error: message } : l
    ),
  };
};

/** Remet en calcul les tronçons en échec. */
export const retryFailedLegs = (route: PlannedRoute): PlannedRoute =>
  route.legs.some((l) => l.status === 'error')
    ? { ...route, legs: route.legs.map((l, i) => (l.status === 'error' ? newLeg(route.waypoints[i], route.waypoints[i + 1], l.mode) : l)) }
    : route;

/** Un calcul à demander : les extrémités et le mode d'un tronçon en attente, et sa clé. */
export interface LegRequest {
  key: string;
  from: Waypoint;
  to: Waypoint;
  mode: RouteMode;
}

/** Calculs à demander, dans l'ordre du parcours, une fois par clé. */
export const pendingLegRequests = (route: PlannedRoute): LegRequest[] => {
  const seen = new Set<string>();
  const requests: LegRequest[] = [];
  route.legs.forEach((leg, i) => {
    const key = legKey(route, i);
    if (leg.status !== 'pending' || key === null || seen.has(key)) return;
    seen.add(key);
    requests.push({ key, from: route.waypoints[i], to: route.waypoints[i + 1], mode: leg.mode });
  });
  return requests;
};

/**
 * Écart au-delà duquel un point est jugé hors de tout chemin, en mètres : le
 * serveur accroche le point au chemin le plus proche, même à des kilomètres
 * (un point posé en mer). Défaut de `snapToWaypoints`, passé par l'appelant.
 */
export const DEFAULT_MAX_SNAP_M = 500;

const withEle = (w: Waypoint, eleM: number | undefined): RoutePoint =>
  eleM !== undefined ? { lat: w.lat, lon: w.lon, eleM } : { lat: w.lat, lon: w.lon };

/**
 * Relie un tracé calculé à ses deux points de passage. Le serveur part du
 * chemin le plus proche du point posé : on ajoute le point lui-même en tête et
 * en queue, pour que le trait touche le repère et que la distance compte
 * l'approche. Le point ajouté prend l'altitude du chemin voisin : l'approche
 * est courte (sous `DEFAULT_MAX_SNAP_M`), et le profil n'a pas de trou.
 * `maxGapM` : le plus grand des deux écarts, à comparer au seuil.
 */
export const snapToWaypoints = (
  from: Waypoint,
  to: Waypoint,
  computed: RoutePoint[]
): { points: RoutePoint[]; maxGapM: number } => {
  if (computed.length === 0) return { points: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }], maxGapM: 0 };
  const first = computed[0];
  const last = computed[computed.length - 1];
  const gapStart = haversineDistance(from.lat, from.lon, first.lat, first.lon);
  const gapEnd = haversineDistance(to.lat, to.lon, last.lat, last.lon);
  const points = [
    ...(gapStart > 0 ? [withEle(from, first.eleM)] : []),
    ...computed,
    ...(gapEnd > 0 ? [withEle(to, last.eleM)] : []),
  ];
  return { points, maxGapM: Math.max(gapStart, gapEnd) };
};

/** Premier tronçon à calculer, ou `-1`. */
export const nextPendingLeg = (route: PlannedRoute): number => route.legs.findIndex((l) => l.status === 'pending');

/** Tout l'itinéraire d'un seul trait, point de jonction entre deux tronçons compté une fois. */
export const routePoints = (route: PlannedRoute): RoutePoint[] => {
  const out: RoutePoint[] = [];
  for (const leg of route.legs) {
    const start = out.length > 0 && samePlace(out[out.length - 1], leg.points[0]) ? 1 : 0;
    for (let i = start; i < leg.points.length; i++) out.push(leg.points[i]);
  }
  return out;
};

const samePlace = (a: RoutePoint | undefined, b: RoutePoint | undefined): boolean =>
  !!a && !!b && a.lat === b.lat && a.lon === b.lon;

/**
 * Distance cumulée le long des points, en mètres. Un itinéraire n'a pas de
 * vitesse : la règle 6 (distance intégrée de la vitesse) vaut pour les traces
 * enregistrées ; ici, la somme des distances entre points est la seule mesure.
 */
export const cumulativeDistances = (points: RoutePoint[]): number[] => {
  const cum = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return cum;
};

/**
 * Pour chaque point : distance depuis le départ, et longueur du tronçon qui y
 * arrive (0 pour le départ), en mètres, le long des tracés.
 */
export const waypointDistances = (route: PlannedRoute): { cumulativeM: number; legM: number }[] => {
  let cumulativeM = 0;
  return route.waypoints.map((_, i) => {
    const leg = i > 0 ? route.legs[i - 1] : undefined;
    const cum = leg ? cumulativeDistances(leg.points) : [];
    const legM = cum.length > 0 ? cum[cum.length - 1] : 0;
    cumulativeM += legM;
    return { cumulativeM, legM };
  });
};

export interface RouteTotals {
  distanceM: number;
  /** Dénivelés, `null` si l'itinéraire n'a pas d'altitude (lignes droites seules, rien de calculé). */
  gainM: number | null;
  lossM: number | null;
  /** Tronçons encore en calcul, et en échec. */
  pendingLegs: number;
  errorLegs: number;
}

/**
 * Distance et dénivelés. `minGainM` : écart qui confirme une montée ou une
 * descente (`accumulateElevation`), celui du terrain de l'activité (règle 3).
 * L'altitude d'un tracé calculé vient d'un modèle de terrain, déjà lisse :
 * aucun lissage supplémentaire.
 */
export const routeTotals = (route: PlannedRoute, minGainM: number): RouteTotals => {
  const points = routePoints(route);
  const cum = cumulativeDistances(points);
  const altitudes = points.map((p) => p.eleM ?? NaN);
  const withEle = altitudes.filter((a) => isFinite(a)).length;
  const elevation = withEle >= 2 ? accumulateElevation(altitudes, minGainM) : null;
  return {
    distanceM: cum.length > 0 ? cum[cum.length - 1] : 0,
    gainM: elevation ? elevation.gainM : null,
    lossM: elevation ? elevation.lossM : null,
    pendingLegs: route.legs.filter((l) => l.status === 'pending').length,
    errorLegs: route.legs.filter((l) => l.status === 'error').length,
  };
};

/**
 * Pas du profil d'altitude, en mètres. Le tracé calculé a des points très
 * inégalement espacés (plusieurs centaines de mètres sur une piste droite) :
 * le profil est rééchantillonné à pas régulier avant de mesurer la pente, sur
 * la même fenêtre que la course (`computeGrades`). Défaut de `routeProfileRows`.
 */
export const PROFILE_STEP_M = 10;

/** Une ligne du profil d'altitude, avec sa position pour le repère sur la carte. */
export interface ProfileRow {
  distM: number;
  lat: number;
  lon: number;
  eleM: number | null;
  /** Pente locale en fraction, `null` là où elle manque. */
  grade: number | null;
}

/**
 * Profil d'altitude le long des points, tous les `stepM` mètres et au dernier
 * point, pente comprise. Position et altitude sont interpolées entre deux
 * points ; l'altitude manque là où l'un des deux n'en a pas (ligne droite).
 */
export const routeProfileRows = (points: RoutePoint[], stepM = PROFILE_STEP_M): ProfileRow[] => {
  if (points.length === 0) return [];
  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1];
  const samples: { distM: number; lat: number; lon: number; ele: number }[] = [];
  let seg = 0;
  const sampleAt = (d: number) => {
    while (seg < points.length - 2 && cum[seg + 1] < d) seg++;
    const a = points[seg];
    const b = points[Math.min(seg + 1, points.length - 1)];
    const span = cum[Math.min(seg + 1, points.length - 1)] - cum[seg];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / span)) : 0;
    const ele = a.eleM !== undefined && b.eleM !== undefined ? a.eleM + (b.eleM - a.eleM) * t : NaN;
    samples.push({ distM: d, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, ele });
  };
  for (let d = 0; d < total; d += stepM) sampleAt(d);
  sampleAt(total);

  const altitudes = samples.map((p) => p.ele);
  // computeGrades ne lit que les distances : un itinéraire n'a pas de temps.
  const grades = computeGrades(altitudes, { cumDist: samples.map((p) => p.distM), cumTime: [] });
  return samples.map((p, i) => ({
    distM: p.distM,
    lat: p.lat,
    lon: p.lon,
    eleM: isFinite(p.ele) ? p.ele : null,
    grade: isFinite(grades[i]) ? grades[i] : null,
  }));
};
