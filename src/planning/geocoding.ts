import type { Waypoint } from './route';

/**
 * Recherche d'un lieu par son nom (commune, sommet, refuge, adresse), par le
 * service public Photon de komoot, bâti sur les données OpenStreetMap. Sans
 * clé ; il autorise l'appel depuis n'importe quelle page. Seul `searchPlaces`
 * touche au réseau.
 */

export const PHOTON_URL = 'https://photon.komoot.io/api/';

export interface Place extends Waypoint {
  /** Nom du lieu. */
  label: string;
  /** Où il se trouve : commune, département, pays, ce qui est connu. */
  detail: string;
}

/**
 * Adresse de la recherche. `near` : le centre de la carte, pour que les
 * lieux proches passent devant leurs homonymes lointains.
 */
export const photonUrl = (query: string, near?: Waypoint, limit = 6): string => {
  const params = new URLSearchParams({ q: query, limit: String(limit), lang: 'fr' });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lon.toFixed(4));
  }
  return `${PHOTON_URL}?${params.toString()}`;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** Lieux de la réponse ; les entrées mal formées sont écartées. */
export const parsePhoton = (json: unknown): Place[] => {
  if (!isObject(json) || !Array.isArray(json.features)) return [];
  const places: Place[] = [];
  for (const feature of json.features) {
    if (!isObject(feature) || !isObject(feature.properties) || !isObject(feature.geometry)) continue;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const [lon, lat] = coordinates as unknown[];
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) continue;

    const p = feature.properties;
    const street = text(p.street);
    const label = text(p.name) ?? (street ? [text(p.housenumber), street].filter(Boolean).join(' ') : null) ?? text(p.city);
    if (!label) continue;
    const detail = [text(p.city), text(p.county), text(p.country)]
      .filter((part, i, all): part is string => part !== null && part !== label && all.indexOf(part) === i)
      .join(', ');
    places.push({ label, detail, lat, lon });
  }
  return places;
};

/** Lieux qui répondent à `query`. Lève une erreur au message lisible. */
export const searchPlaces = async (query: string, near?: Waypoint, signal?: AbortSignal): Promise<Place[]> => {
  let response: Response;
  try {
    response = await fetch(photonUrl(query, near), { signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Pas de réseau : la recherche de lieux est impossible.');
  }
  if (!response.ok) throw new Error(`La recherche de lieux n'a pas répondu (erreur ${response.status}).`);
  return parsePhoton(await response.json());
};
