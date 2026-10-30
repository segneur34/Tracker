import { sampledIndices } from './chartZoom';
import { heartRateStats, smoothHeartRate, timeInZones, type HeartRatePoint, type HeartRateStats } from './heartRate';
import { pointTimeMs } from './kinematics';
import type { HeartRateProfile } from './sportProfiles';
import type { TimedTrackPoint } from './types';
import type { IntervalSeries } from './domainTypes';

/**
 * Analyse d'une session sans trace (muscu, lot I du 25/10) : la FC de la
 * ceinture et les phases du compteur posées dessus, sans position ni
 * cinématique. Tout se mesure en temps (règle 2) : la même séance à 1 Hz ou
 * à mesures irrégulières donne les mêmes chiffres. Les phases viennent de la
 * fiche (`record.intervals`, écrites à l'arrêt depuis le journal), jamais
 * recalculées ; elles sont seulement bornées à la session.
 */

/** Point d'une session sans trace : l'heure, la FC éventuelle, et la reprise après une pause. */
export interface HeartRateSessionPoint extends HeartRatePoint {
  segmentStart?: true;
}

/**
 * Points horodatés lus dans le GPX (`ParsedGpx.timedPoints`), en millisecondes ;
 * un point à l'heure illisible, ou qui n'est pas plus tard que le précédent, est
 * écarté (sa reprise passe au suivant gardé).
 */
export const heartRatePointsFrom = (timed: readonly TimedTrackPoint[]): HeartRateSessionPoint[] => {
  const out: HeartRateSessionPoint[] = [];
  let resume = false;
  for (const p of timed) {
    resume ||= p.segmentStart === true;
    const timeMs = pointTimeMs(p.time);
    if (!isFinite(timeMs) || (out.length > 0 && timeMs <= out[out.length - 1].timeMs)) continue;
    out.push({ timeMs, ...(p.hr !== undefined ? { hr: p.hr } : {}), ...(resume && out.length > 0 ? { segmentStart: true as const } : {}) });
    resume = false;
  }
  return out;
};

/** Durée hors pauses, en secondes : la somme des pas, sauf celui qui mène à une reprise. */
export const activeDurationS = (points: readonly HeartRateSessionPoint[]): number => {
  let totalMs = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].segmentStart) continue;
    totalMs += points[i].timeMs - points[i - 1].timeMs;
  }
  return totalMs / 1000;
};

/** Une phase du compteur posée sur la FC, bornée à la session. */
export interface SessionPhase {
  kind: 'travail' | 'repos' | 'libre';
  /** Répétition, de 1, dans son bloc. */
  rep: number;
  startMs: number;
  endMs: number;
}

/** Phases des séances, bornées à `[startMs, endMs]`, dans l'ordre du temps ; une phase hors de la session est omise. */
export const sessionPhases = (series: readonly IntervalSeries[], startMs: number, endMs: number): SessionPhase[] =>
  series
    .flatMap((s) => s.laps)
    .filter((lap) => lap.endMs > startMs && lap.startMs < endMs)
    .map((lap) => ({ kind: lap.kind, rep: lap.rep, startMs: Math.max(lap.startMs, startMs), endMs: Math.min(lap.endMs, endMs) }))
    .sort((a, b) => a.startMs - b.startMs);

/** Répétitions faites : les phases de travail des séances, comme la ligne de la bibliothèque les compte. */
export const repsDone = (series: readonly IntervalSeries[] | null | undefined): number =>
  series?.reduce((n, s) => n + s.laps.filter((lap) => lap.kind === 'travail').length, 0) ?? 0;

export interface HeartRateSessionAnalysis {
  startMs: number;
  endMs: number;
  /** Durée hors pauses, en secondes. */
  durationS: number;
  /** FC lissée, point par point (`smoothHeartRate`). */
  smoothed: (number | null)[];
  /** FC moyenne, max et temps couvert ; `null` sans FC. */
  stats: HeartRateStats | null;
  /** Secondes de « sous Z1 » à Z5 ; `null` sans zones. */
  zoneTimes: number[] | null;
  phases: SessionPhase[];
  reps: number;
}

/**
 * Analyse d'une session sans trace ; `null` à moins de deux points. FC lissée
 * sur `smoothS`, trou de plus de `gapS` ni compté ni tracé (profil du calcul).
 */
export const analyzeHeartRateSession = (
  points: readonly HeartRateSessionPoint[],
  series: readonly IntervalSeries[],
  params: Pick<HeartRateProfile, 'smoothS' | 'gapS'>,
  zoneBounds: readonly number[] | null
): HeartRateSessionAnalysis | null => {
  if (points.length < 2) return null;
  const startMs = points[0].timeMs;
  const endMs = points[points.length - 1].timeMs;
  const smoothed = smoothHeartRate(points, params.smoothS, params.gapS);
  const stats = heartRateStats(points, smoothed, params.gapS);
  return {
    startMs,
    endMs,
    durationS: activeDurationS(points),
    smoothed,
    stats,
    zoneTimes: zoneBounds && stats ? timeInZones(points, smoothed, zoneBounds, params.gapS) : null,
    phases: sessionPhases(series, startMs, endMs),
    reps: repsDone(series),
  };
};

/**
 * Courbe de FC d'une vignette (bibliothèque), en chemin SVG dans un cadre
 * `width` × `height` : le temps en abscisse, la FC lissée en ordonnée, de la
 * plus basse (en bas) à la plus haute ; `maxPoints` points au plus, coupée là
 * où la FC manque. `null` sans deux FC.
 */
export const heartRatePreviewPath = (
  points: readonly HeartRatePoint[],
  smoothed: readonly (number | null)[],
  width: number,
  height: number,
  maxPoints: number
): string | null => {
  const shown = smoothed.filter((v): v is number => v !== null);
  if (shown.length < 2 || points.length < 2) return null;
  const t0 = points[0].timeMs;
  const spanMs = Math.max(1, points[points.length - 1].timeMs - t0);
  // Boucle plutôt que Math.min(...série) : une longue séance dépasserait la
  // limite d'arguments d'un appel de fonction.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of shown) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const spanBpm = Math.max(1, hi - lo);
  const parts: string[] = [];
  let pen = false;
  for (const i of sampledIndices(0, points.length - 1, maxPoints, smoothed)) {
    const bpm = smoothed[i];
    if (bpm === null) {
      pen = false;
      continue;
    }
    const x = ((points[i].timeMs - t0) / spanMs) * width;
    const y = height - ((bpm - lo) / spanBpm) * height;
    parts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    pen = true;
  }
  return parts.length > 1 ? parts.join('') : null;
};
