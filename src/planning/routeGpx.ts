import { escapeXml } from '../recording/gpxWriter';
import { routePoints, type PlannedRoute } from './route';

/**
 * GPX d'un itinéraire, pour l'emporter dans une autre application ou sur une
 * montre : GPX 1.1, sans heure (rien n'a encore été parcouru), un `<wpt>` par
 * point de passage et une trace d'un seul segment, la forme que Komoot,
 * Garmin et la plupart des montres suivent sans surprise.
 *
 * C'est un export : la fiche (`routeRecord.ts`) fait foi, elle seule porte
 * les tronçons et leur mode.
 */

/** Nom d'un point de passage : A, B, … Z, puis A2, B2… */
export const waypointLabel = (index: number): string => {
  const letter = String.fromCharCode(65 + (index % 26));
  const round = Math.floor(index / 26);
  return round === 0 ? letter : `${letter}${round + 1}`;
};

const fixed = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

export const buildRouteGpx = (route: PlannedRoute, name: string): string => {
  const safeName = escapeXml(name);
  const waypoints = route.waypoints.map(
    (w, i) => `  <wpt lat="${fixed(w.lat, 7)}" lon="${fixed(w.lon, 7)}"><name>${waypointLabel(i)}</name></wpt>`
  );
  const trackPoints = routePoints(route).map((p) => {
    const ele = p.eleM !== undefined ? `<ele>${fixed(p.eleM, 1)}</ele>` : '';
    return `      <trkpt lat="${fixed(p.lat, 7)}" lon="${fixed(p.lon, 7)}">${ele}</trkpt>`;
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Tracker" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${safeName}</name></metadata>`,
    ...waypoints,
    '  <trk>',
    `    <name>${safeName}</name>`,
    '    <trkseg>',
    ...trackPoints,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
};
