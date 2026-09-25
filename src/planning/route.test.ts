import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROUTE, addWaypoint, closeLoop, insertWaypoint, isLooped, legKey, moveWaypoint, nextPendingLeg, pendingLegRequests, removeWaypoint,
  reorderWaypoint, retryFailedLegs, reverseRoute, routePoints, routeProfileRows, routeTotals, setLegMode, snapToWaypoints, waypointDistances, withLegError, withLegResult,
  type PlannedRoute, type RoutePoint, type Waypoint,
} from './route';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };
const C: Waypoint = { lat: 43.62, lon: 3.8 };
const D: Waypoint = { lat: 43.63, lon: 3.8 };

/** Un degré de latitude fait un peu plus de 111 km : 0,01° ≈ 1 112 m. */
const STEP_M = 1112;

const build = (points: Waypoint[], mode: 'foot' | 'straight' = 'foot'): PlannedRoute =>
  points.reduce((route, p) => addWaypoint(route, p, mode), EMPTY_ROUTE);

/** Tracé calculé factice : trois points sur la droite, altitudes données. */
const computed = (from: Waypoint, to: Waypoint, eles: [number, number, number]): RoutePoint[] => [
  { lat: from.lat, lon: from.lon, eleM: eles[0] },
  { lat: (from.lat + to.lat) / 2, lon: from.lon, eleM: eles[1] },
  { lat: to.lat, lon: to.lon, eleM: eles[2] },
];

/** Calcule tous les tronçons en attente avec des altitudes données. */
const resolveAll = (route: PlannedRoute, eles: [number, number, number]): PlannedRoute => {
  let r = route;
  for (let i = nextPendingLeg(r); i >= 0; i = nextPendingLeg(r)) {
    r = withLegResult(r, legKey(r, i)!, computed(r.waypoints[i], r.waypoints[i + 1], eles));
  }
  return r;
};

describe('édition d\'un itinéraire', () => {
  it('ajoute des points et un tronçon à calculer entre chaque paire', () => {
    const route = build([A, B, C]);
    expect(route.waypoints).toEqual([A, B, C]);
    expect(route.legs).toHaveLength(2);
    expect(route.legs.every((l) => l.status === 'pending')).toBe(true);
    expect(route.legs[0].points).toEqual([A, B]);
  });

  it('un tronçon en ligne droite est prêt tout de suite', () => {
    const route = build([A, B], 'straight');
    expect(route.legs[0].status).toBe('ready');
    expect(nextPendingLeg(route)).toBe(-1);
  });

  it('insère un point : le tronçon coupé devient deux tronçons du même mode, les autres restent', () => {
    const route = resolveAll(build([A, C, D]), [0, 0, 0]);
    const inserted = insertWaypoint(route, 0, B);
    expect(inserted.waypoints).toEqual([A, B, C, D]);
    expect(inserted.legs.map((l) => l.status)).toEqual(['pending', 'pending', 'ready']);
    expect(inserted.legs[2]).toBe(route.legs[1]);
  });

  it('déplace un point : seuls ses deux tronçons sont à recalculer', () => {
    const route = resolveAll(build([A, B, C, D]), [0, 0, 0]);
    const moved = moveWaypoint(route, 1, { lat: 43.612, lon: 3.81 });
    expect(moved.legs.map((l) => l.status)).toEqual(['pending', 'pending', 'ready']);
    const first = moveWaypoint(route, 0, { lat: 43.59, lon: 3.8 });
    expect(first.legs.map((l) => l.status)).toEqual(['pending', 'ready', 'ready']);
  });

  it('retire un point au bout ou au milieu', () => {
    const route = resolveAll(build([A, B, C, D]), [0, 0, 0]);
    expect(removeWaypoint(route, 0).legs).toEqual(route.legs.slice(1));
    expect(removeWaypoint(route, 3).legs).toEqual(route.legs.slice(0, 2));
    const middle = removeWaypoint(route, 1);
    expect(middle.waypoints).toEqual([A, C, D]);
    expect(middle.legs.map((l) => l.status)).toEqual(['pending', 'ready']);
    expect(middle.legs[0].points).toEqual([A, C]);
    expect(removeWaypoint(build([A]), 0)).toEqual(EMPTY_ROUTE);
  });

  it('au milieu, le tronçon fusionné garde le mode du tronçon qui arrivait au point', () => {
    const route = setLegMode(build([A, B, C]), 0, 'straight');
    expect(removeWaypoint(route, 1).legs[0].mode).toBe('straight');
  });

  it('change le mode d\'un tronçon', () => {
    const route = resolveAll(build([A, B]), [0, 0, 0]);
    const bike = setLegMode(route, 0, 'bike');
    expect(bike.legs[0]).toMatchObject({ mode: 'bike', status: 'pending' });
    expect(setLegMode(route, 0, 'foot')).toBe(route);
  });

  it('inverse le sens : tracés retournés en attendant le recalcul', () => {
    const route = resolveAll(build([A, B, C]), [10, 20, 30]);
    const reversed = reverseRoute(route);
    expect(reversed.waypoints).toEqual([C, B, A]);
    expect(reversed.legs.every((l) => l.status === 'pending')).toBe(true);
    // C était l'arrivée du tronçon B → C, à 30 m.
    expect(reversed.legs[0].points[0]).toEqual({ ...C, eleM: 30 });
  });

  it('boucle : un dernier tronçon ramène au départ, une seule fois', () => {
    const loop = closeLoop(build([A, B]), 'foot');
    expect(loop.waypoints).toEqual([A, B, A]);
    expect(isLooped(loop)).toBe(true);
    expect(closeLoop(loop, 'foot')).toBe(loop);
    expect(isLooped(build([A, B]))).toBe(false);
    expect(closeLoop(build([A]), 'foot').waypoints).toEqual([A]);
  });

  it('sur une boucle, déplacer le départ déplace l\'arrivée : la boucle reste fermée', () => {
    const loop = resolveAll(closeLoop(build([A, B, C]), 'foot'), [0, 0, 0]);
    const moved = moveWaypoint(loop, 0, D);
    expect(moved.waypoints).toEqual([D, B, C, D]);
    expect(moved.legs.map((l) => l.status)).toEqual(['pending', 'ready', 'pending']);
    expect(isLooped(moved)).toBe(true);
  });

  it('réordonne : tronçons inchangés gardés, les autres recalculés avec le mode de leur place', () => {
    // A → B → C → D, tronçons calculés ; B → C en ligne droite.
    const route = resolveAll(setLegMode(build([A, B, C, D]), 1, 'straight'), [0, 0, 0]);
    const moved = reorderWaypoint(route, 3, 1); // D passe en deuxième : A, D, B, C
    expect(moved.waypoints).toEqual([A, D, B, C]);
    // D → B prend la ligne droite de sa place : prête tout de suite ; A → D est à calculer.
    expect(moved.legs.map((l) => l.status)).toEqual(['pending', 'ready', 'ready']);
    expect(moved.legs[2]).toBe(route.legs[1]);
    expect(moved.legs.map((l) => l.mode)).toEqual(['foot', 'straight', 'straight']);
    expect(reorderWaypoint(route, 1, 1)).toBe(route);
    expect(reorderWaypoint(route, 0, 9)).toBe(route);
  });
});

describe('résultats de calcul', () => {
  it('n\'applique pas un résultat si le tronçon a changé pendant la requête', () => {
    const route = build([A, B]);
    const key = legKey(route, 0)!;
    const moved = moveWaypoint(route, 1, C);
    expect(withLegResult(moved, key, computed(A, B, [0, 0, 0]))).toBe(moved);
    expect(withLegResult(route, key, computed(A, B, [0, 0, 0])).legs[0].status).toBe('ready');
  });

  it('retrouve le tronçon par sa clé si un point a été inséré avant lui pendant la requête', () => {
    const route = build([B, C]);
    const key = legKey(route, 0)!;
    const withStart = { waypoints: [A, ...route.waypoints], legs: [...build([A, B], 'straight').legs, ...route.legs] };
    expect(withLegResult(withStart, key, computed(B, C, [0, 0, 0])).legs[1].status).toBe('ready');
  });

  it('liste les calculs à demander, une fois par clé', () => {
    const route = closeLoop(build([A, B]), 'straight');
    expect(pendingLegRequests(route)).toEqual([{ key: legKey(route, 0), from: A, to: B, mode: 'foot' }]);
  });

  it('un échec garde la ligne droite et la raison', () => {
    const route = build([A, B]);
    const failed = withLegError(route, legKey(route, 0)!, 'Pas de réseau');
    expect(failed.legs[0]).toMatchObject({ status: 'error', error: 'Pas de réseau', points: [A, B] });
    expect(nextPendingLeg(failed)).toBe(-1);
    expect(retryFailedLegs(failed).legs[0].status).toBe('pending');
    expect(retryFailedLegs(route)).toBe(route);
  });

  it('relie le tracé calculé aux points posés, et mesure l\'écart', () => {
    const snapped = snapToWaypoints(A, C, [{ ...B, eleM: 5 }, { lat: 43.615, lon: 3.8, eleM: 6 }]);
    // Les points ajoutés prennent l'altitude du chemin voisin.
    expect(snapped.points[0]).toEqual({ ...A, eleM: 5 });
    expect(snapped.points[snapped.points.length - 1]).toEqual({ ...C, eleM: 6 });
    expect(snapped.maxGapM).toBeGreaterThan(STEP_M * 0.99);
    expect(snapToWaypoints(A, B, computed(A, B, [0, 0, 0]))).toEqual({ points: computed(A, B, [0, 0, 0]), maxGapM: 0 });
    expect(snapToWaypoints(A, A, []).points).toEqual([A, A]);
  });
});

describe('totaux et profil', () => {
  it('compte la distance le long du tracé, jonctions une seule fois', () => {
    const route = resolveAll(build([A, B, C]), [0, 0, 0]);
    expect(routePoints(route)).toHaveLength(5);
    const totals = routeTotals(route, 3);
    expect(totals.distanceM).toBeGreaterThan(2 * STEP_M * 0.99);
    expect(totals.distanceM).toBeLessThan(2 * STEP_M * 1.01);
    expect(totals.pendingLegs).toBe(0);
  });

  it('cumule le dénivelé avec le seuil du terrain', () => {
    const route = resolveAll(build([A, B, C]), [100, 150, 120]);
    // Jonction comptée une fois (celle du premier tronçon) : 100 → 150 → 120 → 150 → 120.
    const totals = routeTotals(route, 5);
    expect(totals.gainM).toBe(50 + 30);
    expect(totals.lossM).toBe(30 + 30);
  });

  it('donne la distance depuis le départ et la longueur du tronçon d\'arrivée de chaque point', () => {
    const d = waypointDistances(resolveAll(build([A, B, C]), [0, 0, 0]));
    expect(d[0]).toEqual({ cumulativeM: 0, legM: 0 });
    expect(d[1].legM).toBeCloseTo(STEP_M, -1);
    expect(d[2].cumulativeM).toBeCloseTo(2 * STEP_M, -1);
  });

  it('sans altitude, pas de dénivelé', () => {
    const totals = routeTotals(build([A, B], 'straight'), 3);
    expect(totals.gainM).toBeNull();
    expect(totals.distanceM).toBeGreaterThan(0);
  });

  it('le profil est rééchantillonné à pas régulier, pente mesurée même entre points espacés', () => {
    // Deux points à 1 112 m l'un de l'autre, 100 m de montée : 9 % tout du long.
    const rows = routeProfileRows([{ ...A, eleM: 100 }, { ...B, eleM: 200 }], 10);
    expect(rows).toHaveLength(Math.ceil(STEP_M / 10) + 1);
    expect(rows[1].distM).toBe(10);
    expect(rows[rows.length - 1]).toMatchObject({ lat: B.lat, lon: B.lon, eleM: 200 });
    const middle = rows[Math.floor(rows.length / 2)];
    expect(middle.eleM).toBeCloseTo(150, 0);
    expect(middle.grade).toBeCloseTo(100 / STEP_M, 2);
  });

  it('sans altitude à un bout, le profil a un trou', () => {
    const rows = routeProfileRows([{ ...A, eleM: 100 }, { ...B }]);
    expect(rows.every((r) => r.eleM === null)).toBe(true);
    expect(routeProfileRows([])).toEqual([]);
  });
});
