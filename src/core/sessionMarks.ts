/**
 * Repères posés par le bouton « Note » pendant l'enregistrement : un instant
 * et une position, nommés ensuite dans l'analyse. Datés par l'horloge du
 * téléphone, comme les séances du compteur : ils ne se tirent pas du GPX.
 */
export interface SessionMark {
  /** Instant de l'appui, en millisecondes. */
  timeMs: number;
  lat: number;
  lon: number;
  /** Nom donné dans l'analyse, `null` s'il n'en a pas. */
  label: string | null;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

/** Un repère relu, `null` s'il est mal formé ; un nom vide vaut une absence. */
export const readSessionMark = (raw: unknown): SessionMark | null => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { timeMs, lat, lon, label } = raw as Record<string, unknown>;
  if (!isFiniteNumber(timeMs) || !isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const name = typeof label === 'string' ? label.trim() : '';
  return { timeMs, lat, lon, label: name === '' ? null : name };
};

/** Repères relus, dans l'ordre du temps ; les mal formés sont écartés, et `null` s'il n'en reste aucun. */
export const readSessionMarks = (raw: unknown): SessionMark[] | null => {
  if (!Array.isArray(raw)) return null;
  const marks = raw.map(readSessionMark).filter((m): m is SessionMark => m !== null);
  return marks.length > 0 ? sortMarks(marks) : null;
};

export const sortMarks = (marks: readonly SessionMark[]): SessionMark[] => [...marks].sort((a, b) => a.timeMs - b.timeMs);

/** Repères de la fenêtre `[fromMs, toMs]`, dans l'ordre du temps. */
export const marksWithin = (marks: readonly SessionMark[], fromMs: number, toMs: number): SessionMark[] =>
  sortMarks(marks.filter((m) => m.timeMs >= fromMs && m.timeMs <= toMs));

/** Un repère placé sur la trace. */
export interface LocatedMark {
  mark: SessionMark;
  /** Numéro, de 1, dans l'ordre du temps. */
  n: number;
  /** Point de la trace le plus proche dans le temps. */
  index: number;
  /** Distance depuis le départ à l'instant du repère, en mètres, interpolée entre les deux points qui l'encadrent. */
  distanceM: number;
}

/**
 * Place chaque repère sur la trace : point le plus proche dans le temps et
 * distance depuis le départ (`cumDist`, `buildCumulativeTrack`). Un repère
 * hors de la trace se rattache à son bout le plus proche. Rend une liste vide
 * sans trace.
 */
export const locateMarks = (
  track: ReadonlyArray<{ timeMs: number }>,
  cumDist: readonly number[],
  marks: readonly SessionMark[]
): LocatedMark[] => {
  if (track.length === 0) return [];
  return sortMarks(marks).map((mark, k) => {
    // Premier point qui n'est pas avant le repère.
    let lo = 0;
    let hi = track.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track[mid].timeMs < mark.timeMs) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return { mark, n: k + 1, index: 0, distanceM: cumDist[0] ?? 0 };
    if (lo === track.length) return { mark, n: k + 1, index: track.length - 1, distanceM: cumDist[track.length - 1] ?? 0 };
    const before = track[lo - 1].timeMs;
    const after = track[lo].timeMs;
    const f = after > before ? (mark.timeMs - before) / (after - before) : 0;
    const index = f < 0.5 ? lo - 1 : lo;
    const d0 = cumDist[lo - 1] ?? 0;
    const d1 = cumDist[lo] ?? d0;
    return { mark, n: k + 1, index, distanceM: d0 + (d1 - d0) * f };
  });
};
