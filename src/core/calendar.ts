/**
 * Calendrier local : jours, semaines ISO, mois, dates en clair. Les bornes sont
 * des minuits locaux (juste aux changements d'heure) ; pur.
 */
import { pad2 } from './units';

export const DAY_MS = 86_400_000;

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
export const isoWeekday = (ms: number): number => (new Date(ms).getDay() + 6) % 7;

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

/** Minuit local du premier jour du mois de `ms`. */
export const startOfMonth = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

/** Ajoute des mois de calendrier à un premier du mois. */
export const addMonths = (monthMs: number, n: number): number => {
  const d = new Date(monthMs);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};

/** Date locale `AAAA-MM-JJ`. */
export const formatLocalDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Plus grand écart à l'origine d'une date valide, en ms ; au-delà, `toLocaleDateString` rend « Invalid Date ». */
const MAX_DATE_MS = 8.64e15;

/** Formateur français nommé ; une date invalide donne « Invalid Date », comme `toLocaleDateString`. */
const dateFormatter = (options: Intl.DateTimeFormatOptions): ((when: number | Date) => string) => {
  const format = new Intl.DateTimeFormat('fr-FR', options);
  return (when) => (Math.abs(+when) <= MAX_DATE_MS ? format.format(when) : 'Invalid Date');
};

/** « 12 mars » */
export const shortDate = dateFormatter({ day: 'numeric', month: 'short' });
/** « 12 mars 2026 » */
export const dayMonthYear = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric' });
/** « jeu. 12 mars 2026 » */
export const weekdayDayMonthYear = dateFormatter({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
/** « 12 mars 2026, 14:05 » */
export const dayMonthYearTime = dateFormatter({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** « 12 mars, 14:05 » */
export const dayMonthTime = dateFormatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** « mars 26 » */
export const monthYearShort = dateFormatter({ month: 'short', year: '2-digit' });
/** « mars 2026 » */
export const monthYearLong = dateFormatter({ month: 'long', year: 'numeric' });

/** Piles d'une barre : le nombre de sessions de chaque activité, dans l'ordre de `order` (les absentes à la suite). */
export const stacksByActivity = (
  sessions: readonly { activityId: string }[],
  order: readonly string[]
): { activityId: string; count: number }[] => {
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.activityId, (counts.get(s.activityId) ?? 0) + 1);
  const rank = (id: string) => order.indexOf(id);
  return [...counts.entries()].map(([activityId, count]) => ({ activityId, count })).sort((a, b) => rank(a.activityId) - rank(b.activityId));
};
