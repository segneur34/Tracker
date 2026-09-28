import { describe, expect, it } from 'vitest';
import type { Activity } from '../core/activities';
import { routesOfFamily, sortRoutes } from './routeList';

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
