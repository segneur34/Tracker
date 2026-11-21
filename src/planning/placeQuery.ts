import { isFiniteNumber, isObject } from '../core/basics';
import { fetchJson } from './fetchJson';
import { OVERPASS_URL, overpassErrorMessage } from './overpass';
import type { Waypoint } from './route';

/**
 * Lieu d'une session (lot 215), demandé au serveur public Overpass, en une
 * requête : la commune du départ (et celle de l'arrivée si on la demande),
 * puis, en voile et en surf, les plages, ports, baies et plans d'eau nommés
 * autour du départ. Le choix entre eux se fait ailleurs (`library/sessionPlace.ts`).
 * Seule la position du départ (et de l'arrivée) part sur le réseau.
 *
 * Seul `fetchPlaceSearch` touche au réseau ; le reste est pur.
 */

/** Sorte d'un plan d'eau trouvé, dans l'ordre de préférence. */
export type WaterKind = 'plage' | 'port' | 'baie' | 'eau';

export const WATER_KINDS: readonly WaterKind[] = ['plage', 'port', 'baie', 'eau'];

/** Un plan d'eau nommé de la réponse ; sa position est celle de son centre (`null` si le serveur ne la donne pas). */
export interface FoundWater {
  name: string;
  kind: WaterKind;
  lat: number | null;
  lon: number | null;
}

/** Ce que la réponse dit autour d'une session. */
export interface PlaceSearchResult {
  /** Commune du départ, `null` si le départ n'est dans aucune (en mer, hors de France parfois). */
  startCommune: string | null;
  /** Commune de l'arrivée, `null` si elle n'a pas été demandée ou n'est dans aucune. */
  endCommune: string | null;
  /** Plans d'eau nommés à moins du rayon demandé du départ ; vide s'ils n'ont pas été demandés. */
  water: FoundWater[];
}

/** Temps accordé au serveur, en secondes. */
const PLACE_SERVER_TIMEOUT_S = 25;

/** Délai accordé à la réponse et à son corps, en millisecondes. */
export const PLACE_REQUEST_TIMEOUT_MS = 60_000;

export const PLACE_NO_NETWORK = 'Pas de réseau : le lieu de la session sera cherché plus tard.';
export const PLACE_TIMEOUT = 'Le serveur d\'OpenStreetMap ne répond pas : le lieu de la session sera cherché plus tard.';
const UNREADABLE = 'Réponse du serveur d\'OpenStreetMap illisible.';

export const PLACE_BUSY = 'Le serveur d\'OpenStreetMap est occupé : le lieu de la session sera cherché plus tard.';

/** Codes d'un serveur occupé ou d'un relais sans réponse : on retente plus tard. */
const BUSY_STATUSES = [429, 502, 503, 504];

/** Message d'une réponse en erreur : serveur occupé (`PLACE_BUSY`), ou l'erreur en clair. */
const placeHttpError = (status: number): string => (BUSY_STATUSES.includes(status) ? PLACE_BUSY : overpassErrorMessage(status));

/**
 * Vrai pour un échec passager (pas de réseau, pas de réponse, serveur occupé), qu'on retente à la prochaine
 * occasion ; faux pour une réponse illisible ou refusée.
 */
export const isPlaceNetworkError = (err: unknown): boolean =>
  err instanceof Error && (err.message === PLACE_NO_NETWORK || err.message === PLACE_TIMEOUT || err.message === PLACE_BUSY);

/**
 * Marqueur posé dans chaque requête de lieu, en commentaire Overpass (le serveur l'ignore) : le banc de test
 * reconnaît ainsi ces requêtes et les fait échouer comme hors ligne, sans toucher à celles du revêtement
 * (`outils/banc/lib/cdp.mjs`, même texte, vérifié par `placeQuery.test.ts`).
 */
export const PLACE_QUERY_MARK = '/*tracker-lieu*/';

const coord = (p: Waypoint): string => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Commune d'un point : l'aire administrative de niveau 8 qui le contient, suivie d'un compte qui sépare les blocs. */
const communeOf = (p: Waypoint, set: string): string =>
  `is_in(${coord(p)})->.${set};area.${set}[boundary=administrative][admin_level=8];out tags;out count;`;

/** Étiquettes d'un plan d'eau nommé : plage, port de plaisance ou de commerce, baie, étendue d'eau. */
const WATER_FILTERS = ['[natural~"^(beach|bay|water)$"]', '[leisure=marina]', '[harbour]', '[landuse=harbour]'];

/**
 * Requête : commune du départ, commune de l'arrivée (`end`, sinon rien), puis
 * plans d'eau nommés à moins de `waterRadiusM` du départ si `water`. Chaque
 * commune est suivie d'un élément de compte, qui sépare les blocs de la réponse.
 */
export const placeQuery = (start: Waypoint, end: Waypoint | null, water: boolean, waterRadiusM: number): string => {
  const around = `(around:${Math.round(waterRadiusM)},${coord(start)})`;
  return `[out:json][timeout:${PLACE_SERVER_TIMEOUT_S}];${PLACE_QUERY_MARK}`
    + communeOf(start, 'a')
    + (end ? communeOf(end, 'b') : '')
    + (water ? `(${WATER_FILTERS.map((f) => `nwr${around}[name]${f};`).join('')});out tags center;` : '');
};

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Sorte d'un plan d'eau d'après ses étiquettes, `null` s'il n'en est pas un. Un port posé sur une étendue d'eau reste un port. */
export const waterKindOf = (tags: Record<string, unknown>): WaterKind | null => {
  if (tags.natural === 'beach') return 'plage';
  if (tags.leisure === 'marina' || (text(tags.harbour) !== null && tags.harbour !== 'no') || tags.landuse === 'harbour') return 'port';
  if (tags.natural === 'bay') return 'baie';
  if (tags.natural === 'water') return 'eau';
  return null;
};

/**
 * Lieu de la réponse : la première commune de chaque bloc (le départ, puis
 * l'arrivée si `withEnd`), et les plans d'eau nommés. Lève une erreur si la
 * réponse n'a pas cette forme, ou si le serveur dit s'être interrompu.
 */
export const parsePlaceSearch = (json: unknown, withEnd: boolean): PlaceSearchResult => {
  if (!isObject(json) || !Array.isArray(json.elements)) throw new Error(UNREADABLE);
  if (typeof json.remark === 'string' && /error/i.test(json.remark)) {
    throw new Error('Le serveur d\'OpenStreetMap n\'a pas pu finir sa recherche.');
  }
  const communes: (string | null)[] = [null, null];
  const water: FoundWater[] = [];
  let block = 0;
  for (const element of json.elements) {
    if (!isObject(element)) continue;
    if (element.type === 'count') {
      block += 1;
      continue;
    }
    const tags = isObject(element.tags) ? element.tags : {};
    const name = text(tags.name);
    if (!name) continue;
    if (element.type === 'area') {
      if (block < 2 && communes[block] === null) communes[block] = name;
      continue;
    }
    if (element.type !== 'node' && element.type !== 'way' && element.type !== 'relation') continue;
    const kind = waterKindOf(tags);
    if (!kind) continue;
    const at: Record<string, unknown> = element.type === 'node' ? element : isObject(element.center) ? element.center : {};
    water.push({
      name, kind,
      lat: isFiniteNumber(at.lat) ? at.lat : null,
      lon: isFiniteNumber(at.lon) ? at.lon : null,
    });
  }
  return { startCommune: communes[0], endCommune: withEnd ? communes[1] : null, water };
};

/**
 * Lieu autour d'une session (`placeQuery`). Lève une erreur au message lisible ;
 * un échec de réseau se reconnaît par `isPlaceNetworkError`.
 */
export const fetchPlaceSearch = async (
  start: Waypoint,
  end: Waypoint | null,
  water: boolean,
  waterRadiusM: number,
  signal?: AbortSignal
): Promise<PlaceSearchResult> => {
  const json = await fetchJson(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: placeQuery(start, end, water, waterRadiusM) }), signal }, {
    noNetwork: PLACE_NO_NETWORK,
    unreadable: UNREADABLE,
    httpError: placeHttpError,
    timeout: PLACE_TIMEOUT,
    timeoutMs: PLACE_REQUEST_TIMEOUT_MS,
  });
  return parsePlaceSearch(json, end !== null);
};
