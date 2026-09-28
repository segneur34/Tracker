/**
 * Tuiles de carte gardées sur l'appareil, pour les cartes sans réseau :
 * calculs purs (nom d'une tuile, parent à agrandir, fraîcheur, place à
 * libérer). Le stockage est dans `platform/tileCache.ts`, la couche Leaflet
 * dans `components/OsmTileLayer.tsx`.
 *
 * Les règles d'OpenStreetMap interdisent de télécharger une zone à l'avance :
 * on ne garde que les tuiles affichées en ligne, et on les redemande quand
 * elles ont vieilli, comme le veulent les en-têtes du serveur.
 */

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export const TILE_CACHE_DEFAULTS = {
  /** Âge au-delà duquel une tuile gardée est redemandée, si le réseau répond. */
  refreshAgeMs: 7 * 24 * 3600 * 1000,
  /** Zooms au-dessus d'une tuile gardée où on l'agrandit plutôt que de laisser une case vide. */
  overzoomDepth: 3,
  /** Place occupée au plus, en mégaoctets. */
  capMb: 500,
  /** Intervalle minimal entre deux contrôles de la place occupée. */
  evictIntervalMs: 60_000,
  /** Attente maximale d'une tuile demandée au serveur, avant de se replier sur la mémoire. */
  fetchTimeoutMs: 8000,
} as const;

/** Nom de fichier d'une tuile, sans extension. */
export const tileKey = ({ z, x, y }: TileCoord): string => `${z}_${x}_${y}`;

/** Tuile d'un nom de fichier (`z_x_y` ou `z_x_y.png`), `null` s'il n'en est pas un. */
export const parseTileKey = (name: string): TileCoord | null => {
  const match = /^(\d+)_(\d+)_(\d+)(?:\.png)?$/.exec(name);
  if (!match) return null;
  return { z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) };
};

/**
 * Tuile `depth` zooms plus haut qui contient `tile`, et la place de `tile` en
 * elle : agrandie `scale` fois, la parente montre `tile` dans sa case
 * (`col`, `row`), comptée de 0 à `scale - 1` depuis le coin haut gauche.
 */
export interface AncestorTile {
  tile: TileCoord;
  scale: number;
  col: number;
  row: number;
}

export const ancestorTile = (tile: TileCoord, depth: number): AncestorTile | null => {
  if (depth < 1 || depth > tile.z) return null;
  const scale = 2 ** depth;
  const px = Math.floor(tile.x / scale);
  const py = Math.floor(tile.y / scale);
  return { tile: { z: tile.z - depth, x: px, y: py }, scale, col: tile.x - px * scale, row: tile.y - py * scale };
};

/** Vrai si une tuile gardée à `savedAtMs` est à redemander. */
export const isStale = (savedAtMs: number, nowMs: number, maxAgeMs: number): boolean => nowMs - savedAtMs > maxAgeMs;

export interface CachedTileEntry {
  key: string;
  bytes: number;
  savedAtMs: number;
}

export interface TileCacheUsage {
  tiles: number;
  bytes: number;
}

export const tileCacheUsage = (entries: CachedTileEntry[]): TileCacheUsage => ({
  tiles: entries.length,
  bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
});

/** Tuiles à effacer, les plus anciennes d'abord, pour repasser sous `capBytes`. */
export const tilesToEvict = (entries: CachedTileEntry[], capBytes: number): string[] => {
  let total = tileCacheUsage(entries).bytes;
  if (total <= capBytes) return [];
  const evicted: string[] = [];
  for (const entry of [...entries].sort((a, b) => a.savedAtMs - b.savedAtMs)) {
    if (total <= capBytes) break;
    evicted.push(entry.key);
    total -= entry.bytes;
  }
  return evicted;
};
