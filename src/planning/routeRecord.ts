import { isRouteMode, newLeg, type PlannedRoute, type RouteLeg, type RouteMode, type RoutePoint, type Waypoint } from './route';

/**
 * Fiche d'un itinéraire : le fichier JSON rangé dans `itineraires/` du
 * dossier mémoire, à côté de son GPX (`routeGpx.ts`).
 *
 * La fiche fait foi : elle seule porte les points de passage, le mode de
 * chaque tronçon et leur tracé, qui ne se recalcule pas sans réseau. Le GPX
 * n'en est que l'export, réécrit à chaque rangement.
 *
 * Mêmes règles de compatibilité que les fiches de session
 * (`library/record.ts`) : champs inconnus conservés à la réécriture, fiche
 * d'une version future lue mais jamais réécrite.
 */

export const ROUTE_FORMAT = 'tracker-itineraire';
export const ROUTE_VERSION = 1;

/** Point de tracé compact : `[lat, lon]` ou `[lat, lon, altitude]`. */
type StoredPoint = number[];

interface StoredLeg {
  mode: RouteMode;
  /** Vrai si le tronçon n'était pas calculé au rangement : il le sera à l'ouverture. */
  pending?: boolean;
  points: StoredPoint[];
}

export interface RouteRecord {
  format: typeof ROUTE_FORMAT;
  version: number;
  name: string;
  /** Activité choisie pour l'itinéraire (unités d'affichage, terrain) ; `null` : aucune. */
  activityId: string | null;
  /** Dates ISO de création et de dernier rangement. */
  createdAt: string;
  updatedAt: string;
  waypoints: Waypoint[];
  legs: StoredLeg[];
  [unknown: string]: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

const storePoint = (p: RoutePoint): StoredPoint =>
  p.eleM !== undefined ? [round(p.lat, 7), round(p.lon, 7), round(p.eleM, 1)] : [round(p.lat, 7), round(p.lon, 7)];

const readPoint = (raw: unknown): RoutePoint | null => {
  if (!Array.isArray(raw) || !isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) return null;
  return isFiniteNumber(raw[2]) ? { lat: raw[0], lon: raw[1], eleM: raw[2] } : { lat: raw[0], lon: raw[1] };
};

const readWaypoint = (raw: unknown): Waypoint | null =>
  isObject(raw) && isFiniteNumber(raw.lat) && isFiniteNumber(raw.lon) ? { lat: raw.lat, lon: raw.lon } : null;

/**
 * Fiche d'un itinéraire. `previous` : la fiche relue, dont les champs
 * inconnus sont gardés.
 */
export const routeToRecord = (
  route: PlannedRoute,
  meta: { name: string; activityId: string | null; createdAt: string; updatedAt: string },
  previous?: RouteRecord
): RouteRecord => ({
  ...previous,
  format: ROUTE_FORMAT,
  version: ROUTE_VERSION,
  name: meta.name,
  activityId: meta.activityId,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
  waypoints: route.waypoints.map((w) => ({ lat: round(w.lat, 7), lon: round(w.lon, 7) })),
  legs: route.legs.map((leg) => ({
    mode: leg.mode,
    ...(leg.status !== 'ready' ? { pending: true } : {}),
    points: leg.points.map(storePoint),
  })),
});

/**
 * Itinéraire d'une fiche. Un tronçon illisible, ou des tronçons qui ne
 * correspondent pas aux points, sont recalculés plutôt que perdus.
 */
export const recordToRoute = (record: RouteRecord): PlannedRoute => {
  const { waypoints } = record;
  const legs: RouteLeg[] = [];
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const stored = record.legs.length === waypoints.length - 1 ? record.legs[i] : undefined;
    const mode: RouteMode = stored && isRouteMode(stored.mode) ? stored.mode : 'foot';
    const points = (stored?.points ?? []).map(readPoint).filter((p): p is RoutePoint => p !== null);
    if (!stored || stored.pending || points.length < 2) {
      legs.push(newLeg(waypoints[i], waypoints[i + 1], mode));
    } else {
      legs.push({ mode, status: 'ready', points });
    }
  }
  return { waypoints, legs };
};

/** Lit une fiche ; `null` si le texte n'en est pas une lisible. Les champs inconnus sont gardés. */
export const parseRouteRecord = (text: string): RouteRecord | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.format !== ROUTE_FORMAT || !isFiniteNumber(raw.version)) return null;
  if (!Array.isArray(raw.waypoints)) return null;
  const waypoints = raw.waypoints.map(readWaypoint);
  if (waypoints.some((w) => w === null)) return null;
  const legs = Array.isArray(raw.legs) ? raw.legs.filter(isObject) : [];
  const now = new Date(0).toISOString();
  return {
    ...raw,
    format: ROUTE_FORMAT,
    version: raw.version,
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : 'Itinéraire',
    activityId: typeof raw.activityId === 'string' && raw.activityId !== '' ? raw.activityId : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    waypoints: waypoints as Waypoint[],
    legs: legs.map((leg) => ({
      ...leg,
      mode: isRouteMode(leg.mode) ? leg.mode : 'foot',
      ...(leg.pending === true ? { pending: true } : {}),
      points: Array.isArray(leg.points) ? (leg.points as StoredPoint[]) : [],
    })),
  };
};

/** Texte de la fiche. Sans indentation : le tracé compte des milliers de points. */
export const serializeRouteRecord = (record: RouteRecord): string => `${JSON.stringify(record)}\n`;

/** Faux pour une fiche écrite par une version plus récente : on la lit sans jamais la réécrire. */
export const isWritableRouteRecord = (record: RouteRecord): boolean => record.version <= ROUTE_VERSION;

/** Caractères refusés dans un nom de fichier par Windows ou Android (ceux de contrôle ne se saisissent pas). */
const FORBIDDEN = /[\\/:*?"<>|]/g;

/**
 * Nom de fichier (sans extension) d'un nouvel itinéraire, tiré de son nom :
 * `nom`, sinon `nom-2`, `nom-3`… `taken` : les noms déjà présents dans le
 * dossier, extension comprise. La comparaison ignore la casse, comme Windows.
 * Le nom de fichier ne change plus ensuite, même si l'itinéraire est renommé.
 */
export const routeFileBase = (name: string, taken: Iterable<string>): string => {
  const used = new Set([...taken].map((n) => n.toLowerCase().replace(/\.(json|gpx)$/, '')));
  const base = name.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'itineraire';
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
};
