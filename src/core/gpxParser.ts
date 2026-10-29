import type { RawTrackPoint, TimedTrackPoint } from './types';

/**
 * Lecture d'un fichier GPX, sans dépendance externe.
 *
 * La librairie `gpxparser` n'exposait que latitude, longitude, altitude et
 * heure. Elle rendait donc inaccessibles les extensions, en particulier la
 * vitesse Doppler mesurée par l'appareil, qui est bien plus fiable qu'une
 * vitesse dérivée des positions. Ce lecteur les récupère.
 *
 * Les espaces de noms des extensions varient d'un constructeur à l'autre
 * (`gpxtpx`, `gpxdata`, `ns3`), d'où la recherche par nom local plutôt que par
 * nom qualifié.
 */

export interface ParsedGpx {
  /** Points bruts de la trace, dans l'ordre du fichier. */
  rawPoints: RawTrackPoint[];
  /**
   * Points horodatés sans position (muscu, lot I du 25/10 : l'heure et la
   * FC), dans l'ordre du fichier. Vide pour une trace à positions, dont les
   * points vont tous dans `rawPoints`.
   */
  timedPoints: TimedTrackPoint[];
  /** Nom de la trace, si le fichier en porte un. */
  trackName?: string;
  /**
   * Type d'activité de la trace (`<trk><type>`), tel que l'application qui l'a
   * écrit le nomme : notre support (`wingfoil`), `running` chez Strava ou
   * Garmin…
   */
  trackType?: string;
  /** Vrai si au moins un point porte une vitesse fournie par l'appareil. */
  hasDeviceSpeed: boolean;
}

/** Premier descendant portant ce nom local, quel que soit l'espace de noms. */
const findByLocalName = (element: Element, localName: string): Element | null => {
  const direct = element.getElementsByTagName(localName)[0];
  if (direct) return direct;

  const all = element.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return all[i];
  }
  return null;
};

/** Contenu numérique d'un nœud, ou `undefined` s'il est absent ou illisible. */
const numberOf = (node: Element | null): number | undefined => {
  if (!node || node.textContent === null) return undefined;

  const value = parseFloat(node.textContent.trim());
  return isFinite(value) ? value : undefined;
};

/** Contenu numérique d'un descendant, ou `undefined` s'il est absent ou illisible. */
const readNumber = (element: Element, localName: string): number | undefined => numberOf(findByLocalName(element, localName));

/** Contenu texte d'un nœud, ou `undefined` s'il est absent ou vide. */
const textOf = (node: Element | null): string | undefined => {
  const text = node?.textContent?.trim();
  return text ? text : undefined;
};

/** Champs lus sur un point de trace. */
const POINT_FIELDS = ['time', 'ele', 'speed', 'course', 'hr', 'cad'] as const;
type PointField = (typeof POINT_FIELDS)[number];

/**
 * Nœud de chacun des champs d'un point, comme `findByLocalName` le trouverait
 * (premier descendant de ce nom qualifié, sinon premier de ce nom local), en
 * un seul parcours des descendants au lieu d'un par champ (lot 56).
 */
const pointFieldNodes = (trkpt: Element): Record<PointField, Element | null> => {
  const qualified: Record<PointField, Element | null> = { time: null, ele: null, speed: null, course: null, hr: null, cad: null };
  const local: Record<PointField, Element | null> = { time: null, ele: null, speed: null, course: null, hr: null, cad: null };
  const all = trkpt.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const element = all[i];
    const name = element.localName;
    if (!(POINT_FIELDS as readonly string[]).includes(name)) continue;
    const field = name as PointField;
    if (local[field] === null) local[field] = element;
    if (qualified[field] === null && element.tagName === name) qualified[field] = element;
  }
  return {
    time: qualified.time ?? local.time,
    ele: qualified.ele ?? local.ele,
    speed: qualified.speed ?? local.speed,
    course: qualified.course ?? local.course,
    hr: qualified.hr ?? local.hr,
    cad: qualified.cad ?? local.cad,
  };
};

/** Contenu d'un enfant direct : une extension de point du même nom ne doit pas répondre. */
const readChildText = (element: Element, localName: string): string | undefined => {
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i];
    if (child.localName !== localName) continue;
    const text = child.textContent?.trim();
    return text ? text : undefined;
  }
  return undefined;
};

/**
 * Vitesse portée par le point, en m/s.
 *
 * La balise `speed` du profil Garmin est en m/s. Certains fichiers exposent
 * la même donnée sous `gpxdata:speed`. Les valeurs négatives ou absurdes sont
 * écartées plutôt que propagées.
 */
const readDeviceSpeed = (node: Element | null): number | undefined => {
  const speed = numberOf(node);
  if (speed === undefined || speed < 0 || speed > 100) return undefined;
  return speed;
};

/** Cap porté par le point (`course` du profil Garmin), en degrés ; hors de 0 à 360, écarté. */
const readCourse = (node: Element | null): number | undefined => {
  const course = numberOf(node);
  return course !== undefined && course >= 0 && course <= 360 ? course : undefined;
};

export const parseGpx = (gpxContent: string): ParsedGpx => {
  const doc = new DOMParser().parseFromString(gpxContent, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Fichier GPX illisible : le XML est mal formé.');
  }

  const trkpts = doc.getElementsByTagName('trkpt');
  const rawPoints: RawTrackPoint[] = [];
  const timedPoints: TimedTrackPoint[] = [];
  let hasDeviceSpeed = false;
  // Segment du dernier point retenu : un point d'un autre `<trkseg>` reprend
  // après une pause de l'enregistrement (un `<trkseg>` par pause, `gpxWriter.ts`).
  let lastSegment: Element | null = null;
  let lastTimedSegment: Element | null = null;

  for (let i = 0; i < trkpts.length; i++) {
    const trkpt = trkpts[i];
    const lat = parseFloat(trkpt.getAttribute('lat') ?? '');
    const lon = parseFloat(trkpt.getAttribute('lon') ?? '');
    const nodes = pointFieldNodes(trkpt);
    const time = textOf(nodes.time);

    // Un point sans horodatage ne sert à rien : toute la kinématique repose
    // sur la différence de temps entre deux points.
    if (!time) continue;
    // Sans position, mais à l'heure : un point d'une session sans trace (muscu),
    // à part, jamais dans la cinématique.
    if (!isFinite(lat) || !isFinite(lon)) {
      const segment = trkpt.parentElement;
      const resumes = lastTimedSegment !== null && segment !== lastTimedSegment;
      lastTimedSegment = segment;
      const hr = numberOf(nodes.hr);
      timedPoints.push({
        time,
        ...(hr !== undefined ? { hr } : {}),
        ...(resumes ? { segmentStart: true as const } : {}),
      });
      continue;
    }

    const speedMs = readDeviceSpeed(nodes.speed);
    if (speedMs !== undefined) hasDeviceSpeed = true;

    const segment = trkpt.parentElement;
    const resumes = lastSegment !== null && segment !== lastSegment;
    lastSegment = segment;

    rawPoints.push({
      lat,
      lon,
      time,
      // Date lue une fois (lot 56), comme `pointTimeMs` la relirait.
      rawTimeMs: new Date(time).getTime(),
      ele: numberOf(nodes.ele),
      speedMs,
      courseDeg: readCourse(nodes.course),
      hr: numberOf(nodes.hr),
      cadence: numberOf(nodes.cad),
      ...(resumes ? { segmentStart: true as const } : {}),
    });
  }

  const trk = doc.getElementsByTagName('trk')[0];

  return {
    rawPoints,
    timedPoints,
    trackName: trk ? readChildText(trk, 'name') : undefined,
    trackType: trk ? readChildText(trk, 'type') : undefined,
    hasDeviceSpeed,
  };
};

/** Tracé d'un GPX, sans notion de temps : la forme d'un parcours à suivre. */
export interface ParsedGpxPath {
  /** Positions dans l'ordre du fichier ; altitude en mètres quand le fichier la porte. */
  points: { lat: number; lon: number; eleM?: number }[];
  /** Nom de la trace, de la route ou du fichier, si le GPX en porte un. */
  name?: string;
  /** Type d'activité de la trace (`<trk><type>`), comme pour `parseGpx`. */
  trackType?: string;
}

/**
 * Lecture d'un GPX pour en tirer un parcours (planification) : les points de
 * trace (`trkpt`), à défaut ceux de route (`rtept`). Contrairement à
 * `parseGpx`, l'heure n'est pas exigée : un parcours téléchargé (Visorando,
 * Komoot, IGN…) n'en porte souvent pas, et ne sert pas à mesurer une vitesse.
 */
export const parseGpxPath = (gpxContent: string): ParsedGpxPath => {
  const doc = new DOMParser().parseFromString(gpxContent, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Fichier GPX illisible : le XML est mal formé.');
  }

  const read = (tag: string) => {
    const nodes = doc.getElementsByTagName(tag);
    const points: ParsedGpxPath['points'] = [];
    for (let i = 0; i < nodes.length; i++) {
      const lat = parseFloat(nodes[i].getAttribute('lat') ?? '');
      const lon = parseFloat(nodes[i].getAttribute('lon') ?? '');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const eleM = readNumber(nodes[i], 'ele');
      points.push(eleM !== undefined ? { lat, lon, eleM } : { lat, lon });
    }
    return points;
  };
  const trackPoints = read('trkpt');
  const points = trackPoints.length >= 2 ? trackPoints : read('rtept');

  const trk = doc.getElementsByTagName('trk')[0];
  const rte = doc.getElementsByTagName('rte')[0];
  const metadata = doc.getElementsByTagName('metadata')[0];
  return {
    points,
    name: (trk && readChildText(trk, 'name')) ?? (rte && readChildText(rte, 'name')) ?? (metadata && readChildText(metadata, 'name')),
    trackType: trk ? readChildText(trk, 'type') : undefined,
  };
};
