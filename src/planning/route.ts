import { accumulateElevation } from '../core/elevation';
import { EARTH_RADIUS_M, haversineDistance, initialBearing, toRad } from '../core/kinematics';
import type { ELEVATION_PRESETS, SportFamily } from '../core/sportProfiles';
import type { BikeType } from '../cycling/energy';
import { computeGrades } from '../running/runningAnalytics';
import { WAY_TYPES, type WayType } from './brouterProfile';
import { shiftSurfaceRuns, type SurfaceRuns } from './surface';

/**
 * Itinéraire planifié : des points de passage posés par l'utilisateur, reliés
 * deux à deux par des tronçons. Un tronçon suit les chemins de la carte
 * (calcul par un serveur, `brouter.ts`), va en ligne droite, ou reprend le
 * tracé d'un GPX chargé (`routeFromTrack`).
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

export const WAY_TYPE_LABEL: Record<WayType, string> = {
  sentier: 'Sentier',
  piste: 'Piste',
  route: 'Route',
  grandeRoute: 'Grande route',
};

/** Voies de chaque type, pour l'aide et les infobulles (classement : `brouterProfile.ts`). */
export const WAY_TYPE_HINT: Record<WayType, string> = {
  sentier: 'sentiers et chemins étroits, non revêtus',
  piste: 'chemins larges et routes en terre ou en gravier',
  route: 'petites routes, rues et voies cyclables revêtues',
  grandeRoute: 'départementales et nationales',
};

/** Séparateur des types dans un mode : `route+grandeRoute`. */
const WAYS_SEPARATOR = '+';

/** Types optionnels, mis bout à bout dans l'ordre de `WAY_TYPES` ; `''` pour aucun. */
type JoinWays<A extends string, B extends string> = A extends '' ? B : B extends '' ? A : `${A}${typeof WAYS_SEPARATOR}${B}`;
type OptionalWay<T extends WayType> = T | '';

/**
 * Mode d'un tronçon calculé : les types cochés, dans l'ordre de `WAY_TYPES`,
 * joints par « + » (`route+grandeRoute`). Un seul type garde son nom : les
 * fiches et préférences d'avant les cases (`piste`, `grandeRoute`…) se
 * relisent telles quelles ; « Chemin », devenu « Sentier », est traduit
 * (`readRouteMode`).
 */
export type WaysMode = Exclude<
  JoinWays<JoinWays<JoinWays<OptionalWay<'sentier'>, OptionalWay<'piste'>>, OptionalWay<'route'>>, OptionalWay<'grandeRoute'>>,
  ''
>;

/**
 * Façon de relier deux points : par les types de voie cochés, en ligne
 * droite, ou par le tracé d'un GPX chargé (`imported`), gardé tel quel. Le
 * moyen de transport n'en fait pas partie : il suit l'activité
 * (`RouteVehicle`).
 */
export type RouteMode = WaysMode | 'straight' | 'imported';

/** Mode des types donnés, remis dans l'ordre et sans doublon ; `null` sans aucun type. */
export const waysMode = (types: Iterable<WayType>): WaysMode | null => {
  const chosen = new Set(types);
  const kept = WAY_TYPES.filter((t) => chosen.has(t));
  // Types connus, dans l'ordre : la chaîne est bien un `WaysMode`.
  return kept.length > 0 ? (kept.join(WAYS_SEPARATOR) as WaysMode) : null;
};

/** Types de voie d'un mode, dans l'ordre de `WAY_TYPES`. */
export const wayTypesOf = (mode: WaysMode): WayType[] => {
  const parts = mode.split(WAYS_SEPARATOR);
  return WAY_TYPES.filter((t) => parts.includes(t));
};

/** Vrai pour un mode calculé par les types de voie (ni ligne droite, ni trace importée). */
export const isWaysMode = (mode: RouteMode): mode is WaysMode => mode !== 'straight' && mode !== 'imported';

/** Mode par défaut, et celui d'un tronçon illisible. */
export const DEFAULT_ROUTE_MODE: RouteMode = 'sentier';

export const STRAIGHT_LABEL = 'Ligne droite';
export const STRAIGHT_HINT = 'tout droit, sans suivre la carte';

/** Libellé d'un mode : « Route + Grande route », « Ligne droite », « Trace importée ». */
export const routeModeLabel = (mode: RouteMode): string => {
  if (mode === 'straight') return STRAIGHT_LABEL;
  if (mode === 'imported') return 'Trace importée';
  return wayTypesOf(mode).map((t) => WAY_TYPE_LABEL[t]).join(' + ');
};

/**
 * Coche ou décoche un type. Depuis la ligne droite ou une trace importée, le
 * type seul est choisi. Le dernier type coché ne se décoche pas : mode
 * inchangé.
 */
export const toggleWayType = (mode: RouteMode, type: WayType): RouteMode => {
  if (!isWaysMode(mode)) return type;
  const types = wayTypesOf(mode);
  return types.includes(type) ? waysMode(types.filter((t) => t !== type)) ?? mode : waysMode([...types, type]) ?? mode;
};

/** Modes d'avant les types de voie (À pied, Vélo, VTT), relus dans les fiches et les préférences. */
const LEGACY_ROUTE_MODES: Record<string, RouteMode> = { foot: 'sentier', mtb: 'piste', bike: 'route' };

/** Types renommés, relus sous leur nouveau nom : « Chemin » est devenu « Sentier » (05/10/2026). */
const LEGACY_WAY_TYPES: Record<string, WayType> = { chemin: 'sentier' };

const isWayType = (value: string): value is WayType => (WAY_TYPES as readonly string[]).includes(value);

/** Types d'une chaîne `a+b`, dans le désordre accepté, anciens noms traduits ; `null` si une part n'est pas un type. */
const parseWays = (value: string): WaysMode | null => {
  const parts = value.split(WAYS_SEPARATOR).map((part) =>
    Object.prototype.hasOwnProperty.call(LEGACY_WAY_TYPES, part) ? LEGACY_WAY_TYPES[part] : part
  );
  return parts.every(isWayType) ? waysMode(parts) : null;
};

/** Tout mode connu, écrit dans l'ordre, `imported` compris : celui d'un tronçon relu d'une fiche. */
export const isRouteMode = (value: unknown): value is RouteMode =>
  value === 'straight' || value === 'imported' || (typeof value === 'string' && parseWays(value) === value);

/** Mode relu d'une fiche ou des préférences, types remis dans l'ordre, ancien mode traduit ; `null` s'il est inconnu. */
export const readRouteMode = (value: unknown): RouteMode | null => {
  if (typeof value !== 'string') return null;
  if (value === 'straight' || value === 'imported') return value;
  if (Object.prototype.hasOwnProperty.call(LEGACY_ROUTE_MODES, value)) return LEGACY_ROUTE_MODES[value];
  return parseWays(value);
};

/**
 * Règles d'accès du calcul : celles du piéton (escaliers permis, sens
 * interdits ignorés) ou du vélo (sens interdits respectés, passages à pied
 * pénalisés). Elles suivent la famille de l'activité ; la voile prend celles
 * du piéton.
 */
export type RouteVehicle = 'pieton' | 'velo';

export const routeVehicle = (family: SportFamily): RouteVehicle => (family === 'velo' ? 'velo' : 'pieton');

/** À vélo, types de voie cochés d'office selon le type de vélo (§10, point 81). */
export const BIKE_WAY_TYPES: Record<BikeType, WayType[]> = {
  route: ['route'],
  ville: ['route'],
  gravel: ['piste'],
  vtt: ['sentier', 'piste'],
};

/** À pied, types de voie cochés d'office selon le terrain de l'activité. */
export const TERRAIN_WAY_TYPES: Record<keyof typeof ELEVATION_PRESETS, WayType[]> = {
  route: ['route'],
  trail: ['sentier', 'piste'],
};

/**
 * Types de voie cochés d'office en planification pour une activité qui n'en
 * a pas de réglés : selon son type de vélo, ou son terrain à pied ; aucun en
 * voile, où les balises sont reliées en ligne droite.
 */
export const presetWayTypes = (family: SportFamily, bikeType: BikeType, terrain: keyof typeof ELEVATION_PRESETS): WayType[] => {
  if (family === 'velo') return BIKE_WAY_TYPES[bikeType];
  return family === 'course' ? TERRAIN_WAY_TYPES[terrain] : [];
};

/** Types de voie d'un réglage : connus, dans l'ordre, sans doublon ; `null` si la valeur n'en est pas une liste non vide. */
export const sanitizeWayTypes = (value: unknown): WayType[] | null => {
  if (!Array.isArray(value) || !value.every((v): v is WayType => typeof v === 'string' && isWayType(v))) return null;
  const mode = waysMode(value);
  return mode ? wayTypesOf(mode) : null;
};

/** Mode que l'utilisateur peut choisir : des types de voie, ou la ligne droite. */
export const isChoosableMode = (value: unknown): value is RouteMode => isRouteMode(value) && value !== 'imported';

/** Tronçon qui ne se calcule pas : ligne droite, ou trace importée. */
const isFixedMode = (mode: RouteMode): boolean => !isWaysMode(mode);

/**
 * Mode d'un tronçon à refaire entre deux nouvelles extrémités : le sien, sauf
 * une trace importée, qui ne se refait pas et prend le mode choisi à la place.
 */
const rebuiltMode = (mode: RouteMode, fallback: RouteMode): RouteMode => (mode === 'imported' ? fallback : mode);

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
  /**
   * Voies suivies, d'après le calcul (`brouter.ts`), en indices de `points`.
   * Absent pour une ligne droite, une trace importée, ou un tronçon calculé
   * avant qu'on les garde : son revêtement est alors inconnu (`surface.ts`).
   */
  surfaces?: SurfaceRuns;
}

/** `legs[i]` relie `waypoints[i]` à `waypoints[i + 1]` : un tronçon de moins que de points. */
export interface PlannedRoute {
  waypoints: Waypoint[];
  legs: RouteLeg[];
}

export const EMPTY_ROUTE: PlannedRoute = { waypoints: [], legs: [] };

/**
 * Tronçon neuf entre deux points : prêt s'il va en ligne droite, à calculer
 * sinon. Une trace importée ne se refait pas entre deux points quelconques :
 * demandée ici, elle devient une ligne droite (les opérations d'édition la
 * refont plutôt dans le mode choisi, `rebuiltMode`).
 */
export const newLeg = (from: Waypoint, to: Waypoint, mode: RouteMode): RouteLeg => {
  const kept = mode === 'imported' ? 'straight' : mode;
  return {
    mode: kept,
    status: kept === 'straight' ? 'ready' : 'pending',
    points: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
  };
};

/** Ajoute un point à la fin ; le tronçon qui y mène prend le mode donné. */
export const addWaypoint = (route: PlannedRoute, waypoint: Waypoint, mode: RouteMode): PlannedRoute => {
  const last = route.waypoints[route.waypoints.length - 1];
  return {
    waypoints: [...route.waypoints, waypoint],
    legs: last ? [...route.legs, newLeg(last, waypoint, mode)] : route.legs,
  };
};

/**
 * Insère un point au milieu du tronçon `legIndex`, qui devient deux tronçons
 * du même mode. Sur une trace importée, le point se pose sur la trace, au plus
 * près de `waypoint`, et la coupe en deux sans rien en perdre ; au bout de la
 * trace, il n'y a rien à couper.
 */
export const insertWaypoint = (route: PlannedRoute, legIndex: number, waypoint: Waypoint): PlannedRoute => {
  const leg = route.legs[legIndex];
  if (!leg) return route;
  if (leg.mode === 'imported') {
    const cut = splitPath(leg.points, waypoint);
    if (!cut) return route;
    return {
      waypoints: [...route.waypoints.slice(0, legIndex + 1), { lat: cut.at.lat, lon: cut.at.lon }, ...route.waypoints.slice(legIndex + 1)],
      legs: [
        ...route.legs.slice(0, legIndex),
        { mode: 'imported', status: 'ready', points: cut.before },
        { mode: 'imported', status: 'ready', points: cut.after },
        ...route.legs.slice(legIndex + 1),
      ],
    };
  }
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
 * et la boucle reste fermée. Un tronçon importé touché est refait dans
 * `fallback`, le mode choisi sur la page.
 */
export const moveWaypoint = (route: PlannedRoute, index: number, waypoint: Waypoint, fallback: RouteMode = 'straight'): PlannedRoute => {
  const last = route.waypoints.length - 1;
  if (index < 0 || index > last) return route;
  const moved = isLooped(route) && (index === 0 || index === last) ? [0, last] : [index];
  const waypoints = route.waypoints.map((w, i) => (moved.includes(i) ? waypoint : w));
  const legs = route.legs.map((leg, i) =>
    moved.includes(i) || moved.includes(i + 1) ? newLeg(waypoints[i], waypoints[i + 1], rebuiltMode(leg.mode, fallback)) : leg
  );
  return { waypoints, legs };
};

/**
 * Retire un point. Au milieu, ses deux tronçons sont remplacés par un seul,
 * qui garde le mode de celui qui arrivait au point ; deux tronçons importés
 * sont recollés, tracé intact. Un tronçon importé à refaire l'est dans
 * `fallback`.
 */
export const removeWaypoint = (route: PlannedRoute, index: number, fallback: RouteMode = 'straight'): PlannedRoute => {
  const n = route.waypoints.length;
  if (index < 0 || index >= n) return route;
  const waypoints = route.waypoints.filter((_, i) => i !== index);
  if (index === 0) return { waypoints, legs: route.legs.slice(1) };
  if (index === n - 1) return { waypoints, legs: route.legs.slice(0, -1) };
  const before = route.legs[index - 1];
  const after = route.legs[index];
  const merged: RouteLeg = before.mode === 'imported' && after.mode === 'imported'
    ? { mode: 'imported', status: 'ready', points: joinPaths(before.points, after.points) }
    : newLeg(route.waypoints[index - 1], route.waypoints[index + 1], rebuiltMode(before.mode, fallback));
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
 * tracé retourné. Une ligne droite ou une trace importée est simplement
 * retournée.
 */
export const reverseRoute = (route: PlannedRoute): PlannedRoute => ({
  waypoints: [...route.waypoints].reverse(),
  legs: [...route.legs].reverse().map((leg) => ({
    mode: leg.mode,
    status: isFixedMode(leg.mode) ? 'ready' : 'pending',
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
 * Parcours de voile : sur l'eau, aucun chemin à suivre. Les tronçons
 * calculés par la carte passent en ligne droite ; une ligne droite ou une
 * trace importée reste telle quelle. Itinéraire inchangé (même objet) s'il
 * n'y a rien à redresser.
 */
export const straightenRoute = (route: PlannedRoute): PlannedRoute =>
  route.legs.some((leg) => !isFixedMode(leg.mode))
    ? { ...route, legs: route.legs.map((leg, i) => (isFixedMode(leg.mode) ? leg : newLeg(route.waypoints[i], route.waypoints[i + 1], 'straight'))) }
    : route;

/** Un bord d'un parcours de voile : d'une balise à la suivante, en ligne droite. */
export interface CourseLeg {
  distanceM: number;
  /** Cap de la balise de départ vers la suivante, en degrés depuis le nord. */
  bearingDeg: number;
}

/** Bords du parcours, de balise en balise : `courseLegs(route)[i]` va du point `i` au point `i + 1`. */
export const courseLegs = (route: PlannedRoute): CourseLeg[] =>
  route.waypoints.slice(1).map((to, i) => {
    const from = route.waypoints[i];
    return {
      distanceM: haversineDistance(from.lat, from.lon, to.lat, to.lon),
      bearingDeg: initialBearing(from.lat, from.lon, to.lat, to.lon),
    };
  });

/**
 * Change la place d'un point dans l'ordre du parcours. Un tronçon dont les
 * deux extrémités n'ont pas changé est gardé tel quel ; les autres sont
 * recalculés, avec le mode du tronçon qui occupait leur place (`fallback` à la
 * place d'une trace importée).
 */
export const reorderWaypoint = (route: PlannedRoute, from: number, to: number, fallback: RouteMode = 'straight'): PlannedRoute => {
  const n = route.waypoints.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return route;
  const waypoints = [...route.waypoints];
  const [moved] = waypoints.splice(from, 1);
  waypoints.splice(to, 0, moved);
  const legs = waypoints.slice(1).map((w, i) => {
    const kept = route.legs.find((_, j) => route.waypoints[j] === waypoints[i] && route.waypoints[j + 1] === w);
    return kept ?? newLeg(waypoints[i], w, rebuiltMode(route.legs[i].mode, fallback));
  });
  return { waypoints, legs };
};

/** Écart sous lequel l'arrivée d'une trace chargée est prise pour son départ, en mètres. Défaut de `routeFromTrack`. */
export const DEFAULT_LOOP_CLOSE_M = 30;

/**
 * Itinéraire tiré d'une trace chargée (un GPX téléchargé ailleurs) : la trace
 * est gardée telle quelle, en tronçons `imported`, entre le départ et
 * l'arrivée, seuls points de passage. Points répétés et positions illisibles
 * retirés. Si l'arrivée est à moins de `loopCloseM` du départ, c'est une
 * boucle : elle revient exactement au départ, par un point posé à mi-parcours
 * (une boucle a trois points, `isLooped`). `null` sous deux points distincts.
 */
export const routeFromTrack = (
  points: ReadonlyArray<RoutePoint>,
  { loopCloseM = DEFAULT_LOOP_CLOSE_M }: { loopCloseM?: number } = {}
): PlannedRoute | null => {
  const kept: RoutePoint[] = [];
  for (const p of points) {
    if (!isFinite(p.lat) || !isFinite(p.lon) || samePlace(kept[kept.length - 1], p)) continue;
    kept.push(p.eleM !== undefined && isFinite(p.eleM) ? { lat: p.lat, lon: p.lon, eleM: p.eleM } : { lat: p.lat, lon: p.lon });
  }
  if (kept.length < 2) return null;
  const first = kept[0];
  const last = kept[kept.length - 1];
  const start: Waypoint = { lat: first.lat, lon: first.lon };
  const closes = kept.length >= 3 && haversineDistance(first.lat, first.lon, last.lat, last.lon) <= loopCloseM;
  if (!closes) {
    return { waypoints: [start, { lat: last.lat, lon: last.lon }], legs: [{ mode: 'imported', status: 'ready', points: kept }] };
  }

  const path = samePlace(first, last) ? kept : [...kept, { ...first }];
  const cum = cumulativeDistances(path);
  const half = cum[cum.length - 1] / 2;
  // Point à mi-parcours, jamais au départ ni à l'arrivée.
  const mid = Math.min(path.length - 2, Math.max(1, cum.findIndex((d) => d >= half)));
  return {
    waypoints: [start, { lat: path[mid].lat, lon: path[mid].lon }, start],
    legs: [
      { mode: 'imported', status: 'ready', points: path.slice(0, mid + 1) },
      { mode: 'imported', status: 'ready', points: path.slice(mid) },
    ],
  };
};

/** Point entre `a` et `b` à la fraction `t` ; altitude interpolée si les deux en ont une. */
const interpolatePoint = (a: RoutePoint, b: RoutePoint, t: number): RoutePoint => {
  const lat = a.lat + (b.lat - a.lat) * t;
  const lon = a.lon + (b.lon - a.lon) * t;
  return a.eleM !== undefined && b.eleM !== undefined ? { lat, lon, eleM: a.eleM + (b.eleM - a.eleM) * t } : { lat, lon };
};

/**
 * Point du tracé le plus proche de `p` : le tronçon `index` et la fraction `t`
 * le long de lui. Plan local équirectangulaire centré sur `p`, exact à mieux
 * que le mètre à l'échelle d'un toucher sur la carte.
 */
const nearestOnPath = (points: ReadonlyArray<RoutePoint>, p: Waypoint): { index: number; t: number } => {
  const cosLat = Math.cos(toRad(p.lat));
  const x = (q: RoutePoint) => toRad(q.lon - p.lon) * cosLat * EARTH_RADIUS_M;
  const y = (q: RoutePoint) => toRad(q.lat - p.lat) * EARTH_RADIUS_M;
  let best = { index: 0, t: 0, d2: Infinity };
  for (let i = 0; i + 1 < points.length; i++) {
    const ax = x(points[i]);
    const ay = y(points[i]);
    const dx = x(points[i + 1]) - ax;
    const dy = y(points[i + 1]) - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const d2 = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
    if (d2 < best.d2) best = { index: i, t, d2 };
  }
  return best;
};

/**
 * Tracé coupé au point le plus proche de `target` : les deux parts partagent
 * le point de coupe. `null` si la coupe tombe à un bout (rien à couper).
 */
const splitPath = (
  points: ReadonlyArray<RoutePoint>,
  target: Waypoint
): { at: RoutePoint; before: RoutePoint[]; after: RoutePoint[] } | null => {
  if (points.length < 2) return null;
  const { index, t } = nearestOnPath(points, target);
  const at = interpolatePoint(points[index], points[index + 1], t);
  const before = points.slice(0, index + 1);
  if (!samePlace(before[before.length - 1], at)) before.push(at);
  const rest = points.slice(index + 1);
  const after = samePlace(rest[0], at) ? rest : [at, ...rest];
  if (samePlace(at, points[0]) || samePlace(at, points[points.length - 1])) return null;
  return { at, before, after };
};

/** Deux tracés qui se suivent, d'un seul trait : le point de jonction n'est compté qu'une fois. */
const joinPaths = (a: RoutePoint[], b: RoutePoint[]): RoutePoint[] =>
  samePlace(a[a.length - 1], b[0]) ? [...a, ...b.slice(1)] : [...a, ...b];

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
 * Géométrie calculée pour la clé `key`, et ses voies s'il y en a, posées sur
 * les tronçons en attente qui la portent encore ; itinéraire inchangé si aucun
 * ne la porte plus.
 */
export const withLegResult = (route: PlannedRoute, key: string, points: RoutePoint[], surfaces?: SurfaceRuns): PlannedRoute => {
  const targets = pendingWithKey(route, key);
  if (targets.length === 0 || points.length < 2) return route;
  const ready = (mode: RouteMode): RouteLeg => (surfaces ? { mode, status: 'ready', points, surfaces } : { mode, status: 'ready', points });
  return { ...route, legs: route.legs.map((l, i) => (targets.includes(i) ? ready(l.mode) : l)) };
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

/** Tronçon calculé, prêt, mais sans voies connues : rangé avant qu'on les garde. */
const lacksSurfaces = (leg: RouteLeg): boolean => leg.status === 'ready' && !isFixedMode(leg.mode) && !leg.surfaces;

/**
 * Remet en calcul les tronçons calculés sans voies connues, pour en avoir le
 * revêtement. Le tracé peut changer si la carte a changé depuis. Itinéraire
 * inchangé (même objet) s'il n'y en a aucun.
 */
export const recomputeLegsWithoutSurfaces = (route: PlannedRoute): PlannedRoute =>
  route.legs.some(lacksSurfaces)
    ? { ...route, legs: route.legs.map((l, i) => (lacksSurfaces(l) ? newLeg(route.waypoints[i], route.waypoints[i + 1], l.mode) : l)) }
    : route;

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
 * est courte (sous `DEFAULT_MAX_SNAP_M`), et le profil n'a pas de trou. Elle
 * prend aussi la voie voisine : `surfaces` sont décalées d'un point ajouté en
 * tête. `maxGapM` : le plus grand des deux écarts, à comparer au seuil.
 */
export const snapToWaypoints = (
  from: Waypoint,
  to: Waypoint,
  computed: RoutePoint[],
  surfaces?: SurfaceRuns
): { points: RoutePoint[]; surfaces?: SurfaceRuns; maxGapM: number } => {
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
  const maxGapM = Math.max(gapStart, gapEnd);
  if (!surfaces) return { points, maxGapM };
  return { points, surfaces: gapStart > 0 ? shiftSurfaceRuns(surfaces, 1) : surfaces, maxGapM };
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
