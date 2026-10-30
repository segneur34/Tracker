import { escapeXmlText } from '../core/xml';
import { sortMarks, type SessionMark } from '../core/sessionMarks';
import { base64ToBytes, bytesToBase64 } from '../core/base64';
import { isWritableRecord, parseRecordParts, serializeRecord, type RecordWithoutSummary, type SessionRecord } from './record';

/**
 * GPX complet d'une session, pour la passer d'un appareil à l'autre en un seul
 * fichier : sa fiche (séances du compteur, nom, notes, réglages) et ses
 * capteurs (`.imu`) voyagent dans une extension posée juste avant `</gpx>`.
 * Les points ne sont pas touchés ; les autres applications, comme notre
 * lecteur (`core/gpxParser.ts`, qui ne lit que `trk`), ignorent ce bloc.
 * Une session nommée porte son nom dans `<metadata><name>` et `<trk><name>`,
 * ce que montrent les autres applications (Strava, Komoot), et ses repères
 * du bouton « Note » en `<wpt>`, avant la trace : les textes remplacés ou les
 * éléments ajoutés sont notés dans le bloc (`tracker:edit`).
 * À l'import, tout est défait à l'identique : la mémoire range le GPX
 * d'origine, octet pour octet. Un paquet sans ces notes (0.2.82) se relit tel quel.
 */

const NS = 'https://github.com/segneur34/Tracker/session';
const OPEN = `<extensions><tracker:session xmlns:tracker="${NS}" version="1">`;
const CLOSE = '</tracker:session></extensions>';

const unescapeXml = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export interface UnbundledGpx {
  /** Le GPX tel qu'il était avant l'empaquetage. */
  gpx: string;
  /**
   * Fiche du paquet, `null` sans paquet, illisible ou écrite par une version
   * plus récente ; son résumé, refait à l'import, peut manquer.
   */
  record: RecordWithoutSummary | null;
  /** Capteurs du paquet, `null` s'il n'en porte pas. */
  motion: Uint8Array | null;
}

/**
 * Retouche du GPX empaquetée : à la position `at` du GPX empaqueté, `length`
 * caractères remplacent le texte d'origine `original` (vide pour un ajout).
 */
interface GpxEdit {
  at: number;
  length: number;
  original: string;
}

/** Nom d'abord : le premier enfant de `<metadata>` et de `<trk>`, selon le schéma GPX 1.1. */
const LEADING_NAME = /^\s*<name>([\s\S]*?)<\/name>/;

/**
 * Repères en points de passage, nommés comme dans l'analyse : leur nom, sinon « Note N ». Un repère à
 * l'heure seule (muscu) n'en a pas, faute de position : il reste dans la fiche, en extension.
 */
const waypoints = (marks: readonly SessionMark[]): string =>
  sortMarks(marks).map((m, k) => (m.lat === null || m.lon === null ? ''
    : `<wpt lat="${m.lat}" lon="${m.lon}"><time>${new Date(m.timeMs).toISOString()}</time>`
      + `<name>${escapeXmlText(m.label ?? `Note ${k + 1}`)}</name></wpt>`)).join('');

/**
 * Nom de la session écrit dans `<metadata>` (créé s'il manque) et dans la
 * première `<trk>`, repères en `<wpt>` juste avant la première route ou
 * trace, à leur place dans le schéma GPX 1.1 : le GPX retouché et les
 * retouches, dans l'ordre du texte.
 */
const retouchGpx = (gpx: string, name: string | null, marks: readonly SessionMark[]): { gpx: string; edits: GpxEdit[] } => {
  /** Retouches sur le GPX d'origine : `from`..`to` remplacé par `insert`. */
  const changes: { from: number; to: number; insert: string }[] = [];
  const points = waypoints(marks);
  if (points !== '') {
    const first = /<(rte|trk)[\s>]/.exec(gpx);
    if (first) changes.push({ from: first.index, to: first.index, insert: points });
  }
  if (name !== null) writeName(gpx, escapeXmlText(name), changes);

  let out = '';
  let cursor = 0;
  const edits: GpxEdit[] = [];
  for (const c of changes.sort((a, b) => a.from - b.from)) {
    out += gpx.slice(cursor, c.from);
    edits.push({ at: out.length, length: c.insert.length, original: gpx.slice(c.from, c.to) });
    out += c.insert;
    cursor = c.to;
  }
  return { gpx: out + gpx.slice(cursor), edits };
};

/** Retouches du nom (`text`, déjà échappé), ajoutées à `changes`. */
const writeName = (gpx: string, text: string, changes: { from: number; to: number; insert: string }[]): void => {
  /** Le nom en tête de l'élément ouvert juste avant `at` : remplacé s'il y est, ajouté sinon. */
  const nameAfter = (at: number) => {
    const found = LEADING_NAME.exec(gpx.slice(at));
    if (found) {
      const from = at + found[0].length - found[1].length - '</name>'.length;
      changes.push({ from, to: from + found[1].length, insert: text });
    } else {
      changes.push({ from: at, to: at, insert: `<name>${text}</name>` });
    }
  };
  const metadata = /<metadata(\s[^>]*)?>/.exec(gpx);
  if (metadata) {
    if (!metadata[0].endsWith('/>')) nameAfter(metadata.index + metadata[0].length);
  } else {
    const root = /<gpx(\s[^>]*)?>/.exec(gpx);
    if (root && !root[0].endsWith('/>')) {
      const at = root.index + root[0].length;
      changes.push({ from: at, to: at, insert: `<metadata><name>${text}</name></metadata>` });
    }
  }
  const trk = /<trk(\s[^>]*)?>/.exec(gpx);
  if (trk && !trk[0].endsWith('/>')) nameAfter(trk.index + trk[0].length);
};

/** GPX empaqueté avec sa fiche et ses capteurs. Un GPX sans `</gpx>` est rendu tel quel. */
export const bundleSessionGpx = (gpx: string, record: SessionRecord, motion: Uint8Array | null): string => {
  if (gpx.lastIndexOf('</gpx>') < 0) return gpx;
  const named = retouchGpx(gpx, record.name?.trim() || null, record.marks ?? []);
  const at = named.gpx.lastIndexOf('</gpx>');
  const block = OPEN
    + `<tracker:record>${escapeXmlText(serializeRecord(record))}</tracker:record>`
    + (motion ? `<tracker:imu>${bytesToBase64(motion)}</tracker:imu>` : '')
    + named.edits.map((e) => `<tracker:edit at="${e.at}" length="${e.length}">${escapeXmlText(e.original)}</tracker:edit>`).join('')
    + CLOSE;
  return named.gpx.slice(0, at) + block + named.gpx.slice(at);
};

/**
 * Retouches (nom, repères) défaites, de la dernière à la première. Le GPX
 * rendu doit redonner exactement le texte reçu une fois retouché de nouveau
 * avec le nom et les repères de la fiche (`record`) : sinon le texte a changé
 * en route (fins de ligne passées en CRLF, réindentation), les positions ne
 * tombent plus juste, et le GPX est gardé tel que reçu, qui reste lisible.
 * Sans fiche lisible, de même.
 */
const undoEdits = (gpx: string, body: string, record: Pick<RecordWithoutSummary, 'name' | 'marks'> | null): string => {
  const edits = [...body.matchAll(/<tracker:edit at="(\d+)" length="(\d+)">([\s\S]*?)<\/tracker:edit>/g)]
    .map((m) => ({ at: Number(m[1]), length: Number(m[2]), original: unescapeXml(m[3]) }));
  if (edits.length === 0 || !record) return gpx;
  let out = gpx;
  let limit = gpx.length;
  for (const e of edits.reverse()) {
    if (e.at + e.length > limit) return gpx;
    out = out.slice(0, e.at) + e.original + out.slice(e.at + e.length);
    limit = e.at;
  }
  return retouchGpx(out, record.name?.trim() || null, record.marks ?? []).gpx === gpx ? out : gpx;
};

/** Retire le paquet d'un GPX et rend ce qu'il portait. Un bloc abîmé est retiré, puis ignoré. */
export const unbundleSessionGpx = (text: string): UnbundledGpx => {
  const start = text.lastIndexOf(OPEN);
  const end = start < 0 ? -1 : text.indexOf(CLOSE, start);
  if (end < 0) return { gpx: text, record: null, motion: null };
  const body = text.slice(start + OPEN.length, end);
  const recordText = /<tracker:record>([\s\S]*?)<\/tracker:record>/.exec(body)?.[1];
  const parsed = recordText === undefined ? null : parseRecordParts(unescapeXml(recordText));
  const gpx = undoEdits(text.slice(0, start) + text.slice(end + CLOSE.length), body, parsed && isWritableRecord(parsed) ? parsed : null);
  const imuText = /<tracker:imu>([A-Za-z0-9+/=\s]*)<\/tracker:imu>/.exec(body)?.[1];
  let motion: Uint8Array | null = null;
  try {
    motion = imuText ? base64ToBytes(imuText.replace(/\s/g, '')) : null;
  } catch {
    motion = null;
  }
  return { gpx, record: parsed && isWritableRecord(parsed) ? parsed : null, motion };
};
