/**
 * Graphe d'activités de l'accueil : les sessions rangées en barres, une par
 * jour ou par semaine selon la période, empilées par activité, avec les
 * totaux de la période. Logique pure ; l'heure est celle de l'appareil (une
 * session du dimanche soir compte pour le dimanche, où qu'on la regarde).
 *
 * Semaines ISO : elles commencent le lundi, la semaine 1 est celle qui
 * contient le premier jeudi de l'année.
 */

export type ChartPeriod = 'semaine' | 'trente' | 'sixmois' | 'annee';

export const CHART_PERIODS: { id: ChartPeriod; label: string }[] = [
  { id: 'semaine', label: 'Semaine' },
  { id: 'trente', label: '30 jours' },
  { id: 'sixmois', label: '6 mois' },
  { id: 'annee', label: 'Année' },
];

/** Ce que le graphe retient d'une session. */
export interface ChartSession {
  file: string;
  startMs: number;
  /** Durée totale, en secondes. */
  durationS: number;
  distanceM: number;
  activityId: string;
}

/** Une activité présente dans le graphe, ses couleur et nom. */
export interface ChartActivity {
  id: string;
  name: string;
  color: string;
}

export interface ChartBar {
  /** Début de la barre (minuit local du jour, ou du lundi de la semaine). */
  startMs: number;
  /** Repère sous la barre (« L », « S39 »…), vide s'il n'y en a pas. */
  label: string;
  /** Titre du détail : le jour ou la semaine en clair. */
  title: string;
  /** Première barre d'une semaine (trait de séparation), hors première barre du graphe. */
  weekStart: boolean;
  /** Jour pas encore arrivé (vue Semaine). */
  future: boolean;
  /** Sessions par activité, dans l'ordre des activités. */
  stacks: { activityId: string; count: number }[];
  sessions: ChartSession[];
}

export interface ChartTotal {
  activityId: string;
  sessions: number;
  durationS: number;
  distanceM: number;
}

export interface ActivityChartData {
  bars: ChartBar[];
  /** Totaux de la période, par activité, dans l'ordre des activités. */
  totals: ChartTotal[];
  /** La période en clair : « Semaine 39 », « 30 derniers jours »… */
  title: string;
  /** Ses bornes en clair. */
  range: string;
}

const DAY_MS = 86_400_000;
const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Minuit local du jour de `ms`. */
export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Ajoute des jours de calendrier (juste aux changements d'heure). */
const addDays = (dayMs: number, n: number): number => {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

/** Rang du jour dans la semaine ISO : 0 le lundi, 6 le dimanche. */
const isoWeekday = (ms: number): number => (new Date(ms).getDay() + 6) % 7;

/** Minuit local du lundi de la semaine de `ms`. */
export const startOfIsoWeek = (ms: number): number => addDays(startOfDay(ms), -isoWeekday(ms));

/** Année et numéro de semaine ISO du jour de `ms`. */
export const isoWeek = (ms: number): { year: number; week: number } => {
  // Le jeudi de la même semaine donne l'année ISO ; la semaine 1 contient le 4 janvier.
  const thursday = addDays(startOfDay(ms), 3 - isoWeekday(ms));
  const year = new Date(thursday).getFullYear();
  const jan4 = new Date(year, 0, 4).getTime();
  const week1Thursday = addDays(jan4, 3 - isoWeekday(jan4));
  // Arrondi : un changement d'heure décale les minuits d'une heure.
  return { year, week: 1 + Math.round((thursday - week1Thursday) / (7 * DAY_MS)) };
};

const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

const longDay = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

interface Slot {
  startMs: number;
  endMs: number;
  label: string;
  title: string;
  weekStart: boolean;
  future: boolean;
}

/** Cases de la période, de la plus ancienne à la plus récente. */
const slotsOf = (period: ChartPeriod, nowMs: number): { slots: Slot[]; title: string; range: string } => {
  const today = startOfDay(nowMs);
  const slots: Slot[] = [];
  if (period === 'semaine') {
    const monday = startOfIsoWeek(nowMs);
    for (let i = 0; i < 7; i++) {
      const day = addDays(monday, i);
      slots.push({ startMs: day, endMs: addDays(day, 1), label: DAY_LETTERS[i], title: longDay(day), weekStart: false, future: day > today });
    }
    const sunday = addDays(monday, 6);
    return { slots, title: `Semaine ${isoWeek(nowMs).week}`, range: `du ${shortDate(monday)} au ${shortDate(sunday)}` };
  }
  if (period === 'trente') {
    const first = addDays(today, -29);
    for (let i = 0; i < 30; i++) {
      const day = addDays(first, i);
      const monday = isoWeekday(day) === 0;
      const week = isoWeek(day).week;
      slots.push({
        startMs: day, endMs: addDays(day, 1),
        label: monday || i === 0 ? `S${week}` : '',
        title: `${longDay(day)} (S${week})`,
        weekStart: monday && i > 0, future: false,
      });
    }
    return { slots, title: '30 derniers jours', range: `du ${shortDate(first)} à aujourd'hui` };
  }
  // Par semaine : les 26 dernières, ou celles de l'année en cours.
  const thisMonday = startOfIsoWeek(nowMs);
  const { year, week: thisWeek } = isoWeek(nowMs);
  const count = period === 'sixmois' ? 26 : thisWeek;
  for (let i = count - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const { week } = isoWeek(monday);
    const marked = period === 'sixmois' ? week % 4 === 0 : week === 1 || week % 5 === 0;
    slots.push({
      startMs: monday, endMs: addDays(monday, 7),
      label: marked ? `S${week}` : '',
      title: `Semaine ${week}, du ${shortDate(monday)} au ${shortDate(addDays(monday, 6))}`,
      weekStart: false, future: false,
    });
  }
  const firstWeek = isoWeek(slots[0].startMs).week;
  return {
    slots,
    title: period === 'sixmois' ? '6 derniers mois, par semaine' : `Année ${year}, par semaine`,
    range: `S${firstWeek} à S${thisWeek}`,
  };
};

/**
 * Barres et totaux d'une période qui se termine aujourd'hui (`nowMs`).
 * `activityOrder` fixe l'ordre des piles et des totaux ; une activité absente
 * de cet ordre vient après, dans l'ordre d'apparition.
 */
export const buildActivityChart = (
  sessions: ChartSession[],
  period: ChartPeriod,
  nowMs: number,
  activityOrder: string[]
): ActivityChartData => {
  const { slots, title, range } = slotsOf(period, nowMs);
  const from = slots[0].startMs;
  const to = slots[slots.length - 1].endMs;
  const inside = sessions.filter((s) => s.startMs >= from && s.startMs < to).sort((a, b) => a.startMs - b.startMs);

  const order = [...activityOrder];
  for (const s of inside) if (!order.includes(s.activityId)) order.push(s.activityId);
  const rank = (id: string) => order.indexOf(id);

  let cursor = 0;
  const bars: ChartBar[] = slots.map((slot) => {
    const mine: ChartSession[] = [];
    while (cursor < inside.length && inside[cursor].startMs < slot.endMs) mine.push(inside[cursor++]);
    const counts = new Map<string, number>();
    for (const s of mine) counts.set(s.activityId, (counts.get(s.activityId) ?? 0) + 1);
    const stacks = [...counts.entries()]
      .map(([activityId, count]) => ({ activityId, count }))
      .sort((a, b) => rank(a.activityId) - rank(b.activityId));
    return { ...slot, stacks, sessions: mine };
  });

  const byActivity = new Map<string, ChartTotal>();
  for (const s of inside) {
    const t = byActivity.get(s.activityId) ?? { activityId: s.activityId, sessions: 0, durationS: 0, distanceM: 0 };
    byActivity.set(s.activityId, { ...t, sessions: t.sessions + 1, durationS: t.durationS + s.durationS, distanceM: t.distanceM + s.distanceM });
  }
  const totals = [...byActivity.values()].sort((a, b) => rank(a.activityId) - rank(b.activityId));
  return { bars, totals, title, range };
};
