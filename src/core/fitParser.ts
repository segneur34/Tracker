/**
 * Lecture d'un fichier FIT (format binaire des montres Garmin, Suunto, Coros…),
 * sans dépendance externe : en-tête, définitions, données. Lecteur pur, en unités
 * SI (m, m/s, ms, degrés). Numéros de messages et de champs : profil FIT officiel.
 *
 * Seul ce qui sert à ranger une session est relu : le type du fichier
 * (`file_id`), le sport (`session`, à défaut `sport`), la minuterie (`event`) et
 * les points (`record`). La distance du fichier n'est pas lue : la distance d'une
 * session est toujours l'intégrale de la vitesse retenue.
 *
 * Un fichier coupé rend ce qui a été lu jusqu'à la coupure (`truncated`) ; la somme
 * de contrôle n'est pas vérifiée, pour la même raison : mieux vaut les points lus
 * qu'un refus. Seul un fichier qui n'est pas un FIT lève une erreur.
 */

/** Type de fichier d'une activité (`file` du profil FIT). */
export const FIT_FILE_ACTIVITY = 4;

export interface FitRecord {
  /** Instant du point, en millisecondes depuis l'époque Unix. */
  timeMs: number;
  /** Position, en degrés ; les deux présentes, ou aucune. */
  lat?: number;
  lon?: number;
  altitudeM?: number;
  speedMs?: number;
  heartRateBpm?: number;
  /** Cadence telle que le FIT la donne : foulées par minute à pied, tours par minute à vélo. */
  cadence?: number;
}

/** Minuterie de la montre : `running` à vrai quand elle repart, à faux quand elle s'arrête. */
export interface FitTimerEvent {
  timeMs: number;
  running: boolean;
}

export interface ParsedFit {
  /** Type du fichier (`FIT_FILE_ACTIVITY` pour une activité), `null` sans `file_id` lisible. */
  fileType: number | null;
  /** Numéros de sport du fichier : un par `session`, à défaut ceux des messages `sport`. */
  sportCodes: number[];
  records: FitRecord[];
  timerEvents: FitTimerEvent[];
  /** Fichier coupé, ou abîmé au point qu'on ne peut lire la suite : ce qui précède est rendu. */
  truncated: boolean;
}

const HEADER_SIZES = new Set([12, 14]);
const SIGNATURE = [0x2e, 0x46, 0x49, 0x54]; // « .FIT »
const CRC_SIZE = 2;

/** Époque du FIT : le 31/12/1989 à 00:00:00 UTC. */
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);
/** Sous cette valeur, un `date_time` compte les secondes depuis l'allumage de l'appareil : ce n'est pas une date. */
const MIN_ABSOLUTE_TIME = 0x10000000;
const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

// Messages et champs du profil FIT.
const MESG_FILE_ID = 0;
const MESG_SPORT = 12;
const MESG_SESSION = 18;
const MESG_RECORD = 20;
const MESG_EVENT = 21;
const FIELD_TIMESTAMP = 253;
const EVENT_TIMER = 0;
const EVENT_TYPE_START = 0;
const EVENT_TYPES_STOP = new Set([1, 4, 8, 9]); // stop, stop_all, stop_disable, stop_disable_all

interface FieldDefinition {
  num: number;
  /** Place du champ dans le message. */
  offset: number;
  size: number;
  baseType: number;
}

interface MessageDefinition {
  global: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
  /** Taille du message, champs développeur compris. */
  size: number;
}

/**
 * Valeur d'un champ, ou `undefined` si elle vaut l'invalide de son type (ou si le champ
 * n'est pas un nombre). Un tableau rend son premier élément.
 */
const readValue = (view: DataView, at: number, field: FieldDefinition, littleEndian: boolean): number | undefined => {
  const need = (size: number): boolean => field.size >= size;
  let value: number;
  let invalid: number;
  // Numéro de type dans les 5 bits bas : le bit haut dit seulement que le type a un boutisme.
  switch (field.baseType & 0x1f) {
    case 0: case 2: case 13: // enum, uint8, byte
      value = view.getUint8(at);
      invalid = 0xff;
      break;
    case 1: // sint8
      value = view.getInt8(at);
      invalid = 0x7f;
      break;
    case 10: // uint8z
      value = view.getUint8(at);
      invalid = 0;
      break;
    case 3: // sint16
      if (!need(2)) return undefined;
      value = view.getInt16(at, littleEndian);
      invalid = 0x7fff;
      break;
    case 4: // uint16
      if (!need(2)) return undefined;
      value = view.getUint16(at, littleEndian);
      invalid = 0xffff;
      break;
    case 11: // uint16z
      if (!need(2)) return undefined;
      value = view.getUint16(at, littleEndian);
      invalid = 0;
      break;
    case 5: // sint32
      if (!need(4)) return undefined;
      value = view.getInt32(at, littleEndian);
      invalid = 0x7fffffff;
      break;
    case 6: // uint32
      if (!need(4)) return undefined;
      value = view.getUint32(at, littleEndian);
      invalid = 0xffffffff;
      break;
    case 12: // uint32z
      if (!need(4)) return undefined;
      value = view.getUint32(at, littleEndian);
      invalid = 0;
      break;
    case 8: { // float32 : l'invalide (tous les bits à 1) se lit NaN
      if (!need(4)) return undefined;
      const float = view.getFloat32(at, littleEndian);
      return Number.isFinite(float) ? float : undefined;
    }
    case 9: { // float64
      if (!need(8)) return undefined;
      const float = view.getFloat64(at, littleEndian);
      return Number.isFinite(float) ? float : undefined;
    }
    default: // Texte et entiers de 64 bits : aucun champ relu ici n'en est un.
      return undefined;
  }
  return value === invalid ? undefined : value;
};

const hasSignature = (bytes: Uint8Array, at: number): boolean =>
  HEADER_SIZES.has(bytes[at]) && at + 12 <= bytes.length && SIGNATURE.every((c, k) => bytes[at + 8 + k] === c);

/** Lit un champ du message en cours, par son numéro. */
type FieldReader = (num: number) => number | undefined;

/** Reçoit chaque message de données ; rend `true` pour arrêter la lecture. */
type MessageVisitor = (global: number, timestampS: number | undefined, read: FieldReader) => boolean | void;

/**
 * Parcourt les messages : le temps compressé est remis à plat, les champs développeur sont
 * sautés, une redéfinition d'un message local remplace la précédente. Plusieurs FIT mis
 * bout à bout se lisent à la suite. Rend vrai si le fichier s'est arrêté avant sa fin.
 */
const walkFit = (bytes: Uint8Array, visit: MessageVisitor): boolean => {
  if (bytes.length === 0) throw new Error('fichier vide');
  if (!hasSignature(bytes, 0)) throw new Error("ce n'est pas un fichier FIT");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let start = 0;
  for (;;) {
    const dataSize = view.getUint32(start + 4, true);
    const dataStart = start + bytes[start];
    const dataEnd = dataStart + dataSize;
    // Taille nulle (écriture jamais terminée) ou au-delà du fichier : on lit ce qu'il y a.
    const end = dataSize === 0 || dataEnd > bytes.length ? bytes.length : dataEnd;
    let truncated = end !== dataEnd;

    const definitions = new Map<number, MessageDefinition>();
    let lastTimestamp: number | undefined;
    let pos = dataStart;
    while (pos < end) {
      const header = bytes[pos];
      pos += 1;
      const compressed = (header & 0x80) !== 0;

      if (!compressed && (header & 0x40) !== 0) {
        // Définition : réservé, boutisme, message global, champs, puis champs développeur si le drapeau est levé.
        if (pos + 5 > end) { truncated = true; break; }
        const architecture = bytes[pos + 1];
        if (architecture > 1) { truncated = true; break; }
        const littleEndian = architecture === 0;
        const global = view.getUint16(pos + 2, littleEndian);
        const fieldCount = bytes[pos + 4];
        pos += 5;
        if (pos + fieldCount * 3 > end) { truncated = true; break; }
        const fields: FieldDefinition[] = [];
        let size = 0;
        for (let k = 0; k < fieldCount; k++) {
          const fieldSize = bytes[pos + 1];
          fields.push({ num: bytes[pos], offset: size, size: fieldSize, baseType: bytes[pos + 2] });
          size += fieldSize;
          pos += 3;
        }
        if ((header & 0x20) !== 0) {
          if (pos + 1 > end) { truncated = true; break; }
          const developerCount = bytes[pos];
          pos += 1;
          if (pos + developerCount * 3 > end) { truncated = true; break; }
          for (let k = 0; k < developerCount; k++) {
            size += bytes[pos + 1];
            pos += 3;
          }
        }
        definitions.set(header & 0x0f, { global, littleEndian, fields, size });
        continue;
      }

      // Données : un message local défini plus haut ; en temps compressé, 2 bits de message et 5 de temps.
      const definition = definitions.get(compressed ? (header >> 5) & 0x03 : header & 0x0f);
      if (!definition || pos + definition.size > end) { truncated = true; break; }
      const at = pos;
      pos += definition.size;

      const read: FieldReader = (num) => {
        const field = definition.fields.find((f) => f.num === num);
        return field && field.size > 0 ? readValue(view, at + field.offset, field, definition.littleEndian) : undefined;
      };
      if (compressed) {
        if (lastTimestamp !== undefined) {
          // Le décalage ne porte que les 5 bits bas : plus petit que ceux du dernier temps, il a fait le tour.
          const offset = header & 0x1f;
          const low = lastTimestamp % 0x20;
          lastTimestamp = lastTimestamp - low + offset + (offset < low ? 0x20 : 0);
        }
      } else {
        const timestamp = read(FIELD_TIMESTAMP);
        if (timestamp !== undefined) lastTimestamp = timestamp;
      }
      if (visit(definition.global, lastTimestamp, read) === true) return truncated;
    }

    if (truncated) return true;
    // Un autre FIT à la suite (après la somme de contrôle de celui-ci) ?
    start = dataEnd + CRC_SIZE;
    if (start >= bytes.length || !hasSignature(bytes, start)) return false;
  }
};

const timeOf = (timestampS: number | undefined): number | null =>
  timestampS === undefined || timestampS < MIN_ABSOLUTE_TIME ? null : FIT_EPOCH_MS + timestampS * 1000;

const readRecord = (timeMs: number, read: FieldReader): FitRecord => {
  const record: FitRecord = { timeMs };

  const latRaw = read(0);
  const lonRaw = read(1);
  if (latRaw !== undefined && lonRaw !== undefined) {
    const lat = latRaw * SEMICIRCLE_TO_DEG;
    const lon = lonRaw * SEMICIRCLE_TO_DEG;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      record.lat = lat;
      record.lon = lon;
    }
  }
  // `enhanced_*` (78 et 73 : plus de bits) l'emporte sur l'ancien champ. Échelle 5 et décalage 500 de l'altitude,
  // écrits en une seule division pour garder un nombre rond.
  const altitudeRaw = read(78) ?? read(2);
  if (altitudeRaw !== undefined) record.altitudeM = (altitudeRaw - 2500) / 5;
  const speedRaw = read(73) ?? read(6);
  if (speedRaw !== undefined) record.speedMs = speedRaw / 1000;
  // 0 : pas de mesure (capteur non porté), jamais une fréquence cardiaque.
  const heartRate = read(3);
  if (heartRate !== undefined && heartRate > 0) record.heartRateBpm = heartRate;
  const cadence = read(4);
  if (cadence !== undefined) record.cadence = cadence + (read(53) ?? 0) / 128;
  return record;
};

/** Lit un FIT ; lève une erreur en clair si ce n'en est pas un (vide, signature fausse). */
export const parseFit = (bytes: Uint8Array): ParsedFit => {
  let fileType: number | null = null;
  let fileTypeSeen = false;
  const sessionSports: number[] = [];
  const sportMessages: number[] = [];
  const records: FitRecord[] = [];
  const timerEvents: FitTimerEvent[] = [];

  const truncated = walkFit(bytes, (global, timestampS, read) => {
    switch (global) {
      case MESG_RECORD: {
        const timeMs = timeOf(timestampS);
        if (timeMs !== null) records.push(readRecord(timeMs, read));
        break;
      }
      case MESG_EVENT: {
        const timeMs = timeOf(timestampS);
        const type = read(1);
        if (timeMs === null || read(0) !== EVENT_TIMER || type === undefined) break;
        if (type === EVENT_TYPE_START) timerEvents.push({ timeMs, running: true });
        else if (EVENT_TYPES_STOP.has(type)) timerEvents.push({ timeMs, running: false });
        break;
      }
      case MESG_SESSION: {
        const sport = read(5);
        if (sport !== undefined) sessionSports.push(sport);
        break;
      }
      case MESG_SPORT: {
        const sport = read(0);
        if (sport !== undefined) sportMessages.push(sport);
        break;
      }
      case MESG_FILE_ID:
        // Le premier compte : celui d'un FIT mis bout à bout derrière ne décrit pas le fichier.
        if (!fileTypeSeen) {
          fileTypeSeen = true;
          fileType = read(0) ?? null;
        }
        break;
      default:
    }
  });

  return { fileType, sportCodes: sessionSports.length > 0 ? sessionSports : sportMessages, records, timerEvents, truncated };
};

/**
 * Type d'un FIT sans en lire la suite (`fileType` de `parseFit`), pour compter les activités
 * d'un dossier avant de l'importer. Lève une erreur si ce n'est pas un FIT.
 */
export const readFitFileType = (bytes: Uint8Array): number | null => {
  let fileType: number | null = null;
  walkFit(bytes, (global, _timestampS, read) => {
    if (global !== MESG_FILE_ID) return false;
    fileType = read(0) ?? null;
    return true;
  });
  return fileType;
};
