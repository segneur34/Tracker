import { EARTH_RADIUS_M, toRad } from '../core/kinematics';
import type { RouteLeg, RoutePoint, Waypoint } from './route';

/**
 * Retour d'une boucle qui évite l'aller (mode « Boucle » de la
 * planification). Le serveur de calcul (`brouter.ts`) accepte des zones
 * pondérées : une voie qui traverse une zone y coûte la distance parcourue
 * dedans, multipliée par le poids. On pose un couloir de rectangles le long
 * de l'aller, et l'on demande le retour avec un poids fort, puis faible, puis
 * sans couloir : on garde le premier qui ne dépasse pas l'aller multiplié par
 * le rapport de l'activité (`SportProfile.loopReturnMaxRatio`).
 *
 * Le couloir reste ouvert aux deux bouts de l'aller, d'où part et où arrive
 * le retour : sans cela, le serveur ne trouve pas de quoi y accrocher ses
 * extrémités (« target island »). Seuls les tronçons calculés et les traces
 * importées le forment : une ligne droite ne suit aucune voie.
 *
 * Essais sur brouter.de (06 et 07/10/2026, §10, point 87) : l'adresse est
 * refusée au-delà de 32 kB (414) ; des poids intermédiaires (50, 100) ne
 * trouvent rien que 200 ou 20 ne trouvent déjà.
 *
 * Tout est pur. Unités SI (règle 1) : mètres, degrés décimaux.
 */

export interface LoopReturnParams {
  /** Demi-largeur du couloir le long de l'aller, en mètres. */
  halfWidthM: number;
  /** Longueur de l'aller laissée hors du couloir à chaque bout, en mètres, mesurée le long de l'aller. */
  openingM: number;
  /** Tolérance de la simplification de l'aller (Douglas-Peucker), en mètres. */
  toleranceM: number;
  /** Tolérance au-delà de laquelle on renonce au couloir (aller trop long pour l'adresse), en mètres. */
  maxToleranceM: number;
  /** Poids des essais avec couloir, dans l'ordre ; l'essai sans couloir vient ensuite. */
  weights: number[];
  /** Longueur maximale du paramètre `polygons`, en caractères : le serveur refuse une adresse de plus de 32 kB. */
  maxParamChars: number;
  /** Écart sous lequel un point du retour compte comme sur l'aller, en mètres. */
  sharedToleranceM: number;
}

export const LOOP_RETURN_DEFAULTS: LoopReturnParams = {
  halfWidthM: 12,
  openingM: 150,
  toleranceM: 5,
  maxToleranceM: 40,
  weights: [200, 20],
  maxParamChars: 30_000,
  sharedToleranceM: 12,
};

/** Variantes du calcul (`alternativeidx` de BRouter, de 0 à 3) parcourues par « Autre retour ». */
export const LOOP_RETURN_VARIANTS = 4;

/** Zone pondérée : un polygone fermé, sommets en degrés. */
export type AvoidancePolygon = Waypoint[];

/** Point projeté dans un plan local, en mètres. */
interface XY {
  x: number;
  y: number;
}

/** Plan local équirectangulaire autour de `refLat` : exact à mieux que le pour cent sur quelques dizaines de kilomètres. */
const projection = (refLat: number) => {
  const kx = toRad(1) * EARTH_RADIUS_M * Math.cos(toRad(refLat));
  const ky = toRad(1) * EARTH_RADIUS_M;
  return {
    to: (p: Waypoint): XY => ({ x: p.lon * kx, y: p.lat * ky }),
    from: (q: XY): Waypoint => ({ lat: q.y / ky, lon: q.x / kx }),
  };
};

const meanLat = (points: ReadonlyArray<Waypoint>): number =>
  points.length > 0 ? points.reduce((s, p) => s + p.lat, 0) / points.length : 0;

const dist = (a: XY, b: XY): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Distance de `p` au segment `[a, b]`, en mètres. */
const segmentDistance = (p: XY, a: XY, b: XY): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};

/** Douglas-Peucker sans récursion : les points gardés, bouts compris. */
const simplify = (points: XY[], toleranceM: number): XY[] => {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let worst = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(points[i], points[first], points[last]);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > toleranceM) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
};

/** Rectangle autour du segment `[a, b]`, prolongé de `h` à chaque bout pour couvrir les coudes. */
const rectangle = (a: XY, b: XY, h: number): XY[] => {
  const len = dist(a, b) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // Normale au segment.
  const nx = -uy;
  const ny = ux;
  return [
    { x: a.x - ux * h + nx * h, y: a.y - uy * h + ny * h },
    { x: b.x + ux * h + nx * h, y: b.y + uy * h + ny * h },
    { x: b.x + ux * h - nx * h, y: b.y + uy * h - ny * h },
    { x: a.x - ux * h - nx * h, y: a.y - uy * h - ny * h },
  ];
};

/**
 * Parties d'un tracé comprises entre les distances `from` et `to`, mesurées
 * le long de lui (`cum`) ; les points de coupe sont interpolés.
 */
const clipByDistance = (points: XY[], cum: number[], from: number, to: number): XY[] => {
  const out: XY[] = [];
  const at = (i: number, d: number): XY => {
    const span = cum[i + 1] - cum[i];
    const t = span > 0 ? (d - cum[i]) / span : 0;
    return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
  };
  for (let i = 0; i + 1 < points.length; i++) {
    if (cum[i + 1] <= from || cum[i] >= to) continue;
    if (out.length === 0) out.push(cum[i] >= from ? points[i] : at(i, from));
    out.push(cum[i + 1] <= to ? points[i + 1] : at(i, to));
  }
  return out;
};

/**
 * Morceaux de l'aller qui forment le couloir : les tronçons calculés ou
 * importés qui se suivent, mis bout à bout, en plan local, privés de
 * `openingM` à chaque bout de l'aller entier.
 */
const corridorRuns = (legs: ReadonlyArray<Pick<RouteLeg, 'mode' | 'points'>>, openingM: number, to: (p: Waypoint) => XY): XY[][] => {
  const runs: { points: XY[]; cum: number[] }[] = [];
  let total = 0;
  let current: { points: XY[]; cum: number[] } | null = null;
  for (const leg of legs) {
    const points = leg.points.map(to);
    const start = total;
    const cum = [start];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
    total = cum[cum.length - 1];
    if (leg.mode === 'straight' || points.length < 2) {
      current = null;
      continue;
    }
    if (!current) {
      current = { points: [], cum: [] };
      runs.push(current);
    }
    // Le point de jonction entre deux tronçons n'est compté qu'une fois.
    const skip = current.points.length > 0 && dist(current.points[current.points.length - 1], points[0]) === 0 ? 1 : 0;
    current.points.push(...points.slice(skip));
    current.cum.push(...cum.slice(skip));
  }
  return runs
    .map((run) => clipByDistance(run.points, run.cum, openingM, total - openingM))
    .filter((run) => run.length >= 2);
};

/** Une coordonnée du paramètre : 5 décimales, un mètre environ, bien assez pour un couloir de 12 m. */
const coord = (deg: number): string => deg.toFixed(5);

/** Texte du paramètre `polygons` du serveur : `lon,lat,…,poids` par zone, zones séparées par `|`. */
export const polygonsParam = (polygons: ReadonlyArray<AvoidancePolygon>, weight: number): string =>
  polygons.map((poly) => `${poly.map((p) => `${coord(p.lon)},${coord(p.lat)}`).join(',')},${weight}`).join('|');

/**
 * Couloir à éviter le long de l'aller (ses tronçons, dans l'ordre) : un
 * rectangle par segment de l'aller simplifié. Tant que le paramètre dépasse
 * `maxParamChars`, la tolérance double, et la demi-largeur la suit pour que
 * le couloir couvre encore la voie ; au-delà de `maxToleranceM`, `null` : on
 * renonce au couloir. `polygons` vide si l'aller est trop court pour en avoir
 * un hors des bouts ouverts.
 */
export const avoidancePolygons = (
  legs: ReadonlyArray<Pick<RouteLeg, 'mode' | 'points'>>,
  params: LoopReturnParams = LOOP_RETURN_DEFAULTS
): { polygons: AvoidancePolygon[]; toleranceM: number } | null => {
  const proj = projection(meanLat(legs.flatMap((l) => l.points)));
  const runs = corridorRuns(legs, params.openingM, proj.to);
  const heaviest = Math.max(0, ...params.weights);
  for (let toleranceM = params.toleranceM; toleranceM <= params.maxToleranceM; toleranceM *= 2) {
    const halfWidth = Math.max(params.halfWidthM, toleranceM);
    const polygons: AvoidancePolygon[] = [];
    for (const run of runs) {
      const kept = simplify(run, toleranceM);
      for (let i = 1; i < kept.length; i++) polygons.push(rectangle(kept[i - 1], kept[i], halfWidth).map(proj.from));
    }
    if (polygonsParam(polygons, heaviest).length <= params.maxParamChars) return { polygons, toleranceM };
  }
  return null;
};

/**
 * Paramètre `polygons` de chaque essai, dans l'ordre : un par poids, puis
 * `null`, l'essai sans couloir, toujours fait en dernier. Sans couloir
 * (aller trop court ou trop long), l'essai sans couloir seul.
 */
export const returnAttempts = (polygons: ReadonlyArray<AvoidancePolygon> | null, weights: ReadonlyArray<number>): (string | null)[] =>
  polygons && polygons.length > 0 ? [...weights.map((w) => polygonsParam(polygons, w)), null] : [null];

/** Vrai si le retour ne dépasse pas l'aller multiplié par `maxRatio`. */
export const isAcceptableReturn = (lengthM: number, outboundM: number, maxRatio: number): boolean => lengthM <= outboundM * maxRatio;

/** Pas d'échantillonnage du retour pour mesurer le recouvrement, en mètres. */
const SHARED_STEP_M = 5;

/**
 * Longueur de `path` qui passe à moins de `toleranceM` de `outbound`, en
 * mètres : le retour mesuré par morceaux de 5 m au plus, chacun compté s'il
 * est près de l'aller en son milieu. Les segments de l'aller sont rangés dans
 * une grille de pas `toleranceM` : chaque morceau n'en regarde que quelques-uns.
 */
export const sharedDistanceM = (path: ReadonlyArray<RoutePoint>, outbound: ReadonlyArray<RoutePoint>, toleranceM: number): number => {
  if (path.length < 2 || outbound.length < 2 || toleranceM <= 0) return 0;
  const proj = projection(meanLat([...path, ...outbound]));
  const aller = outbound.map(proj.to);
  const cell = toleranceM;
  const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i + 1 < aller.length; i++) {
    const a = aller[i];
    const b = aller[i + 1];
    const x0 = Math.floor((Math.min(a.x, b.x) - toleranceM) / cell);
    const x1 = Math.floor((Math.max(a.x, b.x) + toleranceM) / cell);
    const y0 = Math.floor((Math.min(a.y, b.y) - toleranceM) / cell);
    const y1 = Math.floor((Math.max(a.y, b.y) + toleranceM) / cell);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  }
  const near = (p: XY): boolean => {
    const list = grid.get(cellKey(Math.floor(p.x / cell), Math.floor(p.y / cell)));
    return !!list && list.some((i) => segmentDistance(p, aller[i], aller[i + 1]) < toleranceM);
  };

  const points = path.map(proj.to);
  let shared = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = dist(a, b);
    const n = Math.max(1, Math.ceil(len / SHARED_STEP_M));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (near({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) shared += len / n;
    }
  }
  return shared;
};
