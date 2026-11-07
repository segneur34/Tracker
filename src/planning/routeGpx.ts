import { escapeXmlAttr, escapeXmlText, gpxDocument } from '../core/xml';
import { isLooped, routePoints, type PlannedRoute } from './route';
import { parseRouteRecord, serializeRouteRecord, type RouteRecord } from './routeRecord';

/**
 * GPX d'un itinéraire, pour l'emporter dans une autre application ou sur une
 * montre : GPX 1.1, sans heure (rien n'a encore été parcouru), un `<wpt>` par
 * point de passage et une trace d'un seul segment, la forme que Komoot,
 * Garmin et la plupart des montres suivent sans surprise. L'arrivée d'une
 * boucle, posée sur le départ, n'a pas de `<wpt>` à elle : la page la nomme
 * comme le départ, et un point de plus au même endroit s'y confondrait.
 *
 * C'est un export : la fiche (`routeRecord.ts`) fait foi, elle seule porte
 * les tronçons et leur mode. Pour passer l'itinéraire d'un téléphone à
 * l'autre (lot 194), le GPX rangé dans `itineraires/` et partagé porte sa
 * fiche dans une extension posée juste avant `</gpx>`, que les autres
 * applications ignorent, comme le GPX complet d'une session
 * (`library/sessionBundle.ts`) : relu par `embeddedRouteRecord`.
 */

const NS = 'https://github.com/segneur34/Tracker/itineraire';
const OPEN = `<extensions><tracker:itineraire xmlns:tracker="${NS}" version="1">`;
const CLOSE = '</tracker:itineraire></extensions>';

const unescapeXml = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Fiche portée par le GPX d'un itinéraire (`buildRouteGpx` avec `record`) ; `null` sans bloc, ou bloc illisible. */
export const embeddedRouteRecord = (gpx: string): RouteRecord | null => {
  const start = gpx.lastIndexOf(OPEN);
  const end = start < 0 ? -1 : gpx.indexOf(CLOSE, start);
  return end < 0 ? null : parseRouteRecord(unescapeXml(gpx.slice(start + OPEN.length, end)));
};

/** Nom d'un point de passage : A, B, … Z, puis A2, B2… */
export const waypointLabel = (index: number): string => {
  const letter = String.fromCharCode(65 + (index % 26));
  const round = Math.floor(index / 26);
  return round === 0 ? letter : `${letter}${round + 1}`;
};

/** Nom d'une balise d'un parcours de balises (voile, surf) : 1, 2, 3… */
export const markLabel = (index: number): string => String(index + 1);

const fixed = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

/**
 * `label` : nom de chaque point, des lettres par défaut, des numéros pour un parcours de balises (`markLabel`).
 * `record` : la fiche, portée en extension (GPX rangé et partagé) ; absente, le GPX pour une montre, sans rien de plus.
 */
export const buildRouteGpx = (
  route: PlannedRoute,
  name: string,
  label: (index: number) => string = waypointLabel,
  record?: RouteRecord
): string => {
  const safeName = escapeXmlAttr(name);
  const shown = isLooped(route) ? route.waypoints.slice(0, -1) : route.waypoints;
  const waypoints = shown.map(
    (w, i) => `  <wpt lat="${fixed(w.lat, 7)}" lon="${fixed(w.lon, 7)}"><name>${label(i)}</name></wpt>`
  );
  const trackPoints = routePoints(route).map((p) => {
    const ele = p.eleM !== undefined ? `<ele>${fixed(p.eleM, 1)}</ele>` : '';
    return `      <trkpt lat="${fixed(p.lat, 7)}" lon="${fixed(p.lon, 7)}">${ele}</trkpt>`;
  });
  return gpxDocument([
    `  <metadata><name>${safeName}</name></metadata>`,
    ...waypoints,
    '  <trk>',
    `    <name>${safeName}</name>`,
    '    <trkseg>',
    ...trackPoints,
    '    </trkseg>',
    '  </trk>',
    ...(record ? [`  ${OPEN}${escapeXmlText(serializeRouteRecord(record).trimEnd())}${CLOSE}`] : []),
  ]);
};
