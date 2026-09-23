import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';

/**
 * Écriture d'une session en GPX 1.1, le format pivot de l'application : ce
 * que l'enregistreur produit, `parseGpx` le relit sans rien de particulier, et
 * n'importe quelle autre application aussi.
 *
 * La vitesse du système va dans `gpxtpx:speed` (extension Garmin, en m/s) et
 * le cap dans `gpxtpx:course`. La précision, que GPX ne sait pas dire en
 * mètres, va dans une extension propre à Tracker. `parseGpx` cherchant par nom
 * local, le préfixe importe peu.
 */

export interface GpxMeta {
  /** Nom de la trace, qui sert aussi à rattacher les notes de session. */
  name: string;
  sport: SportType;
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isoTime = (ms: number): string => new Date(ms).toISOString();

const trackPoint = (fix: LocationFix): string => {
  const children: string[] = [];
  if (fix.altitudeM !== undefined) children.push(`<ele>${fix.altitudeM}</ele>`);
  children.push(`<time>${isoTime(fix.timeMs)}</time>`);

  const tpx: string[] = [];
  if (fix.speedMs !== undefined) tpx.push(`<gpxtpx:speed>${fix.speedMs}</gpxtpx:speed>`);
  if (fix.bearingDeg !== undefined) tpx.push(`<gpxtpx:course>${fix.bearingDeg}</gpxtpx:course>`);
  const extensions: string[] = [];
  if (tpx.length > 0) extensions.push(`<gpxtpx:TrackPointExtension>${tpx.join('')}</gpxtpx:TrackPointExtension>`);
  if (fix.accuracyM !== undefined) extensions.push(`<tracker:accuracy>${fix.accuracyM}</tracker:accuracy>`);
  if (extensions.length > 0) children.push(`<extensions>${extensions.join('')}</extensions>`);

  return `      <trkpt lat="${fix.lat}" lon="${fix.lon}">${children.join('')}</trkpt>`;
};

export const buildGpx = (fixes: LocationFix[], meta: GpxMeta): string => {
  const name = escapeXml(meta.name);
  const startTime = fixes.length > 0 ? `<time>${isoTime(fixes[0].timeMs)}</time>` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Tracker"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"',
    '  xmlns:tracker="https://github.com/segneur34/Tracker/gpx/1">',
    `  <metadata><name>${name}</name>${startTime}</metadata>`,
    '  <trk>',
    `    <name>${name}</name>`,
    `    <type>${meta.sport}</type>`,
    '    <trkseg>',
    ...fixes.map(trackPoint),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
};
