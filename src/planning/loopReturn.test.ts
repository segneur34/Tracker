import { describe, expect, it } from 'vitest';
import {
  LOOP_RETURN_DEFAULTS, avoidancePolygons, corridorPaths, isAcceptableReturn, polygonsParam, returnAttempts, sharedDistanceM,
  type AvoidancePolygon, type CorridorLeg,
} from './loopReturn';
import type { RouteLeg, RoutePoint } from './route';
import { ORIGIN, at as geoAt, mPerDegLon } from '../test/geo.fixture';

/** Un mètre vers l'est, en degrés de longitude. */
const M_LON = 1 / mPerDegLon(ORIGIN.lat);

/** Point à `northM` au nord et `eastM` à l'est du départ. */
const at = (northM: number, eastM = 0): RoutePoint => geoAt(eastM, northM);

/** Aller sinueux vers le nord : un point tous les 20 m, ondulation de 30 m d'amplitude sur 400 m. */
const wiggly = (fromM: number, toM: number, eastM = 0): RoutePoint[] => {
  const out: RoutePoint[] = [];
  for (let n = fromM; n <= toM; n += 20) out.push(at(n, eastM + 30 * Math.sin((2 * Math.PI * n) / 400)));
  return out;
};

const leg = (points: RoutePoint[], mode: RouteLeg['mode'] = 'sentier', status?: RouteLeg['status']): CorridorLeg =>
  (status ? { mode, points, status } : { mode, points });

/** Point dans un polygone (lancer de rayon, en degrés : assez juste à cette échelle). */
const inside = (p: RoutePoint, poly: AvoidancePolygon): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) hit = !hit;
  }
  return hit;
};
const covered = (p: RoutePoint, polys: AvoidancePolygon[]) => polys.some((poly) => inside(p, poly));

/** Points de l'ondulation tous les 2 m, entre deux distances le long du nord. */
const dense = (fromM: number, toM: number): RoutePoint[] => {
  const out: RoutePoint[] = [];
  for (let n = fromM; n <= toM; n += 2) out.push(at(n, 30 * Math.sin((2 * Math.PI * n) / 400)));
  return out;
};

describe('couloir le long de l\'aller', () => {
  it('couvre tout l\'aller, sauf ses deux bouts, laissés ouverts', () => {
    const aller = wiggly(0, 3000);
    const plan = avoidancePolygons([leg(aller)])!;
    expect(plan.toleranceM).toBe(LOOP_RETURN_DEFAULTS.toleranceM);
    // L'ondulation fait près de 1,2 fois la distance au nord : 150 m le long de l'aller tombent avant 150 m au nord.
    expect(dense(400, 2600).every((p) => covered(p, plan.polygons))).toBe(true);
    expect(covered(at(0), plan.polygons)).toBe(false);
    expect(covered(at(60, 30 * Math.sin((2 * Math.PI * 60) / 400)), plan.polygons)).toBe(false);
    expect(covered(at(3000), plan.polygons)).toBe(false);
    // Une rue parallèle à 50 m reste libre.
    expect(dense(400, 2600).map((p) => ({ ...p, lon: p.lon + 50 * M_LON })).some((p) => covered(p, plan.polygons))).toBe(false);
  });

  it('une ligne droite de l\'aller ne suit aucune voie : hors du couloir', () => {
    const first = wiggly(0, 1000);
    const straight = [at(1000), at(2000)];
    const last = wiggly(2000, 3000);
    const plan = avoidancePolygons([leg(first), leg(straight, 'straight'), leg(last)])!;
    expect(covered(at(1500), plan.polygons)).toBe(false);
    expect(dense(500, 900).every((p) => covered(p, plan.polygons))).toBe(true);
    expect(dense(2100, 2600).every((p) => covered(p, plan.polygons))).toBe(true);
  });

  it('un tronçon en échec garde une ligne droite qui ne suit aucune voie : hors du couloir', () => {
    const first = wiggly(0, 1000);
    const failed = [at(1000), at(2000)];
    const last = wiggly(2000, 3000);
    const plan = avoidancePolygons([leg(first, 'sentier', 'ready'), leg(failed, 'sentier', 'error'), leg(last, 'sentier', 'ready')])!;
    expect(covered(at(1500), plan.polygons)).toBe(false);
    expect(dense(500, 900).every((p) => covered(p, plan.polygons))).toBe(true);
    // Les morceaux de l'aller qui suivent des voies : deux, sans la ligne droite.
    const paths = corridorPaths([leg(first, 'sentier', 'ready'), leg(failed, 'sentier', 'error'), leg(last, 'sentier', 'ready')]);
    expect(paths).toEqual([first, last]);
    expect(corridorPaths([leg(wiggly(0, 500)), leg(wiggly(500, 1000), 'imported')])).toEqual([wiggly(0, 1000)]);
  });

  it('les tronçons qui se suivent forment un seul couloir, sans trou à la jonction', () => {
    const plan = avoidancePolygons([leg(wiggly(0, 1500)), leg(wiggly(1500, 3000), 'imported')])!;
    expect(dense(1400, 1600).every((p) => covered(p, plan.polygons))).toBe(true);
  });

  it('un aller trop court pour sortir des bouts ouverts n\'a pas de couloir', () => {
    expect(avoidancePolygons([leg([at(0), at(120), at(250)])])).toEqual({ polygons: [], toleranceM: LOOP_RETURN_DEFAULTS.toleranceM });
  });

  it('adresse trop longue : la tolérance double, la demi-largeur la suit, puis on renonce', () => {
    const aller = [leg(wiggly(0, 20_000))];
    const full = avoidancePolygons(aller)!;
    const size = polygonsParam(full.polygons, 200).length;
    const coarser = avoidancePolygons(aller, { ...LOOP_RETURN_DEFAULTS, maxParamChars: Math.floor(size / 2) })!;
    expect(coarser.toleranceM).toBeGreaterThan(full.toleranceM);
    expect(polygonsParam(coarser.polygons, 200).length).toBeLessThanOrEqual(Math.floor(size / 2));
    expect(avoidancePolygons(aller, { ...LOOP_RETURN_DEFAULTS, maxParamChars: 100 })).toBeNull();
  });

  it('paramètre du serveur : lon,lat à 5 décimales, le poids en dernier, zones séparées par |', () => {
    const square = [at(0), at(10), at(10, 10), at(0, 10)];
    const text = polygonsParam([square, square], 20);
    expect(text.split('|')).toHaveLength(2);
    expect(text.split('|')[0]).toBe(`${square.map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(',')},20`);
  });

  it('essais : un par poids, dans l\'ordre, puis sans couloir ; sans couloir seul s\'il n\'y en a pas', () => {
    const square = [at(0), at(10), at(10, 10), at(0, 10)];
    expect(returnAttempts([square], [200, 20])).toEqual([polygonsParam([square], 200), polygonsParam([square], 20), null]);
    expect(returnAttempts([], [200, 20])).toEqual([null]);
    expect(returnAttempts(null, [200, 20])).toEqual([null]);
  });
});

describe('retour accepté et recouvrement', () => {
  it('accepte un retour jusqu\'au rapport réglé', () => {
    expect(isAcceptableReturn(7500, 5000, 1.5)).toBe(true);
    expect(isAcceptableReturn(7501, 5000, 1.5)).toBe(false);
  });

  it('mesure la longueur du retour sur l\'aller', () => {
    const aller = [at(0), at(1000), at(2000)];
    const length = 2000;
    // Le même chemin en sens inverse : tout est commun.
    expect(sharedDistanceM([...aller].reverse(), [aller], 12)).toBeCloseTo(length, -1);
    // Une rue parallèle à 50 m : rien.
    expect(sharedDistanceM([at(0, 50), at(2000, 50)], [aller], 12)).toBe(0);
    // La moitié sur l'aller, puis on s'en écarte.
    expect(sharedDistanceM([at(0), at(1000), at(1000, 500)], [aller], 12)).toBeGreaterThan(990);
    expect(sharedDistanceM([at(0), at(1000), at(1000, 500)], [aller], 12)).toBeLessThan(1020);
  });

  it('l\'aller en morceaux : rien n\'est compté entre la fin de l\'un et le début du suivant', () => {
    const before = [at(0), at(1000)];
    const after = [at(2000), at(3000)];
    // Le retour longe le trou entre les deux morceaux (une ligne droite de l'aller) : seuls les morceaux comptent.
    // Deux morceaux de 1 km, chacun un peu plus avec la tolérance à ses bouts.
    const shared = sharedDistanceM([at(0), at(3000)], [before, after], 12);
    expect(shared).toBeGreaterThan(1990);
    expect(shared).toBeLessThan(2050);
    expect(sharedDistanceM([at(1100), at(1900)], [before, after], 12)).toBe(0);
  });

  it('une longue ligne droite en diagonale reste rapide (grille par bouts, pas par boîte englobante)', () => {
    // 15 km en diagonale, deux points : l'ancienne grille rangeait le segment dans près d'un million de cases.
    const aller = [at(0), at(10_600, 10_600)];
    const t0 = performance.now();
    const shared = sharedDistanceM([at(0), at(10_600, 10_600)], [aller], 12);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(shared / Math.hypot(10_600, 10_600)).toBeCloseTo(1, 2);
    // Un point à 11 m du milieu compte, à 13 m non : la grille par bouts ne perd rien.
    const mid = { n: 5300, e: 5300 };
    const off = (d: number) => [at(mid.n + d / Math.SQRT2, mid.e - d / Math.SQRT2), at(mid.n + d / Math.SQRT2 + 3, mid.e - d / Math.SQRT2 + 3)];
    expect(sharedDistanceM(off(11), [aller], 12)).toBeGreaterThan(0);
    expect(sharedDistanceM(off(13), [aller], 12)).toBe(0);
  });
});
