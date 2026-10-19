import type { TileCoord } from './tiles';

/**
 * Image de partage d'une session : calculs purs (cadrage de la trace en
 * Mercator, tuiles de fond à poser, chiffres retenus). Le dessin est dans
 * `components/drawShareImage.ts`, l'envoi dans `platform/share.ts`.
 */

/** Un chiffre de la synthèse d'une session, tel que l'affiche son onglet « général ». */
export interface ShareStat {
  /** Identifiant stable, clé du choix retenu sur l'appareil ; jamais affiché. */
  key: string;
  label: string;
  value: string;
  /** Explication au survol, dans l'analyse seulement. */
  title?: string;
}

export const SHARE_IMAGE = {
  /** Image carrée, côté en pixels. */
  sizePx: 1080,
  /** Hauteur du bandeau du titre. */
  headerPx: 150,
  /** Hauteur d'une rangée de chiffres. */
  statRowPx: 130,
  /** Marges de la grille des chiffres, en haut et en bas. */
  statPaddingPx: 30,
  /** Pied de l'image. */
  footerPx: 60,
  /** Chiffres au plus sur l'image : deux rangées de trois. */
  maxStats: 6,
  tileSizePx: 256,
  /** Zoom le plus fort du fond : au-delà, une trace minuscule n'est pas plus lisible. */
  maxZoom: 17,
  /** Marge entre la trace et le bord de la carte. */
  paddingPx: 70,
  /** Chiffres retenus d'office, à la première ouverture : les premiers de la synthèse. */
  defaultStatCount: 6,
} as const;

/** Colonnes de la grille des chiffres : une rangée jusqu'à trois, deux sur deux pour quatre, trois au-delà. */
export const statColumns = (count: number): number => (count <= 3 ? Math.max(count, 1) : count === 4 ? 2 : 3);

/** Rangées de la grille des chiffres. */
export const statRows = (count: number): number => (count <= 0 ? 0 : Math.ceil(count / statColumns(count)));

/** Hauteur de la carte pour `count` chiffres : ce que laissent le bandeau, la grille et le pied dans le carré. */
export const mapHeight = (count: number): number => {
  const rows = statRows(Math.min(count, SHARE_IMAGE.maxStats));
  const statsPx = rows === 0 ? 0 : rows * SHARE_IMAGE.statRowPx + 2 * SHARE_IMAGE.statPaddingPx;
  return SHARE_IMAGE.sizePx - SHARE_IMAGE.headerPx - statsPx - SHARE_IMAGE.footerPx;
};

/** Point du monde en pixels de tuile au zoom `zoom` (Mercator sphérique, comme les tuiles d'OSM). */
export const worldPx = (lat: number, lon: number, zoom: number): { x: number; y: number } => {
  const size = SHARE_IMAGE.tileSizePx * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
};

/**
 * Cadrage de la carte : un zoom entier pour les tuiles, agrandies `scale` fois
 * (de 1 à 2) pour que la trace remplisse le cadre, et le coin haut gauche du
 * cadre en pixels du monde à ce zoom.
 */
export interface ShareView {
  zoom: number;
  scale: number;
  originX: number;
  originY: number;
  widthPx: number;
  heightPx: number;
}

/** Cadre qui contient tous les points, marge comprise ; `null` sans point. */
export const fitView = (
  points: ReadonlyArray<readonly [number, number]>,
  widthPx: number,
  heightPx: number,
  paddingPx: number = SHARE_IMAGE.paddingPx,
  maxZoom: number = SHARE_IMAGE.maxZoom
): ShareView | null => {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lat, lon] of points) {
    const p = worldPx(lat, lon, 0);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const room = (span: number, px: number) => (span > 0 ? Math.max(px - 2 * paddingPx, 1) / span : Infinity);
  const zoomF = Math.min(Math.log2(Math.min(room(maxX - minX, widthPx), room(maxY - minY, heightPx))), maxZoom);
  const zoom = Math.max(Math.floor(zoomF), 0);
  const scale = 2 ** (Math.max(zoomF, 0) - zoom);
  const factor = 2 ** zoom;
  return {
    zoom,
    scale,
    originX: ((minX + maxX) / 2) * factor - widthPx / 2 / scale,
    originY: ((minY + maxY) / 2) * factor - heightPx / 2 / scale,
    widthPx,
    heightPx,
  };
};

/** Point de la trace en pixels du cadre. */
export const projectPoint = (view: ShareView, lat: number, lon: number): { x: number; y: number } => {
  const p = worldPx(lat, lon, view.zoom);
  return { x: (p.x - view.originX) * view.scale, y: (p.y - view.originY) * view.scale };
};

/** Tuile de fond et sa place dans le cadre. */
export interface PlacedTile {
  tile: TileCoord;
  x: number;
  y: number;
  sizePx: number;
}

/** Tuiles qui couvrent le cadre ; la longitude fait le tour du monde, la latitude s'arrête aux bords. */
export const viewTiles = (view: ShareView): PlacedTile[] => {
  const size = SHARE_IMAGE.tileSizePx;
  const count = 2 ** view.zoom;
  const first = { x: Math.floor(view.originX / size), y: Math.floor(view.originY / size) };
  const last = {
    x: Math.floor((view.originX + view.widthPx / view.scale) / size),
    y: Math.floor((view.originY + view.heightPx / view.scale) / size),
  };
  const tiles: PlacedTile[] = [];
  for (let ty = Math.max(first.y, 0); ty <= Math.min(last.y, count - 1); ty++) {
    for (let tx = first.x; tx <= last.x; tx++) {
      tiles.push({
        tile: { z: view.zoom, x: ((tx % count) + count) % count, y: ty },
        x: (tx * size - view.originX) * view.scale,
        y: (ty * size - view.originY) * view.scale,
        sizePx: size * view.scale,
      });
    }
  }
  return tiles;
};

/**
 * Chiffres de l'image, dans l'ordre de la synthèse : ceux que l'utilisateur
 * a retenus, ou, sans choix retenu, les premiers ; six au plus. Un chiffre
 * retenu que la session n'a pas (autre support, pas de foil) est ignoré.
 */
export const pickShareStats = (available: readonly ShareStat[], chosen: readonly string[] | null): ShareStat[] =>
  (chosen === null ? available.slice(0, SHARE_IMAGE.defaultStatCount) : available.filter((stat) => chosen.includes(stat.key)))
    .slice(0, SHARE_IMAGE.maxStats);

/** Chiffres à proposer pour l'image : ceux que la session n'a pas (« — ») n'y apporteraient rien. */
export const shareableStats = (stats: readonly ShareStat[]): ShareStat[] => stats.filter((stat) => stat.value !== '—');
