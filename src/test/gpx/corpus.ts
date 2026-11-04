import type { RawTrackPoint } from '../../core/types';

/**
 * Corpus de GPX synthétiques, au format de chaque éditeur (lot 159) : le filet du lecteur GPX avant sa réécriture
 * (lot 126). Une trace de base (60 points à 1 Hz, altitude, vitesse, cap, FC et cadence connus) est rendue par une
 * fonction par éditeur ; chaque entrée dit ce que le lecteur doit en tirer, par construction.
 *
 * Des chaînes et non des fichiers `.gpx` : `.gitattributes` normaliserait les fins de ligne d'un vrai fichier, et le
 * BOM, le CRLF ou le CDATA doivent rester exacts. Imports de type seulement : le corpus se lit aussi sous Node, sans
 * Vite (`outils/banc/charge-ts.mjs`). Fichier de test seulement : l'application ne l'importe pas.
 *
 * Les formats suivent des exports réels (en-têtes, espaces de noms, ordre et précision des champs), écrits de mémoire :
 * aucun GPX réel n'entre dans le dépôt.
 */

/** Point d'une trace à écrire : un champ absent n'est pas écrit. */
export interface CorpusPoint {
  lat: number;
  lon: number;
  /** Heure telle qu'écrite dans le fichier ; absente : point sans `<time>`. */
  time?: string;
  ele?: number;
  /** Vitesse de l'appareil, en m/s. */
  speedMs?: number;
  courseDeg?: number;
  hr?: number;
  cad?: number;
}

/** Nom et type de la trace (`<trk><name>`, `<trk><type>`), écrits tels quels (un CDATA passe). */
export interface CorpusMeta {
  name?: string;
  type?: string;
}

/** Écrit une trace découpée en segments (un `<trkseg>` chacun). */
export type GpxRenderer = (segments: CorpusPoint[][], meta?: CorpusMeta) => string;

export interface CorpusEntry {
  nom: string;
  texte: string;
  attendu: {
    /** Points de `parseGpx` (`rawPoints`). */
    points: number;
    /** Segments : points marqués `segmentStart`, plus un ; 0 sans point. */
    segments: number;
    hasDeviceSpeed: boolean;
    /** Au moins un point porte une FC. */
    avecFc: boolean;
    /** Points de `parseGpxPath`, quand ils diffèrent de `points` (points sans heure, route seule). */
    chemin?: number;
    trackName?: string;
    trackType?: string;
  };
}

// ---------------------------------------------------------------------------
// Trace de base
// ---------------------------------------------------------------------------

export const BASE_START_MS = Date.UTC(2026, 9, 1, 8, 0, 0);
export const BASE_POINT_COUNT = 60;

const round = (value: number, digits: number): number => Number(value.toFixed(digits));
const isoSeconds = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Trace de base : 60 points à 1 Hz, partis le 01/10/2026 à 8 h (UTC), heure sans millisecondes. */
export const basePoints = (): CorpusPoint[] =>
  Array.from({ length: BASE_POINT_COUNT }, (_, i) => ({
    lat: round(43.6 + i * 0.00002, 7),
    lon: round(3.8 + i * 0.00003, 7),
    time: isoSeconds(BASE_START_MS + i * 1000),
    ele: round(12 + i * 0.5, 1),
    speedMs: round(3 + (i % 10) / 10, 2),
    courseDeg: 50 + (i % 7),
    hr: 120 + Math.round(i / 2),
    cad: 80 + (i % 5),
  }));

/** Les points en un seul segment, ou en `count` segments de tailles égales. */
export const segmentsOf = <T,>(points: T[], count = 1): T[][] => {
  const size = Math.ceil(points.length / count);
  return Array.from({ length: count }, (_, i) => points.slice(i * size, (i + 1) * size)).filter((s) => s.length > 0);
};

/** Heure avec millisecondes (« .000Z »), comme Garmin Connect et Komoot l'écrivent. */
const withMillis = (p: CorpusPoint): CorpusPoint => (p.time ? { ...p, time: new Date(p.time).toISOString() } : p);

// ---------------------------------------------------------------------------
// Éditeurs
// ---------------------------------------------------------------------------

const GPX11 = 'http://www.topografix.com/GPX/1/1';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const TPX1 = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
const TPX2 = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v2';
const GPXX = 'http://www.garmin.com/xmlschemas/GpxExtensions/v3';
const GPXDATA = 'http://www.cluetrust.com/XML/GPXDATA/1/0';

const tag = (name: string, value: string | number | undefined): string => (value === undefined ? '' : `<${name}>${value}</${name}>`);
const nameAndType = (meta: CorpusMeta = {}): string => tag('name', meta.name) + tag('type', meta.type);
/** Au moins un segment, vide au besoin : un fichier sans point garde son `<trkseg>`. */
const atLeastOneSegment = (segments: CorpusPoint[][]): CorpusPoint[][] => (segments.length > 0 ? segments : [[]]);

/**
 * Trace minimale, une ligne : heure et vitesse en `<extensions><speed>` (m/s) seulement. C'est la forme de l'ancien
 * `rawToGpx` des tests de voile, au caractère près.
 */
export const simpleGpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string =>
    `<trkpt lat="${p.lat}" lon="${p.lon}">${tag('time', p.time)}${p.speedMs === undefined ? '' : `<extensions><speed>${p.speedMs}</speed></extensions>`}</trkpt>`;
  const body = atLeastOneSegment(segments).map((s) => `<trkseg>${s.map(point).join('')}</trkseg>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="${GPX11}"><trk>${nameAndType(meta)}${body}</trk></gpx>`;
};

/** Garmin Connect : extensions `ns3:` (TrackPointExtension v1), température, FC et cadence ; pas de vitesse ; indentation de 2. */
export const garminConnectGpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string => {
    const ext = [
      '            <ns3:atemp>21.0</ns3:atemp>',
      ...(p.hr === undefined ? [] : [`            <ns3:hr>${p.hr}</ns3:hr>`]),
      ...(p.cad === undefined ? [] : [`            <ns3:cad>${p.cad}</ns3:cad>`]),
    ];
    return [
      `      <trkpt lat="${p.lat}" lon="${p.lon}">`,
      ...(p.ele === undefined ? [] : [`        <ele>${p.ele.toFixed(1)}</ele>`]),
      ...(p.time === undefined ? [] : [`        <time>${p.time}</time>`]),
      '        <extensions>',
      '          <ns3:TrackPointExtension>',
      ...ext,
      '          </ns3:TrackPointExtension>',
      '        </extensions>',
      '      </trkpt>',
    ].join('\n');
  };
  const first = segments[0]?.[0]?.time;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx creator="Garmin Connect" version="1.1" xsi:schemaLocation="${GPX11} http://www.topografix.com/GPX/11.xsd" xmlns:ns3="${TPX1}" xmlns="${GPX11}" xmlns:xsi="${XSI}" xmlns:ns2="${GPXX}">`,
    '  <metadata>',
    '    <link href="connect.garmin.com">',
    '      <text>Garmin Connect</text>',
    '    </link>',
    ...(first ? [`    <time>${first}</time>`] : []),
    '  </metadata>',
    '  <trk>',
    ...(meta?.name !== undefined ? [`    <name>${meta.name}</name>`] : []),
    ...(meta?.type !== undefined ? [`    <type>${meta.type}</type>`] : []),
    ...atLeastOneSegment(segments).flatMap((s) => ['    <trkseg>', ...s.map(point), '    </trkseg>']),
    '  </trk>',
    '</gpx>',
  ].join('\n');
};

/** Montre Garmin, TrackPointExtension v2 en `gpxtpx:` : FC, cadence, vitesse et cap ; une ligne par point. */
export const garminV2Gpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string => {
    const ext = tag('gpxtpx:hr', p.hr) + tag('gpxtpx:cad', p.cad) + tag('gpxtpx:speed', p.speedMs) + tag('gpxtpx:course', p.courseDeg);
    const extensions = ext ? `<extensions><gpxtpx:TrackPointExtension>${ext}</gpxtpx:TrackPointExtension></extensions>` : '';
    return `<trkpt lat="${p.lat}" lon="${p.lon}">${tag('ele', p.ele)}${tag('time', p.time)}${extensions}</trkpt>`;
  };
  const body = atLeastOneSegment(segments).map((s) => `<trkseg>\n${s.map(point).join('\n')}\n</trkseg>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="${GPX11}" xmlns:gpxtpx="${TPX2}" creator="Garmin Edge 840" version="1.1">\n<trk>${nameAndType(meta)}\n${body}\n</trk>\n</gpx>\n`;
};

/** Strava : latitude à 7 décimales, FC et cadence en `gpxtpx:` (v1), pas de vitesse ; indentation d'une espace. */
export const stravaGpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string => {
    const ext = [
      ...(p.hr === undefined ? [] : [`      <gpxtpx:hr>${p.hr}</gpxtpx:hr>`]),
      ...(p.cad === undefined ? [] : [`      <gpxtpx:cad>${p.cad}</gpxtpx:cad>`]),
    ];
    return [
      `   <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`,
      ...(p.ele === undefined ? [] : [`    <ele>${p.ele.toFixed(1)}</ele>`]),
      ...(p.time === undefined ? [] : [`    <time>${p.time}</time>`]),
      ...(ext.length === 0 ? [] : ['    <extensions>', '     <gpxtpx:TrackPointExtension>', ...ext, '     </gpxtpx:TrackPointExtension>', '    </extensions>']),
      '   </trkpt>',
    ].join('\n');
  };
  const first = segments[0]?.[0]?.time;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx creator="StravaGPX" xmlns:xsi="${XSI}" xsi:schemaLocation="${GPX11} http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1" xmlns="${GPX11}" xmlns:gpxtpx="${TPX1}" xmlns:gpxx="${GPXX}">`,
    ' <metadata>',
    ...(first ? [`  <time>${first}</time>`] : []),
    ' </metadata>',
    ' <trk>',
    ...(meta?.name !== undefined ? [`  <name>${meta.name}</name>`] : []),
    ...(meta?.type !== undefined ? [`  <type>${meta.type}</type>`] : []),
    ...atLeastOneSegment(segments).flatMap((s) => ['  <trkseg>', ...s.map(point), '  </trkseg>']),
    ' </trk>',
    '</gpx>',
  ].join('\n');
};

/** Komoot (sortie enregistrée) : déclaration entre apostrophes, auteur dont le lien porte un `<type>`, sans extensions. */
export const komootGpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string =>
    [
      `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`,
      ...(p.ele === undefined ? [] : [`        <ele>${p.ele.toFixed(6)}</ele>`]),
      ...(p.time === undefined ? [] : [`        <time>${p.time}</time>`]),
      '      </trkpt>',
    ].join('\n');
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<gpx version="1.1" creator="https://www.komoot.de" xmlns="${GPX11}" xmlns:xsi="${XSI}" xsi:schemaLocation="${GPX11} http://www.topografix.com/GPX/1/1/gpx.xsd">`,
    '  <metadata>',
    ...(meta?.name !== undefined ? [`    <name>${meta.name}</name>`] : []),
    '    <author>',
    '      <link href="https://www.komoot.de">',
    '        <text>komoot</text>',
    '        <type>text/html</type>',
    '      </link>',
    '    </author>',
    '  </metadata>',
    '  <trk>',
    ...(meta?.name !== undefined ? [`    <name>${meta.name}</name>`] : []),
    ...atLeastOneSegment(segments).flatMap((s) => ['    <trkseg>', ...s.map(point), '    </trkseg>']),
    '  </trk>',
    '</gpx>',
  ].join('\n');
};

/** Komoot (itinéraire planifié) : une `<rte>` seule, sans heure ; `parseGpx` n'y trouve aucun point, `parseGpxPath` si. */
export const komootRouteGpx: GpxRenderer = (segments, meta) => {
  const points = segments.flat();
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    `<gpx version="1.1" creator="https://www.komoot.de" xmlns="${GPX11}">`,
    '  <metadata>',
    ...(meta?.name !== undefined ? [`    <name>${meta.name}</name>`] : []),
    '  </metadata>',
    '  <rte>',
    ...(meta?.name !== undefined ? [`    <name>${meta.name}</name>`] : []),
    ...points.map((p) => `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${tag('ele', p.ele?.toFixed(6))}</rtept>`),
    '  </rte>',
    '</gpx>',
  ].join('\n');
};

/** Waterspeed : vitesse en `gpxdata:speed` (m/s), espace de noms cluetrust ; ni FC ni cadence. */
export const waterspeedGpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string =>
    `<trkpt lat="${p.lat}" lon="${p.lon}">${tag('ele', p.ele)}${tag('time', p.time)}${p.speedMs === undefined ? '' : `<extensions><gpxdata:speed>${p.speedMs}</gpxdata:speed></extensions>`}</trkpt>`;
  const body = atLeastOneSegment(segments).map((s) => `<trkseg>${s.map(point).join('')}</trkseg>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="WaterSpeed" xmlns="${GPX11}" xmlns:gpxdata="${GPXDATA}"><trk>${nameAndType(meta)}${body}</trk></gpx>`;
};

/** GPX 1.0 (GPSBabel et anciens appareils) : `<course>` et `<speed>` (m/s) dans le point même, sans extensions. */
export const gpx10Gpx: GpxRenderer = (segments, meta) => {
  const point = (p: CorpusPoint): string =>
    `<trkpt lat="${p.lat}" lon="${p.lon}">${tag('ele', p.ele)}${tag('time', p.time)}${tag('course', p.courseDeg)}${tag('speed', p.speedMs)}</trkpt>`;
  const body = atLeastOneSegment(segments).map((s) => `<trkseg>\n${s.map(point).join('\n')}\n</trkseg>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.0" creator="GPSBabel - https://www.gpsbabel.org" xmlns="http://www.topografix.com/GPX/1/0">\n<trk>${nameAndType(meta)}\n${body}\n</trk>\n</gpx>\n`;
};

/** Éditeurs, par nom : `gpxOf` (`test/sailing.fixture.ts`) écrit une trace au format de l'un d'eux. */
export const GPX_EDITORS = {
  simple: simpleGpx,
  'garmin-connect': garminConnectGpx,
  'garmin-v2': garminV2Gpx,
  strava: stravaGpx,
  komoot: komootGpx,
  waterspeed: waterspeedGpx,
  'gpx-1.0': gpx10Gpx,
} satisfies Record<string, GpxRenderer>;

export type GpxEditor = keyof typeof GPX_EDITORS;

/** Points bruts d'une trace en points à écrire, coupés en segments à chaque `segmentStart`. */
export const corpusSegmentsOf = (raw: RawTrackPoint[]): CorpusPoint[][] => {
  const segments: CorpusPoint[][] = [];
  for (const p of raw) {
    if (segments.length === 0 || p.segmentStart) segments.push([]);
    segments[segments.length - 1].push({
      lat: p.lat,
      lon: p.lon,
      time: typeof p.time === 'string' ? p.time : p.time.toISOString(),
      ele: p.ele,
      speedMs: p.speedMs,
      courseDeg: p.courseDeg,
      hr: p.hr,
      cad: p.cadence,
    });
  }
  return segments;
};

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const RUN = { name: 'Course à pied du matin', type: 'running' };
const SAIL = { name: 'Wing du soir', type: 'wingfoil' };
const N = BASE_POINT_COUNT;

/** Retire l'heure d'un point sur six (les points 0, 6, 12…). */
const someWithoutTime = (points: CorpusPoint[]): CorpusPoint[] => points.map((p, i) => (i % 6 === 0 ? { ...p, time: undefined } : p));
const WITHOUT_TIME = Math.ceil(N / 6);

/** Heure locale à + 2 h, avec des quarts de seconde : `2026-10-01T10:00:00.250+02:00`. */
const offsetDecimalTimes = (points: CorpusPoint[]): CorpusPoint[] =>
  points.map((p, i) => {
    const local = new Date(BASE_START_MS + i * 1000 + 250 + 2 * 3600_000).toISOString();
    return { ...p, time: local.replace('Z', '+02:00') };
  });

/** Deux `<trk>` d'un segment chacun, la moitié des points dans chacun. */
const twoTracks = (): string => {
  const [aller, retour] = segmentsOf(basePoints(), 2);
  const trk = (name: string, points: CorpusPoint[]) =>
    `<trk><name>${name}</name><type>hiking</type><trkseg>${points
      .map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${p.time}</time></trkpt>`)
      .join('')}</trkseg></trk>`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="${GPX11}">${trk('Aller', aller)}${trk('Retour', retour)}</gpx>`;
};

/** Extensions sans vitesse ni FC : température, puissance et un champ inconnu. */
const extensionsWithoutSpeed = (): string => {
  const point = (p: CorpusPoint): string =>
    `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${p.time}</time><extensions><power>210</power>`
    + `<gpxtpx:TrackPointExtension><gpxtpx:atemp>19.5</gpxtpx:atemp><gpxtpx:depth>0</gpxtpx:depth></gpxtpx:TrackPointExtension></extensions></trkpt>`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Wahoo ELEMNT" xmlns="${GPX11}" xmlns:gpxtpx="${TPX1}"><trk><name>Sortie vélo</name><type>cycling</type><trkseg>${basePoints().map(point).join('')}</trkseg></trk></gpx>`;
};

/** Commentaires entre les points, dans un point, et autour d'un point entier mis en commentaire. */
const withComments = (): string => {
  const points = basePoints();
  const point = (p: CorpusPoint, i: number): string =>
    (i === 10 ? '<!-- pause café -->' : '')
    + `<trkpt lat="${p.lat}" lon="${p.lon}">${i === 20 ? '<!-- <time>2020-01-01T00:00:00Z</time> -->' : ''}<time>${p.time}</time></trkpt>`
    + (i === 30 ? `<!-- <trkpt lat="1" lon="2"><time>${p.time}</time></trkpt> -->` : '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Exporté à la main -->\n<gpx version="1.1" creator="test" xmlns="${GPX11}"><trk><name>Commentée</name><trkseg>${points.map(point).join('')}</trkseg></trk></gpx>`;
};

/** Balises (`<wpt>`, avec heure et nom) avant et après la trace. */
const withWaypoints = (): string => {
  const wpt = (lat: number, lon: number, name: string, time: string) => `<wpt lat="${lat}" lon="${lon}"><time>${time}</time><name>${name}</name><sym>Flag</sym></wpt>`;
  const points = basePoints();
  const trk = `<trk><name>Régate</name><type>sailing</type><trkseg>${points.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${p.time}</time></trkpt>`).join('')}</trkseg></trk>`;
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="test" xmlns="${GPX11}">${wpt(43.61, 3.81, 'Bouée 1', points[0].time!)}${wpt(43.62, 3.82, 'Bouée 2', points[1].time!)}${trk}${wpt(43.63, 3.83, 'Arrivée', points[N - 1].time!)}</gpx>`;
};

/** Le texte de `garminConnectGpx` en fins de ligne Windows, indenté de tabulations. */
const crlfTabs = (text: string): string => text.split('\n').map((line) => line.replace(/^( {2})+/, (spaces) => '\t'.repeat(spaces.length / 2))).join('\r\n');

export const GPX_CORPUS: CorpusEntry[] = [
  {
    nom: 'Garmin Connect (ns3:, FC et cadence)',
    texte: garminConnectGpx(segmentsOf(basePoints().map(withMillis)), RUN),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true, trackName: RUN.name, trackType: 'running' },
  },
  {
    nom: 'Garmin gpxtpx: v2 (vitesse et cap)',
    texte: garminV2Gpx(segmentsOf(basePoints()), { name: 'Sortie vélo', type: 'cycling' }),
    attendu: { points: N, segments: 1, hasDeviceSpeed: true, avecFc: true, trackType: 'cycling' },
  },
  {
    nom: 'Strava (sans vitesse)',
    texte: stravaGpx(segmentsOf(basePoints()), { name: 'Morning Run', type: 'running' }),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true, trackName: 'Morning Run', trackType: 'running' },
  },
  {
    nom: 'Komoot, sortie enregistrée (sans extensions)',
    texte: komootGpx(segmentsOf(basePoints().map(withMillis)), { name: 'Tour à vélo' }),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: false, trackName: 'Tour à vélo' },
  },
  {
    nom: 'Komoot, itinéraire (<rte> seule)',
    texte: komootRouteGpx(segmentsOf(basePoints()), { name: 'Boucle planifiée' }),
    attendu: { points: 0, segments: 0, hasDeviceSpeed: false, avecFc: false, chemin: N },
  },
  {
    nom: 'Waterspeed (gpxdata:speed)',
    texte: waterspeedGpx(segmentsOf(basePoints()), SAIL),
    attendu: { points: N, segments: 1, hasDeviceSpeed: true, avecFc: false, trackName: SAIL.name, trackType: 'wingfoil' },
  },
  {
    nom: 'GPX 1.0 (speed et course dans le point)',
    texte: gpx10Gpx(segmentsOf(basePoints()), { name: 'GPSBabel' }),
    attendu: { points: N, segments: 1, hasDeviceSpeed: true, avecFc: false },
  },
  {
    nom: 'BOM en tête (Strava)',
    texte: '﻿' + stravaGpx(segmentsOf(basePoints()), RUN),
    // BOM ignoré (lot 126, décision 1 du 04/11), comme le navigateur et `Blob.text()` : xmldom refusait la déclaration
    // qui le suit, et le test du corpus compare donc ce texte, BOM retiré, à la copie gelée.
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true, trackName: RUN.name, trackType: 'running' },
  },
  {
    nom: 'CDATA dans le nom',
    texte: stravaGpx(segmentsOf(basePoints()), { name: '<![CDATA[Sortie & retour <matin>]]>', type: 'running' }),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true, trackName: 'Sortie & retour <matin>' },
  },
  {
    nom: 'sans déclaration XML',
    texte: stravaGpx(segmentsOf(basePoints()), RUN).replace(/^<\?xml[^>]*\?>\n/, ''),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true },
  },
  {
    nom: 'trois <trkseg> (pauses)',
    texte: garminV2Gpx(segmentsOf(basePoints(), 3), RUN),
    attendu: { points: N, segments: 3, hasDeviceSpeed: true, avecFc: true },
  },
  {
    nom: 'deux <trk>',
    texte: twoTracks(),
    attendu: { points: N, segments: 2, hasDeviceSpeed: false, avecFc: false, trackName: 'Aller', trackType: 'hiking' },
  },
  {
    nom: 'extensions sans vitesse ni FC',
    texte: extensionsWithoutSpeed(),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: false, trackType: 'cycling' },
  },
  {
    nom: 'CRLF et tabulations (Garmin Connect)',
    texte: crlfTabs(garminConnectGpx(segmentsOf(basePoints().map(withMillis)), RUN)),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: true, trackName: RUN.name },
  },
  {
    nom: 'heures décimales et décalage horaire',
    texte: garminV2Gpx(segmentsOf(offsetDecimalTimes(basePoints())), RUN),
    attendu: { points: N, segments: 1, hasDeviceSpeed: true, avecFc: true },
  },
  {
    nom: 'points sans heure',
    texte: stravaGpx(segmentsOf(someWithoutTime(basePoints())), RUN),
    attendu: { points: N - WITHOUT_TIME, segments: 1, hasDeviceSpeed: false, avecFc: true, chemin: N },
  },
  {
    nom: 'commentaires',
    texte: withComments(),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: false, trackName: 'Commentée' },
  },
  {
    nom: 'balises <wpt> mêlées',
    texte: withWaypoints(),
    attendu: { points: N, segments: 1, hasDeviceSpeed: false, avecFc: false, trackName: 'Régate', trackType: 'sailing' },
  },
  {
    nom: 'trace minimale (forme de gpxOf « simple »)',
    texte: simpleGpx(segmentsOf(basePoints())),
    attendu: { points: N, segments: 1, hasDeviceSpeed: true, avecFc: false },
  },
];

/** Textes que le lecteur doit refuser ou rendre vides, comme le lecteur d'aujourd'hui. */
export const UNREADABLE_GPX: { nom: string; texte: string }[] = [
  { nom: 'vide', texte: '' },
  { nom: 'blancs seuls', texte: ' \n\t ' },
  { nom: 'pas du XML', texte: 'pas du XML' },
  { nom: 'JSON', texte: '{"gpx": []}' },
  { nom: 'balise non fermée', texte: '<gpx><trk><trkseg></gpx>' },
  { nom: 'point non fermé', texte: `<?xml version="1.0"?><gpx xmlns="${GPX11}"><trk><trkseg><trkpt lat="1" lon="2"><time>2026-10-01T08:00:00Z</time></trkseg></trk></gpx>` },
  { nom: 'entité inconnue', texte: `<?xml version="1.0"?><gpx xmlns="${GPX11}"><trk><name>&inconnue;</name></trk></gpx>` },
  { nom: 'tronqué au milieu', texte: garminConnectGpx(segmentsOf(basePoints()), RUN).slice(0, 1500) },
];
