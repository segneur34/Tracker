import { describe, expect, it } from 'vitest';
import { parseGpxPath } from '../core/gpxParser';
import { MARK_GUIDE_DEFAULTS } from '../recording/markGuide';
import { EMPTY_ROUTE, addWaypoint, closeLoop, type PlannedRoute, type Waypoint } from './route';
import { buildRouteGpx, embeddedRouteRecord, markLabel } from './routeGpx';
import { importedRouteRecord, isRouteGpx, uniqueRouteName } from './routeImport';
import { recordToRoute, routeToRecord } from './routeRecord';

const A: Waypoint = { lat: 43.6, lon: 3.8 };
const B: Waypoint = { lat: 43.61, lon: 3.8 };
const C: Waypoint = { lat: 43.61, lon: 3.81 };

const build = (points: Waypoint[]): PlannedRoute => points.reduce((route, p) => addWaypoint(route, p, 'straight'), EMPTY_ROUTE);

const NOW = '2026-11-07T12:00:00.000Z';
const options = (takenNames: string[] = []) => ({ nowIso: NOW, takenNames, activityFor: () => null });

/** Parcours de balises bouclé, avec son activité et ses bips propres : ce qu'un téléphone partage. */
const course = closeLoop(build([A, B, C]), 'straight');
const courseRecord = routeToRecord(course, {
  name: 'Parcours <Carnon> & co', activityId: 'voile', createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-02T08:00:00.000Z',
  markGuide: MARK_GUIDE_DEFAULTS,
});
const sharedGpx = buildRouteGpx(course, courseRecord.name, markLabel, courseRecord);

const ROUTE_ONLY = '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>Tour du lac</name>'
  + '<rtept lat="43.60" lon="3.80"><ele>10</ele></rtept><rtept lat="43.61" lon="3.80"><ele>12</ele></rtept></rte></gpx>';

const trackGpx = (withTime: boolean): string => '<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>'
  + [0, 1, 2].map((s) => `<trkpt lat="43.6${s}" lon="3.8">${withTime ? `<time>2026-10-27T10:00:0${s}Z</time>` : ''}</trkpt>`).join('')
  + '</trkseg></trk></gpx>';

describe('GPX d\'un itinéraire avec sa fiche (lot 194)', () => {
  it('la fiche portée en extension se relit à l\'identique, nom échappé compris', () => {
    expect(embeddedRouteRecord(sharedGpx)).toEqual(courseRecord);
  });

  it('sans fiche demandée (GPX pour une montre), rien de plus qu\'avant', () => {
    const plain = buildRouteGpx(course, courseRecord.name, markLabel);
    expect(plain).not.toContain('<extensions>');
    expect(embeddedRouteRecord(plain)).toBeNull();
  });

  it('les autres applications y lisent le même tracé', () => {
    expect(parseGpxPath(sharedGpx).points).toEqual(parseGpxPath(buildRouteGpx(course, courseRecord.name, markLabel)).points);
  });
});

describe('aiguillage d\'un GPX reçu : itinéraire ou session', () => {
  it('itinéraire : fiche de Tracker, route seule, trace sans heure', () => {
    expect(isRouteGpx(sharedGpx)).toBe(true);
    expect(isRouteGpx(ROUTE_ONLY)).toBe(true);
    expect(isRouteGpx(trackGpx(false))).toBe(true);
  });

  it('session : une trace datée reste une session ; vide ou illisible n\'est pas un itinéraire', () => {
    expect(isRouteGpx(trackGpx(true))).toBe(false);
    expect(isRouteGpx('<?xml version="1.0"?><gpx version="1.1"></gpx>')).toBe(false);
    expect(isRouteGpx('pas du XML <<<')).toBe(false);
  });
});

describe('nom d\'un itinéraire importé', () => {
  it('libre : gardé ; pris (casse et espaces ignorés) : numéroté', () => {
    expect(uniqueRouteName('Tour du lac', ['Autre'])).toBe('Tour du lac');
    expect(uniqueRouteName('Tour du lac', [' tour du LAC '])).toBe('Tour du lac (2)');
    expect(uniqueRouteName('Tour du lac', ['Tour du lac', 'Tour du lac (2)'])).toBe('Tour du lac (3)');
    expect(uniqueRouteName('  ', [])).toBe('Itinéraire');
  });
});

describe('fiche d\'un itinéraire importé', () => {
  it('GPX de Tracker : balises, tronçons, activité et bips repris tels quels, nom non doublé', () => {
    const record = importedRouteRecord(sharedGpx, 'x.gpx', options([courseRecord.name]));
    expect(record).not.toBeNull();
    expect(record?.name).toBe('Parcours <Carnon> & co (2)');
    expect(record?.updatedAt).toBe(NOW);
    expect(record?.createdAt).toBe(courseRecord.createdAt);
    expect(record?.activityId).toBe('voile');
    expect(record?.markGuide).toEqual(MARK_GUIDE_DEFAULTS);
    expect(recordToRoute(record!)).toEqual(recordToRoute(courseRecord));
  });

  it('autre GPX : la trace gardée telle quelle, nommée par le fichier, activité devinée', () => {
    const record = importedRouteRecord(ROUTE_ONLY, 'komoot.gpx', { ...options(), activityFor: (type) => (type === undefined ? 'course' : null) });
    expect(record?.name).toBe('Tour du lac');
    expect(record?.activityId).toBe('course');
    expect(record?.createdAt).toBe(NOW);
    expect(record?.legs.map((leg) => leg.mode)).toEqual(['imported']);
    expect(record?.waypoints).toEqual([{ lat: 43.6, lon: 3.8 }, { lat: 43.61, lon: 3.8 }]);
    const unnamed = importedRouteRecord(trackGpx(false), 'Sortie.GPX', options());
    expect(unnamed?.name).toBe('Sortie');
  });

  it('moins de deux points : pas d\'itinéraire', () => {
    expect(importedRouteRecord('<?xml version="1.0"?><gpx version="1.1"></gpx>', 'vide.gpx', options())).toBeNull();
  });
});
