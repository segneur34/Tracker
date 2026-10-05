import { jsonStore } from '../platform/storage';
import { BROUTER_PROFILE_TEXT, profileCombination, type WayType } from './brouterProfile';
import type { RoutePoint, RouteVehicle, Waypoint } from './route';
import { buildSurfaceRuns, parseWayTags, wayTagsText, type SurfaceRuns } from './surface';

/**
 * Calcul d'un tronçon sur les chemins de la carte, par le serveur public de
 * BRouter (moteur libre sur les données OpenStreetMap, `brouter.de`). Sans
 * clé ; le serveur autorise l'appel depuis n'importe quelle page
 * (`Access-Control-Allow-Origin: *`), donc depuis la WebView du téléphone.
 *
 * Le calcul suit le profil de l'application (`brouterProfile.ts`), envoyé au
 * serveur une fois par lancement : le serveur le garde sous un id, que
 * l'appareil retient pour réécrire le même fichier au lancement suivant
 * plutôt que d'en créer un autre.
 *
 * La réponse GeoJSON donne l'altitude de chaque point, d'où le dénivelé de
 * l'itinéraire, et les étiquettes des voies suivies, d'où son revêtement
 * (`surface.ts`). Seuls `fetchLeg` et l'envoi du profil touchent au réseau ;
 * le reste est pur.
 */

export const BROUTER_URL = 'https://brouter.de/brouter';
/** Envoi d'un profil : `POST` du texte, suivi de `/<id>` pour réécrire un profil déjà envoyé. */
export const BROUTER_PROFILE_URL = `${BROUTER_URL}/profile`;

/** Id du profil retenu sur l'appareil. */
const PROFILE_KEY = 'tracker.brouterProfile';

/**
 * Réponse du serveur quand le profil demandé n'existe plus (effacé de son
 * côté) : 500, corps vide. On renvoie alors le profil, une fois.
 */
const PROFILE_MISSING_STATUS = 500;

const NO_NETWORK = 'Pas de réseau : le tronçon reste en ligne droite.';

/** Six décimales : une dizaine de centimètres, bien assez pour un point posé au doigt. */
const coord = (w: Waypoint): string => `${w.lon.toFixed(6)},${w.lat.toFixed(6)}`;

/** Types de voie cochés et règles d'accès, en une seule variable du profil (`profileCombination`). */
export const brouterUrl = (from: Waypoint, to: Waypoint, ways: ReadonlyArray<WayType>, vehicle: RouteVehicle, profileId: string): string =>
  `${BROUTER_URL}?lonlats=${coord(from)}|${coord(to)}&profile=${profileId}` +
  `&profile:calcul=${profileCombination(ways, vehicle === 'velo')}&alternativeidx=0&format=geojson`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Id de profil envoyé : `custom_` suivi de lettres, chiffres ou soulignés. */
const isProfileId = (value: unknown): value is string => typeof value === 'string' && /^custom_\w+$/.test(value);

/**
 * Id rendu par le serveur après l'envoi du profil (`{"profileid": "custom_…"}`).
 * Lève une erreur s'il refuse le profil (`error`) ou si la réponse n'a pas
 * cette forme.
 */
export const parseProfileUpload = (json: unknown): string => {
  if (isObject(json) && typeof json.error === 'string' && json.error !== '') {
    throw new Error(`Le serveur de calcul refuse le profil : ${json.error}`);
  }
  const id = isObject(json) ? json.profileid : null;
  if (!isProfileId(id)) throw new Error('Réponse du serveur de calcul illisible.');
  return id;
};

/** Une coordonnée en micro-degrés, comme le serveur l'écrit dans `messages`. */
const micro = (deg: number): number => Math.round(deg * 1e6);

/**
 * Voies suivies, tirées de `messages` : une ligne d'en-tête, puis une ligne
 * par morceau de voie, qui finit au point du tracé dont elle porte les
 * coordonnées (en micro-degrés) et commence où finit la précédente. Seules les
 * étiquettes du revêtement sont gardées (`wayTagsText`). `undefined` si le
 * tableau manque ou ne colle pas au tracé : le revêtement reste inconnu.
 */
export const parseBrouterMessages = (messages: unknown, points: ReadonlyArray<RoutePoint>): SurfaceRuns | undefined => {
  if (!Array.isArray(messages) || messages.length < 2 || !Array.isArray(messages[0]) || points.length < 2) return undefined;
  const header = messages[0] as unknown[];
  const lonCol = header.indexOf('Longitude');
  const latCol = header.indexOf('Latitude');
  const tagsCol = header.indexOf('WayTags');
  if (lonCol < 0 || latCol < 0 || tagsCol < 0) return undefined;

  const entries: { start: number; tags: string }[] = [];
  let start = 0;
  for (const row of messages.slice(1)) {
    if (!Array.isArray(row)) return undefined;
    const lon = Number(row[lonCol]);
    const lat = Number(row[latCol]);
    let end = start;
    while (end < points.length && (micro(points[end].lon) !== lon || micro(points[end].lat) !== lat)) end++;
    if (end === points.length) return undefined;
    if (end > start) {
      entries.push({ start, tags: wayTagsText(parseWayTags(typeof row[tagsCol] === 'string' ? row[tagsCol] : '')) });
      start = end;
    }
  }
  return entries.length > 0 ? buildSurfaceRuns(entries) : undefined;
};

/**
 * Géométrie de la réponse : les coordonnées `[lon, lat, altitude]` de la
 * première ligne, et les voies suivies (`parseBrouterMessages`). Elle part du
 * chemin le plus proche du premier point, pas du point lui-même
 * (`snapToWaypoints`), et peut être vide pour deux points confondus. Lève une
 * erreur si la réponse n'a pas cette forme.
 */
export const parseBrouterGeojson = (json: unknown): { points: RoutePoint[]; surfaces?: SurfaceRuns } => {
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
  const properties = isObject(feature) ? feature.properties : null;
  const surfaces = parseBrouterMessages(isObject(properties) ? properties.messages : undefined, points);
  return surfaces ? { points, surfaces } : { points };
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

/** Envoie le profil, sur l'id retenu s'il y en a un, et retient l'id rendu. */
const uploadProfile = async (): Promise<string> => {
  const stored = jsonStore.read<{ id?: unknown }>(PROFILE_KEY)?.id;
  let response: Response;
  try {
    response = await fetch(isProfileId(stored) ? `${BROUTER_PROFILE_URL}/${stored}` : BROUTER_PROFILE_URL, {
      method: 'POST',
      body: BROUTER_PROFILE_TEXT,
    });
  } catch {
    throw new Error(NO_NETWORK);
  }
  if (!response.ok) throw new Error(brouterErrorMessage(response.status, await response.text().catch(() => '')));
  const id = parseProfileUpload(await response.json());
  jsonStore.write(PROFILE_KEY, { id });
  return id;
};

/** Envoi en cours ou fait pendant ce lancement ; oublié après un échec, pour que l'essai suivant le refasse. */
let profileUpload: Promise<string> | null = null;

const ensureProfile = (): Promise<string> => {
  profileUpload ??= uploadProfile().catch((err: unknown) => {
    profileUpload = null;
    throw err;
  });
  return profileUpload;
};

/**
 * Calcule un tronçon, selon les types de voie cochés et les règles d'accès de
 * l'activité. `signal` annule la requête quand le tronçon a changé
 * entre-temps (l'envoi du profil, partagé, va à son terme). Lève une erreur au
 * message lisible.
 */
export const fetchLeg = async (
  from: Waypoint,
  to: Waypoint,
  ways: ReadonlyArray<WayType>,
  vehicle: RouteVehicle,
  signal?: AbortSignal
): Promise<{ points: RoutePoint[]; surfaces?: SurfaceRuns }> => {
  const request = async (profileId: string): Promise<Response> => {
    try {
      return await fetch(brouterUrl(from, to, ways, vehicle, profileId), { signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error(NO_NETWORK);
    }
  };
  let response = await request(await ensureProfile());
  if (response.status === PROFILE_MISSING_STATUS) {
    profileUpload = null;
    response = await request(await ensureProfile());
  }
  if (!response.ok) throw new Error(brouterErrorMessage(response.status, await response.text().catch(() => '')));
  return parseBrouterGeojson(await response.json());
};
