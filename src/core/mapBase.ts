import { tileCacheUsage, type CachedTileEntry, type TileCacheUsage, type TileCoord } from './tiles';

/**
 * Fonds de carte : le plan d'OpenStreetMap, ou la photo satellite d'Esri
 * (World Imagery), choisi par famille sur la carte (`hooks/useMapBase.ts`).
 * La couche Leaflet est dans `components/BaseTileLayer.tsx`, les tuiles dans
 * `platform/mapTiles.ts`.
 *
 * Esri, au large, renvoie une image grise « Map data not yet available » au
 * lieu de la photo ; `blankTile=false` la change en 404, et la case montre
 * alors l'agrandissement d'une tuile des zooms inférieurs, que le serveur a
 * (l'eau est servie jusqu'à z13 au large du golfe du Lion).
 */

export type MapBase = 'plan' | 'satellite';

export interface MapBaseSource {
  /** Gabarit d'adresse : `{z}`, `{x}`, `{y}`. */
  url: string;
  /**
   * Mention exigée par les conditions d'usage, en HTML (carte). Esri en tête : sur téléphone la mention tient sur
   * une ligne coupée à droite, « Powered by Esri » reste lisible (`theme/base.css`).
   */
  attribution: string;
  /** Mention en texte, pour l'image de partage. */
  credit: string;
  /** Préfixe de la clé des tuiles gardées ; vide pour le plan, dont les tuiles déjà gardées restent lisibles. */
  keyPrefix: string;
  /** Zooms au-dessus d'une tuile gardée où on l'agrandit plutôt que de laisser une case vide. */
  overzoomDepth: number;
  /** Une tuile que le serveur n'a pas est remplacée par l'agrandissement d'une parente, demandée au serveur au besoin. */
  fetchAncestors: boolean;
}

export const MAP_BASES: Record<MapBase, MapBaseSource> = {
  plan: {
    // Sans sous-domaine : OSM les déconseille depuis 2023 (une seule adresse, servie en HTTP/2).
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    credit: '© OpenStreetMap',
    keyPrefix: '',
    overzoomDepth: 3,
    fetchAncestors: false,
  },
  satellite: {
    // Attention à l'ordre : y puis x.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
    attribution: 'Powered by Esri &middot; Imagerie &copy; Esri, Vantor, Earthstar Geographics, GIS User Community',
    credit: 'Powered by Esri · Imagerie © Esri, Vantor, Earthstar Geographics, GIS User Community',
    keyPrefix: 'sat_',
    overzoomDepth: 6,
    fetchAncestors: true,
  },
};

export const MAP_BASE_DEFAULT: MapBase = 'plan';

/** Fond d'une session : celui de sa fiche s'il existe, sinon celui de sa famille. */
export const resolveMapBase = (sessionBase: unknown, familyBase: MapBase): MapBase => (isMapBase(sessionBase) ? sessionBase : familyBase);

export const isMapBase = (value: unknown): value is MapBase => value === 'plan' || value === 'satellite';

/** Adresses choisies sur l'appareil (Réglages › Cartes hors ligne), par fond ; absente ou vide : celle d'origine. */
export type TileUrlOverrides = Partial<Record<MapBase, string>>;

const TILE_MARKS = ['{z}', '{x}', '{y}'] as const;

/** Vrai pour une adresse web qui porte `{z}`, `{x}` et `{y}` une fois chacun, et aucun autre repère entre accolades (`{s}`…). */
export const isTileTemplate = (value: string): boolean => {
  if (!/^https?:\/\/\S+$/.test(value)) return false;
  const marks = value.match(/\{[^}]*\}/g) ?? [];
  return marks.length === TILE_MARKS.length && TILE_MARKS.every((mark) => marks.filter((m) => m === mark).length === 1);
};

/**
 * Gabarit d'adresse retenu pour un fond : celui saisi, s'il est une adresse web qui porte `{z}`, `{x}` et `{y}`,
 * sinon celui d'origine. Une adresse sans les trois repères donnerait la même image à toutes les cases, et la
 * garderait sous chacune de leurs clés.
 */
export const tileTemplate = (base: MapBase, overrides?: TileUrlOverrides): string => {
  const custom = overrides?.[base]?.trim() ?? '';
  return isTileTemplate(custom) ? custom : MAP_BASES[base].url;
};

/** Adresse d'une tuile, d'après le gabarit d'origine du fond ou `template`. */
export const tileUrl = (base: MapBase, { z, x, y }: TileCoord, template: string = MAP_BASES[base].url): string =>
  template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));

/** Fond d'une tuile gardée, d'après sa clé. */
export const baseOfTileKey = (key: string): MapBase =>
  key.startsWith(MAP_BASES.satellite.keyPrefix) ? 'satellite' : 'plan';

/** Place occupée par chaque fond, pour Réglages : les photos pèsent plus que le plan. */
export const tileCacheUsageByBase = (entries: CachedTileEntry[]): Record<MapBase, TileCacheUsage> => ({
  plan: tileCacheUsage(entries.filter((e) => baseOfTileKey(e.key) === 'plan')),
  satellite: tileCacheUsage(entries.filter((e) => baseOfTileKey(e.key) === 'satellite')),
});
