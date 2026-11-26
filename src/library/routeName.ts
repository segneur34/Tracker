import { isObject } from '../core/basics';
import { dayMonthNumeric, formatLocalDate } from '../core/calendar';
import { haversineDistance } from '../core/geo';
import { isLooped, type Waypoint } from '../planning/route';
import { isWritableRouteRecord, type RouteRecord } from '../planning/routeRecord';
import { PLACE_ARROW } from './sessionName';
import {
  PLACE_DEFAULTS, PLACE_VERSION, readSessionPlace, readSummaryPoint, summaryPoint, type PlaceParams, type PlaceSearch,
  type SessionPlace, type SummaryPoint,
} from './sessionPlace';

/**
 * Nom d'un itinéraire planifié (lot 236, d'après le lot 467 de Gtracker) : celui que l'utilisateur a saisi, sinon
 * un nom donné d'office, calculé à chaque lecture et jamais écrit dans la fiche, comme celui d'une session (§8) :
 * « Boucle à Montpellier le 20/11 », « Aller de Montpellier à Sète le 20/11 », « Boucle du 20/11 » tant que le
 * lieu n'est pas connu. La fiche garde un nom vide, son lieu (`place`, cherché comme celui d'une session par
 * `hooks/routePlace.ts`) et sa date de création. Ici parce que `planning/` ne lit pas `library/`.
 */

/** Boucle (le dernier point revient au départ, `isLooped`) ou aller. */
export type RouteKind = 'boucle' | 'aller';

/** Genre d'un itinéraire d'après ses points. */
export const routeKind = (waypoints: readonly Waypoint[]): RouteKind =>
  isLooped({ waypoints: [...waypoints], legs: [] }) ? 'boucle' : 'aller';

/**
 * Lieu d'un itinéraire, rangé dans sa fiche : celui d'une session (`SessionPlace`, `to` pour l'arrivée), avec la
 * position du départ où il a été cherché (`start`), et celle de l'arrivée si elle l'a été aussi (`end`). Un point
 * déplacé depuis ne cite plus l'ancien lieu.
 */
export type RoutePlace = SessionPlace & { start: SummaryPoint; end?: SummaryPoint };

/** Lieu relu d'une fiche, `null` s'il est absent ou mal formé (il sera cherché de nouveau). */
export const readRoutePlace = (raw: unknown): RoutePlace | null => {
  const place = readSessionPlace(raw);
  if (!place || !isObject(raw)) return null;
  const start = readSummaryPoint(raw.start);
  if (!start) return null;
  const end = readSummaryPoint(raw.end);
  const read: RoutePlace = { ...place, start };
  if (end) read.end = end;
  else delete read.end;
  return read;
};

/** Lieu à ranger après une recherche (ou un lieu appris) : `start` et `end`, les points cherchés. */
export const routePlaceAt = (place: SessionPlace, start: Waypoint, end: Waypoint | null): RoutePlace => ({
  ...place,
  start: summaryPoint(start.lat, start.lon),
  ...(end ? { end: summaryPoint(end.lat, end.lon) } : {}),
});

const distanceM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number =>
  haversineDistance(a.lat, a.lon, b.lat, b.lon);

/**
 * Vrai si l'arrivée a son lieu à elle : un aller (pas une boucle) qui finit à plus de `arrivalMinM` du départ,
 * comme pour une session (§8).
 */
const needsArrival = (waypoints: readonly Waypoint[], params: PlaceParams): boolean =>
  waypoints.length >= 2 && routeKind(waypoints) === 'aller'
  && distanceM(waypoints[0], waypoints[waypoints.length - 1]) > params.arrivalMinM;

/**
 * Vrai si le lieu trouvé en `at` vaut encore pour `point` : il n'a pas bougé de plus de `learnRadiusM`, le rayon
 * où un lieu corrigé vaut aussi pour une autre session.
 */
const stillAt = (at: SummaryPoint, point: Waypoint, params: PlaceParams): boolean => distanceM(at, point) <= params.learnRadiusM;

/** Ce que le nom donné d'office lit de la fiche. */
export type RouteNameSource = Pick<RouteRecord, 'name' | 'waypoints' | 'createdAt'> & { place?: unknown };

/**
 * Lieux cités par le nom donné d'office : le départ, s'il est connu et n'a pas bougé ; l'arrivée d'un aller
 * lointain, si elle porte un autre nom et n'a pas bougé non plus. `null` pour ce qui ne se cite pas.
 */
export const routePlaceNames = (
  record: Pick<RouteNameSource, 'waypoints' | 'place'>, params: PlaceParams = PLACE_DEFAULTS
): { from: string | null; to: string | null } => {
  const { waypoints } = record;
  const place = readRoutePlace(record.place);
  const start = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  const from = place?.name && start && stillAt(place.start, start, params) ? place.name : null;
  const to = from && place?.to && place.end && needsArrival(waypoints, params) && stillAt(place.end, last, params) ? place.to : null;
  return { from, to };
};

/** Jour de création d'une fiche, en millisecondes ; une date illisible donne le 1er janvier 1970, comme la relecture. */
const createdMs = (record: Pick<RouteNameSource, 'createdAt'>): number => Date.parse(record.createdAt) || 0;

/**
 * Nom montré d'un itinéraire : le nom saisi, sinon « Boucle à Lieu le 20/11 », « Aller de Départ à Arrivée le
 * 20/11 », « Aller de Départ le 20/11 » (arrivée proche, ou sans autre nom), et sans lieu « Boucle du 20/11 » ou
 * « Aller du 20/11 ». La date est celle de la création.
 */
export const routeDisplayName = (record: RouteNameSource, params: PlaceParams = PLACE_DEFAULTS): string => {
  const typed = record.name.trim();
  if (typed) return typed;
  const date = dayMonthNumeric(createdMs(record));
  const { from, to } = routePlaceNames(record, params);
  if (routeKind(record.waypoints) === 'boucle') return from ? `Boucle à ${from} le ${date}` : `Boucle du ${date}`;
  if (!from) return `Aller du ${date}`;
  return to ? `Aller de ${from} à ${to} le ${date}` : `Aller de ${from} le ${date}`;
};

/**
 * Nom des fichiers d'un itinéraire, avant le nettoyage de `routeFileBase` : le nom saisi, sinon
 * « AAAA-MM-JJ Boucle - Lieu » ou « AAAA-MM-JJ Aller - Départ → Arrivée », comme le GPX d'une session (§8), le
 * genre seul tant que le lieu n'est pas connu. Tiré une fois, au premier rangement : il ne change plus ensuite.
 */
export const routeFileLabel = (record: RouteNameSource, params: PlaceParams = PLACE_DEFAULTS): string => {
  const typed = record.name.trim();
  if (typed) return typed;
  const kind = routeKind(record.waypoints) === 'boucle' ? 'Boucle' : 'Aller';
  const { from, to } = routePlaceNames(record, params);
  const place = from ? ` - ${from}${to ? `${PLACE_ARROW}${to}` : ''}` : '';
  return `${formatLocalDate(createdMs(record))} ${kind}${place}`;
};

/** Ce que la recherche du lieu d'un itinéraire lit de sa fiche. */
export type RoutePlaceHolder = Pick<RouteRecord, 'name' | 'waypoints'> & { place?: unknown };

/** Recherche à faire pour le lieu d'un itinéraire : autour du départ, et de l'arrivée (`end`) d'un aller lointain. */
export interface RoutePlaceQuery {
  start: Waypoint;
  end: Waypoint | null;
  search: PlaceSearch;
}

/**
 * Recherche à faire pour le lieu d'un itinéraire sans nom saisi, `null` s'il n'y a rien à faire : un nom saisi,
 * moins de deux points, un départ sans position (0, 0), ou un lieu à jour. Un lieu est à jour s'il vient de la
 * même recherche (`search` : plan d'eau en voile et en surf, commune ailleurs ; l'activité a pu changer), d'une
 * version courante, si le départ n'a pas bougé depuis, et, pour un aller lointain, si l'arrivée a été cherchée
 * au point où elle est encore. Un lieu où rien n'a été trouvé (`name` nul) n'est pas cherché de nouveau.
 */
export const routePlaceQuery = (
  record: RoutePlaceHolder, search: PlaceSearch, params: PlaceParams = PLACE_DEFAULTS
): RoutePlaceQuery | null => {
  const { waypoints } = record;
  if (record.name.trim() !== '' || waypoints.length < 2) return null;
  const start = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (start.lat === 0 && start.lon === 0) return null;
  const arrival = needsArrival(waypoints, params);
  const place = readRoutePlace(record.place);
  const fresh = place !== null
    && place.search === search
    && !(place.source === 'osm' && place.version < PLACE_VERSION)
    && stillAt(place.start, start, params)
    && (!arrival || (place.end !== undefined && stillAt(place.end, last, params)));
  return fresh ? null : { start, end: arrival ? last : null, search };
};

/**
 * Fiche relue à qui ranger le lieu trouvé, `null` si elle ne le prend plus : rangée de nouveau depuis le début de
 * la recherche (autre `updatedAt`), nommée entre-temps, ou d'une version plus récente. Le lieu
 * ne compte pas comme un rangement : `updatedAt` est gardé.
 */
export const routeRecordWithPlace = (record: RouteRecord, place: RoutePlace, expectedUpdatedAt: string): RouteRecord | null =>
  isWritableRouteRecord(record) && record.updatedAt === expectedUpdatedAt && record.name.trim() === '' ? { ...record, place } : null;
