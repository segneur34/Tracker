/**
 * Fichier de test seulement : le code de l'application ne l'importe pas. Fabrique un FIT en octets,
 * message par message, pour les tests du lecteur et le banc (`outils/banc/import-fit.mjs`).
 */

/** Types de base du FIT (`fit_base_type`). */
export const FIT_BASE = {
  enum: 0x00, sint8: 0x01, uint8: 0x02, sint16: 0x83, uint16: 0x84, sint32: 0x85, uint32: 0x86, float32: 0x88,
  uint8z: 0x0a, uint16z: 0x8b, uint32z: 0x8c, byte: 0x0d,
} as const;

/** Taille d'un élément de chaque type de base. */
const BASE_SIZE: Record<number, number> = {
  0x00: 1, 0x01: 1, 0x02: 1, 0x83: 2, 0x84: 2, 0x85: 4, 0x86: 4, 0x88: 4, 0x0a: 1, 0x8b: 2, 0x8c: 4, 0x0d: 1,
};

/** Valeurs invalides des types les plus courants. */
export const FIT_INVALID = { uint8: 0xff, uint16: 0xffff, sint32: 0x7fffffff, uint32: 0xffffffff } as const;

export const FIT_MESG = { fileId: 0, sport: 12, session: 18, lap: 19, record: 20, event: 21 } as const;

export interface FitFieldDef {
  num: number;
  base: number;
}

const FIT_EPOCH_MS = Date.UTC(1989, 11, 31);

/** Instant Unix (ms) en temps FIT (s depuis le 31/12/1989). */
export const fitTime = (ms: number): number => Math.round((ms - FIT_EPOCH_MS) / 1000);

/** Degrés en semi-cercles. */
export const semicircles = (deg: number): number => Math.round((deg * 2 ** 31) / 180);

/** Somme de contrôle du FIT (CRC-16 du SDK, par quartets). */
export const fitCrc = (bytes: ArrayLike<number>, from = 0, to = bytes.length): number => {
  const table = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];
  let crc = 0;
  for (let k = from; k < to; k++) {
    const byte = bytes[k];
    let tmp = table[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ table[byte & 0xf];
    tmp = table[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ table[(byte >> 4) & 0xf];
  }
  return crc;
};

interface WriterOptions {
  bigEndian?: boolean;
  /** 12 ou 14 octets. */
  headerSize?: 12 | 14;
}

/** Écrit un FIT, définitions et données à la suite ; `bytes()` rend le fichier fini, sommes de contrôle comprises. */
export const fitWriter = ({ bigEndian = false, headerSize = 14 }: WriterOptions = {}) => {
  const data: number[] = [];
  const defs = new Map<number, FitFieldDef[]>();

  const push = (value: number, base: number): void => {
    const size = BASE_SIZE[base];
    const scratch = new DataView(new ArrayBuffer(8));
    switch (base) {
      case FIT_BASE.sint16: scratch.setInt16(0, value, !bigEndian); break;
      case FIT_BASE.uint16: case FIT_BASE.uint16z: scratch.setUint16(0, value, !bigEndian); break;
      case FIT_BASE.sint32: scratch.setInt32(0, value, !bigEndian); break;
      case FIT_BASE.uint32: case FIT_BASE.uint32z: scratch.setUint32(0, value, !bigEndian); break;
      case FIT_BASE.float32: scratch.setFloat32(0, value, !bigEndian); break;
      default: scratch.setUint8(0, value);
    }
    for (let k = 0; k < size; k++) data.push(scratch.getUint8(k));
  };

  const writer = {
    /** Définit le message local `local` ; `developer` : tailles des champs développeur, écrits après les autres. */
    define(local: number, global: number, fields: FitFieldDef[], developer: number[] = []) {
      defs.set(local, fields);
      data.push(0x40 | (developer.length > 0 ? 0x20 : 0) | local, 0, bigEndian ? 1 : 0);
      if (bigEndian) data.push(global >> 8, global & 0xff);
      else data.push(global & 0xff, global >> 8);
      data.push(fields.length);
      for (const f of fields) data.push(f.num, BASE_SIZE[f.base], f.base);
      if (developer.length > 0) {
        data.push(developer.length);
        developer.forEach((size, k) => data.push(k, size, 0));
      }
      return writer;
    },
    /** Message de données, avec les octets de ses champs développeur (`developer`). */
    message(local: number, values: number[], developer: number[] = []) {
      data.push(local);
      defs.get(local)!.forEach((f, k) => push(values[k], f.base));
      data.push(...developer);
      return writer;
    },
    /** Message en temps compressé : `offset` sur 5 bits, message local de 0 à 3. */
    compressed(local: number, offset: number, values: number[]) {
      data.push(0x80 | (local << 5) | (offset & 0x1f));
      defs.get(local)!.forEach((f, k) => push(values[k], f.base));
      return writer;
    },
    bytes(): Uint8Array {
      const out = new Uint8Array(headerSize + data.length + 2);
      const view = new DataView(out.buffer);
      out[0] = headerSize;
      out[1] = 0x20; // version du protocole
      view.setUint16(2, 2132, true); // version du profil
      view.setUint32(4, data.length, true);
      out.set([0x2e, 0x46, 0x49, 0x54], 8);
      if (headerSize === 14) view.setUint16(12, fitCrc(out, 0, 12), true);
      out.set(data, headerSize);
      view.setUint16(headerSize + data.length, fitCrc(out, 0, headerSize + data.length), true);
      return out;
    },
  };
  return writer;
};

/** Un point d'une activité fabriquée ; champ absent : valeur invalide dans le fichier. */
export interface FitPointSpec {
  timeMs: number;
  lat?: number;
  lon?: number;
  altitudeM?: number;
  speedMs?: number;
  hr?: number;
  /** Cadence FIT : foulées par minute à pied, tours par minute à vélo. */
  cadence?: number;
  /** Fraction de cadence, en 1/128 (`fractional_cadence`). */
  fractionalCadence?: number;
  /** Distance du fichier, en mètres (jamais relue). */
  distanceM?: number;
}

export interface FitActivitySpec {
  points: FitPointSpec[];
  /** Type de fichier (4 : activité). */
  fileType?: number;
  /** Sport de chaque `session` ; vide : aucune session. */
  sessionSports?: number[];
  /** Sport du message `sport`. */
  sportMessage?: number;
  /** Minuterie : instant, `true` si elle repart. */
  timer?: [timeMs: number, running: boolean][];
  bigEndian?: boolean;
  headerSize?: 12 | 14;
}

const RECORD_FIELDS: FitFieldDef[] = [
  { num: 253, base: FIT_BASE.uint32 },
  { num: 0, base: FIT_BASE.sint32 },
  { num: 1, base: FIT_BASE.sint32 },
  { num: 78, base: FIT_BASE.uint32 },
  { num: 73, base: FIT_BASE.uint32 },
  { num: 3, base: FIT_BASE.uint8 },
  { num: 4, base: FIT_BASE.uint8 },
  { num: 53, base: FIT_BASE.uint8 },
  { num: 5, base: FIT_BASE.uint32 },
];

/** Une activité entière : `file_id`, minuterie et points dans l'ordre du temps, puis ses sessions. */
export const buildFitActivity = (spec: FitActivitySpec): Uint8Array => {
  const writer = fitWriter({ bigEndian: spec.bigEndian, headerSize: spec.headerSize });
  writer.define(0, FIT_MESG.fileId, [{ num: 0, base: FIT_BASE.enum }]).message(0, [spec.fileType ?? 4]);
  writer.define(1, FIT_MESG.record, RECORD_FIELDS);
  writer.define(2, FIT_MESG.event, [{ num: 253, base: FIT_BASE.uint32 }, { num: 0, base: FIT_BASE.enum }, { num: 1, base: FIT_BASE.enum }]);
  writer.define(3, FIT_MESG.session, [{ num: 253, base: FIT_BASE.uint32 }, { num: 5, base: FIT_BASE.enum }]);
  if (spec.sportMessage !== undefined) writer.define(4, FIT_MESG.sport, [{ num: 0, base: FIT_BASE.enum }]).message(4, [spec.sportMessage]);

  type Step = { timeMs: number; write: () => void };
  const steps: Step[] = [
    // À instant égal, la minuterie d'abord, comme une montre : le point d'un arrêt ou d'un départ vient après elle.
    ...(spec.timer ?? []).map(([timeMs, running]): Step => ({
      timeMs, write: () => writer.message(2, [fitTime(timeMs), 0, running ? 0 : 4]),
    })),
    ...spec.points.map((p): Step => ({
      timeMs: p.timeMs,
      write: () => writer.message(1, [
        fitTime(p.timeMs),
        p.lat === undefined ? FIT_INVALID.sint32 : semicircles(p.lat),
        p.lon === undefined ? FIT_INVALID.sint32 : semicircles(p.lon),
        p.altitudeM === undefined ? FIT_INVALID.uint32 : Math.round((p.altitudeM + 500) * 5),
        p.speedMs === undefined ? FIT_INVALID.uint32 : Math.round(p.speedMs * 1000),
        p.hr ?? FIT_INVALID.uint8,
        p.cadence ?? FIT_INVALID.uint8,
        p.fractionalCadence ?? FIT_INVALID.uint8,
        p.distanceM === undefined ? FIT_INVALID.uint32 : Math.round(p.distanceM * 100),
      ]),
    })),
  ];
  steps.sort((a, b) => a.timeMs - b.timeMs);
  for (const step of steps) step.write();

  const last = spec.points[spec.points.length - 1]?.timeMs ?? Date.UTC(2026, 0, 1);
  for (const sport of spec.sessionSports ?? [1]) writer.message(3, [fitTime(last), sport]);
  return writer.bytes();
};
