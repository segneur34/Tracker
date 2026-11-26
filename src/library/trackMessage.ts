import type { PreparedTrack } from '../core/prepareTrack';
import type { SpeedSource, TrackPoint } from '../core/types';

/**
 * Trace préparée mise en colonnes pour traverser un message du worker vers la page (lot 235). Recopier 54 000 objets
 * d'un fil à l'autre (3 h à 5 Hz) figeait la page plus d'une seconde, processeur ralenti six fois, à la seule
 * réception : en colonnes, un tableau typé par champ, transférés sans copie, et les heures en un seul texte, la page
 * refait ses objets en une boucle. Les objets refaits sont ceux de `computeKinematics`, champ pour champ et dans le
 * même ordre (`ele`, `hr` et `cadence` toujours présents, au besoin `undefined` ; `courseDeg`, `segmentStart` et
 * `gapDistanceM` seulement quand ils existent) : une trace d'une autre forme part telle quelle, sans colonnes.
 */

/** Bits de `flags`, un octet par point. */
const ELE = 1;
const HR = 2;
const CADENCE = 4;
const COURSE = 8;
const SEGMENT_START = 16;
const GAP = 32;

/** Les champs d'une trace en colonnes. */
export interface TrackColumns {
  lat: Float64Array;
  lon: Float64Array;
  timeMs: Float64Array;
  ele: Float64Array;
  hr: Float64Array;
  cadence: Float64Array;
  speedMs: Float64Array;
  smoothedSpeedMs: Float64Array;
  bearing: Float64Array;
  courseDeg: Float64Array;
  gapDistanceM: Float64Array;
  /** Champs présents de chaque point (`ELE`, `HR`…). */
  flags: Uint8Array;
  /** Rang de la provenance de la vitesse de chaque point dans `sources`. */
  source: Uint8Array;
  sources: SpeedSource[];
  /** Heures en texte de tous les points, mises bout à bout ; `timeEnds[i]` : fin de celle du point `i`. */
  timeText: string;
  timeEnds: Uint32Array;
}

/** Ce que le worker renvoie pour `prepare` : la trace préparée, ses points en colonnes s'ils en ont la forme. */
export interface PreparedTrackMessage {
  packedTrack: true;
  rest: Omit<PreparedTrack, 'track' | 'cumulative'>;
  /** Points en colonnes ; `null` : trace d'une autre forme, rendue telle quelle dans `track`. */
  columns: TrackColumns | null;
  track: TrackPoint[] | null;
  cumDist: Float64Array;
  cumTime: Float64Array;
}

/** Clés d'un point de `computeKinematics`, dans leur ordre, d'après ses champs facultatifs présents. */
const keysOf = (flags: number): string[] => [
  'lat', 'lon', 'time', 'timeMs', 'ele', 'hr', 'cadence', 'speedMs', 'smoothedSpeedMs', 'bearing',
  ...(flags & COURSE ? ['courseDeg'] : []),
  'speedSource',
  ...(flags & SEGMENT_START ? ['segmentStart'] : []),
  ...(flags & GAP ? ['gapDistanceM'] : []),
];

/** Mêmes clés, dans le même ordre. */
const sameKeys = (actual: string[], expected: string[]): boolean =>
  actual.length === expected.length && actual.every((k, i) => k === expected[i]);

/** Nombre, ou absent (`undefined`) si `optional`. */
const isNumber = (value: unknown, optional = false): boolean => typeof value === 'number' || (optional && value === undefined);

/** Points en colonnes ; `null` si l'un d'eux n'a pas la forme d'un point de `computeKinematics`. */
export const trackColumns = (track: readonly TrackPoint[]): TrackColumns | null => {
  const n = track.length;
  const columns: TrackColumns = {
    lat: new Float64Array(n), lon: new Float64Array(n), timeMs: new Float64Array(n), ele: new Float64Array(n),
    hr: new Float64Array(n), cadence: new Float64Array(n), speedMs: new Float64Array(n), smoothedSpeedMs: new Float64Array(n),
    bearing: new Float64Array(n), courseDeg: new Float64Array(n), gapDistanceM: new Float64Array(n),
    flags: new Uint8Array(n), source: new Uint8Array(n), sources: [], timeText: '', timeEnds: new Uint32Array(n),
  };
  const times: string[] = [];
  let textLength = 0;
  for (let i = 0; i < n; i++) {
    const p = track[i];
    if (typeof p.time !== 'string' || typeof p.speedSource !== 'string') return null;
    if (![p.lat, p.lon, p.timeMs, p.speedMs, p.smoothedSpeedMs, p.bearing].every((v) => isNumber(v))) return null;
    if (![p.ele, p.hr, p.cadence].every((v) => isNumber(v, true))) return null;
    if (('courseDeg' in p && !isNumber(p.courseDeg)) || ('gapDistanceM' in p && !isNumber(p.gapDistanceM))) return null;
    let flags = 0;
    if (p.ele !== undefined) flags |= ELE;
    if (p.hr !== undefined) flags |= HR;
    if (p.cadence !== undefined) flags |= CADENCE;
    if ('courseDeg' in p) flags |= COURSE;
    if (p.segmentStart === true) flags |= SEGMENT_START;
    if ('gapDistanceM' in p) flags |= GAP;
    if (!sameKeys(Object.keys(p), keysOf(flags))) return null;
    columns.lat[i] = p.lat;
    columns.lon[i] = p.lon;
    columns.timeMs[i] = p.timeMs;
    columns.ele[i] = p.ele ?? 0;
    columns.hr[i] = p.hr ?? 0;
    columns.cadence[i] = p.cadence ?? 0;
    columns.speedMs[i] = p.speedMs;
    columns.smoothedSpeedMs[i] = p.smoothedSpeedMs;
    columns.bearing[i] = p.bearing;
    columns.courseDeg[i] = p.courseDeg ?? 0;
    columns.gapDistanceM[i] = p.gapDistanceM ?? 0;
    columns.flags[i] = flags;
    let rank = columns.sources.indexOf(p.speedSource);
    if (rank < 0) {
      rank = columns.sources.length;
      columns.sources.push(p.speedSource);
    }
    columns.source[i] = rank;
    times.push(p.time);
    textLength += p.time.length;
    columns.timeEnds[i] = textLength;
  }
  columns.timeText = times.join('');
  return columns;
};

/** Points refaits de leurs colonnes : les objets de `computeKinematics`, champ pour champ et dans le même ordre. */
export const pointsFromColumns = (c: TrackColumns): TrackPoint[] => {
  const n = c.flags.length;
  const track: TrackPoint[] = new Array(n);
  let start = 0;
  for (let i = 0; i < n; i++) {
    const flags = c.flags[i];
    const end = c.timeEnds[i];
    // Champs posés un à un, dans l'ordre de `computeKinematics` : sans objet intermédiaire à recopier.
    const point = {
      lat: c.lat[i],
      lon: c.lon[i],
      time: c.timeText.slice(start, end),
      timeMs: c.timeMs[i],
      ele: flags & ELE ? c.ele[i] : undefined,
      hr: flags & HR ? c.hr[i] : undefined,
      cadence: flags & CADENCE ? c.cadence[i] : undefined,
      speedMs: c.speedMs[i],
      smoothedSpeedMs: c.smoothedSpeedMs[i],
      bearing: c.bearing[i],
    } as TrackPoint;
    if (flags & COURSE) point.courseDeg = c.courseDeg[i];
    point.speedSource = c.sources[c.source[i]];
    if (flags & SEGMENT_START) point.segmentStart = true;
    if (flags & GAP) point.gapDistanceM = c.gapDistanceM[i];
    track[i] = point;
    start = end;
  }
  return track;
};

/** La trace préparée, prête à traverser un message. */
export const packPreparedTrack = ({ track, cumulative, ...rest }: PreparedTrack): PreparedTrackMessage => {
  const columns = trackColumns(track);
  return {
    packedTrack: true,
    rest,
    columns,
    track: columns ? null : track,
    cumDist: Float64Array.from(cumulative.cumDist),
    cumTime: Float64Array.from(cumulative.cumTime),
  };
};

/** La trace préparée refaite de son message : la même, à l'égalité stricte. */
export const unpackPreparedTrack = ({ rest, columns, track, cumDist, cumTime }: PreparedTrackMessage): PreparedTrack => ({
  ...rest,
  track: columns ? pointsFromColumns(columns) : (track ?? []),
  cumulative: { cumDist: Array.from(cumDist), cumTime: Array.from(cumTime) },
});

/** Vrai pour un message de trace préparée (`packPreparedTrack`). */
export const isPreparedTrackMessage = (value: unknown): value is PreparedTrackMessage =>
  typeof value === 'object' && value !== null && (value as Partial<PreparedTrackMessage>).packedTrack === true;

/** Mémoires des tableaux d'un message de trace préparée, à transférer sans copie : le worker ne les garde pas. */
export const preparedTrackTransfer = ({ columns, cumDist, cumTime }: PreparedTrackMessage): ArrayBuffer[] => {
  const arrays: ArrayBufferView[] = [cumDist, cumTime];
  if (columns) {
    arrays.push(
      columns.lat, columns.lon, columns.timeMs, columns.ele, columns.hr, columns.cadence, columns.speedMs, columns.smoothedSpeedMs,
      columns.bearing, columns.courseDeg, columns.gapDistanceM, columns.flags, columns.source, columns.timeEnds
    );
  }
  return arrays.map((a) => a.buffer as ArrayBuffer);
};
