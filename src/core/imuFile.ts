/**
 * Fichier des capteurs d'une session (`.imu`), rangé à côté de son GPX :
 * accéléromètre et gyroscope bruts, et baromètre s'il existe, mesurés par le
 * téléphone pendant l'enregistrement (`platform/motion.ts`). Ils servent à la
 * mesure des sauts en voile.
 *
 * Ce commentaire est la seule description du format. Le téléphone l'écrit
 * (`android/…/ImuWriter.java`, qui y renvoie) ; ce module le lit, et l'écrit
 * aussi (tests, banc, élagage à venir). Tout est petit-boutiste :
 *
 * 1. marque : les 8 octets ASCII « TRKIMU1\n » ;
 * 2. en-tête : sa longueur (uint32), puis du JSON en UTF-8 (`ImuHeader`) ;
 * 3. des paquets jusqu'à la fin du fichier : longueur L (uint32), puis L
 *    octets compressés en deflate brut (RFC 1951, sans enveloppe zlib).
 *    Un paquet tient environ une seconde de mesures ; il se lit seul, si bien
 *    qu'un arrêt brutal ne perd que le dernier, tronqué, qui est ignoré.
 *
 * Un paquet décompressé est une suite de blocs, chacun d'un seul flux :
 * - numéro du flux (uint8), nombre n de mesures (uint16, au moins 1) ;
 * - instant de la première mesure (float64, entier exact) : en microsecondes
 *   depuis `clock.elapsedUs`, temps écoulé du système au départ ;
 * - n − 1 écarts d'instant (int16), en dixièmes de milliseconde : chaque
 *   instant est arrondi au dixième de milliseconde depuis la première mesure
 *   du bloc, et un écart hors de [0, 32 767] ouvre un nouveau bloc (à
 *   l'élagage, un instant qui ne tombe pas juste sur ce pas aussi) ;
 * - pour chaque axe, n entiers (int16) : le premier tel quel, les suivants en
 *   écart au précédent, modulo 2^16. Valeur = `offset` + entier × `unit`,
 *   l'entier étant borné à [−32 768, 32 767] à l'écriture.
 *
 * Les instants des mesures se ramènent à l'heure par le couple d'horloges de
 * l'en-tête (`clock`), lu d'un coup au départ : heure = `clock.wallMs` +
 * instant / 1000.
 */

export const IMU_MAGIC = 'TRKIMU1\n';
export const IMU_FORMAT = 'tracker-capteurs';
export const IMU_VERSION = 1;

/** Pas des instants dans un bloc, en microsecondes. */
export const IMU_TIME_STEP_US = 100;

export type ImuStreamKind = 'accel' | 'gyro' | 'pressure';

export interface ImuStreamInfo {
  /** Numéro du flux dans les blocs. */
  id: number;
  kind: ImuStreamKind;
  axes: number;
  /** Valeur d'une unité entière : 0,01 m/s², 0,002 rad/s, 0,01 hPa. */
  unit: number;
  /** Valeur de l'entier 0 (baromètre : 1000 hPa). */
  offset: number;
  /** Capteur d'Android : nom, fabricant, plage et résolution dans son unité, cadence la plus rapide. */
  sensor?: { name?: string; vendor?: string; maxRange?: number; resolution?: number; minDelayUs?: number };
}

export interface ImuHeader {
  format: typeof IMU_FORMAT;
  version: number;
  /** Instant de l'en-tête du journal de l'enregistrement (horloge de la page), qui relie le fichier à sa session. */
  startedAtMs: number;
  /** Temps écoulé du système (µs) et heure (ms), lus ensemble au départ de la capture. */
  clock: { elapsedUs: number; wallMs: number };
  device?: { manufacturer?: string; model?: string; android?: number };
  /** Réglages des sauts au départ : emplacement du téléphone et foil. */
  setup: { placement: string; foil: boolean };
  streams: ImuStreamInfo[];
  /**
   * Fenêtres gardées, en µs comme les instants, quand le fichier a été élagué ;
   * absent : toute la capture.
   */
  windows?: [number, number][];
}

/** Mesures d'un flux : instants en µs depuis `clock.elapsedUs`, valeurs par axe dans l'unité du capteur. */
export interface ImuSeries {
  info: ImuStreamInfo;
  t: Float64Array;
  values: Float32Array[];
}

export interface ImuRecording {
  header: ImuHeader;
  series: ImuSeries[];
  /** Paquets lus. */
  chunks: number;
  /** Vrai si la fin du fichier était un paquet incomplet, ignoré (arrêt brutal). */
  truncated: boolean;
  /** Paquets complets mais illisibles, sautés. */
  skippedChunks: number;
}

/** Flux écrits par le téléphone, dans cet ordre de numéros. */
export const PHONE_STREAMS: readonly ImuStreamInfo[] = [
  { id: 0, kind: 'accel', axes: 3, unit: 0.01, offset: 0 },
  { id: 1, kind: 'gyro', axes: 3, unit: 0.002, offset: 0 },
  { id: 2, kind: 'pressure', axes: 1, unit: 0.01, offset: 1000 },
];

const asciiBytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

const transform = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const piped = new Blob([copy]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
};

const inflateRaw = (bytes: Uint8Array): Promise<Uint8Array> => transform(bytes, new DecompressionStream('deflate-raw'));
const deflateRaw = (bytes: Uint8Array): Promise<Uint8Array> => transform(bytes, new CompressionStream('deflate-raw'));

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Tableau de nombres qui grandit, sans recopier à chaque ajout. */
class Growable {
  data: Float64Array;
  length = 0;
  constructor(capacity = 4096) {
    this.data = new Float64Array(capacity);
  }
  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new Float64Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }
}

const readHeader = (json: unknown): ImuHeader | null => {
  if (!isObject(json) || json.format !== IMU_FORMAT || typeof json.version !== 'number') return null;
  if (typeof json.startedAtMs !== 'number' || !isObject(json.clock) || !Array.isArray(json.streams)) return null;
  const { elapsedUs, wallMs } = json.clock;
  if (typeof elapsedUs !== 'number' || typeof wallMs !== 'number') return null;
  const streams = json.streams.filter((s): s is ImuStreamInfo =>
    isObject(s) && typeof s.id === 'number' && typeof s.kind === 'string' && typeof s.axes === 'number' && s.axes > 0 &&
    typeof s.unit === 'number' && s.unit > 0 && typeof s.offset === 'number'
  );
  const setup = isObject(json.setup) ? json.setup : {};
  // Fenêtres d'un fichier élagué : des paires croissantes, sinon ignorées (toute la capture).
  const windows = Array.isArray(json.windows) && json.windows.every((w) =>
    Array.isArray(w) && w.length === 2 && typeof w[0] === 'number' && typeof w[1] === 'number' && w[0] <= w[1])
    ? (json.windows as [number, number][])
    : undefined;
  const { windows: _windows, ...rest } = json;
  return {
    ...rest,
    ...(windows ? { windows } : {}),
    format: IMU_FORMAT,
    version: json.version,
    startedAtMs: json.startedAtMs,
    clock: { elapsedUs, wallMs },
    setup: {
      placement: typeof setup.placement === 'string' ? setup.placement : 'poitrine',
      foil: setup.foil === true,
    },
    streams,
  } as ImuHeader;
};

/**
 * Lit un fichier `.imu`. Rend `null` s'il ne commence pas par la marque et un
 * en-tête lisible. Un dernier paquet incomplet est ignoré (`truncated`) ; un
 * paquet complet mais illisible est sauté (`skippedChunks`), les suivants
 * sont lus.
 */
export const decodeImu = async (bytes: Uint8Array): Promise<ImuRecording | null> => {
  const magic = asciiBytes(IMU_MAGIC);
  if (bytes.length < magic.length + 4 || magic.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(magic.length, true);
  const headerStart = magic.length + 4;
  if (headerStart + headerLength > bytes.length) return null;
  let header: ImuHeader | null;
  try {
    header = readHeader(JSON.parse(new TextDecoder().decode(bytes.subarray(headerStart, headerStart + headerLength))));
  } catch {
    return null;
  }
  if (!header) return null;

  const streams = new Map(header.streams.map((info) => [info.id, {
    info,
    t: new Growable(),
    values: Array.from({ length: info.axes }, () => new Growable()),
  }]));

  let offset = headerStart + headerLength;
  let chunks = 0;
  let skippedChunks = 0;
  let truncated = false;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) { truncated = true; break; }
    const length = view.getUint32(offset, true);
    if (offset + 4 + length > bytes.length) { truncated = true; break; }
    const compressed = bytes.subarray(offset + 4, offset + 4 + length);
    offset += 4 + length;
    let payload: Uint8Array;
    try {
      payload = await inflateRaw(compressed);
    } catch {
      skippedChunks += 1;
      continue;
    }
    if (readPayload(payload, streams)) chunks += 1;
    else skippedChunks += 1;
  }

  const series: ImuSeries[] = [...streams.values()].map((s) => ({
    info: s.info,
    t: s.t.data.slice(0, s.t.length),
    values: s.values.map((v) => Float32Array.from(v.data.subarray(0, v.length))),
  }));
  return { header, series, chunks, truncated, skippedChunks };
};

type Accumulator = Map<number, { info: ImuStreamInfo; t: Growable; values: Growable[] }>;

/** Lit les blocs d'un paquet ; faux si le paquet est mal formé (il est alors écarté en entier). */
const readPayload = (payload: Uint8Array, streams: Accumulator): boolean => {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  // Les blocs sont d'abord lus à part : un paquet mal formé n'ajoute rien.
  const blocks: { id: number; t: number[]; values: number[][] }[] = [];
  let at = 0;
  while (at < payload.length) {
    if (at + 11 > payload.length) return false;
    const id = view.getUint8(at);
    const n = view.getUint16(at + 1, true);
    const first = view.getFloat64(at + 3, true);
    at += 11;
    const info = streams.get(id)?.info;
    const axes = info?.axes ?? 0;
    const size = (n - 1) * 2 + axes * n * 2;
    // Un flux absent de l'en-tête a une taille inconnue : le paquet entier devient illisible.
    if (n < 1 || at + size > payload.length || !info) return false;
    const t: number[] = [first];
    let r = 0;
    for (let i = 1; i < n; i++) {
      r += view.getInt16(at, true);
      at += 2;
      t.push(first + r * IMU_TIME_STEP_US);
    }
    const values: number[][] = [];
    for (let a = 0; a < axes; a++) {
      const axis: number[] = [];
      let q = 0;
      for (let i = 0; i < n; i++) {
        const d = view.getInt16(at, true);
        at += 2;
        q = i === 0 ? d : ((q + d) << 16) >> 16;
        axis.push(info.offset + q * info.unit);
      }
      values.push(axis);
    }
    blocks.push({ id, t, values });
  }
  for (const block of blocks) {
    const target = streams.get(block.id)!;
    for (const t of block.t) target.t.push(t);
    block.values.forEach((axis, a) => { for (const v of axis) target.values[a].push(v); });
  }
  return true;
};

const quantize = (value: number, info: ImuStreamInfo): number =>
  Math.max(-32768, Math.min(32767, Math.round((value - info.offset) / info.unit)));

/** Blocs d'un paquet pour un flux : mesures [from, to) de la série. */
const writeBlocks = (out: number[], series: ImuSeries, from: number, to: number, exactTimes: boolean): void => {
  const { info, t, values } = series;
  let start = from;
  while (start < to) {
    // Étendre le bloc tant que les écarts d'instant tiennent en int16.
    const first = t[start];
    let end = start + 1;
    let previous = 0;
    const deltas: number[] = [];
    while (end < to && end - start < 65535) {
      const r = Math.round((t[end] - first) / IMU_TIME_STEP_US);
      const d = r - previous;
      if (d < 0 || d > 32767) break;
      if (exactTimes && Math.abs(t[end] - first - r * IMU_TIME_STEP_US) > 1e-3) break;
      deltas.push(d);
      previous = r;
      end += 1;
    }
    const n = end - start;
    const block = new DataView(new ArrayBuffer(11 + (n - 1) * 2 + info.axes * n * 2));
    block.setUint8(0, info.id);
    block.setUint16(1, n, true);
    block.setFloat64(3, first, true);
    let at = 11;
    for (const d of deltas) { block.setInt16(at, d, true); at += 2; }
    for (let a = 0; a < info.axes; a++) {
      let previousQ = 0;
      for (let i = start; i < end; i++) {
        const q = quantize(values[a][i], info);
        block.setInt16(at, i === start ? q : ((q - previousQ) << 16) >> 16, true);
        previousQ = q;
        at += 2;
      }
    }
    for (let i = 0; i < block.byteLength; i++) out.push(block.getUint8(i));
    start = end;
  }
};

/**
 * Écrit un fichier `.imu` : un paquet par `chunkS` secondes de mesures. Les
 * séries doivent avoir des instants croissants. Sert aux tests et au banc,
 * et à l'élagage ; le téléphone écrit les siens en Java, au même format.
 * `exactTimes` (élagage d'un fichier déjà lu) : un instant qui ne tombe pas
 * juste sur le pas du bloc en ouvre un autre, si bien que le fichier écrit se
 * relit avec exactement les mêmes instants.
 */
export const encodeImu = async (header: ImuHeader, series: ImuSeries[], chunkS = 1, exactTimes = false): Promise<Uint8Array> => {
  const parts: Uint8Array[] = [];
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const head = new Uint8Array(IMU_MAGIC.length + 4);
  head.set(asciiBytes(IMU_MAGIC));
  new DataView(head.buffer).setUint32(IMU_MAGIC.length, headerBytes.length, true);
  parts.push(head, headerBytes);

  // Bornes par une boucle : une séance de 2 h compte des centaines de milliers d'instants.
  let startUs = Infinity;
  let endUs = -Infinity;
  for (const s of series) {
    if (s.t.length === 0) continue;
    startUs = Math.min(startUs, s.t[0]);
    endUs = Math.max(endUs, s.t[s.t.length - 1]);
  }
  if (startUs <= endUs) {
    const stepUs = chunkS * 1e6;
    const cursor = series.map(() => 0);
    for (let chunkStart = startUs; chunkStart <= endUs; chunkStart += stepUs) {
      const out: number[] = [];
      series.forEach((s, k) => {
        const from = cursor[k];
        let to = from;
        while (to < s.t.length && s.t[to] < chunkStart + stepUs) to += 1;
        if (to > from) writeBlocks(out, s, from, to, exactTimes);
        cursor[k] = to;
      });
      if (out.length === 0) continue;
      const compressed = await deflateRaw(Uint8Array.from(out));
      const length = new Uint8Array(4);
      new DataView(length.buffer).setUint32(0, compressed.length, true);
      parts.push(length, compressed);
    }
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const file = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { file.set(p, at); at += p.length; }
  return file;
};

/**
 * Élagage : ne garde que les mesures comprises dans les fenêtres (en instants
 * du fichier, triées et disjointes), et les inscrit dans l'en-tête. Le
 * résultat s'écrit par `encodeImu`.
 */
export const selectImuWindows = (recording: ImuRecording, windows: [number, number][]): ImuRecording => ({
  ...recording,
  header: { ...recording.header, windows },
  series: recording.series.map((s) => {
    const kept: number[] = [];
    let w = 0;
    for (let i = 0; i < s.t.length; i++) {
      while (w < windows.length && windows[w][1] < s.t[i]) w += 1;
      if (w === windows.length) break;
      if (s.t[i] >= windows[w][0]) kept.push(i);
    }
    return {
      info: s.info,
      t: Float64Array.from(kept, (i) => s.t[i]),
      values: s.values.map((v) => Float32Array.from(kept, (i) => v[i])),
    };
  }),
});

export interface ImuStreamStats {
  kind: ImuStreamKind;
  count: number;
  /** Cadence médiane, en Hz ; 0 sous deux mesures. */
  rateHz: number;
  /** Plus long écart entre deux mesures, en secondes. */
  longestGapS: number;
}

export interface ImuCaptureStats {
  /** Du premier au dernier instant mesuré, tous flux confondus, en secondes. */
  durationS: number;
  /** Heure de la première mesure, en ms. */
  startMs: number | null;
  streams: ImuStreamStats[];
}

/** Durée, cadence et plus long trou de chaque flux : de quoi juger une capture. */
export const imuCaptureStats = (recording: ImuRecording): ImuCaptureStats => {
  let first = Infinity;
  let last = -Infinity;
  const streams = recording.series.map((s): ImuStreamStats => {
    const n = s.t.length;
    if (n > 0) {
      first = Math.min(first, s.t[0]);
      last = Math.max(last, s.t[n - 1]);
    }
    const gaps: number[] = [];
    let longest = 0;
    for (let i = 1; i < n; i++) {
      const dt = s.t[i] - s.t[i - 1];
      gaps.push(dt);
      if (dt > longest) longest = dt;
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 0;
    return { kind: s.info.kind, count: n, rateHz: median > 0 ? 1e6 / median : 0, longestGapS: longest / 1e6 };
  });
  return {
    durationS: last > first ? (last - first) / 1e6 : 0,
    startMs: Number.isFinite(first) ? recording.header.clock.wallMs + first / 1000 : null,
    streams,
  };
};
