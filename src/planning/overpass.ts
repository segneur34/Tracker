import type { Waypoint } from './route';
import { wayTagsText } from './surface';
import type { OsmWay } from './wayMatch';

/**
 * Voies d'OpenStreetMap le long d'une trace enregistrée, demandées au
 * serveur public Overpass, pour en tirer le revêtement (`wayMatch.ts`,
 * `surface.ts`). Sans clé ; le serveur autorise l'appel depuis n'importe
 * quelle page (`Access-Control-Allow-Origin: *`).
 *
 * Piège (04/10/2026) : le serveur répond 406 à une requête qui porte l'agent
 * d'un navigateur sans `Referer`. Le navigateur et la WebView l'envoient
 * d'office ; ne pas le retirer (`referrerPolicy`).
 *
 * Seul `fetchWays` touche au réseau ; le reste est pur.
 */

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Coordonnées au plus par requête : une trace longue part en plusieurs fois, l'une après l'autre. */
export const OVERPASS_MAX_COORDS = 1000;

/** Temps accordé au serveur pour chaque requête, en secondes ; il en met une quinzaine pour 2 km en ville. */
const OVERPASS_TIMEOUT_S = 90;

const NO_NETWORK = 'Pas de réseau : la recherche des voies reprendra à la prochaine ouverture de l\'onglet.';
const UNREADABLE = 'Réponse du serveur d\'OpenStreetMap illisible.';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const coord = (p: Waypoint): string => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/** Requête : toutes les voies (`highway`) à moins de `radiusM` de chaque ligne, avec leurs étiquettes et leur tracé. */
export const overpassQuery = (lines: ReadonlyArray<ReadonlyArray<Waypoint>>, radiusM: number): string =>
  `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(` +
  lines.map((line) => `way[highway](around:${Math.round(radiusM)},${line.map(coord).join(',')});`).join('') +
  ');out tags geom;';

/**
 * Lignes réparties en paquets d'au plus `maxCoords` coordonnées ; une ligne
 * trop longue est coupée, ses morceaux partageant un point pour ne rien
 * laisser entre eux.
 */
export const batchLines = (lines: ReadonlyArray<ReadonlyArray<Waypoint>>, maxCoords: number): Waypoint[][][] => {
  const batches: Waypoint[][][] = [];
  let batch: Waypoint[][] = [];
  let count = 0;
  const flush = () => {
    if (batch.length > 0) batches.push(batch);
    batch = [];
    count = 0;
  };
  for (const line of lines) {
    let from = 0;
    while (from < line.length) {
      // Place pour deux points au moins (ou le seul qui reste), sinon paquet suivant.
      if (count > 0 && maxCoords - count < Math.min(2, line.length - from)) flush();
      const end = Math.min(line.length, from + maxCoords - count);
      batch.push(line.slice(from, end));
      count += end - from;
      if (end === line.length) break;
      // Le morceau suivant repart du dernier point de celui-ci, dans le paquet suivant.
      from = end - 1;
      flush();
    }
  }
  flush();
  return batches;
};

/**
 * Voies de la réponse, étiquettes réduites à celles du revêtement. Lève une
 * erreur si la réponse n'a pas cette forme, ou si le serveur signale qu'il a
 * dû s'interrompre (`remark` : la liste serait incomplète).
 */
export const parseOverpassWays = (json: unknown): OsmWay[] => {
  if (!isObject(json) || !Array.isArray(json.elements)) throw new Error(UNREADABLE);
  if (typeof json.remark === 'string' && /error/i.test(json.remark)) {
    throw new Error('Le serveur d\'OpenStreetMap n\'a pas pu finir sa recherche : réessayez dans un moment.');
  }
  const ways: OsmWay[] = [];
  for (const element of json.elements) {
    if (!isObject(element) || element.type !== 'way' || typeof element.id !== 'number' || !Array.isArray(element.geometry)) continue;
    const geometry = element.geometry.flatMap((p): Waypoint[] =>
      isObject(p) && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.lat) && isFinite(p.lon) ? [{ lat: p.lat, lon: p.lon }] : []
    );
    if (geometry.length < 2) continue;
    const tags = isObject(element.tags) ? (element.tags as Record<string, string | undefined>) : {};
    ways.push({ id: element.id, tags: wayTagsText(tags), geometry });
  }
  return ways;
};

/** Message en clair pour une réponse en erreur du serveur. */
export const overpassErrorMessage = (status: number): string =>
  status === 429 || status === 504
    ? `Le serveur d'OpenStreetMap est occupé (erreur ${status}) : réessayez dans un moment.`
    : `Le serveur d'OpenStreetMap n'a pas répondu (erreur ${status}). Réessayez dans un moment.`;

/**
 * Voies à moins de `radiusM` des lignes, par paquets envoyés l'un après
 * l'autre, chaque voie une seule fois. `signal` abandonne la recherche. Lève
 * une erreur au message lisible.
 */
export const fetchWays = async (
  lines: ReadonlyArray<ReadonlyArray<Waypoint>>,
  radiusM: number,
  signal?: AbortSignal
): Promise<OsmWay[]> => {
  const byId = new Map<number, OsmWay>();
  for (const batch of batchLines(lines, OVERPASS_MAX_COORDS)) {
    let response: Response;
    try {
      response = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(batch, radiusM) }), signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error(NO_NETWORK);
    }
    if (!response.ok) throw new Error(overpassErrorMessage(response.status));
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new Error(UNREADABLE);
    }
    for (const way of parseOverpassWays(json)) byId.set(way.id, way);
  }
  return [...byId.values()];
};
