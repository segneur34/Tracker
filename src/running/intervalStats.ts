import type { CumulativeTrack, TrackPoint } from '../core/types';

/**
 * Mesure des phases d'une séance du compteur sur la trace analysée
 * (fractionné, §10, point 89). Les phases sont datées par l'horloge du
 * téléphone (`recording/intervalTimer.ts`), la trace par le GPS : on lit la
 * trace aux instants des phases, sans rien supposer du nombre de points entre
 * eux (règle 10). La distance est celle de la trace (intégrale de la vitesse
 * retenue, règle 6), interpolée aux bornes ; pas celle du direct.
 */

/** Une phase, telle que la fiche la garde. */
export interface IntervalPhaseSpan {
  kind: 'travail' | 'repos';
  rep: number;
  startMs: number;
  endMs: number;
}

export interface IntervalPhaseStats extends IntervalPhaseSpan {
  durationS: number;
  /** Distance sur la trace, en mètres ; `null` si la phase tombe hors de la trace. */
  distanceM: number | null;
  /** Vitesse moyenne, en m/s ; `null` hors de la trace. */
  speedMs: number | null;
  /** Tracé de la phase, bornes interpolées comprises, pour la carte. */
  path: [number, number][];
}

/** Indice du dernier point à l'instant `t` ou avant, `-1` avant la trace. */
const lastIndexAtOrBefore = (track: TrackPoint[], t: number): number => {
  let lo = 0;
  let hi = track.length - 1;
  if (track.length === 0 || t < track[0].timeMs) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (track[mid].timeMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};

/** Distance cumulée et position à l'instant `t`, interpolées entre les deux points qui l'encadrent ; `t` est ramené dans la trace. */
const sampleAt = (track: TrackPoint[], cum: CumulativeTrack, t: number): { distM: number; at: [number, number] } => {
  const i = lastIndexAtOrBefore(track, t);
  if (i < 0) return { distM: 0, at: [track[0].lat, track[0].lon] };
  if (i >= track.length - 1) return { distM: cum.cumDist[track.length - 1], at: [track[i].lat, track[i].lon] };
  const a = track[i];
  const b = track[i + 1];
  const f = b.timeMs > a.timeMs ? (t - a.timeMs) / (b.timeMs - a.timeMs) : 0;
  return {
    distM: cum.cumDist[i] + f * (cum.cumDist[i + 1] - cum.cumDist[i]),
    at: [a.lat + f * (b.lat - a.lat), a.lon + f * (b.lon - a.lon)],
  };
};

/** Chaque phase mesurée sur la trace, dans l'ordre donné. */
export const intervalPhaseStats = (track: TrackPoint[], cum: CumulativeTrack, phases: IntervalPhaseSpan[]): IntervalPhaseStats[] =>
  phases.map((phase) => {
    const durationS = (phase.endMs - phase.startMs) / 1000;
    const outside = track.length < 2 || phase.endMs <= track[0].timeMs || phase.startMs >= track[track.length - 1].timeMs;
    if (outside) return { ...phase, durationS, distanceM: null, speedMs: null, path: [] };
    const start = sampleAt(track, cum, phase.startMs);
    const end = sampleAt(track, cum, phase.endMs);
    const inner = track.filter((p) => p.timeMs > phase.startMs && p.timeMs < phase.endMs).map((p): [number, number] => [p.lat, p.lon]);
    const distanceM = Math.max(0, end.distM - start.distM);
    return { ...phase, durationS, distanceM, speedMs: durationS > 0 ? distanceM / durationS : null, path: [start.at, ...inner, end.at] };
  });

// --- Analyse d'une séance : profil de chaque répétition, synthèse ---

/** Réglage de l'analyse (`SportProfile.intervals`), passé en paramètre. */
export interface IntervalAnalysisParams {
  /** Pas du profil de vitesse, en secondes. */
  profileStepS: number;
  /** Fin de la mise en vitesse : la répétition atteint cette part de sa vitesse. */
  launchFraction: number;
}

/**
 * Vitesse d'une répétition pas à pas (`stepS`), en m/s, tirée de la distance
 * cumulée aux bornes de chaque pas : la règle 6 tient, et une trace clairsemée
 * donne la vitesse moyenne sur le trou plutôt que rien (règle 10). Le dernier
 * pas s'arrête à la fin de la répétition ; un pas hors de la trace vaut `null`.
 */
export const repSpeedProfile = (track: TrackPoint[], cum: CumulativeTrack, startMs: number, endMs: number, stepS: number): (number | null)[] => {
  if (track.length < 2 || !(stepS > 0) || endMs <= startMs) return [];
  const first = track[0].timeMs;
  const last = track[track.length - 1].timeMs;
  const stepMs = stepS * 1000;
  const count = Math.max(1, Math.round((endMs - startMs) / stepMs));
  const profile: (number | null)[] = [];
  for (let k = 0; k < count; k++) {
    const t0 = startMs + k * stepMs;
    const t1 = k === count - 1 ? endMs : Math.min(endMs, t0 + stepMs);
    if (t1 <= t0 || t0 < first || t1 > last) {
      profile.push(null);
      continue;
    }
    profile.push(Math.max(0, sampleAt(track, cum, t1).distM - sampleAt(track, cum, t0).distM) / ((t1 - t0) / 1000));
  }
  return profile;
};

/** Milieu du pas `k`, en secondes depuis le début de la répétition. */
const stepMid = (k: number, stepS: number): number => (k + 0.5) * stepS;

/**
 * Mise en vitesse : temps, depuis le début de la répétition, où le profil
 * atteint `fraction` de la vitesse de la répétition, interpolé entre les
 * milieux des pas ; 0 si le premier pas y est déjà (départ lancé). Avec
 * l'accélération moyenne jusque-là, en m/s², `null` pour un départ lancé.
 */
export const launchOf = (
  profile: (number | null)[],
  repSpeedMs: number,
  params: IntervalAnalysisParams
): { launchS: number; accelMs2: number | null } | null => {
  const target = params.launchFraction * repSpeedMs;
  if (!(target > 0)) return null;
  const k = profile.findIndex((v) => v !== null && v >= target);
  if (k < 0) return null;
  if (k === 0) return { launchS: 0, accelMs2: null };
  const before = profile[k - 1];
  const after = profile[k] as number;
  const launchS = before !== null && after > before
    ? stepMid(k - 1, params.profileStepS) + ((target - before) / (after - before)) * params.profileStepS
    : stepMid(k, params.profileStepS);
  const startSpeed = profile[0];
  const elapsed = launchS - stepMid(0, params.profileStepS);
  return { launchS, accelMs2: startSpeed !== null && elapsed > 0 ? (target - startSpeed) / elapsed : null };
};

/**
 * Maintien : vitesse de la seconde moitié de la répétition rapportée à celle
 * de la première, comptées après la mise en vitesse. `null` s'il reste moins
 * de deux pas par moitié.
 */
export const holdRatioOf = (profile: (number | null)[], launchS: number, stepS: number): number | null => {
  const after = profile
    .map((v, k) => ({ v, t: stepMid(k, stepS) }))
    .filter((s): s is { v: number; t: number } => s.v !== null && s.t >= launchS);
  if (after.length < 4) return null;
  const middle = (after[0].t + after[after.length - 1].t) / 2;
  const firstHalf = after.filter((s) => s.t <= middle);
  const secondHalf = after.filter((s) => s.t > middle);
  if (firstHalf.length < 2 || secondHalf.length < 2) return null;
  const mean = (list: { v: number }[]) => list.reduce((sum, s) => sum + s.v, 0) / list.length;
  const before = mean(firstHalf);
  return before > 0 ? mean(secondHalf) / before : null;
};

/** Une répétition : son travail, le repos qui le suit, son profil et ce qu'on en tire. */
export interface IntervalRep {
  rep: number;
  work: IntervalPhaseStats;
  rest: IntervalPhaseStats | null;
  /** Vitesse pas à pas, en m/s (`repSpeedProfile`). */
  profile: (number | null)[];
  /** Mise en vitesse, en secondes ; `null` hors de la trace ou jamais atteinte. */
  launchS: number | null;
  /** Accélération moyenne pendant la mise en vitesse, en m/s². */
  accelMs2: number | null;
  /** Vitesse de la seconde moitié sur celle de la première, après la mise en vitesse. */
  holdRatio: number | null;
}

export interface IntervalSummary {
  /** Répétitions commencées. */
  count: number;
  /** Vitesse moyenne des répétitions : leur distance sur leur durée, en m/s. */
  meanSpeedMs: number | null;
  best: { rep: number; speedMs: number } | null;
  worst: { rep: number; speedMs: number } | null;
  /** Écart-type des vitesses des répétitions sur leur moyenne. */
  regularity: number | null;
  /**
   * Droite des moindres carrés des vitesses : pente en part de la moyenne par
   * répétition (négative : on ralentit), et ses valeurs à la première et à la
   * dernière répétition, en m/s. Trois répétitions au moins.
   */
  trend: { perRep: number; firstMs: number; lastMs: number } | null;
  launchS: number | null;
  accelMs2: number | null;
  holdRatio: number | null;
  /** Profil moyen, pas à pas : la moyenne des répétitions qui couvrent le pas, s'il y en a au moins la moitié. */
  meanProfile: (number | null)[];
}

const average = (values: (number | null)[]): number | null => {
  const kept = values.filter((v): v is number => v !== null && isFinite(v));
  return kept.length > 0 ? kept.reduce((sum, v) => sum + v, 0) / kept.length : null;
};

/** Séance mesurée sur la trace : chaque répétition avec le repos qui la suit, et la synthèse. */
export const analyzeIntervals = (
  track: TrackPoint[],
  cum: CumulativeTrack,
  phases: IntervalPhaseSpan[],
  params: IntervalAnalysisParams
): { reps: IntervalRep[]; summary: IntervalSummary } => {
  const stats = intervalPhaseStats(track, cum, phases);
  const reps: IntervalRep[] = stats
    .filter((p) => p.kind === 'travail')
    .map((work) => {
      const rest = stats.find((p) => p.kind === 'repos' && p.rep === work.rep) ?? null;
      const profile = repSpeedProfile(track, cum, work.startMs, work.endMs, params.profileStepS);
      const launch = work.speedMs !== null ? launchOf(profile, work.speedMs, params) : null;
      return {
        rep: work.rep,
        work,
        rest,
        profile,
        launchS: launch?.launchS ?? null,
        accelMs2: launch?.accelMs2 ?? null,
        holdRatio: launch ? holdRatioOf(profile, launch.launchS, params.profileStepS) : null,
      };
    });
  return { reps, summary: summarizeIntervals(reps) };
};

/** Synthèse d'une séance (`IntervalSummary`). */
export const summarizeIntervals = (reps: IntervalRep[]): IntervalSummary => {
  const measured = reps.filter((r) => r.work.speedMs !== null && r.work.distanceM !== null);
  const totalS = measured.reduce((sum, r) => sum + r.work.durationS, 0);
  const totalM = measured.reduce((sum, r) => sum + (r.work.distanceM ?? 0), 0);
  const meanSpeedMs = totalS > 0 ? totalM / totalS : null;
  const speeds = measured.map((r) => ({ rep: r.rep, speedMs: r.work.speedMs as number }));
  const best = speeds.reduce<{ rep: number; speedMs: number } | null>((b, s) => (!b || s.speedMs > b.speedMs ? s : b), null);
  const worst = speeds.reduce<{ rep: number; speedMs: number } | null>((w, s) => (!w || s.speedMs < w.speedMs ? s : w), null);

  const plain = speeds.map((s) => s.speedMs);
  const mean = average(plain);
  const regularity = mean && plain.length > 1
    ? Math.sqrt(plain.reduce((sum, v) => sum + (v - mean) ** 2, 0) / plain.length) / mean
    : null;

  let trend: IntervalSummary['trend'] = null;
  if (mean && speeds.length >= 3) {
    const xMean = speeds.reduce((sum, s) => sum + s.rep, 0) / speeds.length;
    const sxx = speeds.reduce((sum, s) => sum + (s.rep - xMean) ** 2, 0);
    const sxy = speeds.reduce((sum, s) => sum + (s.rep - xMean) * (s.speedMs - mean), 0);
    if (sxx > 0) {
      const slope = sxy / sxx;
      const at = (x: number) => mean + slope * (x - xMean);
      trend = { perRep: slope / mean, firstMs: at(speeds[0].rep), lastMs: at(speeds[speeds.length - 1].rep) };
    }
  }

  const length = Math.max(0, ...reps.map((r) => r.profile.length));
  const meanProfile: (number | null)[] = [];
  for (let k = 0; k < length; k++) {
    const values = reps.map((r) => r.profile[k]).filter((v): v is number => v !== null && v !== undefined);
    meanProfile.push(values.length > 0 && values.length * 2 >= reps.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null);
  }

  return {
    count: reps.length,
    meanSpeedMs,
    best,
    worst,
    regularity,
    trend,
    launchS: average(reps.map((r) => r.launchS)),
    accelMs2: average(reps.map((r) => r.accelMs2)),
    holdRatio: average(reps.map((r) => r.holdRatio)),
    meanProfile,
  };
};
