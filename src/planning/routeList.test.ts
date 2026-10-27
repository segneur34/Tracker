import { describe, expect, it } from 'vitest';
import type { Activity } from '../core/activities';
import { EMPTY_ROUTE, addWaypoint } from './route';
import { routeDistanceM, routeDurationS, routesOfFamily, sortRoutes } from './routeList';
import { routeToRecord } from './routeRecord';

const activities: Activity[] = [
  { id: 'wingfoil', name: 'Voile', base: 'wingfoil', color: '#1565c0' },
  { id: 'running', name: 'Course', base: 'running', color: '#bf360c' },
  { id: 'moth', name: 'Moth', base: 'windsurf', color: '#00897b' },
];

const route = (name: string, activityId: string | null) => ({ name, record: { activityId } });

const routes = [
  route('tour du lac', 'wingfoil'),
  route('footing', 'running'),
  route('régate', 'moth'),
  route('sans activité', null),
  route('activité supprimée', 'a-disparu'),
  route('calcul de base', 'kite'),
];

describe('routesOfFamily', () => {
  it('garde les itinéraires dont l’activité est de la famille', () => {
    expect(routesOfFamily(routes, activities, 'voile').map((r) => r.name)).toEqual(['tour du lac', 'régate', 'calcul de base']);
    expect(routesOfFamily(routes, activities, 'course').map((r) => r.name)).toEqual(['footing']);
  });
});

describe('sortRoutes', () => {
  const saved = (base: string, name: string, updatedAt: string, distanceM: number) => ({ base, distanceM, record: { name, updatedAt } });
  const list = [
    saved('b', 'Été au lac', '2026-09-20T10:00:00Z', 5000),
    saved('a', 'baie', '2026-09-28T10:00:00Z', 12000),
    saved('c', 'Anse', '2026-09-01T10:00:00Z', 5000),
  ];
  const order = (sort: Parameters<typeof sortRoutes>[1]) => sortRoutes(list, sort, (r) => r.distanceM).map((r) => r.base);

  it('trie par date, par nom sans tenir compte de la casse ni des accents, par distance', () => {
    expect(order('recent')).toEqual(['a', 'b', 'c']);
    expect(order('ancien')).toEqual(['c', 'b', 'a']);
    expect(order('nom')).toEqual(['c', 'a', 'b']);
    expect(order('distance-croissante')).toEqual(['b', 'c', 'a']);
    expect(order('distance-decroissante')).toEqual(['a', 'b', 'c']);
  });

  it('ne touche pas à la liste reçue', () => {
    order('nom');
    expect(list.map((r) => r.base)).toEqual(['b', 'a', 'c']);
  });
});

describe('distance et temps d\'une fiche', () => {
  const planned = [{ lat: 43.6, lon: 3.8 }, { lat: 43.61, lon: 3.8 }, { lat: 43.61, lon: 3.81 }]
    .reduce((r, w) => addWaypoint(r, w, 'straight'), EMPTY_ROUTE);
  const meta = { name: 'boucle', activityId: 'running', createdAt: '2026-10-27T10:00:00Z', updatedAt: '2026-10-27T10:00:00Z' };

  it('calculés une fois par fiche : la même valeur, sans refaire le tracé', () => {
    const record = routeToRecord(planned, meta);
    const first = routeDistanceM(record);
    expect(first).toBeGreaterThan(1900);
    // Les points de la fiche changés en place ne sont pas relus : la valeur vient du cache.
    record.waypoints.splice(1, 2);
    expect(routeDistanceM(record)).toBe(first);
    // Une autre fiche, même identique, se calcule à part.
    expect(routeDistanceM(routeToRecord(planned, meta))).toBe(first);
  });

  it('le temps est gardé par réglage', () => {
    const record = routeToRecord(planned, meta);
    const slow = routeDurationS(record, 3, { family: 'course', flatSpeedMs: 2, climbFactor: 10 });
    const fast = routeDurationS(record, 3, { family: 'course', flatSpeedMs: 4, climbFactor: 10 });
    expect(slow).not.toBeNull();
    expect(fast! * 2).toBeCloseTo(slow!, 6);
    expect(routeDurationS(record, 3, null)).toBeNull();
  });
});
