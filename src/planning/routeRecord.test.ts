import { describe, expect, it } from 'vitest';
import { EMPTY_ROUTE, addWaypoint, legKey, withLegResult, type PlannedRoute } from './route';
import { buildRouteGpx, waypointLabel } from './routeGpx';
import {
  ROUTE_VERSION, isWritableRouteRecord, parseRouteRecord, recordToRoute, routeFileBase, routeToRecord, serializeRouteRecord,
} from './routeRecord';

const A = { lat: 43.6, lon: 3.8 };
const B = { lat: 43.61, lon: 3.8 };
const C = { lat: 43.62, lon: 3.81 };

/** A → B calculé (avec altitude), B → C en attente. */
const sample = (): PlannedRoute => {
  let route = [A, B, C].reduce((r, p) => addWaypoint(r, p, 'foot'), EMPTY_ROUTE);
  route = withLegResult(route, legKey(route, 0)!, [
    { ...A, eleM: 100 }, { lat: 43.605, lon: 3.8012345678, eleM: 120.26 }, { ...B, eleM: 110 },
  ]);
  return route;
};

const META = { name: 'Tour du Pic', activityId: 'course', createdAt: '2026-09-25T10:00:00.000Z', updatedAt: '2026-09-25T11:00:00.000Z' };

describe('fiche d\'itinéraire', () => {
  it('fait l\'aller-retour : tronçons calculés gardés, tronçons en attente recalculés', () => {
    const route = sample();
    const record = parseRouteRecord(serializeRouteRecord(routeToRecord(route, META)))!;
    expect(record).toMatchObject({ name: 'Tour du Pic', activityId: 'course', version: ROUTE_VERSION });
    const back = recordToRoute(record);
    expect(back.waypoints).toEqual([A, B, C]);
    expect(back.legs[0].status).toBe('ready');
    expect(back.legs[0].points[1]).toEqual({ lat: 43.605, lon: 3.8012346, eleM: 120.3 });
    expect(back.legs[1]).toMatchObject({ mode: 'foot', status: 'pending' });
  });

  it('garde les champs inconnus et ne réécrit pas une fiche d\'une version future', () => {
    const text = JSON.stringify({ ...routeToRecord(sample(), META), version: ROUTE_VERSION + 1, couleur: 'rouge' });
    const record = parseRouteRecord(text)!;
    expect(record.couleur).toBe('rouge');
    expect(isWritableRouteRecord(record)).toBe(false);
    expect(routeToRecord(sample(), META, record).couleur).toBe('rouge');
  });

  it('refuse ce qui n\'est pas une fiche d\'itinéraire', () => {
    expect(parseRouteRecord('pas du json')).toBeNull();
    expect(parseRouteRecord(JSON.stringify({ format: 'tracker-session', version: 1 }))).toBeNull();
    expect(parseRouteRecord(JSON.stringify({ format: 'tracker-itineraire', version: 1, waypoints: [{ lat: 'x' }] }))).toBeNull();
  });

  it('recalcule des tronçons qui ne correspondent plus aux points', () => {
    const record = routeToRecord(sample(), META);
    const route = recordToRoute({ ...record, legs: record.legs.slice(1) });
    expect(route.legs.map((l) => l.status)).toEqual(['pending', 'pending']);
  });

  it('nomme le fichier d\'après l\'itinéraire, sans caractère interdit ni doublon', () => {
    expect(routeFileBase('Tour du Pic', [])).toBe('Tour du Pic');
    expect(routeFileBase('A/B : aller?', [])).toBe('A B aller');
    expect(routeFileBase('Tour du Pic', ['tour du pic.json', 'Tour du Pic.gpx', 'Tour du Pic-2.json'])).toBe('Tour du Pic-3');
    expect(routeFileBase(' ... ', [])).toBe('itineraire');
  });
});

describe('GPX d\'itinéraire', () => {
  const gpx = buildRouteGpx(sample(), 'Tour & retour');

  it('porte les points de passage et la trace d\'un seul segment, sans heure', () => {
    expect(gpx).toContain('<wpt lat="43.6" lon="3.8"><name>A</name></wpt>');
    expect(gpx.match(/<wpt /g)).toHaveLength(3);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
    // A, point intermédiaire, B (jonction une seule fois), C.
    expect(gpx.match(/<trkpt /g)).toHaveLength(4);
    expect(gpx).toContain('<trkpt lat="43.605" lon="3.8012346"><ele>120.3</ele></trkpt>');
    expect(gpx).not.toContain('<time>');
    expect(gpx).toContain('<name>Tour &amp; retour</name>');
  });

  it('nomme les points A, B… puis A2 après Z', () => {
    expect(waypointLabel(0)).toBe('A');
    expect(waypointLabel(25)).toBe('Z');
    expect(waypointLabel(26)).toBe('A2');
  });
});
