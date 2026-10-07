import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOP_CLOSE_M, EMPTY_ROUTE, acceptLoopReturn, addBeforeReturn, addWaypoint, closeLoop, courseLegs, insertWaypoint, isChoosableMode, isLooped, isRouteMode, isWaysMode, legKey,
  moveWaypoint, nextPendingLeg, pendingLegRequests, readRouteMode, recomputeLegsWithoutSurfaces, removeWaypoint, reorderWaypoint, retryFailedLegs,
  presetWayTypes, reverseRoute, routeFromTrack, routeModeLabel, routePoints, sanitizeWayTypes, toggleWayType, wayTypesOf, waysMode,
  routeProfileRows, routeTotals, routeVehicle, setLegMode, setRouteMode, snapToWaypoints, straightenRoute, waypointDistances, withLegError, withLegResult,
  nextReturnVariant, openLoop, outboundKey, removeLoopStart, returnRequest, withLoopReturn, withReturnError, withReturnResult,
  type PlannedRoute, type RoutePoint, type Waypoint,
} from './route';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };
const C: Waypoint = { lat: 43.62, lon: 3.8 };
const D: Waypoint = { lat: 43.63, lon: 3.8 };

/** Un degré de latitude fait un peu plus de 111 km : 0,01° ≈ 1 112 m. */
const STEP_M = 1112;

const build = (points: Waypoint[], mode: 'sentier' | 'straight' = 'sentier'): PlannedRoute =>
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
    const bike = setLegMode(route, 0, 'route');
    expect(bike.legs[0]).toMatchObject({ mode: 'route', status: 'pending' });
    expect(setLegMode(route, 0, 'sentier')).toBe(route);
  });

  it('types de voie de tout l\'itinéraire : chaque tronçon calculé les prend, ligne droite et trace importée restent', () => {
    // A → B calculé, B → C en ligne droite, C → D importé.
    const resolved = resolveAll(setLegMode(build([A, B, C, D]), 1, 'straight'), [0, 0, 0]);
    const imported = { mode: 'imported' as const, status: 'ready' as const, points: [C, { lat: 43.625, lon: 3.81 }, D] };
    const route: PlannedRoute = { ...resolved, legs: [resolved.legs[0], resolved.legs[1], imported] };
    const changed = setRouteMode(route, 'piste+route', 'sentier');
    expect(changed.legs[0]).toEqual({ mode: 'piste+route', status: 'pending', points: [A, B] });
    expect(changed.legs[1]).toBe(route.legs[1]);
    expect(changed.legs[2]).toBe(imported);
    expect(setRouteMode(changed, 'piste+route', 'sentier')).toBe(changed);
    expect(setRouteMode(route, 'imported', 'sentier')).toBe(route);
    expect(setRouteMode(EMPTY_ROUTE, 'route', 'sentier')).toBe(EMPTY_ROUTE);
  });

  it('ligne droite au-dessus de la carte : tout se redresse, et en revenir refait aussi les tronçons droits', () => {
    const route = resolveAll(setLegMode(build([A, B, C]), 1, 'straight'), [0, 0, 0]);
    const straight = setRouteMode(route, 'straight', 'sentier');
    expect(straight.legs.map((l) => [l.mode, l.status])).toEqual([['straight', 'ready'], ['straight', 'ready']]);
    expect(straight.legs[1]).toBe(route.legs[1]);
    const back = setRouteMode(straight, 'route', 'straight');
    expect(back.legs.map((l) => [l.mode, l.status])).toEqual([['route', 'pending'], ['route', 'pending']]);
  });

  it('règles d\'accès changées : les tronçons calculés sont refaits, même dans leur mode', () => {
    const route = resolveAll(setLegMode(build([A, B, C]), 1, 'straight'), [0, 0, 0]);
    expect(setRouteMode(route, 'sentier', 'sentier')).toBe(route);
    const redone = setRouteMode(route, 'sentier', 'sentier', true);
    expect(redone.legs[0]).toEqual({ mode: 'sentier', status: 'pending', points: [A, B] });
    expect(redone.legs[1]).toBe(route.legs[1]);
    // Vers la ligne droite, rien à recalculer.
    expect(setRouteMode(build([A, B], 'straight'), 'straight', 'straight', true).legs[0].status).toBe('ready');
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
    const loop = closeLoop(build([A, B]), 'sentier');
    expect(loop.waypoints).toEqual([A, B, A]);
    expect(isLooped(loop)).toBe(true);
    expect(closeLoop(loop, 'sentier')).toBe(loop);
    expect(isLooped(build([A, B]))).toBe(false);
    expect(closeLoop(build([A]), 'sentier').waypoints).toEqual([A]);
  });

  it('boucle en ligne droite : le dernier tronçon est prêt tout de suite, rien à calculer', () => {
    const route = resolveAll(build([A, B, C]), [0, 0, 0]);
    const loop = closeLoop(route, 'straight');
    expect(isLooped(loop)).toBe(true);
    expect(loop.legs[2]).toEqual({ mode: 'straight', status: 'ready', points: [C, A] });
    expect(pendingLegRequests(loop)).toEqual([]);
  });

  it('sur une boucle, déplacer le départ déplace l\'arrivée : la boucle reste fermée', () => {
    const loop = resolveAll(closeLoop(build([A, B, C]), 'sentier'), [0, 0, 0]);
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
    expect(moved.legs.map((l) => l.mode)).toEqual(['sentier', 'straight', 'straight']);
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
    expect(pendingLegRequests(route)).toEqual([{ key: legKey(route, 0), from: A, to: B, mode: 'sentier' }]);
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

  it('fait prendre à l\'approche ajoutée en tête la voie qui suit', () => {
    const surfaces = { tags: ['highway=track', 'highway=residential'], runs: [[0, 0], [1, 1]] as [number, number][] };
    const snapped = snapToWaypoints(A, C, [{ ...B }, { lat: 43.615, lon: 3.8 }, { lat: 43.618, lon: 3.8 }], surfaces);
    expect(snapped.points).toHaveLength(5);
    expect(snapped.surfaces?.runs).toEqual([[0, 0], [2, 1]]);
    // Sans point ajouté en tête, rien ne bouge.
    expect(snapToWaypoints(B, C, [{ ...B }, { lat: 43.615, lon: 3.8 }], surfaces).surfaces).toBe(surfaces);
  });

  it('pose les voies avec le tracé calculé, et recalcule les tronçons rangés sans elles', () => {
    const surfaces = { tags: ['highway=residential'], runs: [[0, 0]] as [number, number][] };
    let route = build([A, B, C]);
    route = withLegResult(route, legKey(route, 0)!, computed(A, B, [0, 0, 0]), surfaces);
    route = withLegResult(route, legKey(route, 1)!, computed(B, C, [0, 0, 0]));
    expect(route.legs[0].surfaces).toBe(surfaces);
    expect(route.legs[1]).not.toHaveProperty('surfaces');
    const again = recomputeLegsWithoutSurfaces(route);
    expect(again.legs[0]).toBe(route.legs[0]);
    expect(again.legs[1].status).toBe('pending');
    // Ligne droite et trace importée n'ont pas de voies à demander.
    const fixed = build([A, B], 'straight');
    expect(recomputeLegsWithoutSurfaces(fixed)).toBe(fixed);
    const imported = routeFromTrack([A, B, C])!;
    expect(recomputeLegsWithoutSurfaces(imported)).toBe(imported);
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

describe('trace importée', () => {
  /** Trace de A vers le nord, puis vers l'est : cinq points, altitudes croissantes. */
  const track: RoutePoint[] = [
    { ...A, eleM: 10 },
    { lat: 43.605, lon: 3.8, eleM: 20 },
    { ...B, eleM: 30 },
    { lat: 43.61, lon: 3.805, eleM: 40 },
    { lat: 43.61, lon: 3.81, eleM: 50 },
  ];
  const END: Waypoint = { lat: 43.61, lon: 3.81 };

  it('garde la trace entière entre le départ et l\'arrivée, points répétés retirés', () => {
    const route = routeFromTrack([track[0], track[1], track[1], track[2], track[3], track[4]])!;
    expect(route.waypoints).toEqual([A, END]);
    expect(route.legs).toEqual([{ mode: 'imported', status: 'ready', points: track }]);
    expect(isLooped(route)).toBe(false);
    expect(nextPendingLeg(route)).toBe(-1);
    expect(routeTotals(route, 3).gainM).toBe(40);
  });

  it('écarte les positions illisibles, et rend null sous deux points distincts', () => {
    expect(routeFromTrack([A, { lat: NaN, lon: 3.8 }, B])!.legs[0].points).toEqual([A, B]);
    expect(routeFromTrack([A, A])).toBeNull();
    expect(routeFromTrack([])).toBeNull();
  });

  it('une trace qui revient près de son départ est une boucle, fermée exactement au départ', () => {
    // Retour à une vingtaine de mètres du départ.
    const back = { lat: 43.6002, lon: 3.8, eleM: 12 };
    const route = routeFromTrack([...track, { lat: 43.605, lon: 3.81 }, back])!;
    expect(isLooped(route)).toBe(true);
    expect(route.waypoints).toHaveLength(3);
    expect(route.waypoints[0]).toEqual(A);
    expect(route.legs.every((l) => l.mode === 'imported' && l.status === 'ready')).toBe(true);
    const all = routePoints(route);
    expect(all[all.length - 1]).toEqual({ ...A, eleM: 10 });
    // Rien de perdu : tous les points de la trace sont dans l'itinéraire, dans l'ordre.
    expect(all.slice(0, -1)).toEqual([...track, { lat: 43.605, lon: 3.81 }, back]);
    // Au-delà du seuil, pas de boucle.
    expect(isLooped(routeFromTrack([...track, { lat: 43.605, lon: 3.81 }, back], { loopCloseM: 10 })!)).toBe(false);
    expect(DEFAULT_LOOP_CLOSE_M).toBeGreaterThan(20);
  });

  it('insérer un point le pose sur la trace et la coupe sans rien perdre', () => {
    const route = routeFromTrack(track)!;
    // Touché à une vingtaine de mètres à l'ouest du milieu du premier segment.
    const cut = insertWaypoint(route, 0, { lat: 43.6025, lon: 3.7998 });
    expect(cut.waypoints).toHaveLength(3);
    expect(cut.waypoints[1].lon).toBeCloseTo(3.8, 9);
    expect(cut.waypoints[1].lat).toBeCloseTo(43.6025, 6);
    expect(cut.legs.map((l) => l.mode)).toEqual(['imported', 'imported']);
    expect(cut.legs[0].points[cut.legs[0].points.length - 1].eleM).toBeCloseTo(15, 3);
    expect(routeTotals(cut, 3).distanceM).toBeCloseTo(routeTotals(route, 3).distanceM, 3);
    // Au bout de la trace, rien à couper.
    expect(insertWaypoint(route, 0, { lat: 43.59, lon: 3.8 })).toBe(route);
  });

  it('retirer le point entre deux parts importées les recolle, tracé intact', () => {
    const route = routeFromTrack(track)!;
    const cut = insertWaypoint(route, 0, B);
    expect(cut.waypoints).toEqual([A, B, END]);
    const joined = removeWaypoint(cut, 1, 'sentier');
    expect(joined.legs).toEqual(route.legs);
  });

  it('déplacer un point refait ses tronçons importés dans le mode choisi, les autres restent', () => {
    const cut = insertWaypoint(routeFromTrack(track)!, 0, B);
    const moved = moveWaypoint(cut, 2, { lat: 43.62, lon: 3.81 }, 'route');
    expect(moved.legs[0]).toBe(cut.legs[0]);
    expect(moved.legs[1]).toMatchObject({ mode: 'route', status: 'pending' });
    // Sans mode donné, la ligne droite.
    expect(moveWaypoint(cut, 2, { lat: 43.62, lon: 3.81 }).legs[1]).toMatchObject({ mode: 'straight', status: 'ready' });
    // Retirer un point entre une part importée et une ligne droite : refait dans le mode choisi.
    const mixed = addWaypoint(routeFromTrack(track)!, C, 'straight');
    expect(removeWaypoint(mixed, 1, 'piste').legs[0]).toMatchObject({ mode: 'piste', status: 'pending' });
  });

  it('inverser retourne la trace sans la recalculer', () => {
    const route = routeFromTrack(track)!;
    const reversed = reverseRoute(route);
    expect(reversed.legs[0]).toEqual({ mode: 'imported', status: 'ready', points: [...track].reverse() });
    expect(pendingLegRequests(reversed)).toEqual([]);
  });

  it('réordonner garde une part importée dont les extrémités n\'ont pas changé', () => {
    const route = addWaypoint(routeFromTrack(track)!, C, 'sentier');
    const moved = reorderWaypoint(route, 2, 0, 'sentier');
    expect(moved.waypoints).toEqual([C, A, END]);
    expect(moved.legs[1]).toBe(route.legs[0]);
    expect(moved.legs[0]).toMatchObject({ mode: 'sentier', status: 'pending' });
  });

  it('le mode importé se relit mais ne se choisit pas', () => {
    expect(isRouteMode('imported')).toBe(true);
    expect(isChoosableMode('imported')).toBe(false);
    expect(isChoosableMode('sentier')).toBe(true);
    expect(isRouteMode('toString')).toBe(false);
  });

  it('traduit les modes d\'avant les types de voie, qui ne se choisissent plus', () => {
    expect(readRouteMode('foot')).toBe('sentier');
    expect(readRouteMode('mtb')).toBe('piste');
    expect(readRouteMode('bike')).toBe('route');
    expect(readRouteMode('grandeRoute')).toBe('grandeRoute');
    expect(readRouteMode('toString')).toBeNull();
    expect(readRouteMode(undefined)).toBeNull();
    expect(isChoosableMode('foot')).toBe(false);
  });

  it('relit « Chemin », devenu « Sentier », seul ou avec d\x27autres types', () => {
    expect(readRouteMode('chemin')).toBe('sentier');
    expect(readRouteMode('chemin+piste')).toBe('sentier+piste');
    expect(readRouteMode('route+chemin')).toBe('sentier+route');
    // Un ancien nom n'est pas un mode tel quel : il se relit, puis s'écrit sous le nouveau.
    expect(isRouteMode('chemin')).toBe(false);
  });

  it('écrit plusieurs types cochés dans l\'ordre fixe, sans doublon ; aucun type ne fait pas de mode', () => {
    expect(waysMode(['grandeRoute', 'route'])).toBe('route+grandeRoute');
    expect(waysMode(['piste', 'sentier', 'piste'])).toBe('sentier+piste');
    expect(waysMode(['route'])).toBe('route');
    expect(waysMode([])).toBeNull();
    expect(wayTypesOf('sentier+route+grandeRoute')).toEqual(['sentier', 'route', 'grandeRoute']);
    expect(isWaysMode('route+grandeRoute')).toBe(true);
    expect(isWaysMode('straight')).toBe(false);
    expect(isWaysMode('imported')).toBe(false);
  });

  it('relit une combinaison, remise dans l\'ordre, et refuse un type inconnu', () => {
    expect(readRouteMode('route+grandeRoute')).toBe('route+grandeRoute');
    expect(readRouteMode('grandeRoute+route')).toBe('route+grandeRoute');
    expect(readRouteMode('route+toString')).toBeNull();
    expect(readRouteMode('')).toBeNull();
    expect(readRouteMode('straight')).toBe('straight');
    // Seule la forme dans l'ordre est un mode tel quel.
    expect(isRouteMode('route+grandeRoute')).toBe(true);
    expect(isRouteMode('grandeRoute+route')).toBe(false);
    expect(isChoosableMode('sentier+piste')).toBe(true);
    expect(isChoosableMode('straight')).toBe(true);
  });

  it('nomme un mode en clair', () => {
    expect(routeModeLabel('route+grandeRoute')).toBe('Route + Grande route');
    expect(routeModeLabel('sentier')).toBe('Sentier');
    expect(routeModeLabel('straight')).toBe('Ligne droite');
    expect(routeModeLabel('imported')).toBe('Trace importée');
  });

  it('coche et décoche un type, sans jamais décocher le dernier ; depuis la ligne droite, le type seul', () => {
    expect(toggleWayType('route', 'grandeRoute')).toBe('route+grandeRoute');
    expect(toggleWayType('route+grandeRoute', 'route')).toBe('grandeRoute');
    expect(toggleWayType('route', 'route')).toBe('route');
    expect(toggleWayType('straight', 'piste')).toBe('piste');
    expect(toggleWayType('imported', 'sentier')).toBe('sentier');
  });

  it('passe un tronçon d\'une combinaison à une autre, et le recalcule', () => {
    const route = setLegMode(build([A, B]), 0, 'route+grandeRoute');
    expect(route.legs[0]).toMatchObject({ mode: 'route+grandeRoute', status: 'pending' });
    expect(legKey(route, 0)).toContain(':route+grandeRoute');
    expect(setLegMode(route, 0, 'grandeRoute').legs[0]).toMatchObject({ mode: 'grandeRoute', status: 'pending' });
  });

  it('prend les règles du vélo pour la famille vélo, celles du piéton sinon', () => {
    expect(routeVehicle('velo')).toBe('velo');
    expect(routeVehicle('course')).toBe('pieton');
    expect(routeVehicle('voile')).toBe('pieton');
  });

  it('propose des types de voie selon le type de vélo, ou le terrain à pied ; aucun en voile', () => {
    expect(presetWayTypes('velo', 'route', 'trail')).toEqual(['route']);
    expect(presetWayTypes('velo', 'ville', 'route')).toEqual(['route']);
    expect(presetWayTypes('velo', 'gravel', 'route')).toEqual(['piste']);
    expect(presetWayTypes('velo', 'vtt', 'route')).toEqual(['sentier', 'piste']);
    expect(presetWayTypes('course', 'vtt', 'route')).toEqual(['route']);
    expect(presetWayTypes('course', 'route', 'trail')).toEqual(['sentier', 'piste']);
    expect(presetWayTypes('voile', 'route', 'route')).toEqual([]);
  });

  it('lit les types de voie d\'un réglage : remis dans l\'ordre, sans doublon, jamais vides', () => {
    expect(sanitizeWayTypes(['piste', 'sentier', 'piste'])).toEqual(['sentier', 'piste']);
    expect(sanitizeWayTypes([])).toBeNull();
    expect(sanitizeWayTypes(['route', 'autoroute'])).toBeNull();
    expect(sanitizeWayTypes('route')).toBeNull();
    expect(sanitizeWayTypes(undefined)).toBeNull();
  });
});

describe('parcours de voile', () => {
  it('redresse les tronçons calculés, garde lignes droites et traces importées', () => {
    const computedLegs = resolveAll(build([A, B, C]), [10, 20, 30]);
    const imported = routeFromTrack([A, { lat: 43.605, lon: 3.801 }, B])!;
    const mixed: PlannedRoute = {
      waypoints: [A, B, C, D],
      legs: [imported.legs[0], computedLegs.legs[1], build([C, D], 'straight').legs[0]],
    };
    const straight = straightenRoute(mixed);
    expect(straight.waypoints).toEqual(mixed.waypoints);
    expect(straight.legs[0]).toBe(mixed.legs[0]);
    expect(straight.legs[1]).toEqual({ mode: 'straight', status: 'ready', points: [B, C] });
    expect(straight.legs[2]).toBe(mixed.legs[2]);
  });

  it('rend le même itinéraire quand il n\'y a rien à redresser', () => {
    const route = build([A, B, C], 'straight');
    expect(straightenRoute(route)).toBe(route);
  });

  it('donne distance et cap de chaque bord, de balise en balise', () => {
    const east: Waypoint = { lat: 43.61, lon: 3.81 };
    const legs = courseLegs(build([A, B, east], 'straight'));
    expect(legs).toHaveLength(2);
    expect(legs[0].distanceM).toBeCloseTo(STEP_M, -1);
    expect(legs[0].bearingDeg).toBeCloseTo(0, 3);
    expect(legs[1].bearingDeg).toBeCloseTo(90, 0);
    expect(courseLegs(EMPTY_ROUTE)).toEqual([]);
  });
});

describe('mode « Boucle »', () => {
  const W: Waypoint = { lat: 43.615, lon: 3.81 };

  /** Point posé en mode « Boucle », puis l'itinéraire remis en ordre, comme le fait le réducteur. */
  const loopAdd = (route: PlannedRoute, w: Waypoint): PlannedRoute => withLoopReturn(addBeforeReturn(route, w, 'sentier'), 'sentier');
  const loopBuild = (points: Waypoint[]): PlannedRoute => points.reduce(loopAdd, EMPTY_ROUTE);

  /** Calcule l'aller, tronçon par tronçon, l'itinéraire remis en ordre après chaque résultat. */
  const resolveOutbound = (route: PlannedRoute): PlannedRoute => {
    let r = route;
    for (let requests = pendingLegRequests(r); requests.length > 0; requests = pendingLegRequests(r)) {
      const { key, from, to } = requests[0];
      r = withLoopReturn(withLegResult(r, key, computed(from, to, [0, 0, 0])), 'sentier');
    }
    return r;
  };

  /** Retour calculé : un détour par l'est. */
  const resolveReturn = (route: PlannedRoute): PlannedRoute => {
    const request = returnRequest(route)!;
    const points = [request.from, { lat: (request.from.lat + request.to.lat) / 2, lon: 3.82 }, request.to];
    return withLoopReturn(withReturnResult(route, request.basis, request.variant, { points, outcome: 'avoided', sharedM: 40 }), 'sentier');
  };

  const last = (route: PlannedRoute) => route.legs[route.legs.length - 1];

  it('poser des points boucle l\'itinéraire : le dernier tronçon est le retour, seul marqué', () => {
    expect(loopBuild([A])).toEqual({ waypoints: [A], legs: [] });
    const two = loopBuild([A, B]);
    expect(two.waypoints).toEqual([A, B, A]);
    expect(last(two)).toMatchObject({ status: 'pending', loopReturn: { basis: outboundKey(two), variant: 0 } });
    const three = loopBuild([A, B, C]);
    expect(three.waypoints).toEqual([A, B, C, A]);
    expect(three.legs.map((l) => l.loopReturn !== undefined)).toEqual([false, false, true]);
    expect(withLoopReturn(three, 'sentier')).toBe(three);
  });

  it('le retour se calcule à part, une fois tout l\'aller calculé', () => {
    const route = loopBuild([A, B, C]);
    expect(pendingLegRequests(route).map((r) => r.key)).toEqual([legKey(route, 0), legKey(route, 1)]);
    expect(returnRequest(route)).toBeNull();
    const outbound = resolveOutbound(route);
    const request = returnRequest(outbound)!;
    expect(request).toMatchObject({ from: C, to: A, mode: 'sentier', variant: 0, basis: outboundKey(outbound) });
    expect(request.outbound).toEqual(outbound.legs.slice(0, 2));
    // Un résultat ordinaire ne se pose pas sur le retour.
    expect(withLegResult(outbound, legKey(outbound, 2)!, computed(C, A, [0, 0, 0]))).toBe(outbound);
    const done = resolveReturn(outbound);
    expect(last(done)).toMatchObject({ status: 'ready', loopReturn: { outcome: 'avoided', sharedM: 40, variant: 0 } });
    // Son propre résultat ne le remet pas en calcul.
    expect(withLoopReturn(done, 'sentier')).toBe(done);
    expect(returnRequest(done)).toBeNull();
  });

  it('un aller modifié remet le retour en calcul, et le résultat d\'avant n\'est plus posé', () => {
    const done = resolveReturn(resolveOutbound(loopBuild([A, B, C])));
    const stale = returnRequest(resolveOutbound(loopBuild([A, B, C])))!;
    const moved = withLoopReturn(moveWaypoint(done, 1, W), 'sentier');
    expect(last(moved)).toMatchObject({ status: 'pending', loopReturn: { basis: outboundKey(moved), variant: 0 } });
    expect(withReturnResult(moved, stale.basis, stale.variant, { points: [C, A], outcome: 'avoided', sharedM: 0 })).toBe(moved);
  });

  it('« Réessayer » un tronçon de l\'aller refait aussi le retour', () => {
    const route = loopBuild([A, B, C]);
    const failed = withLoopReturn(withLegError(route, legKey(route, 0)!, 'Pas de réseau'), 'sentier');
    const done = resolveReturn(resolveOutbound(failed));
    expect(done.legs[0].status).toBe('error');
    expect(last(done).status).toBe('ready');
    const retried = withLoopReturn(retryFailedLegs(done), 'sentier');
    expect(last(retried).status).toBe('pending');
  });

  it('échec du retour : ligne droite et raison, marque gardée', () => {
    const outbound = resolveOutbound(loopBuild([A, B, C]));
    const request = returnRequest(outbound)!;
    const failed = withReturnError(outbound, request.basis, request.variant, 'Aucun chemin trouvé');
    expect(last(failed)).toMatchObject({ status: 'error', error: 'Aucun chemin trouvé', points: [C, A], loopReturn: { basis: request.basis } });
    expect(withLoopReturn(failed, 'sentier')).toBe(failed);
  });

  it('« Autre retour » passe à la variante suivante, puis revient à la première', () => {
    let route = resolveReturn(resolveOutbound(loopBuild([A, B, C])));
    const variants: number[] = [];
    for (let k = 0; k < 4; k++) {
      route = withLoopReturn(nextReturnVariant(route), 'sentier');
      expect(last(route).status).toBe('pending');
      variants.push(returnRequest(route)!.variant);
      route = resolveReturn(route);
    }
    expect(variants).toEqual([1, 2, 3, 0]);
    expect(nextReturnVariant(build([A, B]))).toEqual(build([A, B]));
  });

  it('un point posé sur le retour rejoint l\'aller ; le nouveau retour part de lui', () => {
    const done = resolveReturn(resolveOutbound(loopBuild([A, B, C])));
    const inserted = withLoopReturn(insertWaypoint(done, 2, W), 'sentier');
    expect(inserted.waypoints).toEqual([A, B, C, W, A]);
    expect(inserted.legs[2]).toMatchObject({ status: 'pending', points: [C, W] });
    expect(inserted.legs[2].loopReturn).toBeUndefined();
    expect(last(inserted)).toMatchObject({ status: 'pending', points: [W, A], loopReturn: { variant: 0 } });
  });

  it('déplacer A déplace le départ et l\'arrivée ; « Inverser » garde A et déplace la marque', () => {
    const done = resolveReturn(resolveOutbound(loopBuild([A, B, C])));
    const moved = withLoopReturn(moveWaypoint(done, 0, D), 'sentier');
    expect(moved.waypoints).toEqual([D, B, C, D]);
    expect(last(moved).loopReturn?.basis).toBe(outboundKey(moved));
    const reversed = withLoopReturn(reverseRoute(done), 'sentier');
    expect(reversed.waypoints).toEqual([A, C, B, A]);
    expect(reversed.legs.map((l) => l.loopReturn !== undefined)).toEqual([false, false, true]);
    expect(pendingLegRequests(reversed).map((r) => r.from)).toEqual([A, C]);
  });

  it('retirer A fait du point suivant le départ, et la boucle s\'y referme', () => {
    const done = resolveReturn(resolveOutbound(loopBuild([A, B, C])));
    const removed = withLoopReturn(removeLoopStart(done), 'sentier');
    expect(removed.waypoints).toEqual([B, C, B]);
    expect(removed.legs[0]).toBe(done.legs[1]);
    expect(last(removed)).toMatchObject({ status: 'pending', points: [C, B] });
    expect(withLoopReturn(removeLoopStart(loopBuild([A, B])), 'sentier').waypoints).toEqual([B]);
  });

  it('ligne droite et trace importée ne sont jamais marquées', () => {
    const straight = withLoopReturn(build([A, B, C], 'straight'), 'straight');
    expect(last(straight)).toEqual({ mode: 'straight', status: 'ready', points: [C, A] });
    expect(returnRequest(straight)).toBeNull();
    const imported = routeFromTrack([A, { lat: 43.605, lon: 3.81 }, B, { lat: 43.605, lon: 3.79 }, { lat: 43.6001, lon: 3.8 }])!;
    expect(isLooped(imported)).toBe(true);
    expect(withLoopReturn(imported, 'sentier')).toBe(imported);
    expect(openLoop(imported)).toBe(imported);
  });

  it('bouton allumé sur une boucle faite par « Boucler » : son retour est refait ; éteint : le retour est retiré', () => {
    const closed = resolveAll(closeLoop(build([A, B, C]), 'sentier'), [0, 0, 0]);
    const on = withLoopReturn(closed, 'sentier');
    expect(last(on)).toMatchObject({ status: 'pending', loopReturn: { variant: 0 } });
    expect(on.legs.slice(0, 2)).toEqual(closed.legs.slice(0, 2));
    const off = openLoop(on);
    expect(off.waypoints).toEqual([A, B, C]);
    expect(off.legs).toEqual(closed.legs.slice(0, 2));
    expect(openLoop(build([A, B]))).toEqual(build([A, B]));
  });

  it('boucle rouverte : son retour est pris tel quel, rien à recalculer', () => {
    const closed = resolveAll(closeLoop(build([A, B, C]), 'sentier'), [0, 0, 0]);
    const opened = acceptLoopReturn(closed);
    expect(last(opened)).toMatchObject({ status: 'ready', loopReturn: { basis: outboundKey(closed), variant: 0 } });
    expect(withLoopReturn(opened, 'sentier')).toBe(opened);
    expect(returnRequest(opened)).toBeNull();
    expect(acceptLoopReturn(build([A, B]))).toEqual(build([A, B]));
  });
});
