import type { RawTrackPoint } from './types';

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

/** Contenu numérique d'un descendant, ou `undefined` s'il est absent ou illisible. */
const readNumber = (element: Element, localName: string): number | undefined => {
  const node = findByLocalName(element, localName);
  if (!node || node.textContent === null) return undefined;

  const value = parseFloat(node.textContent.trim());
  return isFinite(value) ? value : undefined;
};

const readText = (element: Element, localName: string): string | undefined => {
  const node = findByLocalName(element, localName);
  const text = node?.textContent?.trim();
  return text ? text : undefined;
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
const readDeviceSpeed = (trkpt: Element): number | undefined => {
  const speed = readNumber(trkpt, 'speed');
  if (speed === undefined || speed < 0 || speed > 100) return undefined;
  return speed;
};

export const parseGpx = (gpxContent: string): ParsedGpx => {
  const doc = new DOMParser().parseFromString(gpxContent, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Fichier GPX illisible : le XML est mal formé.');
  }

  const trkpts = doc.getElementsByTagName('trkpt');
  const rawPoints: RawTrackPoint[] = [];
  let hasDeviceSpeed = false;

  for (let i = 0; i < trkpts.length; i++) {
    const trkpt = trkpts[i];
    const lat = parseFloat(trkpt.getAttribute('lat') ?? '');
    const lon = parseFloat(trkpt.getAttribute('lon') ?? '');
    const time = readText(trkpt, 'time');

    // Un point sans position exploitable ou sans horodatage ne sert à rien :
    // toute la kinématique repose sur la différence de temps entre deux points.
    if (!isFinite(lat) || !isFinite(lon) || !time) continue;

    const speedMs = readDeviceSpeed(trkpt);
    if (speedMs !== undefined) hasDeviceSpeed = true;

    rawPoints.push({
      lat,
      lon,
      time,
      ele: readNumber(trkpt, 'ele'),
      speedMs,
      hr: readNumber(trkpt, 'hr'),
      cadence: readNumber(trkpt, 'cad'),
    });
  }

  const trk = doc.getElementsByTagName('trk')[0];

  return {
    rawPoints,
    trackName: trk ? readText(trk, 'name') : undefined,
    trackType: trk ? readChildText(trk, 'type') : undefined,
    hasDeviceSpeed,
  };
};
