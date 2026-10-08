import type { IntervalDetectionProfile } from '../core/sportProfiles';
import type { CumulativeTrack, TrackPoint } from '../core/types';
import { INTERVAL_LIMITS, type IntervalWorkout } from '../recording/intervalTimer';
import { repSpeedProfile, type IntervalPhaseSpan } from './intervalStats';

/**
 * Répétitions retrouvées dans la vitesse, pour une session de fractionné faite
 * sans le compteur (trace d'une montre, ancienne session ; §10, point 89).
 * Elles sortent sous la forme des phases du compteur (`IntervalPhaseSpan`),
 * rangées en séances : la suite de l'analyse ne fait pas la différence.
 *
 * 1. La vitesse est lue seconde par seconde (`stepS`) sur la distance cumulée
 *    (règle 6), pas point par point : une application économe ne pose un
 *    point qu'à chaque dizaine de mètres, si bien qu'un seul point peut
 *    couvrir 20 s de récupération quand l'effort en compte un toutes les 2 s
 *    (règle 10, essai sur une trace Komoot réelle, 08/10). Elle est lissée sur
 *    `smoothingS`.
 * 2. Le seuil d'effort est tiré de la session : celui qui sépare au mieux
 *    vitesses lentes et rapides (méthode d'Otsu sur les secondes en
 *    mouvement). Sans écart assez net (`minContrast`), la session n'a pas
 *    l'allure d'un fractionné. Si les rapides se séparent encore nettement en
 *    deux (`upperContrast` : le footing d'approche et les efforts), le seuil
 *    monte entre eux : les efforts sont les plus rapides. Il se surcharge par
 *    session.
 * 3. On entre dans un effort au seuil, on en sort sous le seuil diminué de
 *    `exitFraction` ; les bornes sont relues sur la vitesse non lissée.
 * 4. Un creux plus court que `minDipS` est fondu dans l'effort, un effort plus
 *    court que `minWorkS` est écarté. Sur la trace Komoot du 21/07, un effort
 *    de 10 s n'en montre que 3 à 6 : le reste tombe dans le long segment de la
 *    récupération.
 * 5. Chaque effort part du creux de vitesse qui le précède, cherché sur
 *    `launchSearchS` : la mise en vitesse se mesure comme avec le compteur, qui
 *    part au signal.
 * 6. Les efforts se rangent en séances : un repos plus long que
 *    `blockMinGapS` et que `blockGapFactor` fois le repos médian en ouvre une
 *    nouvelle (10/10, puis 20/20). Dans une séance, un effort plus court que
 *    `minWorkFraction` de la durée médiane est une accélération d'échauffement,
 *    écartée. Une séance d'un seul effort n'est gardée que s'il n'y en a pas
 *    d'autre.
 * L'échauffement et le retour au calme, plus lents que le seuil, s'écartent
 * d'eux-mêmes ; un repos est le temps entre deux efforts.
 */

/** Pourquoi aucune répétition n'est trouvée. */
export type DetectionMiss = 'peu-de-points' | 'sans-contraste' | 'aucun-effort';

/** Une séance retrouvée : ses phases, et la séance déduite pour l'affichage. */
export interface DetectedSeries {
  /** Nombre d'efforts, durées médianes arrondies à 5 s. */
  workout: IntervalWorkout;
  /** Travail et repos de chaque répétition, numérotées depuis 1. */
  phases: IntervalPhaseSpan[];
}

export interface DetectedIntervals {
  /** Seuil tiré de la session, en m/s ; `null` sans assez de mouvement. */
  suggestedThresholdMs: number | null;
  /** Seuil appliqué : la surcharge, sinon la suggestion. */
  thresholdMs: number | null;
  /** Vitesse moyenne des rapides sur celle des lents, de part et d'autre de la suggestion. */
  contrast: number | null;
  series: DetectedSeries[];
  miss: DetectionMiss | null;
}

interface OtsuSplit {
  threshold: number;
  lowMean: number;
  highMean: number;
  /** Poids total des valeurs au-dessus du seuil. */
  highWeight: number;
}

/**
 * Seuil d'Otsu de valeurs pondérées : celui qui maximise l'écart entre les
 * deux groupes qu'il sépare, au milieu de deux valeurs voisines. Avec la
 * moyenne de chaque groupe ; `null` s'il n'y a pas deux valeurs distinctes.
 */
export const otsuThreshold = (values: number[], weights: number[]): OtsuSplit | null => {
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] }))
    .filter((p) => p.w > 0 && isFinite(p.v))
    .sort((a, b) => a.v - b.v);
  const totalW = pairs.reduce((sum, p) => sum + p.w, 0);
  const totalS = pairs.reduce((sum, p) => sum + p.v * p.w, 0);
  let w0 = 0;
  let s0 = 0;
  let best = -1;
  let result: OtsuSplit | null = null;
  for (let i = 0; i < pairs.length - 1; i++) {
    w0 += pairs[i].w;
    s0 += pairs[i].v * pairs[i].w;
    if (pairs[i + 1].v === pairs[i].v) continue;
    const w1 = totalW - w0;
    if (w1 <= 0) break;
    const lowMean = s0 / w0;
    const highMean = (totalS - s0) / w1;
    const between = w0 * w1 * (highMean - lowMean) ** 2;
    if (between > best) {
      best = between;
      result = { threshold: (pairs[i].v + pairs[i + 1].v) / 2, lowMean, highMean, highWeight: w1 };
    }
  }
  return result;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Durée en secondes arrondie à 5 s, ramenée dans les bornes du compteur. */
const roundDuration = (seconds: number, limits: { min: number; max: number }): number =>
  Math.min(limits.max, Math.max(limits.min, Math.round(seconds / 5) * 5));

/** Séance déduite et phases numérotées d'une suite d'efforts, en instants. */
const toSeries = (efforts: { startMs: number; endMs: number }[]): DetectedSeries => {
  const phases: IntervalPhaseSpan[] = [];
  efforts.forEach((effort, j) => {
    phases.push({ kind: 'travail', rep: j + 1, startMs: effort.startMs, endMs: effort.endMs });
    const next = efforts[j + 1];
    if (next && next.startMs > effort.endMs) phases.push({ kind: 'repos', rep: j + 1, startMs: effort.endMs, endMs: next.startMs });
  });
  const works = efforts.map((e) => (e.endMs - e.startMs) / 1000);
  const rests = efforts.slice(1).map((e, j) => Math.max(0, (e.startMs - efforts[j].endMs) / 1000));
  return {
    workout: {
      reps: Math.min(INTERVAL_LIMITS.reps.max, efforts.length),
      workS: roundDuration(median(works), INTERVAL_LIMITS.workS),
      restS: rests.length > 0 ? roundDuration(median(rests), INTERVAL_LIMITS.restS) : 0,
    },
    phases,
  };
};

export const detectIntervals = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  activityMask: boolean[],
  params: IntervalDetectionProfile,
  thresholdOverrideMs: number | null = null
): DetectedIntervals => {
  const none = (miss: DetectionMiss, suggested: number | null = null, threshold: number | null = null, contrast: number | null = null): DetectedIntervals => ({
    suggestedThresholdMs: suggested, thresholdMs: threshold, contrast, series: [], miss,
  });
  if (track.length < 2 || !(params.stepS > 0)) return none('peu-de-points');
  const stepMs = params.stepS * 1000;
  const t0 = track[0].timeMs;
  const count = Math.floor((track[track.length - 1].timeMs - t0) / stepMs);
  if (count < 2) return none('peu-de-points');

  // Vitesse de chaque seconde, et si elle est en mouvement (le point qui clôt le segment où elle tombe).
  const raw = repSpeedProfile(track, cum, t0, t0 + count * stepMs, params.stepS).map((v) => v ?? 0);
  const binStart = (k: number) => t0 + k * stepMs;
  const moving: boolean[] = [];
  for (let k = 0, i = 0; k < raw.length; k++) {
    const mid = binStart(k) + stepMs / 2;
    while (i < track.length - 1 && track[i].timeMs < mid) i++;
    moving.push(activityMask[i] ?? false);
  }
  const half = Math.floor(Math.max(1, Math.round(params.smoothingS / params.stepS)) / 2);
  const speeds = raw.map((_, k) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(raw.length - 1, k + half); j++) {
      sum += raw[j];
      n += 1;
    }
    return sum / n;
  });

  // Seuil : Otsu sur les secondes en mouvement, puis parmi les rapides tant qu'ils se séparent nettement.
  const weights = moving.map((m) => (m ? params.stepS : 0));
  const movingS = weights.reduce((sum, w) => sum + w, 0);
  let split = movingS >= 2 * params.minWorkS ? otsuThreshold(speeds, weights) : null;
  const contrastOf = (s: OtsuSplit) => (s.lowMean > 0 ? s.highMean / s.lowMean : Infinity);
  if (split && contrastOf(split) >= params.minContrast) {
    for (;;) {
      const above = split.threshold;
      const upper = otsuThreshold(speeds, weights.map((w, k) => (speeds[k] >= above ? w : 0)));
      if (!upper || contrastOf(upper) < params.upperContrast || upper.highWeight < 2 * params.minWorkS) break;
      split = upper;
    }
  }
  const suggested = split?.threshold ?? null;
  const contrast = split ? contrastOf(split) : null;
  const overridden = thresholdOverrideMs !== null && thresholdOverrideMs > 0;
  const threshold = overridden ? thresholdOverrideMs : suggested;
  if (threshold === null) return none('peu-de-points');
  if (!overridden && (contrast === null || contrast < params.minContrast)) return none('sans-contraste', suggested, threshold, contrast);

  // Efforts : au-dessus du seuil, jusqu'à repasser sous la détente de sortie.
  const exit = threshold * (1 - params.exitFraction);
  const spans: { from: number; to: number }[] = [];
  let open: number | null = null;
  speeds.forEach((v, k) => {
    if (open === null && v >= threshold) open = k;
    else if (open !== null && v < exit) {
      spans.push({ from: open, to: k });
      open = null;
    }
  });
  if (open !== null) spans.push({ from: open, to: speeds.length });
  // Bornes relues sur la vitesse non lissée : le lissage rogne un effort court d'une seconde de chaque côté.
  for (const span of spans) {
    while (span.from > 0 && raw[span.from - 1] >= exit) span.from -= 1;
    while (span.to < raw.length && raw[span.to] >= exit) span.to += 1;
  }

  // Creux courts fondus, efforts courts écartés.
  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && (span.from - previous.to) * params.stepS < params.minDipS) previous.to = span.to;
    else merged.push({ ...span });
  }
  const kept = merged.filter((s) => (s.to - s.from) * params.stepS >= params.minWorkS);
  if (kept.length === 0) return none('aucun-effort', suggested, threshold, contrast);

  // Départ ramené au creux qui précède (sur un creux plat, sa dernière seconde), sans remonter dans
  // l'effort d'avant ; la vitesse lissée, centrée, monte un peu avant la vraie.
  const searchBins = Math.round(params.launchSearchS / params.stepS);
  const efforts = kept.map((span, j) => {
    const floor = Math.max(0, span.from - searchBins, j > 0 ? kept[j - 1].to : 0);
    const last = Math.min(span.from + half, span.to - 1);
    let lowest = floor;
    for (let k = floor; k <= last; k++) if (raw[k] <= raw[lowest]) lowest = k;
    return { startMs: binStart(Math.min(lowest + 1, span.to - 1)), endMs: binStart(span.to) };
  });

  // Séances : un repos bien plus long que les autres en ouvre une nouvelle.
  const rests = efforts.slice(1).map((e, j) => (e.startMs - efforts[j].endMs) / 1000);
  const gap = rests.length > 0 ? Math.max(params.blockMinGapS, params.blockGapFactor * median(rests)) : Infinity;
  const blocks: { startMs: number; endMs: number }[][] = [[efforts[0]]];
  efforts.slice(1).forEach((effort, j) => {
    if (rests[j] > gap) blocks.push([effort]);
    else blocks[blocks.length - 1].push(effort);
  });
  // Dans une séance, un effort bien plus court que les autres est une accélération, pas une répétition.
  const trimmed = blocks.map((block) => {
    const typical = median(block.map((e) => e.endMs - e.startMs));
    return block.filter((e) => e.endMs - e.startMs >= params.minWorkFraction * typical);
  });
  const several = trimmed.filter((b) => b.length > 1);
  const series = (several.length > 0 ? several : trimmed.filter((b) => b.length > 0)).map(toSeries);
  return { suggestedThresholdMs: suggested, thresholdMs: threshold, contrast, series, miss: null };
};
