/**
 * Tuiles de carte gardées sur l'appareil, pour les cartes sans réseau :
 * calculs purs (nom d'une tuile, parent à agrandir, fraîcheur, place à
 * libérer). Le stockage est dans `platform/tileCache.ts`, les requêtes dans
 * `platform/mapTiles.ts`, la couche Leaflet dans `components/BaseTileLayer.tsx`,
 * les fonds dans `core/mapBase.ts`.
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
  /** Place occupée au plus, en mégaoctets. */
  capMb: 500,
  /** Intervalle minimal entre deux contrôles de la place occupée. */
  evictIntervalMs: 60_000,
  /** Attente maximale d'une tuile demandée au serveur, avant de se replier sur la mémoire. */
  fetchTimeoutMs: 8000,
  /**
   * Reprises des cases manquantes après un retour au premier plan ou du réseau, qui met parfois longtemps à se
   * réveiller. Chacune suit la précédente de plus que `fetchTimeoutMs` : une reprise perdue dans l'attente du serveur
   * ne fait pas manquer la suivante, sinon une carte immobile resterait vide.
   */
  retryDelaysMs: [3000, 12_000, 30_000],
  /** Attente minimale, par case, avant une de ces reprises. */
  retryGapMs: 2000,
  /** Attente minimale, par case, avant une reprise au déplacement de la carte : sans réseau, ou si le serveur limite, plus souvent ferait trop de demandes. */
  moveRetryGapMs: 60_000,
  /** Durée d'une demande au-delà de laquelle elle est coupée puis relancée : plus que les deux attentes du serveur qu'une case peut enchaîner (la tuile, puis une parente). */
  stuckLoadMs: 20_000,
} as const;

/** Nom de fichier d'une tuile, sans extension, précédé du préfixe de son fond (`core/mapBase.ts`). */
export const tileKey = ({ z, x, y }: TileCoord, prefix = ''): string => `${prefix}${z}_${x}_${y}`;

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

/**
 * Vrai si la place occupée est à contrôler après une tuile gardée : le dernier
 * contrôle date de `intervalMs` ou plus (`TILE_CACHE_DEFAULTS.evictIntervalMs`).
 */
export const shouldCheckCap = (lastMs: number, nowMs: number, intervalMs: number): boolean => nowMs - lastMs >= intervalMs;

/** Vrai si une tuile gardée à `savedAtMs` est à redemander. */
export const isStale = (savedAtMs: number, nowMs: number, maxAgeMs: number): boolean => nowMs - savedAtMs > maxAgeMs;

/** Cases visibles d'une carte, au zoom `z` des tuiles ; colonnes comptées sans repli, comme Leaflet (elles peuvent sortir de 0 à 2^z - 1). */
export interface TileView {
  z: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Cases touchées par le rectangle de pixels donné, au zoom `z`, pour des tuiles de `tileSize` pixels. */
export const tileViewOf = (z: number, minPx: { x: number; y: number }, maxPx: { x: number; y: number }, tileSize: number): TileView => ({
  z,
  minX: Math.floor(minPx.x / tileSize),
  maxX: Math.ceil(maxPx.x / tileSize) - 1,
  minY: Math.floor(minPx.y / tileSize),
  maxY: Math.ceil(maxPx.y / tileSize) - 1,
});

/** Vrai si la case est dans la vue ; la colonne d'une case est repliée sur le monde, pas celle de la vue, d'où le modulo. */
const inTileView = ({ z, x, y }: TileCoord, view: TileView): boolean => {
  if (z !== view.z || y < view.minY || y > view.maxY) return false;
  const columns = 2 ** z;
  return ((x - view.minX) % columns + columns) % columns <= view.maxX - view.minX;
};

/** Case manquante d'une carte, et l'instant de sa dernière demande. */
export interface TileRetryEntry {
  coords: TileCoord;
  triedAtMs: number;
}

/**
 * Cases à redemander parmi `entries`, les manquantes d'une carte : seulement celles de la vue, au zoom courant,
 * dont la dernière demande date d'au moins `minIntervalMs`.
 */
export const tilesToRetry = <T extends TileRetryEntry>(entries: readonly T[], view: TileView, nowMs: number, minIntervalMs: number): T[] =>
  entries.filter((entry) => inTileView(entry.coords, view) && nowMs - entry.triedAtMs >= minIntervalMs);

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
