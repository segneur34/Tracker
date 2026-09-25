import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, legKey, withLegResult } from '../planning/route';
import { routeToRecord } from '../planning/routeRecord';
import {
  followProgress, followedTraceFromPoints, followedTraceFromRoute, followedTraceLengthM, splitFollowedTrace,
  type FollowedTrace,
} from './followedTrace';

const A = { lat: 43.6, lon: 3.8 };
const B = { lat: 43.61, lon: 3.8 };
const C = { lat: 43.62, lon: 3.81 };
const META = { name: 'Tour du Pic', activityId: null, createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' };

describe('trace suivie', () => {
  it('garde les positions exploitables, sans le reste du point', () => {
    const trace = followedTraceFromPoints([{ ...A, ele: 12 } as { lat: number; lon: number }, { lat: NaN, lon: 3.8 }, B], 'Sortie', 'session');
    expect(trace).toEqual({ name: 'Sortie', source: 'session', points: [A, B] });
  });

  it('refuse une trace de moins de deux positions', () => {
    expect(followedTraceFromPoints([A], 'Un point', 'session')).toBeNull();
    expect(followedTraceFromPoints([A, { lat: Infinity, lon: 0 }], 'Un point', 'session')).toBeNull();
  });

  it('suit un itinéraire : tronçon calculé à la suite, tronçon en attente en ligne droite', () => {
    let route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'foot'), EMPTY_ROUTE);
    const mid = { lat: 43.605, lon: 3.801 };
    route = withLegResult(route, legKey(route, 0)!, [A, mid, B]);
    const trace = followedTraceFromRoute(routeToRecord(route, META));
    expect(trace).toEqual({ name: 'Tour du Pic', source: 'route', points: [A, mid, B, C] });
  });
});

/** Mètres par degré de latitude, et de longitude à la latitude de `O`. */
const M_PER_DEG_LAT = 111195;
const O = { lat: 43.6, lon: 3.8 };
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((O.lat * Math.PI) / 180);
/** Position à `east` m à l'est et `north` m au nord de `O`. */
const at = (east: number, north: number) => ({ lat: O.lat + north / M_PER_DEG_LAT, lon: O.lon + east / M_PER_DEG_LON });

const traceOf = (pts: [number, number][]): FollowedTrace => followedTraceFromPoints(pts.map(([e, n]) => at(e, n)), 'Test', 'route')!;

/** Parcours enregistré le long de sommets donnés, un point tous les `stepM` mètres. */
const walk = (pts: [number, number][], stepM: number) => {
  const out = [at(pts[0][0], pts[0][1])];
  for (let k = 1; k < pts.length; k++) {
    const [e0, n0] = pts[k - 1];
    const [e1, n1] = pts[k];
    const len = Math.hypot(e1 - e0, n1 - n0);
    const count = Math.max(1, Math.round(len / stepM));
    for (let j = 1; j <= count; j++) out.push(at(e0 + ((e1 - e0) * j) / count, n0 + ((n1 - n0) * j) / count));
  }
  return out;
};

describe('avancement sur la trace suivie', () => {
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);

  it('suit un aller simple, la distance restante décroît', () => {
    const p = followProgress(line, [walk([[0, 0], [5, 600]], 5)]);
    expect(p!.totalM).toBeCloseTo(1000, -1);
    expect(p!.progressM).toBeCloseTo(600, -1);
    expect(p!.remainingM).toBeCloseTo(400, -1);
  });

  it('ne dépend pas de la cadence : pas de 1 m ou de 5 m donnent le même avancement', () => {
    const fine = followProgress(line, [walk([[0, 0], [10, 420]], 1)])!;
    const coarse = followProgress(line, [walk([[0, 0], [10, 420]], 5)])!;
    expect(fine.progressM).toBeCloseTo(coarse.progressM, 3);
  });

  it("reste nul tant que la trace n'est pas rejointe", () => {
    expect(followProgress(line, [walk([[500, 0], [500, 1000]], 10)])).toBeNull();
  });

  it("part de 0 sur une boucle dont le départ est l'arrivée", () => {
    const loop = traceOf([[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]]);
    const p = followProgress(loop, [walk([[0, 0], [100, 0]], 5)])!;
    expect(p.progressM).toBeCloseTo(100, -1);
    const end = followProgress(loop, [walk([[0, 0], [400, 0], [400, 400], [0, 400], [0, 10]], 5)])!;
    expect(end.remainingM).toBeCloseTo(10, -1);
  });

  it("ne saute pas sur le retour d'un aller-retour", () => {
    const outAndBack = traceOf([[0, 0], [0, 500], [0, 0]]);
    const going = followProgress(outAndBack, [walk([[0, 0], [0, 300]], 5)])!;
    expect(going.progressM).toBeCloseTo(300, -1);
    const back = followProgress(outAndBack, [walk([[0, 0], [0, 500], [0, 200]], 5)])!;
    expect(back.progressM).toBeCloseTo(800, -1);
  });

  it("gèle l'avancement hors trace, puis se raccroche plus loin (raccourci)", () => {
    // Un U : on quitte la trace en bas, on coupe tout droit, on la rejoint sur l'autre branche.
    const u = traceOf([[0, 0], [0, 1000], [300, 1000], [300, 0]]);
    const away = followProgress(u, [walk([[0, 0], [0, 200], [150, 200]], 5)])!;
    expect(away.progressM).toBeCloseTo(200, -1);
    const rejoined = followProgress(u, [walk([[0, 0], [0, 200], [300, 200], [300, 100]], 5)])!;
    expect(rejoined.progressM).toBeCloseTo(1000 + 300 + 900, -1);
  });

  it("traverse les pauses : chaque segment continue l'avancement", () => {
    const p = followProgress(line, [walk([[0, 0], [0, 300]], 5), walk([[0, 320], [0, 700]], 5)])!;
    expect(p.progressM).toBeCloseTo(700, -1);
  });
});

describe('découpe de la trace suivie', () => {
  const line = traceOf([[0, 0], [0, 500], [0, 1000]]);

  it("coupe au point d'avancement, partagé par les deux parties", () => {
    const { done, remaining } = splitFollowedTrace(line, 250);
    expect(done).toHaveLength(2);
    expect(remaining).toHaveLength(3);
    expect(done[1]).toEqual(remaining[0]);
    expect(done[1].lat).toBeCloseTo(at(0, 250).lat, 6);
  });

  it("aux bords : rien de fait au départ, tout fait à l'arrivée", () => {
    expect(splitFollowedTrace(line, 0)).toEqual({ done: [], remaining: line.points });
    expect(splitFollowedTrace(line, followedTraceLengthM(line))).toEqual({ done: line.points, remaining: [] });
  });
});
