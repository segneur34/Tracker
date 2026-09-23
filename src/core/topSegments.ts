import type { CumulativeTrack, TopSegment, TopTarget, TrackPoint } from './types';

/** Nombre de meilleurs segments retenus par cible. */
export const DEFAULT_TOP_COUNT = 3;

export interface TopSegmentOptions {
  /** Nombre de segments retenus. */
  count?: number;
  /** Décimales du libellé. */
  decimals?: number;
}

/** Interpolation linéaire d'une série au passage d'un seuil sur une autre série. */
const interpolateAt = (
  reference: number[],
  target: number,
  values: number[],
  lower: number,
  upper: number
): number => {
  const span = reference[upper] - reference[lower];
  if (span <= 0) return values[upper];

  const ratio = (target - reference[lower]) / span;
  return values[lower] + ratio * (values[upper] - values[lower]);
};

/**
 * Recherche les meilleurs segments d'une trace, sur une cible de temps ou de
 * distance, en écartant les segments qui se chevauchent.
 *
 * Une seule définition, quelle que soit la cible : la vitesse d'un segment est
 * la distance parcourue divisée par la durée écoulée. C'est la convention des
 * records de vitesse GPS, et elle reste juste même quand l'échantillonnage est
 * irrégulier, contrairement à une moyenne des vitesses instantanées point par
 * point qui donnerait un poids identique à des intervalles de durées
 * différentes.
 *
 * La borne de fin est interpolée : pour un top sur 10 secondes, on ne prend
 * pas le point le plus proche de la dixième seconde, on calcule la distance à
 * la dixième seconde exactement.
 */
export const computeTopSegments = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  target: TopTarget,
  toDisplaySpeed: (speedMs: number) => number,
  options: TopSegmentOptions = {}
): TopSegment[] => {
  const count = options.count ?? DEFAULT_TOP_COUNT;
  const decimals = options.decimals ?? 2;

  const { cumDist, cumTime } = cum;
  const isDistance = target.kind === 'distance';
  const reference = isDistance ? cumDist : cumTime;
  const windows: { start: number; end: number; val: number }[] = [];

  let j = 1;

  for (let i = 0; i < track.length - 1; i++) {
    const threshold = reference[i] + target.value;

    if (j <= i) j = i + 1;
    while (j < track.length && reference[j] < threshold) j++;
    if (j >= track.length) break;

    let distance: number;
    let duration: number;

    if (isDistance) {
      const endTime = interpolateAt(cumDist, threshold, cumTime, j - 1, j);
      distance = target.value;
      duration = endTime - cumTime[i];
    } else {
      const endDist = interpolateAt(cumTime, threshold, cumDist, j - 1, j);
      distance = endDist - cumDist[i];
      duration = target.value;
    }

    if (duration > 0 && distance > 0) {
      windows.push({ start: i, end: j, val: toDisplaySpeed(distance / duration) });
    }
  }

  windows.sort((a, b) => b.val - a.val);

  const tops: TopSegment[] = [];
  const selected: { start: number; end: number }[] = [];

  for (const w of windows) {
    if (tops.length >= count) break;
    const overlap = selected.some((s) => Math.max(w.start, s.start) <= Math.min(w.end, s.end));
    if (!overlap) {
      const path = track.slice(w.start, w.end + 1).map((p) => [p.lat, p.lon] as [number, number]);
      tops.push({ val: w.val.toFixed(decimals), path });
      selected.push({ start: w.start, end: w.end });
    }
  }

  while (tops.length < count) tops.push({ val: '-', path: [] });
  return tops;
};

/** Applique `computeTopSegments` à une liste de cibles et indexe le résultat par clé. */
export const computeAllTopSegments = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  targets: TopTarget[],
  toDisplaySpeed: (speedMs: number) => number,
  options: TopSegmentOptions = {}
): Record<string, TopSegment[]> => {
  const result: Record<string, TopSegment[]> = {};
  for (const target of targets) {
    result[target.key] = computeTopSegments(track, cum, target, toDisplaySpeed, options);
  }
  return result;
};
