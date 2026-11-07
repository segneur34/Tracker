import { median } from '../core/basics';
import { cumulativeDistancesM } from '../core/geo';
import { terrainSamplePoints } from '../land/terrainElevation';
import type { LatLon } from '../core/types';
import { routePoints, type PlannedRoute, type RouteLeg, type RoutePoint } from './route';

/**
 * Altitude du terrain (IGN, `ignAltimetry.ts`) posée sur la trace d'un GPX
 * chargé dans la planification, à la place de l'altitude lissée du GPS
 * (`routeFromTrack`). Mêmes échantillons que pour une session
 * (`terrainSamplePoints`, un point tous les `stepM` mètres), mais la trace n'a
 * pas d'heure : leur « instant » est la distance depuis le départ, en
 * millimètres.
 *
 * L'altitude se pose par la position, pas par le rang des points : un
 * tronçon coupé ou recollé par un point déplacé (`insertWaypoint`,
 * `removeWaypoint`) garde les points d'origine, que l'on retrouve sur la ligne
 * des échantillons. Seuls les tronçons `imported` sont touchés.
 */

/**
 * Au-delà de cet écart à la ligne des échantillons, un point garde son altitude : il n'est pas sur la trace
 * chargée. Trente mètres : très au-dessus de l'écart d'un point de la trace à la corde de ses échantillons
 * (quelques mètres au pas de 20 m), très en dessous de l'écart entre deux voies voisines.
 */
export const IMPORT_MAX_OFFSET_M = 30;

/** Écart sous lequel la recherche près du dernier point trouvé suffit, sinon elle repart de tout le tracé. Dix mètres : trois fois l'écart d'une trace bien suivie, un point perdu (demi-tour, saut) le dépasse. */
const NEAR_M = 10;

/** Segments cherchés de part et d'autre du dernier trouvé. Soixante : de quoi suivre un GPX espacé de plusieurs dizaines de mètres au pas de 5 m, sans balayer toute la trace. */
const NEAR_SEGMENTS = 60;

const EARTH_RADIUS_M = 6_371_000;

/**
 * Positions à demander à l'IGN pour l'itinéraire qui vient d'être chargé :
 * toute sa trace, un point tous les `stepM` mètres, plus le premier et le
 * dernier point.
 */
export const importedSamplePoints = (route: PlannedRoute, stepM: number): LatLon[] => {
  const points = routePoints(route);
  const cum = cumulativeDistancesM(points);
  const track = points.map((p, i) => ({ lat: p.lat, lon: p.lon, timeMs: cum[i] * 1000 }));
  return terrainSamplePoints(track, cum, stepM).map((s) => ({ lat: s.lat, lon: s.lon }));
};

/** Plan local équirectangulaire des échantillons (assez exact pour choisir le segment le plus proche). */
interface SampleLine {
  xs: Float64Array;
  ys: Float64Array;
  z: ReadonlyArray<number | null>;
  lat0: number;
  lon0: number;
  cosLat0: number;
}

const toPlane = (line: { lat0: number; lon0: number; cosLat0: number }, lat: number, lon: number): [number, number] => [
  ((lon - line.lon0) * Math.PI / 180) * line.cosLat0 * EARTH_RADIUS_M,
  ((lat - line.lat0) * Math.PI / 180) * EARTH_RADIUS_M,
];

const buildLine = (samples: ReadonlyArray<LatLon>, z: ReadonlyArray<number | null>): SampleLine => {
  const base = { lat0: samples[0].lat, lon0: samples[0].lon, cosLat0: Math.cos(samples[0].lat * Math.PI / 180) };
  const xs = new Float64Array(samples.length);
  const ys = new Float64Array(samples.length);
  samples.forEach((s, i) => {
    [xs[i], ys[i]] = toPlane(base, s.lat, s.lon);
  });
  return { ...base, xs, ys, z };
};

interface Nearest {
  index: number;
  t: number;
  distanceM: number;
}

/** Segment de la ligne le plus proche de (x, y) parmi ceux de `from` à `to` (indices du segment de départ). */
const nearestSegment = (line: SampleLine, x: number, y: number, from: number, to: number): Nearest => {
  const { xs, ys } = line;
  let best: Nearest = { index: from, t: 0, distanceM: Infinity };
  for (let i = from; i <= to; i++) {
    const dx = xs[i + 1] - xs[i];
    const dy = ys[i + 1] - ys[i];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - xs[i]) * dx + (y - ys[i]) * dy) / len2)) : 0;
    const d = Math.hypot(xs[i] + t * dx - x, ys[i] + t * dy - y);
    if (d < best.distanceM) best = { index: i, t, distanceM: d };
  }
  return best;
};

/** Altitude du terrain au point d'un segment de la ligne, `null` si l'un des échantillons est hors couverture. */
const terrainAt = (line: SampleLine, { index, t }: Nearest): number | null => {
  const z0 = line.z[index];
  const z1 = line.z[index + 1];
  return z0 === null || z1 === null ? null : z0 + t * (z1 - z0);
};

/** Altitude du terrain à chaque point d'un tronçon, `null` hors couverture ou loin de la trace chargée. */
const legTerrain = (line: SampleLine, points: ReadonlyArray<RoutePoint>): (number | null)[] => {
  const lastSegment = line.xs.length - 2;
  let cursor = -1;
  return points.map((p) => {
    const [x, y] = toPlane(line, p.lat, p.lon);
    let found = cursor < 0 ? null : nearestSegment(line, x, y, Math.max(0, cursor - NEAR_SEGMENTS), Math.min(lastSegment, cursor + NEAR_SEGMENTS));
    if (!found || found.distanceM > NEAR_M) found = nearestSegment(line, x, y, 0, lastSegment);
    if (found.distanceM > IMPORT_MAX_OFFSET_M) return null;
    cursor = found.index;
    return terrainAt(line, found);
  });
};

/**
 * Itinéraire dont les tronçons `imported` portent l'altitude du terrain.
 * `samples` et `z` : positions demandées (`importedSamplePoints`) et altitudes
 * rendues par l'IGN, `null` hors couverture.
 *
 * Hors couverture, le point garde son altitude lissée du GPS, décalée de
 * l'écart médian terrain − GPS des points couverts du tronçon : pas de marche
 * à la frontière, comme `applyTerrainElevation`. Un tronçon qui n'est pas
 * `imported` est rendu tel quel. `covered` est faux si aucun point n'est
 * couvert : l'itinéraire est alors rendu lui-même.
 */
export const applyImportedElevation = (
  route: PlannedRoute,
  samples: ReadonlyArray<LatLon>,
  z: ReadonlyArray<number | null>
): { route: PlannedRoute; covered: boolean } => {
  if (samples.length < 2 || z.length !== samples.length || !z.some((v) => v !== null)) return { route, covered: false };
  const line = buildLine(samples, z);

  let covered = false as boolean;
  const legs = route.legs.map((leg): RouteLeg => {
    if (leg.mode !== 'imported') return leg;
    const terrain = legTerrain(line, leg.points);
    const gaps: number[] = [];
    leg.points.forEach((p, i) => {
      const v = terrain[i];
      if (v !== null && p.eleM !== undefined && isFinite(p.eleM)) gaps.push(v - p.eleM);
    });
    const offset = median(gaps);
    const points = leg.points.map((p, i): RoutePoint => {
      const v = terrain[i];
      if (v !== null) {
        covered = true;
        return { lat: p.lat, lon: p.lon, eleM: v };
      }
      return p.eleM !== undefined && isFinite(p.eleM) ? { lat: p.lat, lon: p.lon, eleM: p.eleM + offset } : p;
    });
    return { ...leg, points };
  });
  return covered ? { route: { ...route, legs }, covered } : { route, covered: false };
};
