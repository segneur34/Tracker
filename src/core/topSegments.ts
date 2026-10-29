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
 *
 * Une fenêtre qui contient un trou de la trace (pas qui porte `gapDistanceM`)
 * est écartée : sur un pas plus long que la cible, sa vitesse n'est que celle
 * du point de reprise, une seule mesure (27/10).
 */
export const computeTopSegments = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  target: TopTarget,
  toDisplaySpeed: (speedMs: number) => number,
  options: TopSegmentOptions = {}
): TopSegment[] => computeTopSegmentsWith(track, cum, target, toDisplaySpeed, options, holeCounts(track));

/**
 * Nombre de trous parmi les pas qui mènent aux points 1 à k : la fenêtre
 * [i, j] en contient un si `gapCount[j] > gapCount[i]`.
 */
const holeCounts = (track: TrackPoint[]): Int32Array => {
  const gapCount = new Int32Array(track.length);
  for (let k = 1; k < track.length; k++) {
    gapCount[k] = gapCount[k - 1] + (track[k].gapDistanceM !== undefined ? 1 : 0);
  }
  return gapCount;
};

const computeTopSegmentsWith = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  target: TopTarget,
  toDisplaySpeed: (speedMs: number) => number,
  options: TopSegmentOptions,
  gapCount: Int32Array
): TopSegment[] => {
  const count = options.count ?? DEFAULT_TOP_COUNT;
  const decimals = options.decimals ?? 2;

  const { cumDist, cumTime } = cum;
  const isDistance = target.kind === 'distance';
  const reference = isDistance ? cumDist : cumTime;
  // Fenêtres en tableaux typés (lot 56) : une par point au plus.
  const capacity = Math.max(0, track.length - 1);
  const starts = new Int32Array(capacity);
  const ends = new Int32Array(capacity);
  const vals = new Float64Array(capacity);
  let size = 0;

  let j = 1;

  for (let i = 0; i < track.length - 1; i++) {
    const threshold = reference[i] + target.value;

    if (j <= i) j = i + 1;
    while (j < track.length && reference[j] < threshold) j++;
    if (j >= track.length) break;
    if (gapCount[j] > gapCount[i]) continue;

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
      // Classées dans l'unité d'affichage, comme avant : deux vitesses distinctes en m/s peuvent y devenir égales.
      starts[size] = i;
      ends[size] = j;
      vals[size] = toDisplaySpeed(distance / duration);
      size++;
    }
  }

  const tops: TopSegment[] = [];
  for (const k of pickTopWindows(starts, ends, vals, size, count)) {
    const path = track.slice(starts[k], ends[k] + 1).map((p) => [p.lat, p.lon] as [number, number]);
    tops.push({ val: vals[k].toFixed(decimals), speed: vals[k], path });
  }

  while (tops.length < count) tops.push({ val: '-', speed: null, path: [] });
  return tops;
};

/**
 * Indices des `count` meilleures fenêtres `[starts[k], ends[k]]` (`k < size`)
 * qui ne se chevauchent pas, de la meilleure à la moins bonne : à chaque tour,
 * la plus grande valeur parmi celles qui ne touchent aucune retenue, la
 * première à égalité. C'est le résultat d'un tri stable décroissant parcouru
 * dans l'ordre, sans trier (lot 56). Une valeur NaN rend le tri imprévisible :
 * au-delà d'une fenêtre, on garde alors le tri. Meilleurs segments, podium de la VMG.
 */
export const pickTopWindows = (
  starts: ArrayLike<number>,
  ends: ArrayLike<number>,
  values: ArrayLike<number>,
  size: number,
  count: number
): number[] => {
  const selected: number[] = [];
  const overlaps = (k: number): boolean => {
    for (const s of selected) if (Math.max(starts[k], starts[s]) <= Math.min(ends[k], ends[s])) return true;
    return false;
  };

  let hasNaN = false;
  for (let k = 0; k < size; k++) if (Number.isNaN(values[k])) hasNaN = true;
  if (hasNaN && count !== 1) {
    const order = Array.from({ length: size }, (_, k) => k).sort((a, b) => values[b] - values[a]);
    for (const k of order) {
      if (selected.length >= count) break;
      if (!overlaps(k)) selected.push(k);
    }
    return selected;
  }

  while (selected.length < count) {
    let best = -1;
    for (let k = 0; k < size; k++) {
      if ((best < 0 || values[k] > values[best]) && !overlaps(k)) best = k;
    }
    if (best < 0) break;
    selected.push(best);
  }
  return selected;
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
  const gapCount = holeCounts(track);
  for (const target of targets) {
    result[target.key] = computeTopSegmentsWith(track, cum, target, toDisplaySpeed, options, gapCount);
  }
  return result;
};
