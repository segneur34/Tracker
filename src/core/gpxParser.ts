import type { RawTrackPoint, TimedTrackPoint } from './types';

/**
 * Lecture d'un fichier GPX, sans dépendance externe ni `DOMParser` (lot 126) :
 * un balayage du texte, position par position, qui lit aussi hors du fil de
 * l'affichage, et rend ce que rendait la lecture par le DOM (copie gelée et
 * corpus des éditeurs : `test/gpxParser.legacy.ts`, `gpxParser.corpus.test.ts`).
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
  /**
   * Points bruts de la trace, dans l'ordre du fichier ; un point sans heure,
   * à l'heure illisible ou datée avant le point gardé qui le précède est
   * écarté (une date égale est gardée).
   */
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

// ---------------------------------------------------------------------------
// Balayage du XML
// ---------------------------------------------------------------------------

const MALFORMED = 'Fichier GPX illisible : le XML est mal formé.';
const malformed = (): never => {
  throw new Error(MALFORMED);
};

/** Caractères interdits en XML 1.0 : le navigateur refuse le fichier entier (un UTF-16 lu en UTF-8, par exemple). */
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\u{FFFE}\u{FFFF}]/u;

/** Code permis par XML 1.0 pour une référence numérique. */
const isXmlChar = (code: number): boolean =>
  code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);

const CHAR_REF = /&#(?:x([0-9a-fA-F]+)|([0-9]+));/g;

/** Refuse une référence numérique à un caractère interdit (`&#0;`), comme le navigateur (xmldom la décodait). */
const checkCharRefs = (raw: string): void => {
  for (const [, hex, decimal] of raw.matchAll(CHAR_REF)) {
    if (!isXmlChar(hex !== undefined ? parseInt(hex, 16) : parseInt(decimal, 10))) malformed();
  }
};

/** Texte d'un élément : ni `]]>` hors d'un CDATA, ni référence interdite (le navigateur refuse ; xmldom lisait). */
const checkText = (raw: string): void => {
  if (raw.indexOf(']]>') !== -1) malformed();
  if (raw.indexOf('&#') !== -1) checkCharRefs(raw);
};

const LT = 60;
const GT = 62;
const SLASH = 47;
const BANG = 33;
const QUESTION = 63;
const EQUALS = 61;
const DQUOTE = 34;
const SQUOTE = 39;
const AMP = 38;
const CR = 13;

const isBlankChar = (c: number): boolean => c === 32 || c === 10 || c === 9 || c === 13;

const isBlank = (text: string, from: number, to: number): boolean => {
  for (let k = from; k < to; k++) if (!isBlankChar(text.charCodeAt(k))) return false;
  return true;
};

/** Premier caractère d'un nom XML (lettre, `_`, `:` ou au-delà de l'ASCII). */
const isNameStart = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c === 58 || c >= 0xc0;
/** Caractère d'un nom XML : ceux du début, chiffres, `-`, `.` et `·`. */
const isNameChar = (c: number): boolean => isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 0xb7;

/** Fin du nom qui commence en `from` (`from` s'il n'y en a pas). */
const nameEnd = (text: string, from: number): number => {
  if (from >= text.length || !isNameStart(text.charCodeAt(from))) return from;
  let k = from + 1;
  while (k < text.length && isNameChar(text.charCodeAt(k))) k++;
  return k;
};

const skipBlanks = (text: string, from: number): number => {
  let k = from;
  while (k < text.length && isBlankChar(text.charCodeAt(k))) k++;
  return k;
};

/** Attributs d'une balise, à plat : nom, valeur brute (entités non décodées), nom, valeur… */
type Attributes = readonly string[];
const NO_ATTRIBUTES: Attributes = [];

interface XmlVisitor {
  /** Balise ouvrante (`colon` : place du `:` dans le nom, -1 sans préfixe) ; le contenu commence en `contentStart`. */
  open(name: string, colon: number, attributes: Attributes, contentStart: number): void;
  /** Fin de l'élément ouvert en dernier ; son contenu s'arrête avant `contentEnd`. */
  close(contentEnd: number): void;
}

/** Préfixe d'un nom qualifié (ou d'attribut) : il doit être déclaré par un `xmlns:` en portée, `xml` excepté. */
const checkPrefix = (name: string, colon: number, declared: (prefix: string) => boolean): void => {
  if (colon === -1) return;
  const prefix = name.slice(0, colon);
  if (colon === 0 || colon === name.length - 1 || name.indexOf(':', colon + 1) !== -1) malformed();
  if (prefix !== 'xml' && !declared(prefix)) malformed();
};

/** Saute un `<!DOCTYPE …>`, sous-ensemble entre crochets compris ; rend la position qui suit. */
const skipDoctype = (text: string, from: number): number => {
  let inSubset = false;
  let k = from;
  while (k < text.length) {
    const c = text.charCodeAt(k);
    if (c === DQUOTE || c === SQUOTE) {
      const end = text.indexOf(text[k], k + 1);
      if (end === -1) malformed();
      k = end + 1;
    } else if (inSubset && text.startsWith('<!--', k)) {
      const end = text.indexOf('-->', k + 4);
      if (end === -1) malformed();
      k = end + 3;
    } else {
      if (c === 91) inSubset = true;
      else if (c === 93) inSubset = false;
      else if (c === GT && !inSubset) return k + 1;
      k++;
    }
  }
  return malformed();
};

/**
 * Balayage d'un document XML, linéaire et sans retour arrière, qui refuse ce que
 * le navigateur refuse (message unique, `MALFORMED`) : une seule racine, rien
 * d'autre que des blancs, commentaires et instructions hors d'elle, balises
 * croisées ou non fermées, attribut sans guillemets ou en double, `<` dans une
 * valeur, préfixe non déclaré, déclaration XML ailleurs qu'en tête, caractère
 * interdit (en clair ou par référence numérique), `]]>` hors d'un CDATA. Le BOM
 * est ignoré ; commentaires, instructions et `DOCTYPE` sont sautés ; les entités
 * nommées ne sont pas vérifiées : une entité inconnue ou un `&` seul restent tels
 * quels, comme sous xmldom (décision du 04/11), là où le navigateur refusait.
 */
const scanXml = (text: string, visitor: XmlVisitor): void => {
  if (INVALID_CHARS.test(text)) malformed();
  // Textes et valeurs relus seulement si le fichier porte un `]]>` ou une référence numérique : presque jamais.
  const checkContent = text.indexOf(']]>') !== -1 || text.indexOf('&#') !== -1;
  const n = text.length;
  const start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const names: string[] = [];
  const nsPrefixes: string[] = [];
  const nsDepths: number[] = [];
  const declared = (prefix: string): boolean => {
    for (let k = nsPrefixes.length - 1; k >= 0; k--) if (nsPrefixes[k] === prefix) return true;
    return false;
  };
  const closeElement = (contentEnd: number): void => {
    names.pop();
    while (nsDepths.length > 0 && nsDepths[nsDepths.length - 1] === names.length) {
      nsDepths.pop();
      nsPrefixes.pop();
    }
    visitor.close(contentEnd);
  };
  let rootSeen = false;
  let doctypeSeen = false;
  let i = start;

  for (;;) {
    const lt = text.indexOf('<', i);
    if (names.length === 0 && !isBlank(text, i, lt === -1 ? n : lt)) malformed();
    if (lt === -1) break;
    if (checkContent && names.length > 0 && lt > i) checkText(text.slice(i, lt));
    const c = text.charCodeAt(lt + 1);

    if (c === SLASH) {
      // Balise fermante : le nom de l'élément ouvert en dernier, des blancs, `>`.
      const top = names[names.length - 1];
      if (top === undefined || !text.startsWith(top, lt + 2)) malformed();
      const k = skipBlanks(text, lt + 2 + top.length);
      if (text.charCodeAt(k) !== GT) malformed();
      closeElement(lt);
      i = k + 1;
    } else if (c === BANG) {
      if (text.startsWith('<!--', lt)) {
        // Un commentaire ne contient pas `--`, et finit par `-->`.
        const end = text.indexOf('--', lt + 4);
        if (end === -1 || text.charCodeAt(end + 2) !== GT) malformed();
        i = end + 3;
      } else if (text.startsWith('<![CDATA[', lt)) {
        if (names.length === 0) malformed();
        const end = text.indexOf(']]>', lt + 9);
        if (end === -1) malformed();
        i = end + 3;
      } else if (text.startsWith('<!DOCTYPE', lt)) {
        if (rootSeen || doctypeSeen) malformed();
        doctypeSeen = true;
        i = skipDoctype(text, lt + 9);
      } else {
        malformed();
      }
    } else if (c === QUESTION) {
      // Instruction de traitement ; `<?xml …?>`, la déclaration, en tête seulement.
      const end = text.indexOf('?>', lt + 2);
      if (end === -1) malformed();
      const targetEnd = nameEnd(text, lt + 2);
      if (targetEnd === lt + 2 || (targetEnd < end && !isBlankChar(text.charCodeAt(targetEnd)))) malformed();
      const target = text.slice(lt + 2, targetEnd);
      if (target.toLowerCase() === 'xml' && (lt !== start || target !== 'xml')) malformed();
      i = end + 2;
    } else {
      // Balise ouvrante : nom, attributs séparés par des blancs, `>` ou `/>`.
      if (rootSeen && names.length === 0) malformed();
      const end = nameEnd(text, lt + 1);
      if (end === lt + 1) malformed();
      const name = text.slice(lt + 1, end);
      let attributes: string[] | null = null;
      let k = end;
      let selfClosing = false;
      for (;;) {
        const next = skipBlanks(text, k);
        const ch = text.charCodeAt(next);
        if (ch === GT) {
          k = next + 1;
          break;
        }
        if (ch === SLASH) {
          if (text.charCodeAt(next + 1) !== GT) malformed();
          selfClosing = true;
          k = next + 2;
          break;
        }
        if (next === k) malformed();
        const attributeEnd = nameEnd(text, next);
        if (attributeEnd === next) malformed();
        const attributeName = text.slice(next, attributeEnd);
        const equals = skipBlanks(text, attributeEnd);
        if (text.charCodeAt(equals) !== EQUALS) malformed();
        const open = skipBlanks(text, equals + 1);
        const quote = text.charCodeAt(open);
        if (quote !== DQUOTE && quote !== SQUOTE) malformed();
        const close = text.indexOf(text[open], open + 1);
        if (close === -1) malformed();
        const value = text.slice(open + 1, close);
        if (value.indexOf('<') !== -1) malformed();
        if (checkContent && value.indexOf('&#') !== -1) checkCharRefs(value);
        if (attributes === null) attributes = [];
        for (let a = 0; a < attributes.length; a += 2) if (attributes[a] === attributeName) malformed();
        attributes.push(attributeName, value);
        k = close + 1;
      }
      const attrs: Attributes = attributes ?? NO_ATTRIBUTES;
      // Espaces de noms : les déclarations de l'élément d'abord, puis ses préfixes et ceux de ses attributs.
      for (let a = 0; a < attrs.length; a += 2) {
        if (!attrs[a].startsWith('xmlns:')) continue;
        const prefix = attrs[a].slice(6);
        if (prefix === '' || prefix === 'xmlns' || prefix.indexOf(':') !== -1) malformed();
        nsPrefixes.push(prefix);
        nsDepths.push(names.length);
      }
      const colon = name.indexOf(':');
      checkPrefix(name, colon, declared);
      for (let a = 0; a < attrs.length; a += 2) {
        if (attrs[a] !== 'xmlns' && !attrs[a].startsWith('xmlns:')) checkPrefix(attrs[a], attrs[a].indexOf(':'), declared);
      }
      rootSeen = true;
      names.push(name);
      visitor.open(name, colon, attrs, k);
      if (selfClosing) closeElement(k);
      i = k;
    }
  }
  if (!rootSeen || names.length > 0) malformed();
};

// ---------------------------------------------------------------------------
// Textes : `textContent` relu sur la tranche du source
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g;

/**
 * Entités prédéfinies et numériques décodées ; une entité inconnue ou un `&` seul restent tels quels (décision du
 * 04/11 : comme xmldom, quand le navigateur refusait le fichier). Une référence interdite est refusée au balayage.
 */
const decodeEntities = (raw: string): string =>
  raw.indexOf('&') === -1
    ? raw
    : raw.replace(ENTITY, (match, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
        if (named !== undefined) return NAMED_ENTITIES[named];
        const code = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal!, 10);
        return isXmlChar(code) ? String.fromCodePoint(code) : match;
      });

/** Fins de ligne du XML : `\r\n` et `\r` deviennent `\n`, avant tout décodage. */
const normalizeNewlines = (raw: string): string => (raw.indexOf('\r') === -1 ? raw : raw.replace(/\r\n?/g, '\n'));

/** Fin de la balise qui commence en `from` (un `>` dans une valeur entre guillemets ne la ferme pas). */
const tagEnd = (text: string, from: number): number => {
  let k = from;
  for (;;) {
    const c = text.charCodeAt(k);
    if (c === GT) return k + 1;
    if (c === DQUOTE || c === SQUOTE) k = text.indexOf(text[k], k + 1);
    k++;
  }
};

/**
 * `textContent` du contenu `[from, to[` d'un élément d'un document déjà balayé : textes des descendants mis bout à
 * bout, CDATA et entités décodés, commentaires et instructions exclus, fins de ligne ramenées à `\n`.
 */
const textOfRange = (text: string, from: number, to: number): string => {
  let plain = true;
  for (let k = from; k < to; k++) {
    const c = text.charCodeAt(k);
    if (c === LT || c === AMP || c === CR) {
      plain = false;
      break;
    }
  }
  if (plain) return text.slice(from, to);

  let out = '';
  let i = from;
  while (i < to) {
    const lt = text.indexOf('<', i);
    const end = lt === -1 || lt > to ? to : lt;
    if (end > i) out += decodeEntities(normalizeNewlines(text.slice(i, end)));
    if (end === to) break;
    if (text.startsWith('<!--', lt)) i = text.indexOf('-->', lt + 4) + 3;
    else if (text.startsWith('<![CDATA[', lt)) {
      const close = text.indexOf(']]>', lt + 9);
      out += normalizeNewlines(text.slice(lt + 9, close));
      i = close + 3;
    } else if (text.startsWith('<?', lt)) i = text.indexOf('?>', lt + 2) + 2;
    else i = tagEnd(text, lt + 1);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Lecture du GPX
// ---------------------------------------------------------------------------

/** Champs lus sur un point de trace. */
const POINT_FIELDS = ['time', 'ele', 'speed', 'course', 'hr', 'cad'] as const;
type PointField = (typeof POINT_FIELDS)[number];
const FIELD_COUNT = POINT_FIELDS.length;
const fieldIndex = (field: PointField): number => POINT_FIELDS.indexOf(field);

/**
 * Point lu (`trkpt` ou `rtept`, nom exact, sans préfixe : `getElementsByTagName`). Pour chaque champ, deux cases,
 * comme la recherche par le DOM : le premier descendant de ce nom sans préfixe, et le premier de ce nom local, n'importe
 * où sous le point (numéro de tranche, -1 sans).
 */
interface PointRecord {
  /** Valeurs brutes des attributs `lat` et `lon`. */
  lat: string | undefined;
  lon: string | undefined;
  /** Élément parent (son rang d'ouverture), `null` pour la racine : la reprise après une pause se lit au parent. */
  parent: number | null;
  /** `2 × champ` : sans préfixe ; `2 × champ + 1` : par nom local. */
  slots: number[];
}

/** Premier élément `trk`, `rte` ou `metadata` (nom exact) : tranches de son premier enfant direct `name` et `type`. */
interface ContainerRecord {
  id: number;
  name: number;
  type: number;
}

interface GpxDocument {
  text: string;
  trkpt: PointRecord[];
  rtept: PointRecord[];
  trk?: ContainerRecord;
  rte?: ContainerRecord;
  metadata?: ContainerRecord;
  parsererror: boolean;
  starts: number[];
  ends: number[];
}

const attributeOf = (attributes: Attributes, name: string): string | undefined => {
  for (let a = 0; a < attributes.length; a += 2) if (attributes[a] === name) return decodeEntities(attributes[a + 1]);
  return undefined;
};

/** Balaye le document et relève, sans rien relire, ce que la lecture du GPX demande. */
const readGpxDocument = (text: string): GpxDocument => {
  const doc: GpxDocument = { text, trkpt: [], rtept: [], parsererror: false, starts: [], ends: [] };
  const { starts, ends } = doc;
  const openPoints: PointRecord[] = [];
  // Par profondeur : rang de l'élément, sa tranche (-1 si personne ne la demande), point qu'il ouvre.
  const ids: number[] = [];
  const spans: number[] = [];
  const points: (PointRecord | null)[] = [];
  let nextId = 0;

  scanXml(text, {
    open(name, colon, attributes, contentStart) {
      const id = nextId++;
      const depth = ids.length;
      const parent = depth > 0 ? ids[depth - 1] : null;
      const local = colon === -1 ? name : name.slice(colon + 1);
      const prefixed = colon !== -1;
      // Tranche du contenu de l'élément, réservée seulement si un point ou une trace la prend.
      const span = starts.length;
      let taken = false;

      if (openPoints.length > 0) {
        const field = (POINT_FIELDS as readonly string[]).indexOf(local);
        if (field !== -1) {
          for (const point of openPoints) {
            if (point.slots[2 * field + 1] === -1) {
              point.slots[2 * field + 1] = span;
              taken = true;
            }
            if (!prefixed && point.slots[2 * field] === -1) {
              point.slots[2 * field] = span;
              taken = true;
            }
          }
        }
      }
      if (parent !== null && (local === 'name' || local === 'type')) {
        for (const container of [doc.trk, doc.rte, doc.metadata]) {
          if (container?.id !== parent || container[local] !== -1) continue;
          container[local] = span;
          taken = true;
        }
      }
      if (taken) {
        starts.push(contentStart);
        ends.push(contentStart);
      }

      let point: PointRecord | null = null;
      if (!prefixed) {
        if (name === 'trkpt' || name === 'rtept') {
          point = { lat: attributeOf(attributes, 'lat'), lon: attributeOf(attributes, 'lon'), parent, slots: new Array<number>(2 * FIELD_COUNT).fill(-1) };
          doc[name].push(point);
          openPoints.push(point);
        } else if ((name === 'trk' || name === 'rte' || name === 'metadata') && doc[name] === undefined) {
          doc[name] = { id, name: -1, type: -1 };
        } else if (name === 'parsererror') {
          doc.parsererror = true;
        }
      }
      ids.push(id);
      spans.push(taken ? span : -1);
      points.push(point);
    },
    close(contentEnd) {
      ids.pop();
      const span = spans.pop()!;
      if (span !== -1) ends[span] = contentEnd;
      if (points.pop()) openPoints.pop();
    },
  });
  // Un `<parsererror>` dans un document bien formé : refusé comme le faisait la lecture par le DOM.
  if (doc.parsererror) malformed();
  return doc;
};

/** `textContent` d'une tranche, `undefined` sans tranche. */
const rawTextOf = (doc: GpxDocument, span: number): string | undefined => (span === -1 ? undefined : textOfRange(doc.text, doc.starts[span], doc.ends[span]));

/** Contenu texte d'une tranche, ou `undefined` si elle est absente ou vide. */
const textOf = (doc: GpxDocument, span: number): string | undefined => {
  const text = rawTextOf(doc, span)?.trim();
  return text ? text : undefined;
};

/** Contenu numérique d'une tranche, ou `undefined` s'il est absent ou illisible. */
const numberOf = (doc: GpxDocument, span: number): number | undefined => {
  const text = rawTextOf(doc, span);
  if (text === undefined) return undefined;
  const value = parseFloat(text.trim());
  return isFinite(value) ? value : undefined;
};

/** Tranche d'un champ du point : le nom sans préfixe l'emporte, sinon le premier de ce nom local. */
const fieldSpan = (point: PointRecord, field: PointField): number => {
  const index = fieldIndex(field);
  const qualified = point.slots[2 * index];
  return qualified !== -1 ? qualified : point.slots[2 * index + 1];
};

/**
 * Vitesse portée par le point, en m/s.
 *
 * La balise `speed` du profil Garmin est en m/s. Certains fichiers exposent
 * la même donnée sous `gpxdata:speed`. Les valeurs négatives ou absurdes sont
 * écartées plutôt que propagées.
 */
const readDeviceSpeed = (doc: GpxDocument, span: number): number | undefined => {
  const speed = numberOf(doc, span);
  if (speed === undefined || speed < 0 || speed > 100) return undefined;
  return speed;
};

/** Cap porté par le point (`course` du profil Garmin), en degrés ; hors de 0 à 360, écarté. */
const readCourse = (doc: GpxDocument, span: number): number | undefined => {
  const course = numberOf(doc, span);
  return course !== undefined && course >= 0 && course <= 360 ? course : undefined;
};

export const parseGpx = (gpxContent: string): ParsedGpx => {
  const doc = readGpxDocument(gpxContent);
  const rawPoints: RawTrackPoint[] = [];
  const timedPoints: TimedTrackPoint[] = [];
  let hasDeviceSpeed = false;
  // Segment du dernier point retenu : un point d'un autre `<trkseg>` reprend
  // après une pause de l'enregistrement (un `<trkseg>` par pause, `gpxWriter.ts`).
  // Un point écarté en tête d'un segment ne fait pas perdre la reprise, qui
  // passe au suivant gardé.
  let lastSegment: number | null = null;
  let lastTimedSegment: number | null = null;
  // Date du dernier point gardé de chaque liste : la trace ne remonte jamais le temps.
  let lastRawTimeMs = -Infinity;
  let lastTimedMs = -Infinity;

  for (const trkpt of doc.trkpt) {
    const lat = parseFloat(trkpt.lat ?? '');
    const lon = parseFloat(trkpt.lon ?? '');
    const time = textOf(doc, fieldSpan(trkpt, 'time'));

    // Un point sans horodatage ne sert à rien : toute la kinématique repose
    // sur la différence de temps entre deux points.
    if (!time) continue;
    // Date lue une fois (lot 56), comme `pointTimeMs` la relirait. Une date
    // illisible (`NaN`), ou qui recule sous le dernier point gardé, écarte le
    // point ici, la seule place (lot 149, C2-1 et C2-2) : en aval, un recul
    // allongeait le pas suivant et fabriquait de faux tops, un `NaN` mettait
    // « NaN min » en temps actif et amputait les tops de toute la suite. Une
    // date égale est gardée : `spreadEqualTimes` la répartit.
    const timeMs = new Date(time).getTime();
    if (!isFinite(timeMs)) continue;
    // Sans position, mais à l'heure : un point d'une session sans trace (muscu),
    // à part, jamais dans la cinématique.
    if (!isFinite(lat) || !isFinite(lon)) {
      if (timeMs < lastTimedMs) continue;
      lastTimedMs = timeMs;
      const segment = trkpt.parent;
      const resumes = lastTimedSegment !== null && segment !== lastTimedSegment;
      lastTimedSegment = segment;
      const hr = numberOf(doc, fieldSpan(trkpt, 'hr'));
      timedPoints.push({
        time,
        ...(hr !== undefined ? { hr } : {}),
        ...(resumes ? { segmentStart: true as const } : {}),
      });
      continue;
    }
    if (timeMs < lastRawTimeMs) continue;
    lastRawTimeMs = timeMs;

    const speedMs = readDeviceSpeed(doc, fieldSpan(trkpt, 'speed'));
    if (speedMs !== undefined) hasDeviceSpeed = true;

    const segment = trkpt.parent;
    const resumes = lastSegment !== null && segment !== lastSegment;
    lastSegment = segment;

    rawPoints.push({
      lat,
      lon,
      time,
      rawTimeMs: timeMs,
      ele: numberOf(doc, fieldSpan(trkpt, 'ele')),
      speedMs,
      courseDeg: readCourse(doc, fieldSpan(trkpt, 'course')),
      hr: numberOf(doc, fieldSpan(trkpt, 'hr')),
      cadence: numberOf(doc, fieldSpan(trkpt, 'cad')),
      ...(resumes ? { segmentStart: true as const } : {}),
    });
  }

  return {
    rawPoints,
    timedPoints,
    // Nom et type : premier enfant direct de ce nom local (une extension de point du même nom ne répond pas).
    trackName: doc.trk ? textOf(doc, doc.trk.name) : undefined,
    trackType: doc.trk ? textOf(doc, doc.trk.type) : undefined,
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
  const doc = readGpxDocument(gpxContent);

  const read = (records: PointRecord[]) => {
    const points: ParsedGpxPath['points'] = [];
    for (const record of records) {
      const lat = parseFloat(record.lat ?? '');
      const lon = parseFloat(record.lon ?? '');
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const eleM = numberOf(doc, fieldSpan(record, 'ele'));
      points.push(eleM !== undefined ? { lat, lon, eleM } : { lat, lon });
    }
    return points;
  };
  const trackPoints = read(doc.trkpt);
  const points = trackPoints.length >= 2 ? trackPoints : read(doc.rtept);

  const nameOf = (container: ContainerRecord | undefined) => (container ? textOf(doc, container.name) : undefined);
  return {
    points,
    name: nameOf(doc.trk) ?? nameOf(doc.rte) ?? nameOf(doc.metadata),
    trackType: doc.trk ? textOf(doc, doc.trk.type) : undefined,
  };
};
