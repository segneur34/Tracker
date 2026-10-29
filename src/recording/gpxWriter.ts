import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';
import { gpxStrideCadence } from '../running/cadence';
import type { HeartRateFix } from './session';

/**
 * Écriture d'une session en GPX 1.1, le format pivot de l'application : ce
 * que l'enregistreur produit, `parseGpx` le relit sans rien de particulier, et
 * n'importe quelle autre application aussi.
 *
 * La vitesse du système va dans `gpxtpx:speed` (extension Garmin, en m/s), la
 * fréquence cardiaque de la ceinture dans `gpxtpx:hr`, et la cadence à pied
 * dans `gpxtpx:cad`, en foulées par minute comme Garmin et Strava (pas ÷ 2). La précision,
 * utiles seulement en direct pendant l'enregistrement, ne sont pas écrits :
 * ils alourdiraient le fichier sans être relus par personne.
 *
 * Une pause, manuelle ou automatique, sépare la trace en segments continus :
 * chacun devient un `<trkseg>`.
 */

export interface GpxMeta {
  /** Nom de la trace, qui sert aussi à rattacher les notes de session. */
  name: string;
  /** Calcul de la session, écrit dans `<type>` ; `null` (journal sans en-tête lisible) : pas de `<type>`, session à classer. */
  sport: SportType | null;
}

/** Texte sûr dans un contenu ou un attribut XML ; sert aussi au GPX des itinéraires (`planning/routeGpx.ts`). */
export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const isoTime = (ms: number): string => new Date(ms).toISOString();

const trackPoint = (fix: LocationFix): string => {
  const children: string[] = [];
  if (fix.altitudeM !== undefined) children.push(`<ele>${fix.altitudeM}</ele>`);
  children.push(`<time>${isoTime(fix.timeMs)}</time>`);

  // Vitesse et cap du système (Doppler) ; le cap sert aux virages du surf (§10, point 97).
  const extension: string[] = [];
  // Ordre du schéma Garmin : la fréquence cardiaque, la cadence, puis la vitesse.
  if (fix.heartRateBpm !== undefined) extension.push(`<gpxtpx:hr>${fix.heartRateBpm}</gpxtpx:hr>`);
  if (fix.cadenceSpm !== undefined) extension.push(`<gpxtpx:cad>${gpxStrideCadence(fix.cadenceSpm)}</gpxtpx:cad>`);
  if (fix.speedMs !== undefined) extension.push(`<gpxtpx:speed>${fix.speedMs}</gpxtpx:speed>`);
  if (fix.bearingDeg !== undefined && fix.speedMs !== undefined && fix.speedMs > 0) {
    extension.push(`<gpxtpx:course>${fix.bearingDeg}</gpxtpx:course>`);
  }
  if (extension.length > 0) {
    children.push(`<extensions><gpxtpx:TrackPointExtension>${extension.join('')}</gpxtpx:TrackPointExtension></extensions>`);
  }

  return `      <trkpt lat="${fix.lat}" lon="${fix.lon}">${children.join('')}</trkpt>`;
};

const trackSegment = (fixes: LocationFix[]): string => ['    <trkseg>', ...fixes.map(trackPoint), '    </trkseg>'].join('\n');

/** `segments` : la trace, découpée en continus (`splitIntoSegments`) — un `<trkseg>` par pause. */
export const buildGpx = (segments: LocationFix[][], meta: GpxMeta): string => gpxDocument(segments, meta, trackSegment);

/** Point d'une session sans position : l'heure, et la FC si la ceinture l'a donnée ; ni `lat` ni `lon`. */
const heartRatePoint = (fix: HeartRateFix): string => {
  const hr = fix.heartRateBpm === undefined ? ''
    : `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${fix.heartRateBpm}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
  return `      <trkpt><time>${isoTime(fix.timeMs)}</time>${hr}</trkpt>`;
};

/**
 * GPX d'une session sans position (muscu, lot I du 25/10, décision 5) : des
 * `<trkpt>` sans `lat` ni `lon`, l'heure et la FC seules, un `<trkseg>` par
 * pause. Ce n'est pas un GPX 1.1 valide pour les autres applications, qui
 * exigent la position : seul `parseGpx` le relit (`timedPoints`).
 */
export const buildHeartRateGpx = (segments: HeartRateFix[][], meta: GpxMeta): string =>
  gpxDocument(segments, meta, (fixes) => ['    <trkseg>', ...fixes.map(heartRatePoint), '    </trkseg>'].join('\n'));

const gpxDocument = <F extends { timeMs: number }>(segments: F[][], meta: GpxMeta, segment: (fixes: F[]) => string): string => {
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
    ...(meta.sport !== null ? [`    <type>${meta.sport}</type>`] : []),
    ...toRender.map(segment),
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
};
