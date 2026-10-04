import { EARTH_RADIUS_M, haversineDistance, toRad } from '../core/kinematics';
import type { Waypoint } from './route';
import { buildSurfaceRuns, type SurfaceRuns } from './surface';

/**
 * Voies suivies par une trace enregistrée : chaque point est rattaché à la
 * voie d'OpenStreetMap la plus proche (`overpass.ts` les fournit), d'où le
 * revêtement de la session (`surface.ts`). Pur.
 *
 * Le GPS s'écarte de quelques mètres de la voie, et un trottoir longe souvent
 * la route à quelques mètres : un point garde la voie du point précédent tant
 * qu'elle reste presque aussi proche que la meilleure (`switchMarginM`), pour
 * ne pas sauter de l'une à l'autre à chaque point.
 */

/** Version de l'appariement, rangée avec son résultat : à augmenter quand il change, pour refaire les anciens. */
export const WAY_MATCH_VERSION = 1;

export interface WayMatchOptions {
  /** Distance au-delà de laquelle un point ne suit aucune voie, en mètres. */
  radiusM: number;
  /** Avance qu'une autre voie doit avoir sur celle du point précédent pour la remplacer, en mètres. */
  switchMarginM: number;
  /** Pas des points de la ligne envoyée au serveur, en mètres le long de la trace. */
  querySpacingM: number;
  /** Écart entre deux points au-delà duquel la ligne envoyée est coupée (trajet en pause), en mètres. */
  lineBreakM: number;
}

export const WAY_MATCH_DEFAULTS: WayMatchOptions = { radiusM: 25, switchMarginM: 5, querySpacingM: 25, lineBreakM: 200 };

/** Une voie d'OpenStreetMap : ses étiquettes de revêtement (`wayTagsText`) et son tracé. */
export interface OsmWay {
  id: number;
  tags: string;
  geometry: Waypoint[];
}

/**
 * Lignes à envoyer au serveur : les points pris tous les `querySpacingM`
 * mètres le long de la trace, dernier compris, la ligne coupée là où deux
 * points sont à plus de `lineBreakM` (la recherche suit chaque ligne, pas le
 * saut entre deux).
 */
export const queryLines = (
  points: ReadonlyArray<Waypoint>,
  { querySpacingM, lineBreakM }: Pick<WayMatchOptions, 'querySpacingM' | 'lineBreakM'>
): Waypoint[][] => {
  const lines: Waypoint[][] = [];
  let line: Waypoint[] = [];
  let sinceKept = 0;
  for (let i = 0; i < points.length; i++) {
    const p = { lat: points[i].lat, lon: points[i].lon };
    const step = i > 0 ? haversineDistance(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon) : 0;
    if (i > 0 && step > lineBreakM) {
      lines.push(line);
      line = [];
    }
    sinceKept += step;
    const last = i === points.length - 1 || haversineDistance(p.lat, p.lon, points[i + 1].lat, points[i + 1].lon) > lineBreakM;
    if (line.length === 0 || sinceKept >= querySpacingM || last) {
      line.push(p);
      sinceKept = 0;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
};

interface Segment {
  way: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const distanceToSegment = (x: number, y: number, s: Segment): number => {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / len2)) : 0;
  return Math.hypot(s.ax + t * dx - x, s.ay + t * dy - y);
};

/**
 * Voie de chaque point : l'indice dans `ways` de la plus proche à moins de
 * `radiusM`, celle du point précédent gardée tant qu'elle n'est pas plus loin
 * que la meilleure de plus de `switchMarginM` ; `-1` si aucune voie n'est assez
 * proche. Plan local équirectangulaire centré sur le premier point ; les
 * segments des voies sont rangés dans une grille de pas `radiusM`.
 */
export const matchTrackToWays = (
  points: ReadonlyArray<Waypoint>,
  ways: ReadonlyArray<OsmWay>,
  { radiusM, switchMarginM }: Pick<WayMatchOptions, 'radiusM' | 'switchMarginM'>
): number[] => {
  if (points.length === 0) return [];
  const lat0 = points[0].lat;
  const lon0 = points[0].lon;
  const k = Math.cos(toRad(lat0)) * EARTH_RADIUS_M;
  const px = (p: Waypoint) => toRad(p.lon - lon0) * k;
  const py = (p: Waypoint) => toRad(p.lat - lat0) * EARTH_RADIUS_M;

  const cell = Math.max(radiusM, 1);
  const grid = new Map<string, Segment[]>();
  ways.forEach((way, w) => {
    for (let i = 1; i < way.geometry.length; i++) {
      const s: Segment = { way: w, ax: px(way.geometry[i - 1]), ay: py(way.geometry[i - 1]), bx: px(way.geometry[i]), by: py(way.geometry[i]) };
      for (let cx = Math.floor(Math.min(s.ax, s.bx) / cell); cx <= Math.floor(Math.max(s.ax, s.bx) / cell); cx++) {
        for (let cy = Math.floor(Math.min(s.ay, s.by) / cell); cy <= Math.floor(Math.max(s.ay, s.by) / cell); cy++) {
          const key = `${cx},${cy}`;
          const list = grid.get(key);
          if (list) list.push(s);
          else grid.set(key, [s]);
        }
      }
    }
  });

  const matched: number[] = [];
  let previous = -1;
  for (const p of points) {
    const x = px(p);
    const y = py(p);
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    // Tout segment à moins de `radiusM` passe par l'une des neuf cases autour du point.
    const nearest = new Map<number, number>();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const s of grid.get(`${cx + i},${cy + j}`) ?? []) {
          const d = distanceToSegment(x, y, s);
          if (d < (nearest.get(s.way) ?? Infinity)) nearest.set(s.way, d);
        }
      }
    }
    let best = -1;
    let bestD = Infinity;
    for (const [way, d] of nearest) {
      if (d < bestD) {
        best = way;
        bestD = d;
      }
    }
    const previousD = previous >= 0 ? nearest.get(previous) ?? Infinity : Infinity;
    if (previousD <= radiusM && previousD <= bestD + switchMarginM) {
      matched.push(previous);
    } else {
      previous = bestD <= radiusM ? best : -1;
      matched.push(previous);
    }
  }
  return matched;
};

/**
 * Voies d'une trace enregistrée, en morceaux datés : chaque début est le
 * décalage en millisecondes depuis `startMs`, l'instant du premier point.
 */
export const trackSurfaceRuns = (
  track: ReadonlyArray<Waypoint & { timeMs: number }>,
  ways: ReadonlyArray<OsmWay>,
  options: Pick<WayMatchOptions, 'radiusM' | 'switchMarginM'>
): { startMs: number; surfaces: SurfaceRuns } => {
  const startMs = track.length > 0 ? track[0].timeMs : 0;
  const matched = matchTrackToWays(track, ways, options);
  const surfaces = buildSurfaceRuns(
    track.map((p, i) => ({ start: p.timeMs - startMs, tags: matched[i] >= 0 ? ways[matched[i]].tags : null }))
  );
  return { startMs, surfaces };
};
