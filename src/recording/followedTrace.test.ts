import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, legKey, withLegResult } from '../planning/route';
import { routeToRecord } from '../planning/routeRecord';
import {
  FOLLOWED_TRACE_TOLERANCE_M, followProgress, followedTraceFromPoints, followedTraceFromRoute, followedTraceLengthM,
  splitFollowedTrace, thinFollowedTrace, type FollowedTrace,
} from './followedTrace';

const A = { lat: 43.6, lon: 3.8 };
const B = { lat: 43.61, lon: 3.8 };
const C = { lat: 43.62, lon: 3.81 };
const META = { name: 'Tour du Pic', activityId: null, createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z' };

describe('trace suivie', () => {
  it('garde les positions exploitables, sans le reste du point', () => {
    const trace = followedTraceFromPoints([{ ...A, ele: 12 } as { lat: number; lon: number }, { lat: NaN, lon: 3.8 }, B], 'Sortie', 'session');
    expect(trace).toEqual({ name: 'Sortie', source: 'session', activityId: null, points: [A, B] });
    expect(followedTraceFromPoints([A, B], 'Sortie', 'session', 'kite')?.activityId).toBe('kite');
  });

  it('refuse une trace de moins de deux positions', () => {
    expect(followedTraceFromPoints([A], 'Un point', 'session')).toBeNull();
    expect(followedTraceFromPoints([A, { lat: Infinity, lon: 0 }], 'Un point', 'session')).toBeNull();
  });

  it('suit un itinéraire : tronçon calculé à la suite, tronçon en attente en ligne droite', () => {
    let route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'sentier'), EMPTY_ROUTE);
    const mid = { lat: 43.605, lon: 3.801 };
    route = withLegResult(route, legKey(route, 0)!, [A, mid, B]);
    const trace = followedTraceFromRoute(routeToRecord(route, META));
    // L'activité de l'itinéraire suit la trace : elle sera proposée pour l'enregistrement.
    expect(trace).toEqual({ name: 'Tour du Pic', source: 'route', activityId: META.activityId, points: [A, mid, B, C], marks: [A, B, C] });
  });

  it('garde les bips propres à l\'itinéraire, et aucun quand il n\'en a pas', () => {
    const route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'straight'), EMPTY_ROUTE);
    const guide = { curve: [{ distanceM: 30, intervalMs: 200 }, { distanceM: 120, intervalMs: 1500 }], vibrate: true };
    expect(followedTraceFromRoute(routeToRecord(route, { ...META, markGuide: guide }))?.markGuide).toEqual(guide);
    expect(followedTraceFromRoute(routeToRecord(route, META))).not.toHaveProperty('markGuide');
  });

  it('garde les balises exploitables, et aucune pour une session', () => {
    const trace = followedTraceFromPoints([A, B], 'Parcours', 'route', 'wingfoil', [A, { lat: NaN, lon: 3.8 }, C]);
    expect(trace?.marks).toEqual([A, C]);
    expect(followedTraceFromPoints([A, B], 'Sortie', 'session')).not.toHaveProperty('marks');
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

describe('trace suivie amincie pour être gardée', () => {
  /** Générateur pseudo-aléatoire à graine fixe. */
  const noise = (() => {
    let seed = 42;
    return () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31 - 0.5;
    };
  })();

  it('réduit fortement trois heures à 1 Hz, à 1 % près sur la longueur, bouts et balises intacts', () => {
    // Une boucle de 10 800 points, avec un bruit de ±1 m. Le bruit allonge la trace brute ;
    // l'amincie retrouve la longueur du tracé sans bruit.
    const clean: [number, number][] = [];
    for (let i = 0; i < 10_800; i++) {
      const a = (2 * Math.PI * i) / 10_800;
      clean.push([3000 * Math.cos(a), 2000 * Math.sin(2 * a)]);
    }
    const marks = [at(3000, 0), at(-3000, 0)];
    const trace = { ...traceOf(clean.map(([e, n]) => [e + 2 * noise(), n + 2 * noise()])), marks };
    const thin = thinFollowedTrace(trace, FOLLOWED_TRACE_TOLERANCE_M);
    expect(thin.points.length).toBeLessThan(trace.points.length / 5);
    expect(thin.points[0]).toEqual({ lat: Math.round(trace.points[0].lat * 1e6) / 1e6, lon: Math.round(trace.points[0].lon * 1e6) / 1e6 });
    expect(thin.marks).toBe(marks);
    expect(thin.name).toBe(trace.name);
    expect(Math.abs(followedTraceLengthM(thin) / followedTraceLengthM(traceOf(clean)) - 1)).toBeLessThan(0.01);
    // Plus léger d'un facteur dix une fois gardé.
    expect(JSON.stringify(thin).length).toBeLessThan(JSON.stringify(trace).length / 10);
  });

  it('suit la même avancée que la trace complète', () => {
    const line = traceOf(walk([[0, 0], [0, 500], [400, 900]], 1).map((p) => [
      (p.lon - O.lon) * M_PER_DEG_LON, (p.lat - O.lat) * M_PER_DEG_LAT,
    ] as [number, number]));
    const thin = thinFollowedTrace(line, FOLLOWED_TRACE_TOLERANCE_M);
    expect(thin.points.length).toBe(3);
    const fixes = [walk([[0, 0], [0, 500], [200, 700]], 5)];
    expect(followProgress(thin, fixes)!.progressM).toBeCloseTo(followProgress(line, fixes)!.progressM, -1);
  });
});
