import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, closeLoop, type PlannedRoute, type Waypoint } from './route';
import { buildRouteGpx, markLabel } from './routeGpx';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };
const C: Waypoint = { lat: 43.61, lon: 3.81 };

const build = (points: Waypoint[]): PlannedRoute => points.reduce((route, p) => addWaypoint(route, p, 'straight'), EMPTY_ROUTE);

const names = (gpx: string): string[] => [...gpx.matchAll(/<wpt [^>]*><name>([^<]*)<\/name><\/wpt>/g)].map((m) => m[1]);

describe('GPX d\'un itinéraire', () => {
  it('un <wpt> par point de passage, lettrés', () => {
    expect(names(buildRouteGpx(build([A, B, C]), 'Sortie'))).toEqual(['A', 'B', 'C']);
  });

  it('une boucle n\'a pas de point de plus sur le départ', () => {
    const loop = closeLoop(build([A, B]), 'straight');
    expect(loop.waypoints).toHaveLength(3);
    const gpx = buildRouteGpx(loop, 'Boucle');
    expect(names(gpx)).toEqual(['A', 'B']);
    // La trace, elle, revient bien au départ.
    expect(gpx.match(/<trkpt /g)).toHaveLength(3);
    expect(names(buildRouteGpx(closeLoop(build([A, B, C]), 'straight'), 'Parcours', markLabel))).toEqual(['1', '2', '3']);
  });
});
