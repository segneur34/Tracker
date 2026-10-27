import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addBeforeReturn, addWaypoint, isLooped, legKey, removeWaypoint, setRouteMode, withLegResult, type PlannedRoute, type Waypoint } from '../planning/route';
import { plannedRouteReducer, type PlannedRouteAction, type PlannedRouteState } from './usePlannedRoute';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };
const C: Waypoint = { lat: 43.62, lon: 3.8 };

const start = (loop: boolean): PlannedRouteState => ({ route: EMPTY_ROUTE, mode: 'sentier', loop, history: [] });

const run = (state: PlannedRouteState, actions: PlannedRouteAction[]): PlannedRouteState => actions.reduce(plannedRouteReducer, state);

/** Point posé comme le fait la page : avant le retour en mode « Boucle », à la fin sinon. */
const add = (w: Waypoint): PlannedRouteAction => ({
  type: 'edit',
  change: (r: PlannedRoute, looping: boolean) => (looping ? addBeforeReturn(r, w, 'sentier') : addWaypoint(r, w, 'sentier')),
});

describe('état de la planification', () => {
  it('mode « Boucle » : retirer le seul point de l\'aller laisse le départ seul', () => {
    const looped = run(start(true), [add(A), add(B)]);
    expect(looped.route.waypoints).toEqual([A, B, A]);
    expect(isLooped(looped.route)).toBe(true);
    const removed = plannedRouteReducer(looped, { type: 'edit', change: (r) => removeWaypoint(r, 1, 'sentier') });
    expect(removed.route).toEqual({ waypoints: [A], legs: [] });
    // « Précédent » rend la boucle.
    expect(plannedRouteReducer(removed, { type: 'undo' }).route).toBe(looped.route);
  });

  it('« Précédent » après un changement de cases rend cases et tracé', () => {
    const placed = run(start(false), [add(A), add(B), add(C)]);
    const computed = placed.route.legs.reduce(
      (r, _leg, i) => withLegResult(r, legKey(r, i)!, [r.waypoints[i], r.waypoints[i + 1]]),
      placed.route
    );
    const ready = plannedRouteReducer(placed, { type: 'apply', change: () => computed });
    // Un résultat de calcul n'entre pas dans l'annulation.
    expect(ready.history).toHaveLength(placed.history.length);
    const changed = plannedRouteReducer(ready, { type: 'mode', mode: 'route', change: (r) => setRouteMode(r, 'route', 'sentier') });
    expect(changed.mode).toBe('route');
    expect(changed.route.legs.every((l) => l.mode === 'route' && l.status === 'pending')).toBe(true);
    const undone = plannedRouteReducer(changed, { type: 'undo' });
    expect(undone.mode).toBe('sentier');
    expect(undone.route).toBe(computed);
  });

  it('carte vide : cases et mode « Boucle » changent sans rien à défaire', () => {
    const empty = start(false);
    const looping = plannedRouteReducer(empty, { type: 'loop', on: true });
    expect(looping.loop).toBe(true);
    expect(looping.history).toHaveLength(0);
    const mode = plannedRouteReducer(looping, { type: 'mode', mode: 'route', change: (r) => r });
    expect(mode.mode).toBe('route');
    expect(mode.history).toHaveLength(0);
  });

  it('allumer « Boucle » sur un itinéraire ouvert le boucle, l\'éteindre retire le retour', () => {
    const open = run(start(false), [add(A), add(B)]);
    const on = plannedRouteReducer(open, { type: 'loop', on: true });
    expect(on.route.waypoints).toEqual([A, B, A]);
    const off = plannedRouteReducer(on, { type: 'loop', on: false });
    expect(off.route.waypoints).toEqual([A, B]);
    expect(off.loop).toBe(false);
  });
});
