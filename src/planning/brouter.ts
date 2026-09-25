import type { RouteMode, RoutePoint, Waypoint } from './route';

/**
 * Calcul d'un tronçon sur les chemins de la carte, par le serveur public de
 * BRouter (moteur libre sur les données OpenStreetMap, `brouter.de`). Sans
 * clé ; le serveur autorise l'appel depuis n'importe quelle page
 * (`Access-Control-Allow-Origin: *`), donc depuis la WebView du téléphone.
 *
 * La réponse GeoJSON donne l'altitude de chaque point, d'où le dénivelé de
 * l'itinéraire. Seul `fetchLeg` touche au réseau ; le reste est pur.
 */

export const BROUTER_URL = 'https://brouter.de/brouter';

/**
 * Profil de calcul du serveur pour chaque mode. `hiking-mountain` prend les
 * sentiers selon leur difficulté notée sur la carte (`sac_scale`).
 */
export const BROUTER_PROFILES: Record<Exclude<RouteMode, 'straight'>, string> = {
  foot: 'hiking-mountain',
  bike: 'trekking',
  mtb: 'mtb',
};

/** Six décimales : une dizaine de centimètres, bien assez pour un point posé au doigt. */
const coord = (w: Waypoint): string => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`;

export const brouterUrl = (from: Waypoint, to: Waypoint, mode: Exclude<RouteMode, 'straight'>): string =>
  `${BROUTER_URL}?lonlats=${coord(from)}|${coord(to)}&profile=${BROUTER_PROFILES[mode]}&alternativeidx=0&format=geojson`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Géométrie de la réponse : les coordonnées `[lon, lat, altitude]` de la
 * première ligne. Elle part du chemin le plus proche du premier point, pas du
 * point lui-même (`snapToWaypoints`), et peut être vide pour deux points
 * confondus. Lève une erreur si la réponse n'a pas cette forme.
 */
export const parseBrouterGeojson = (json: unknown): RoutePoint[] => {
  const feature = isObject(json) && Array.isArray(json.features) ? json.features[0] : null;
  const geometry = isObject(feature) ? feature.geometry : null;
  const coordinates = isObject(geometry) && geometry.type === 'LineString' ? geometry.coordinates : null;
  if (!Array.isArray(coordinates)) throw new Error('Réponse du serveur de calcul illisible.');

  const points: RoutePoint[] = [];
  for (const c of coordinates) {
    if (!Array.isArray(c)) continue;
    const [lon, lat, ele] = c as unknown[];
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) continue;
    points.push(typeof ele === 'number' && isFinite(ele) ? { lat, lon, eleM: ele } : { lat, lon });
  }
  return points;
};

/**
 * Point loin de tout chemin connu, zone sans données (en mer : « datafile
 * … not found »), ou deux points qu'aucun chemin ne relie.
 */
const NO_PATH = /not mapped|no track found|target island|datafile .* not found/i;

/** Message en clair pour une réponse en erreur du serveur. */
export const brouterErrorMessage = (status: number, body: string): string =>
  NO_PATH.test(body)
    ? 'Aucun chemin trouvé entre ces deux points : rapprochez un point d\'un chemin, ou passez ce tronçon en ligne droite.'
    : `Le serveur de calcul n'a pas répondu (erreur ${status}). Réessayez dans un moment.`;

/**
 * Calcule un tronçon. `signal` annule la requête quand le tronçon a changé
 * entre-temps. Lève une erreur au message lisible.
 */
export const fetchLeg = async (
  from: Waypoint,
  to: Waypoint,
  mode: Exclude<RouteMode, 'straight'>,
  signal?: AbortSignal
): Promise<RoutePoint[]> => {
  let response: Response;
  try {
    response = await fetch(brouterUrl(from, to, mode), { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Pas de réseau : le tronçon reste en ligne droite.');
  }
  if (!response.ok) throw new Error(brouterErrorMessage(response.status, await response.text().catch(() => '')));
  return parseBrouterGeojson(await response.json());
};
