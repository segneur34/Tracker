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

/** Une période, ou toutes les sessions (`'tout'`, une barre par mois depuis la plus vieille). */
export type ChartRange = ChartPeriod | 'tout';

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
/**
 * Vue 30 jours : barres d'avant le premier lundi en dessous desquelles la
 * première barre ne porte pas de numéro de semaine. Sur téléphone, une barre
 * fait une dizaine de pixels et « S35 » le double : deux repères plus proches
 * se chevauchent.
 */
const FIRST_LABEL_MIN_SLOTS = 4;

/** Minuit local du jour de `ms`. */
export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Ajoute des jours de calendrier (juste aux changements d'heure). */
export const addDays = (dayMs: number, n: number): number => {
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

const monthYear = (ms: number): string =>
  new Date(ms).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

interface Slot {
  startMs: number;
  endMs: number;
  label: string;
  title: string;
  weekStart: boolean;
  future: boolean;
}

/**
 * Toutes les sessions : un mois par case, de celui de la plus vieille session
 * (`oldestMs`, le mois en cours sans session) au mois en cours. Sur un an au
 * plus, chaque mois porte son initiale ; au-delà, janvier porte l'année, et
 * la première case aussi si le premier janvier est assez loin.
 */
const monthSlotsOf = (nowMs: number, oldestMs: number | null): { slots: Slot[]; title: string; range: string } => {
  const now = new Date(nowMs);
  const oldest = new Date(Math.min(oldestMs ?? nowMs, nowMs));
  const count = (now.getFullYear() - oldest.getFullYear()) * 12 + now.getMonth() - oldest.getMonth() + 1;
  const firstJanuaryIndex = (12 - oldest.getMonth()) % 12;
  const labelFirst = firstJanuaryIndex === 0 || firstJanuaryIndex >= FIRST_LABEL_MIN_SLOTS;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(oldest.getFullYear(), oldest.getMonth() + i, 1);
    const january = start.getMonth() === 0;
    const label = count <= 12
      ? MONTH_LETTERS[start.getMonth()]
      : january || (i === 0 && labelFirst) ? String(start.getFullYear()) : '';
    slots.push({
      startMs: start.getTime(),
      endMs: new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime(),
      label, title: monthYear(start.getTime()), weekStart: january && i > 0, future: false,
    });
  }
  return {
    slots,
    title: 'Depuis le début, par mois',
    range: `depuis ${monthYear(slots[0].startMs)}`,
  };
};

/** Cases de la période, de la plus ancienne à la plus récente. */
const slotsOf = (period: ChartRange, nowMs: number, oldestMs: number | null = null): { slots: Slot[]; title: string; range: string } => {
  if (period === 'tout') return monthSlotsOf(nowMs, oldestMs);
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
    // La première barre porte sa semaine seulement si le premier lundi est assez loin pour ne pas la chevaucher.
    const firstMondayIndex = (7 - isoWeekday(first)) % 7;
    const labelFirst = firstMondayIndex === 0 || firstMondayIndex >= FIRST_LABEL_MIN_SLOTS;
    for (let i = 0; i < 30; i++) {
      const day = addDays(first, i);
      const monday = isoWeekday(day) === 0;
      const week = isoWeek(day).week;
      slots.push({
        startMs: day, endMs: addDays(day, 1),
        label: monday || (i === 0 && labelFirst) ? `S${week}` : '',
        title: `${longDay(day)} (S${week})`,
        weekStart: monday && i > 0, future: false,
      });
    }
    return { slots, title: '30 derniers jours', range: `du ${shortDate(first)} à aujourd'hui` };
  }
  // Par semaine : les 26 dernières, ou celles de l'année civile en cours (choix de l'utilisateur, 27/10), du 1er
  // janvier au 31 décembre : la première et la dernière semaine, à cheval sur deux années, sont coupées à ses bords.
  const thisMonday = startOfIsoWeek(nowMs);
  const { week: thisWeek } = isoWeek(nowMs);
  const year = new Date(nowMs).getFullYear();
  const yearStart = new Date(year, 0, 1).getTime();
  const yearEnd = new Date(year + 1, 0, 1).getTime();
  const count = period === 'sixmois' ? 26 : 1 + Math.round((thisMonday - startOfIsoWeek(yearStart)) / (7 * DAY_MS));
  for (let i = count - 1; i >= 0; i--) {
    const monday = addDays(thisMonday, -7 * i);
    const { week } = isoWeek(monday);
    const marked = period === 'sixmois' ? week % 4 === 0 : week === 1 || week % 5 === 0;
    const startMs = period === 'annee' ? Math.max(monday, yearStart) : monday;
    const endMs = period === 'annee' ? Math.min(addDays(monday, 7), yearEnd) : addDays(monday, 7);
    slots.push({
      startMs, endMs,
      label: marked ? `S${week}` : '',
      title: `Semaine ${week}, du ${shortDate(startMs)} au ${shortDate(addDays(endMs, -1))}`,
      weekStart: false, future: false,
    });
  }
  if (period === 'annee') {
    return { slots, title: `Année ${year}, par semaine`, range: `du ${shortDate(yearStart)} à aujourd'hui` };
  }
  const firstWeek = isoWeek(slots[0].startMs).week;
  return { slots, title: '6 derniers mois, par semaine', range: `S${firstWeek} à S${thisWeek}` };
};

/**
 * Hauteur d'une session dans le graphe, en pixels : la plus grande, jusqu'à
 * `unitMaxPx`, qui fait tenir chaque barre dans `plotPx`, écarts de `gapPx`
 * entre ses piles compris. Jamais nulle : une barre de 59 sessions ou plus
 * se tasse au lieu d'effacer tout le graphe.
 */
export const activityBarUnit = (
  bars: Pick<ChartBar, 'stacks'>[],
  plotPx: number,
  gapPx: number,
  unitMaxPx: number
): number => {
  let unit = unitMaxPx;
  for (const { stacks } of bars) {
    const count = stacks.reduce((n, s) => n + s.count, 0);
    if (count === 0) continue;
    const room = plotPx - Math.max(0, stacks.length - 1) * gapPx;
    unit = Math.min(unit, Math.max(0, room) / count);
  }
  return unit;
};

/**
 * Bornes d'une période, `[fromMs, toMs[` : du minuit de sa première case à la
 * fin de sa dernière (la semaine en cours va jusqu'au dimanche soir). Les
 * statistiques les reprennent, pour dire la même chose que le graphe.
 */
export const chartPeriodBounds = (period: ChartPeriod, nowMs: number): { fromMs: number; toMs: number } => {
  const { slots } = slotsOf(period, nowMs);
  return { fromMs: slots[0].startMs, toMs: slots[slots.length - 1].endMs };
};

/**
 * Barres et totaux d'une période qui se termine aujourd'hui (`nowMs`), ou de
 * toutes les sessions (`'tout'`, à partir du mois de la plus vieille).
 * `activityOrder` fixe l'ordre des piles et des totaux ; une activité absente
 * de cet ordre vient après, dans l'ordre d'apparition.
 */
export const buildActivityChart = (
  sessions: ChartSession[],
  period: ChartRange,
  nowMs: number,
  activityOrder: string[]
): ActivityChartData => {
  const oldestMs = sessions.length > 0 ? Math.min(...sessions.map((s) => s.startMs)) : null;
  const { slots, title, range } = slotsOf(period, nowMs, oldestMs);
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
