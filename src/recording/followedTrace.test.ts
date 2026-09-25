import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, legKey, withLegResult } from '../planning/route';
import { routeToRecord } from '../planning/routeRecord';
import { followedTraceFromPoints, followedTraceFromRoute } from './followedTrace';

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
