import { isFiniteNumber, isObject, roundTo } from '../core/basics';
import { haversineDistance } from '../core/geo';
import { hasPositions, sportFamily } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { WATER_KINDS, type PlaceSearchResult } from '../planning/placeQuery';

/**
 * Lieu d'une session (lot 215) : le plan d'eau de la mise à l'eau en voile et
 * en surf (plage, port, baie, plan d'eau nommés), sinon la commune ; à pied et
 * à vélo, la commune du départ, et celle de l'arrivée si elle est loin. Cherché
 * une fois, gardé dans la fiche (`SessionRecord.place`), il donne le nom
 * calculé de la session (`library/sessionName.ts`).
 *
 * Un lieu corrigé par l'utilisateur (`user`) vaut pour les sessions parties
 * du même endroit (`appris`) ; un lieu déjà trouvé tout près est repris sans
 * requête. Pur : la recherche sur le réseau est dans `planning/placeQuery.ts`,
 * la file qui l'appelle dans la bibliothèque.
 */

/** Une position du résumé, arrondie au mètre. */
export interface SummaryPoint {
  lat: number;
  lon: number;
}

/** Position du résumé, en degrés décimaux arrondis à 5 décimales (environ un mètre). */
export const summaryPoint = (lat: number, lon: number): SummaryPoint => ({ lat: roundTo(lat, 5), lon: roundTo(lon, 5) });

/** Position relue, `null` si elle est mal formée ou hors des bornes. */
export const readSummaryPoint = (raw: unknown): SummaryPoint | null =>
  isObject(raw) && isFiniteNumber(raw.lat) && isFiniteNumber(raw.lon) && Math.abs(raw.lat) <= 90 && Math.abs(raw.lon) <= 180
    ? { lat: raw.lat, lon: raw.lon }
    : null;

/** Recherche d'un lieu : le plan d'eau (voile, surf), ou la commune. */
export type PlaceSearch = 'eau' | 'commune';

/** Ce qu'est le lieu trouvé : un plan d'eau, ou une commune. */
export type PlaceKind = 'eau' | 'commune';

/** D'où vient le lieu : OpenStreetMap, l'utilisateur, ou un lieu corrigé tout près (`appris`). */
export type PlaceSource = 'osm' | 'user' | 'appris';

/** Version du choix du lieu : un lieu d'OpenStreetMap d'une version antérieure est cherché de nouveau. */
export const PLACE_VERSION = 1;

/** Lieu d'une session, rangé dans sa fiche. */
export interface SessionPlace {
  /** Nom du lieu ; `null` : cherché, rien trouvé. */
  name: string | null;
  /** À pied et à vélo : commune de l'arrivée, si elle est loin du départ et n'est pas celle du départ. */
  to?: string;
  kind: PlaceKind;
  /** Recherche qui l'a donné (celle de la famille de la session à ce moment) : une autre famille le fait chercher de nouveau. */
  search: PlaceSearch;
  source: PlaceSource;
  version: number;
  /** Instant de la recherche (ou de la correction), au format ISO. */
  fetchedAt: string;
}

const isPlaceSearch = (value: unknown): value is PlaceSearch => value === 'eau' || value === 'commune';

const placeText = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Lieu relu, `null` s'il est mal formé. */
export const readSessionPlace = (raw: unknown): SessionPlace | null => {
  if (!isObject(raw) || !isPlaceSearch(raw.kind) || !isPlaceSearch(raw.search)) return null;
  if (raw.source !== 'osm' && raw.source !== 'user' && raw.source !== 'appris') return null;
  if (!isFiniteNumber(raw.version) || typeof raw.fetchedAt !== 'string') return null;
  if (raw.name !== null && placeText(raw.name) === null) return null;
  const name = raw.name === null ? null : placeText(raw.name);
  const to = name === null ? null : placeText(raw.to);
  return {
    ...raw,
    name,
    ...(to ? { to } : {}),
    kind: raw.kind,
    search: raw.search,
    source: raw.source,
    version: raw.version,
    fetchedAt: raw.fetchedAt,
  } as SessionPlace;
};

/**
 * Seuils du lieu, en mètres (règle 3) : rayon où chercher un plan d'eau autour
 * de la mise à l'eau ; distance départ-arrivée au-delà de laquelle la commune de
 * l'arrivée est cherchée (« Montpellier → Sète ») ; rayon où un lieu corrigé
 * vaut pour une autre session ; rayon où un lieu déjà trouvé est repris sans requête.
 */
export const PLACE_DEFAULTS = {
  waterRadiusM: 1500,
  arrivalMinM: 5000,
  learnRadiusM: 500,
  reuseRadiusM: 200,
} as const;

export type PlaceParams = { readonly [K in keyof typeof PLACE_DEFAULTS]: number };

/** Recherche d'un calcul : le plan d'eau en voile et en surf, la commune ailleurs ; `null` sans calcul ni positions (muscu, nuit). */
export const placeSearchOf = (sport: SportType | null): PlaceSearch | null => {
  if (sport === null || !hasPositions(sport)) return null;
  const family = sportFamily(sport);
  return family === 'voile' || family === 'surf' ? 'eau' : 'commune';
};

const distanceM = (a: SummaryPoint, b: SummaryPoint): number => haversineDistance(a.lat, a.lon, b.lat, b.lon);

/** Ce qu'une session donne au choix de son lieu : son calcul, son départ et son arrivée, son lieu. */
export interface PlaceHolder {
  sport: SportType | null;
  summary: { start?: SummaryPoint; end?: SummaryPoint };
  place?: SessionPlace;
}

/** Vrai si l'arrivée est à chercher : à pied et à vélo, plus loin du départ que `arrivalMinM`. */
export const needsArrival = (session: PlaceHolder, params: PlaceParams): boolean => {
  const { start, end } = session.summary;
  return placeSearchOf(session.sport) === 'commune' && start !== undefined && end !== undefined && distanceM(start, end) > params.arrivalMinM;
};

/**
 * Vrai si le lieu de la session est à chercher : elle a un départ et une
 * recherche, et pas de lieu, ou un lieu d'OpenStreetMap d'une version
 * antérieure ou d'une autre recherche (famille changée). Un lieu corrigé ou
 * appris n'est jamais cherché de nouveau.
 */
export const needsPlaceSearch = (session: PlaceHolder): boolean => {
  const search = placeSearchOf(session.sport);
  const start = session.summary.start;
  // 0, 0 : la position vide de certaines applications (salle, tapis), pas un lieu.
  if (search === null || start === undefined || (start.lat === 0 && start.lon === 0)) return false;
  const { place } = session;
  if (!place) return true;
  return place.source === 'osm' && (place.version < PLACE_VERSION || place.search !== search);
};

/** La plus proche des sessions de `others` qui répondent à `keep`, à moins de `radiusM` de `start`. */
const nearest = <T extends PlaceHolder>(
  start: SummaryPoint, others: readonly T[], radiusM: number, keep: (other: T) => boolean
): T | null => {
  let best: T | null = null;
  let bestM = Infinity;
  for (const other of others) {
    const at = other.summary.start;
    if (!at || !keep(other)) continue;
    const d = distanceM(start, at);
    if (d <= radiusM && d < bestM) {
      best = other;
      bestM = d;
    }
  }
  return best;
};

/** Lieu appris d'un lieu corrigé : son nom seul (pas d'arrivée), pour une session dont la recherche est `search`. */
export const learnedPlace = (from: SessionPlace, search: PlaceSearch, fetchedAt: string): SessionPlace => ({
  name: from.name, kind: from.kind, search, source: 'appris', version: PLACE_VERSION, fetchedAt,
});

/**
 * Lieu d'une session tiré des autres, sans requête, ou `null` s'il faut
 * demander : d'abord le lieu corrigé le plus proche à moins de `learnRadiusM`
 * (`appris`) ; sinon un lieu d'OpenStreetMap à moins de `reuseRadiusM`, de la
 * même recherche et de la version courante, recopié, pourvu qu'aucune des deux
 * n'ait d'arrivée à chercher.
 */
export const localPlace = (
  session: PlaceHolder, others: readonly PlaceHolder[], params: PlaceParams, fetchedAt: string
): SessionPlace | null => {
  const search = placeSearchOf(session.sport);
  const start = session.summary.start;
  if (search === null || !start) return null;
  const learned = nearest(start, others, params.learnRadiusM, (o) => o.place?.source === 'user' && o.place.name !== null);
  if (learned?.place) return learnedPlace(learned.place, search, fetchedAt);
  if (needsArrival(session, params)) return null;
  const reused = nearest(start, others, params.reuseRadiusM, (o) =>
    o !== session && o.place?.source === 'osm' && o.place.version === PLACE_VERSION && o.place.search === search
    && o.place.to === undefined && !needsArrival(o, params));
  return reused?.place ? { ...reused.place, fetchedAt } : null;
};

/**
 * Lieu choisi dans la réponse du serveur. Recherche du plan d'eau : la
 * première sorte présente dans l'ordre plage, port, baie, plan d'eau, et dans
 * cette sorte le plus proche du départ ; à défaut la commune du départ.
 * Recherche de la commune : celle du départ, et celle de l'arrivée si elle en
 * diffère (`to`). Rien : `name` à `null`.
 */
export const choosePlace = (
  found: PlaceSearchResult, search: PlaceSearch, start: SummaryPoint, fetchedAt: string
): SessionPlace => {
  const base = { search, source: 'osm' as const, version: PLACE_VERSION, fetchedAt };
  if (search === 'eau') {
    for (const kind of WATER_KINDS) {
      const candidates = found.water
        .filter((w) => w.kind === kind)
        .map((w) => ({ name: w.name, d: w.lat === null || w.lon === null ? Infinity : distanceM(start, { lat: w.lat, lon: w.lon }) }))
        .sort((a, b) => a.d - b.d);
      if (candidates.length > 0) return { name: candidates[0].name, kind: 'eau', ...base };
    }
    return { name: found.startCommune, kind: 'commune', ...base };
  }
  const name = found.startCommune ?? found.endCommune;
  const to = found.startCommune !== null && found.endCommune !== null && found.endCommune !== found.startCommune ? found.endCommune : null;
  return { name, ...(to ? { to } : {}), kind: 'commune', ...base };
};

/**
 * Sessions qui prennent un lieu corrigé à `start` : celles parties à moins de
 * `learnRadiusM`, qui ont une recherche, sauf celles corrigées à la main.
 */
export const learnedPlaceTargets = <T extends PlaceHolder>(start: SummaryPoint, sessions: readonly T[], params: PlaceParams): T[] =>
  sessions.filter((s) => {
    const at = s.summary.start;
    return at !== undefined && placeSearchOf(s.sport) !== null && s.place?.source !== 'user' && distanceM(start, at) <= params.learnRadiusM;
  });
