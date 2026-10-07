/**
 * Altitude du terrain, demandée à l'API de calcul altimétrique de la
 * Géoplateforme de l'IGN : modèle RGE ALTI (grille d'un mètre), France et
 * DOM. Gratuite, sans clé ; le serveur autorise l'appel depuis n'importe
 * quelle page (`Access-Control-Allow-Origin: *`). Licence Ouverte, mention
 * « Source : IGN ».
 *
 * Limites : 5 000 points par requête ; le serveur annonce une requête par
 * seconde (en-tête `x-ratelimit-limit-second`, relevé le 07/10/2026) : les
 * paquets partent l'un après l'autre, espacés. Hors couverture (étranger,
 * mer), il rend -99999.
 *
 * Seul `fetchIgnElevations` touche au réseau ; le reste est pur.
 */

export const IGN_ALTI_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';

/** Modèle demandé : RGE ALTI, toutes zones. */
export const IGN_RESOURCE = 'ign_rge_alti_wld';

/** Points au plus par requête. */
export const IGN_MAX_POINTS = 5000;

/** Écart entre deux requêtes, en ms : un peu plus que la limite annoncée. */
const IGN_REQUEST_GAP_MS = 1100;

/** Sous cette valeur, le service signale un point hors couverture (-99999). */
const IGN_NO_DATA_BELOW_M = -1000;

const NO_NETWORK = 'Pas de réseau : l\'altitude de l\'IGN sera redemandée à la prochaine ouverture.';
const UNREADABLE = 'Réponse du service d\'altitude de l\'IGN illisible.';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type LatLon = { lat: number; lon: number };

/** Corps de la requête : longitudes et latitudes jointes par `|`. */
export const ignRequestBody = (points: ReadonlyArray<LatLon>) => ({
  lon: points.map((p) => p.lon.toFixed(6)).join('|'),
  lat: points.map((p) => p.lat.toFixed(6)).join('|'),
  resource: IGN_RESOURCE,
  zonly: 'true',
});

/**
 * Altitudes de la réponse, dans l'ordre des points demandés ; `null` hors
 * couverture. Lève une erreur si la réponse n'a pas cette forme ou pas le
 * bon nombre de valeurs.
 */
export const parseIgnElevations = (json: unknown, expected: number): (number | null)[] => {
  if (!isObject(json) || !Array.isArray(json.elevations) || json.elevations.length !== expected) throw new Error(UNREADABLE);
  return json.elevations.map((z): number | null => {
    if (typeof z !== 'number' || !isFinite(z)) throw new Error(UNREADABLE);
    return z < IGN_NO_DATA_BELOW_M ? null : z;
  });
};

/** Message en clair pour une réponse en erreur du serveur. */
export const ignErrorMessage = (status: number): string =>
  status === 429
    ? 'Le service d\'altitude de l\'IGN est occupé (erreur 429) : réessayez dans un moment.'
    : `Le service d'altitude de l'IGN n'a pas répondu (erreur ${status}). Réessayez dans un moment.`;

const wait = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Abandon', 'AbortError'));
    });
  });

/**
 * Altitude du terrain en chaque point, `null` hors couverture, par paquets
 * envoyés l'un après l'autre. `signal` abandonne la demande. Lève une erreur
 * au message lisible.
 */
export const fetchIgnElevations = async (points: ReadonlyArray<LatLon>, signal?: AbortSignal): Promise<(number | null)[]> => {
  const result: (number | null)[] = [];
  for (let from = 0; from < points.length; from += IGN_MAX_POINTS) {
    if (from > 0) await wait(IGN_REQUEST_GAP_MS, signal);
    const batch = points.slice(from, from + IGN_MAX_POINTS);
    let response: Response;
    try {
      response = await fetch(IGN_ALTI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ignRequestBody(batch)),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error(NO_NETWORK);
    }
    if (!response.ok) throw new Error(ignErrorMessage(response.status));
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error(UNREADABLE);
    }
    result.push(...parseIgnElevations(json, batch.length));
  }
  return result;
};
