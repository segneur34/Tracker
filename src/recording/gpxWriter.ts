import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';

/**
 * Écriture d'une session en GPX 1.1, le format pivot de l'application : ce
 * que l'enregistreur produit, `parseGpx` le relit sans rien de particulier, et
 * n'importe quelle autre application aussi.
 *
 * La vitesse du système va dans `gpxtpx:speed` (extension Garmin, en m/s) :
 * le seul champ de `LocationFix` que l'analyse relit. Le cap et la précision,
 * utiles seulement en direct pendant l'enregistrement, ne sont pas écrits :
 * ils alourdiraient le fichier sans être relus par personne.
 *
 * Une pause, manuelle ou automatique, sépare la trace en segments continus :
 * chacun devient un `<trkseg>`.
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

  if (fix.speedMs !== undefined) {
    children.push(`<extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${fix.speedMs}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions>`);
  }

  return `      <trkpt lat="${fix.lat}" lon="${fix.lon}">${children.join('')}</trkpt>`;
};

const trackSegment = (fixes: LocationFix[]): string => ['    <trkseg>', ...fixes.map(trackPoint), '    </trkseg>'].join('\n');

/** `segments` : la trace, découpée en continus (`splitIntoSegments`) — un `<trkseg>` par pause. */
export const buildGpx = (segments: LocationFix[][], meta: GpxMeta): string => {
  const name = escapeXml(meta.name);
  const nonEmpty = segments.filter((s) => s.length > 0);
  const toRender = nonEmpty.length > 0 ? nonEmpty : [[]];
  const startTime = nonEmpty.length > 0 ? `<time>${isoTime(nonEmpty[0][0].timeMs)}</time>` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Tracker"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">',
    `  <metadata><name>${name}</name>${startTime}</metadata>`,
    '  <trk>',
    `    <name>${name}</name>`,
    `    <type>${meta.sport}</type>`,
    ...toRender.map(trackSegment),
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
};
