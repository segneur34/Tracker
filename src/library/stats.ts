/**
 * Statistiques des sessions (lot 5, étape 1) : totaux, évolution de la vitesse
 * max, régularité et records, tirés du résumé des fiches (`SessionSummary`),
 * sans relire un seul GPX. Logique pure, en unités SI ; l'heure est celle de
 * l'appareil, comme le graphe de l'accueil, dont on reprend les périodes et
 * les semaines ISO (`activityChart.ts`).
 */

import type { Activity } from '../core/activities';
import { edwardsLoad, histogramZoneTimes } from '../core/heartRate';
import { sportFamily, sportTreatment, type SportFamily, type Treatment } from '../core/sportProfiles';
import { CHART_PERIODS, addDays, chartPeriodBounds, isoWeek, startOfDay, startOfIsoWeek, type ChartPeriod } from './activityChart';
import type { SessionRecord, SummaryHeartRate } from './record';

export type StatsPeriod = ChartPeriod | 'tout';

/** Les périodes du graphe de l'accueil, et toutes les sessions. */
export const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [...CHART_PERIODS, { id: 'tout', label: 'Tout' }];

export const isStatsPeriod = (value: unknown): value is StatsPeriod => STATS_PERIODS.some((p) => p.id === value);

/** Bornes d'une période, `[fromMs, toMs[` ; `null` : sans borne de ce côté. */
export interface StatsBounds {
  fromMs: number | null;
  toMs: number | null;
}

/** Bornes d'une période qui se termine aujourd'hui : les mêmes que le graphe de l'accueil. */
export const statsPeriodBounds = (period: StatsPeriod, nowMs: number): StatsBounds =>
  period === 'tout' ? { fromMs: null, toMs: null } : chartPeriodBounds(period, nowMs);

export const inBounds = (startMs: number, bounds: StatsBounds): boolean =>
  (bounds.fromMs === null || startMs >= bounds.fromMs) && (bounds.toMs === null || startMs < bounds.toMs);

/** Ce que les statistiques retiennent d'une session. */
export interface StatSession {
  file: string;
  /** Nom donné par l'utilisateur, `null` sans nom. */
  name: string | null;
  startMs: number;
  endMs: number;
  distanceM: number;
  movingTimeS: number | null;
  elevationGainM: number | null;
  maxSpeedMs: number;
  activityId: string;
  family: SportFamily;
  treatment: Treatment;
  /** Voile : manœuvres classées à la dernière analyse, `null` si la session n'a jamais été ouverte. */
  maneuverCount: number | null;
  waveCount: number | null;
  longestWaveM: number | null;
  longestFlightS: number | null;
  /** Répétitions du compteur (fractionné). */
  reps: number;
  /** FC du résumé, `null` pour une session sans FC. */
  heartRate: SummaryHeartRate | null;
}

/** Session des statistiques, d'après sa fiche et son activité (`sessionActivity`). */
export const statSessionOf = (file: string, record: SessionRecord, activity: Activity): StatSession => {
  const { summary } = record;
  return {
    file,
    name: record.name ?? null,
    startMs: summary.startMs,
    endMs: summary.endMs,
    distanceM: summary.distanceM,
    movingTimeS: summary.movingTimeS,
    elevationGainM: summary.elevationGainM,
    maxSpeedMs: summary.maxSpeedMs,
    activityId: activity.id,
    family: sportFamily(activity.base),
    treatment: sportTreatment(activity.base),
    maneuverCount: summary.maneuverCount ?? null,
    waveCount: summary.waveCount ?? null,
    longestWaveM: summary.longestWaveM ?? null,
    longestFlightS: summary.longestFlightS ?? null,
    reps: record.intervals?.reduce((n, series) => n + series.laps.filter((l) => l.kind === 'travail').length, 0) ?? 0,
    heartRate: summary.heartRate ?? null,
  };
};

/** Totaux d'un ensemble de sessions. */
export interface StatsTotals {
  sessions: number;
  /** Durée totale, du premier au dernier point, en secondes. */
  durationS: number;
  /** Temps en action, sur les sessions qui le connaissent. */
  movingTimeS: number;
  /** Distance de ces mêmes sessions : elle donne la vitesse moyenne en action. */
  movingDistanceM: number;
  distanceM: number;
  /** D+ cumulé, sur les sessions qui en ont un (`elevationSessions`). */
  elevationGainM: number;
  elevationSessions: number;
  maxSpeedMs: number | null;
  /** Manœuvres, sur les sessions de voile déjà ouvertes (`maneuverSessions`). */
  maneuvers: number;
  maneuverSessions: number;
  waves: number;
  waveSessions: number;
  longestWaveM: number | null;
  longestFlightS: number | null;
  reps: number;
}

const maxOrNull = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

export const statsTotals = (sessions: readonly StatSession[]): StatsTotals => {
  const t: StatsTotals = {
    sessions: 0, durationS: 0, movingTimeS: 0, movingDistanceM: 0, distanceM: 0, elevationGainM: 0, elevationSessions: 0,
    maxSpeedMs: null, maneuvers: 0, maneuverSessions: 0, waves: 0, waveSessions: 0, longestWaveM: null, longestFlightS: null, reps: 0,
  };
  for (const s of sessions) {
    t.sessions++;
    t.durationS += Math.max(0, (s.endMs - s.startMs) / 1000);
    t.distanceM += s.distanceM;
    if (s.movingTimeS !== null && s.movingTimeS > 0) {
      t.movingTimeS += s.movingTimeS;
      t.movingDistanceM += s.distanceM;
    }
    if (s.elevationGainM !== null) {
      t.elevationGainM += s.elevationGainM;
      t.elevationSessions++;
    }
    if (s.maxSpeedMs > 0) t.maxSpeedMs = maxOrNull(t.maxSpeedMs, s.maxSpeedMs);
    if (s.maneuverCount !== null) {
      t.maneuvers += s.maneuverCount;
      t.maneuverSessions++;
    }
    if (s.waveCount !== null) {
      t.waves += s.waveCount;
      t.waveSessions++;
    }
    t.longestWaveM = maxOrNull(t.longestWaveM, s.longestWaveM);
    t.longestFlightS = maxOrNull(t.longestFlightS, s.longestFlightS);
    t.reps += s.reps;
  }
  return t;
};

/** Vitesse moyenne en action, en m/s ; `null` sans temps en action. */
export const averageMovingSpeedMs = (t: StatsTotals): number | null => (t.movingTimeS > 0 ? t.movingDistanceM / t.movingTimeS : null);

/**
 * Totaux par groupe (famille, activité), dans l'ordre de `order` ; un groupe
 * absent de cet ordre vient après, dans l'ordre d'apparition. Un groupe sans
 * session n'y est pas.
 */
export const groupTotals = <K extends string>(
  sessions: readonly StatSession[], keyOf: (s: StatSession) => K, order: readonly K[]
): { key: K; totals: StatsTotals }[] => {
  const groups = new Map<K, StatSession[]>();
  for (const s of sessions) {
    const key = keyOf(s);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const keys = [...order.filter((k) => groups.has(k)), ...[...groups.keys()].filter((k) => !order.includes(k))];
  return keys.map((key) => ({ key, totals: statsTotals(groups.get(key)!) }));
};

/** Un point du graphe de la vitesse max : une session, et le record établi jusqu'à elle comprise. */
export interface MaxSpeedPoint {
  file: string;
  startMs: number;
  maxSpeedMs: number;
  activityId: string;
  bestMs: number;
  /** La session a battu le record d'avant (la première le fait). */
  isRecord: boolean;
}

/** Les sessions dans l'ordre des dates, avec le record qui court ; une session sans vitesse est écartée. */
export const maxSpeedSeries = (sessions: readonly StatSession[]): MaxSpeedPoint[] => {
  let best = 0;
  return sessions
    .filter((s) => Number.isFinite(s.maxSpeedMs) && s.maxSpeedMs > 0)
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => {
      const isRecord = s.maxSpeedMs > best;
      if (isRecord) best = s.maxSpeedMs;
      return { file: s.file, startMs: s.startMs, maxSpeedMs: s.maxSpeedMs, activityId: s.activityId, bestMs: best, isRecord };
    });
};

/** Une barre du graphe de la régularité : une semaine ou un mois. */
export interface RegularityBar {
  startMs: number;
  endMs: number;
  /** Repère sous la barre : « S12 », « janv. 26 ». */
  label: string;
  /** La semaine ou le mois en clair. */
  title: string;
  count: number;
  /** Sessions par activité, dans l'ordre des activités. */
  stacks: { activityId: string; count: number }[];
}

export interface Regularity {
  /** Semaines de la période (pour « Tout », depuis celle de la première session). */
  weeks: number;
  activeWeeks: number;
  /** Sessions par semaine, en moyenne sur la période. */
  perWeek: number;
  /** Plus longue suite de semaines actives consécutives de la période. */
  longestStreak: number;
  /** Suite en cours : semaines actives jusqu'à celle-ci, ou jusqu'à la précédente si celle-ci est vide. */
  currentStreak: number;
  /** Semaines depuis la dernière session (0 : cette semaine), `null` sans session. */
  weeksSinceLast: number | null;
  /** Une barre par semaine jusqu'à un an, par mois au-delà. */
  barUnit: 'semaine' | 'mois';
  bars: RegularityBar[];
}

/** Au-delà de ce nombre de semaines, les barres se font par mois. */
const MAX_WEEKLY_BARS = 53;

const WEEK_MS = 7 * 86_400_000;

const shortDate = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const startOfMonth = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const addMonths = (monthMs: number, n: number): number => {
  const d = new Date(monthMs);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};

const stacksOf = (sessions: readonly StatSession[], rank: (id: string) => number): RegularityBar['stacks'] => {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.activityId, (counts.get(s.activityId) ?? 0) + 1);
  return [...counts.entries()].map(([activityId, count]) => ({ activityId, count })).sort((a, b) => rank(a.activityId) - rank(b.activityId));
};

/**
 * Régularité d'un ensemble de sessions sur une période qui se termine
 * aujourd'hui (`nowMs`). La suite en cours et les semaines depuis la dernière
 * session regardent toutes les sessions données, pas seulement la période.
 * `activityOrder` fixe l'ordre des piles.
 */
export const regularity = (
  sessions: readonly StatSession[], bounds: StatsBounds, nowMs: number, activityOrder: readonly string[]
): Regularity => {
  const past = sessions.filter((s) => s.startMs <= nowMs);
  const inside = past.filter((s) => inBounds(s.startMs, bounds)).sort((a, b) => a.startMs - b.startMs);
  const order = [...activityOrder];
  for (const s of inside) if (!order.includes(s.activityId)) order.push(s.activityId);
  const rank = (id: string) => order.indexOf(id);

  // Suite en cours et dernière session, sur toutes les sessions.
  const thisWeek = startOfIsoWeek(nowMs);
  const allWeeks = new Set(past.map((s) => startOfIsoWeek(s.startMs)));
  let cursor = allWeeks.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  let currentStreak = 0;
  while (allWeeks.has(cursor)) {
    currentStreak++;
    cursor = addDays(cursor, -7);
  }
  const lastMs = past.reduce<number | null>((m, s) => (m === null || s.startMs > m ? s.startMs : m), null);
  const weeksSinceLast = lastMs === null ? null : Math.round((thisWeek - startOfIsoWeek(lastMs)) / WEEK_MS);

  // Semaines de la période.
  const firstMs = bounds.fromMs ?? inside[0]?.startMs ?? null;
  const weekStarts: number[] = [];
  if (firstMs !== null) {
    const lastWeek = bounds.toMs === null ? thisWeek : Math.min(thisWeek, startOfIsoWeek(bounds.toMs - 1));
    for (let w = startOfIsoWeek(firstMs); w <= lastWeek; w = addDays(w, 7)) weekStarts.push(w);
  }
  const activeSet = new Set(inside.map((s) => startOfIsoWeek(s.startMs)));
  let longestStreak = 0;
  let run = 0;
  for (const w of weekStarts) {
    run = activeSet.has(w) ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  const activeWeeks = weekStarts.filter((w) => activeSet.has(w)).length;

  const barUnit = weekStarts.length > MAX_WEEKLY_BARS ? 'mois' : 'semaine';
  const bars: RegularityBar[] = [];
  if (weekStarts.length > 0) {
    const slots: { startMs: number; endMs: number; label: string; title: string }[] = [];
    if (barUnit === 'semaine') {
      for (const w of weekStarts) {
        const { week } = isoWeek(w);
        slots.push({ startMs: w, endMs: addDays(w, 7), label: `S${week}`, title: `Semaine ${week}, du ${shortDate(w)} au ${shortDate(addDays(w, 6))}` });
      }
    } else {
      const lastMonth = startOfMonth(nowMs);
      for (let m = startOfMonth(weekStarts[0]); m <= lastMonth; m = addMonths(m, 1)) {
        const d = new Date(m);
        slots.push({
          startMs: m, endMs: addMonths(m, 1),
          label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
          title: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
        });
      }
    }
    let i = 0;
    for (const slot of slots) {
      const mine: StatSession[] = [];
      while (i < inside.length && inside[i].startMs < slot.startMs) i++;
      while (i < inside.length && inside[i].startMs < slot.endMs) mine.push(inside[i++]);
      bars.push({ ...slot, count: mine.length, stacks: stacksOf(mine, rank) });
    }
  }

  return {
    weeks: weekStarts.length,
    activeWeeks,
    perWeek: weekStarts.length > 0 ? inside.length / weekStarts.length : 0,
    longestStreak,
    currentStreak,
    weeksSinceLast,
    barUnit,
    bars,
  };
};

/** Records qu'on peut classer. */
export type StatsRecordKind = 'vitesse' | 'distance' | 'duree' | 'denivele' | 'manoeuvres' | 'vague' | 'vol';

/** Valeur d'une session pour un record, `null` si elle n'en a pas. */
export const RECORD_VALUE: Record<StatsRecordKind, (s: StatSession) => number | null> = {
  vitesse: (s) => (s.maxSpeedMs > 0 ? s.maxSpeedMs : null),
  distance: (s) => (s.distanceM > 0 ? s.distanceM : null),
  duree: (s) => (s.endMs > s.startMs ? (s.endMs - s.startMs) / 1000 : null),
  denivele: (s) => (s.elevationGainM !== null && s.elevationGainM > 0 ? s.elevationGainM : null),
  manoeuvres: (s) => (s.maneuverCount !== null && s.maneuverCount > 0 ? s.maneuverCount : null),
  vague: (s) => (s.longestWaveM !== null && s.longestWaveM > 0 ? s.longestWaveM : null),
  vol: (s) => (s.longestFlightS !== null && s.longestFlightS > 0 ? s.longestFlightS : null),
};

/** Records d'une famille, dans l'ordre d'affichage ; `null` : toutes les familles mêlées. */
export const recordKindsOf = (family: SportFamily | null): StatsRecordKind[] => {
  const common: StatsRecordKind[] = ['vitesse', 'distance', 'duree'];
  if (family === 'voile') return [...common, 'manoeuvres'];
  if (family === 'surf') return [...common, 'vague', 'vol'];
  if (family === 'course' || family === 'velo' || family === 'fractionne') return [...common, 'denivele'];
  return ['distance', 'duree'];
};

/** Les `n` meilleures sessions pour un record ; à égalité, la plus ancienne d'abord. */
export const topSessions = (
  sessions: readonly StatSession[], kind: StatsRecordKind, n = 3
): { session: StatSession; value: number }[] =>
  sessions
    .map((session) => ({ session, value: RECORD_VALUE[kind](session) }))
    .filter((e): e is { session: StatSession; value: number } => e.value !== null)
    .sort((a, b) => b.value - a.value || a.session.startMs - b.session.startMs)
    .slice(0, n);

/** Pas des repères d'un axe des dates. */
export type DateTickUnit = 'jour' | 'mois' | 'annee';

const TICK_STEPS: { unit: DateTickUnit; days?: number; months?: number }[] = [
  { unit: 'jour', days: 1 },
  { unit: 'jour', days: 2 },
  { unit: 'jour', days: 7 },
  { unit: 'jour', days: 14 },
  { unit: 'mois', months: 1 },
  { unit: 'mois', months: 2 },
  { unit: 'mois', months: 3 },
  { unit: 'mois', months: 6 },
  { unit: 'annee', months: 12 },
  { unit: 'annee', months: 24 },
  { unit: 'annee', months: 60 },
  { unit: 'annee', months: 120 },
];

const ticksOfStep = (min: number, max: number, step: (typeof TICK_STEPS)[number]): number[] => {
  const ticks: number[] = [];
  if (step.days !== undefined) {
    // Une semaine ou plus : les lundis.
    let t = step.days >= 7 ? startOfIsoWeek(min) : startOfDay(min);
    for (; t <= max; t = addDays(t, step.days)) if (t >= min) ticks.push(t);
    return ticks;
  }
  const months = step.months!;
  for (let t = startOfMonth(min); t <= max; t = addMonths(t, 1)) {
    const d = new Date(t);
    if (t >= min && (d.getFullYear() * 12 + d.getMonth()) % months === 0) ticks.push(t);
  }
  return ticks;
};

/**
 * Repères ronds d'un axe des dates entre `min` et `max` (des minuits, des
 * lundis, des premiers du mois, des premiers janvier) : le pas le plus fin
 * qui n'en donne pas plus de `maxTicks`.
 */
export const dateTicks = (min: number, max: number, maxTicks = 6): { ticks: number[]; unit: DateTickUnit } => {
  for (const step of TICK_STEPS) {
    const ticks = ticksOfStep(min, max, step);
    if (ticks.length <= maxTicks) return { ticks, unit: step.unit };
  }
  const last = TICK_STEPS[TICK_STEPS.length - 1];
  return { ticks: ticksOfStep(min, max, last), unit: last.unit };
};

/** Un repère de l'axe des dates en clair : « 12 mars », « mars 26 », « 2026 ». */
export const formatDateTick = (ms: number, unit: DateTickUnit): string => {
  const d = new Date(ms);
  if (unit === 'annee') return String(d.getFullYear());
  if (unit === 'mois') return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};

// --- Cardio : tiré de la FC du résumé, avec les zones du moment ---

/** Charge d'Edwards d'une session, avec les zones du moment ; `null` sans FC. */
export const sessionLoad = (s: StatSession, zoneBounds: readonly number[]): number | null =>
  s.heartRate ? edwardsLoad(histogramZoneTimes(s.heartRate.histogram, zoneBounds)) : null;

export interface CardioTotals {
  /** Sessions qui ont de la FC. */
  sessions: number;
  /** Temps couvert par la FC, en secondes. */
  coveredS: number;
  /** FC moyenne pondérée par le temps couvert, `null` sans FC. */
  avgBpm: number | null;
  maxBpm: number | null;
  /** Secondes par zone, de « sous Z1 » à Z5 ; `null` sans zones. */
  zoneTimesS: number[] | null;
  /** Charge d'Edwards cumulée ; `null` sans zones. */
  load: number | null;
}

export const cardioTotals = (sessions: readonly StatSession[], zoneBounds: readonly number[] | null): CardioTotals => {
  const t: CardioTotals = {
    sessions: 0, coveredS: 0, avgBpm: null, maxBpm: null,
    zoneTimesS: zoneBounds ? new Array<number>(zoneBounds.length + 1).fill(0) : null, load: zoneBounds ? 0 : null,
  };
  let weighted = 0;
  for (const s of sessions) {
    const hr = s.heartRate;
    if (!hr) continue;
    t.sessions++;
    t.coveredS += hr.coveredS;
    weighted += hr.avgBpm * hr.coveredS;
    t.maxBpm = maxOrNull(t.maxBpm, hr.maxBpm);
    if (zoneBounds && t.zoneTimesS) {
      const times = histogramZoneTimes(hr.histogram, zoneBounds);
      times.forEach((sec, z) => (t.zoneTimesS![z] += sec));
      t.load! += edwardsLoad(times);
    }
  }
  t.avgBpm = t.coveredS > 0 ? weighted / t.coveredS : null;
  return t;
};

/** Charge d'une barre de la régularité (semaine ou mois) : celle des sessions qui y commencent. */
export const cardioLoadBars = (
  bars: readonly RegularityBar[], sessions: readonly StatSession[], zoneBounds: readonly number[]
): { startMs: number; label: string; title: string; load: number }[] =>
  bars.map((b) => ({
    startMs: b.startMs,
    label: b.label,
    title: b.title,
    load: sessions.reduce((sum, s) => (s.startMs >= b.startMs && s.startMs < b.endMs ? sum + (sessionLoad(s, zoneBounds) ?? 0) : sum), 0),
  }));

/** FC moyenne et max de chaque session qui en a, dans l'ordre des dates. */
export const heartRatePoints = (sessions: readonly StatSession[]): { file: string; startMs: number; activityId: string; avgBpm: number; maxBpm: number }[] =>
  sessions
    .filter((s) => s.heartRate !== null)
    .sort((a, b) => a.startMs - b.startMs)
    .map((s) => ({ file: s.file, startMs: s.startMs, activityId: s.activityId, avgBpm: s.heartRate!.avgBpm, maxBpm: s.heartRate!.maxBpm }));
