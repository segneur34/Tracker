import { base64ToBytes, bytesToBase64 } from '../platform/base64';
import { isWritableRecord, parseRecord, serializeRecord, type SessionRecord } from './record';

/**
 * GPX complet d'une session, pour la passer d'un appareil à l'autre en un seul
 * fichier : sa fiche (séances du compteur, nom, notes, réglages) et ses
 * capteurs (`.imu`) voyagent dans une extension posée juste avant `</gpx>`.
 * Les points ne sont pas touchés ; les autres applications, comme notre
 * lecteur (`core/gpxParser.ts`, qui ne lit que `trk`), ignorent ce bloc.
 * À l'import, le bloc est retiré à l'identique : la mémoire range le GPX
 * d'origine, octet pour octet.
 */

const NS = 'https://github.com/segneur34/Tracker/session';
const OPEN = `<extensions><tracker:session xmlns:tracker="${NS}" version="1">`;
const CLOSE = '</tracker:session></extensions>';

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeXml = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export interface UnbundledGpx {
  /** Le GPX tel qu'il était avant l'empaquetage. */
  gpx: string;
  /** Fiche du paquet, `null` sans paquet, illisible ou écrite par une version plus récente. */
  record: SessionRecord | null;
  /** Capteurs du paquet, `null` s'il n'en porte pas. */
  motion: Uint8Array | null;
}

/** GPX empaqueté avec sa fiche et ses capteurs. Un GPX sans `</gpx>` est rendu tel quel. */
export const bundleSessionGpx = (gpx: string, record: SessionRecord, motion: Uint8Array | null): string => {
  const at = gpx.lastIndexOf('</gpx>');
  if (at < 0) return gpx;
  const block = OPEN
    + `<tracker:record>${escapeXml(serializeRecord(record))}</tracker:record>`
    + (motion ? `<tracker:imu>${bytesToBase64(motion)}</tracker:imu>` : '')
    + CLOSE;
  return gpx.slice(0, at) + block + gpx.slice(at);
};

/** Retire le paquet d'un GPX et rend ce qu'il portait. Un bloc abîmé est retiré, puis ignoré. */
export const unbundleSessionGpx = (text: string): UnbundledGpx => {
  const start = text.lastIndexOf(OPEN);
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start);
  if (end < 0) return { gpx: text, record: null, motion: null };
  const gpx = text.slice(0, start) + text.slice(end + CLOSE.length);
  const body = text.slice(start + OPEN.length, end);
  const recordText = /<tracker:record>([\s\S]*?)<\/tracker:record>/.exec(body)?.[1];
  const parsed = recordText === undefined ? null : parseRecord(unescapeXml(recordText));
  const imuText = /<tracker:imu>([A-Za-z0-9+/=\s]*)<\/tracker:imu>/.exec(body)?.[1];
  let motion: Uint8Array | null = null;
  try {
    motion = imuText ? base64ToBytes(imuText.replace(/\s/g, '')) : null;
  } catch {
    motion = null;
  }
  return { gpx, record: parsed && isWritableRecord(parsed) ? parsed : null, motion };
};
