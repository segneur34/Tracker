import { findActivity } from '../core/activities';
import type { SportType } from '../core/types';
import { routePlaceAt, routePlaceQuery, readRoutePlace, type RoutePlace } from '../library/routeName';
import {
  PLACE_DEFAULTS, choosePlace, localPlace, placeSearchOf, type PlaceHolder, type PlaceParams, type PlaceSearch, type SessionPlace,
} from '../library/sessionPlace';
import { fetchPlaceSearch, type PlaceSearchResult } from '../planning/placeQuery';
import type { Waypoint } from '../planning/route';
import { saveRoutePlace, type SavedRoute } from './routeFiles';
import { readLibraryState } from './useSessionLibrary';
import { readStoredActivities } from './useSportSettings';

/**
 * Lieu d'un itinéraire planifié sans nom saisi (lot 236), qui compose son nom donné d'office
 * (`library/routeName.ts`) : cherché comme celui d'une session (§8), un itinéraire à la fois, après son rangement
 * et à son ouverture dans Planifier, jamais pour toute la liste.
 *
 * - Plan d'eau en voile et en surf, commune ailleurs (et sans activité). L'arrivée d'un aller à plus de
 *   `arrivalMinM` du départ a son lieu aussi : sa commune dans la même requête, ou son plan d'eau par une
 *   seconde requête.
 * - Un lieu corrigé par l'utilisateur sur une session partie tout près, ou déjà trouvé tout près, est repris
 *   sans requête (`localPlace`) ; un itinéraire n'apprend aucun lieu aux sessions.
 * - Sinon le serveur d'OpenStreetMap, au plus une requête par `pauseMs`. Sans réseau ou sans réponse, rien n'est
 *   rangé : le lieu sera cherché au prochain rangement ou à la prochaine ouverture.
 * - Le lieu n'est rangé que si la fiche n'a pas été rangée de nouveau entre-temps et n'a toujours pas de nom
 *   saisi (`saveRoutePlace`).
 *
 * Aucun réglage ne coupe la recherche des lieux : celle des sessions part d'elle-même, celle-ci de même.
 */

/** Recherche sur le réseau, remplaçable dans les tests (celle des sessions, `fetchPlaceSearch`). */
export type RoutePlaceFetcher = (start: Waypoint, end: Waypoint | null, water: boolean, waterRadiusM: number) => Promise<PlaceSearchResult>;

/** Ce dont la recherche a besoin, remplaçable dans les tests. */
export interface RoutePlaceDeps {
  search: RoutePlaceFetcher;
  /** Calcul de l'activité de l'itinéraire, `null` sans activité connue. */
  sportOf: (activityId: string | null) => SportType | null;
  /** Sessions de la mémoire, dont les lieux corrigés ou trouvés tout près sont repris. */
  sessions: () => readonly PlaceHolder[];
  /** Range le lieu dans la fiche relue, si elle n'a pas changé depuis `expectedUpdatedAt` (`saveRoutePlace`). */
  save: (base: string, place: RoutePlace, expectedUpdatedAt: string) => Promise<SavedRoute | null>;
  params: PlaceParams;
  /** Écart minimal entre deux requêtes, en millisecondes. */
  pauseMs: number;
  /** Instant présent, au format ISO. */
  now: () => string;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Recherche du lieu des itinéraires sur `deps` (voir l'en-tête). La fonction rendue range le lieu de
 * l'itinéraire s'il reste à trouver et rend l'itinéraire mis à jour ; `null` si rien n'est rangé. Les appels se
 * suivent : une recherche à la fois.
 */
export const createRoutePlaceFinder = (deps: RoutePlaceDeps) => {
  let lastRequestAt = -Infinity;
  let chain: Promise<unknown> = Promise.resolve();

  /**
   * Lieu autour de `point` (et commune de `end`, à pied et à vélo) : repris tout près sans requête, sinon demandé
   * au serveur ; `null` sans réponse.
   */
  const lookup = async (sport: SportType | null, search: PlaceSearch, point: Waypoint, end: Waypoint | null): Promise<SessionPlace | null> => {
    // Il faut un calcul pour savoir quelle recherche vaut un lieu repris.
    const holder: PlaceHolder = { sport, summary: end ? { start: point, end } : { start: point } };
    const local = sport ? localPlace(holder, deps.sessions(), deps.params, deps.now()) : null;
    if (local) return local;
    const pause = lastRequestAt + deps.pauseMs - Date.now();
    if (pause > 0) await wait(pause);
    lastRequestAt = Date.now();
    try {
      return choosePlace(await deps.search(point, end, search === 'eau', deps.params.waterRadiusM), search, point, deps.now());
    } catch {
      // Pas de réseau, serveur occupé ou réponse illisible : cherché de nouveau à la prochaine occasion.
      return null;
    }
  };

  const find = async (saved: SavedRoute): Promise<SavedRoute | null> => {
    const { record } = saved;
    if (saved.readOnly) return null;
    const sport = deps.sportOf(record.activityId);
    const search = placeSearchOf(sport) ?? 'commune';
    const query = routePlaceQuery(record, search, deps.params);
    if (!query) return null;
    const { start, end } = query;
    let found: RoutePlace;
    if (search === 'commune' || end === null) {
      // La commune de l'arrivée vient dans la même requête que celle du départ.
      const place = await lookup(sport, search, start, end);
      if (!place) return null;
      found = routePlaceAt(place, start, end);
    } else {
      // Plan d'eau : celui de l'arrivée se cherche à part, autour d'elle.
      const place = await lookup(sport, search, start, null);
      if (!place) return null;
      const arrival = await lookup(sport, search, end, null);
      const to = place.name && arrival?.name && arrival.name.toLocaleLowerCase('fr') !== place.name.toLocaleLowerCase('fr') ? arrival.name : null;
      // Arrivée sans réponse : le départ est rangé, l'arrivée reste à chercher (pas de position `end`).
      found = routePlaceAt(to ? { ...place, to } : place, start, arrival ? end : null);
    }
    const before = readRoutePlace(record.place);
    if (before && JSON.stringify({ ...before, fetchedAt: '' }) === JSON.stringify({ ...found, fetchedAt: '' })) return null;
    return deps.save(saved.base, found, record.updatedAt);
  };

  return (saved: SavedRoute): Promise<SavedRoute | null> => {
    const next = chain.then(() => find(saved));
    chain = next.catch(() => undefined);
    return next;
  };
};

/** Au plus une requête par seconde, comme pour les sessions (`PLACE_PAUSE_MS`). */
const ROUTE_PLACE_PAUSE_MS = 1000;

/**
 * Range le lieu d'un itinéraire sans nom saisi s'il reste à trouver (voir l'en-tête) ; rend l'itinéraire mis à
 * jour, `null` si rien n'est rangé. Un échec d'écriture est tu : la recherche sera refaite plus tard.
 */
export const findRoutePlace = createRoutePlaceFinder({
  search: fetchPlaceSearch,
  sportOf: (activityId) => findActivity(readStoredActivities(), activityId)?.base ?? null,
  sessions: () => readLibraryState().sessions.map((s) => s.record),
  save: (base, place, expectedUpdatedAt) => saveRoutePlace(base, place, expectedUpdatedAt).catch(() => null),
  params: PLACE_DEFAULTS,
  pauseMs: ROUTE_PLACE_PAUSE_MS,
  now: () => new Date().toISOString(),
});
