import { describe, expect, it } from 'vitest';
import {
  DAY_MS, addDays, addMonths, dayMonthTime, dayMonthYear, dayMonthYearTime, formatLocalDate, monthYearLong, monthYearShort, shortDate, stacksByActivity,
  startOfDay, startOfMonth, weekdayDayMonthYear,
} from './calendar';

// Copies gelées des écritures d'avant le lot 55.
const oldShortDate = (ms: number): string => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const oldPad = (n: number): string => String(n).padStart(2, '0');
const oldLocalDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${oldPad(d.getMonth() + 1)}-${oldPad(d.getDate())}`;
};
const oldStartOfMonth = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const oldStacks = (sessions: readonly { activityId: string }[], order: readonly string[]) => {
  const rank = (id: string) => order.indexOf(id);
  const counts = new Map<string, number>();
  for (const s of sessions) counts.set(s.activityId, (counts.get(s.activityId) ?? 0) + 1);
  return [...counts.entries()].map(([activityId, count]) => ({ activityId, count })).sort((a, b) => rank(a.activityId) - rank(b.activityId));
};

const SAMPLES = [Date.UTC(2026, 0, 1, 0, 0), Date.UTC(2026, 2, 29, 0, 30), Date.UTC(2026, 9, 25, 23, 59), Date.UTC(2024, 1, 29, 12), 0, 1_800_000_000_000];

describe('calendar', () => {
  it('formate les dates comme toLocaleDateString / toLocaleString', () => {
    for (const ms of SAMPLES) {
      for (const when of [ms, new Date(ms)]) {
        const d = new Date(ms);
        expect(shortDate(when)).toBe(oldShortDate(ms));
        expect(dayMonthYear(when)).toBe(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }));
        expect(weekdayDayMonthYear(when)).toBe(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
        expect(monthYearShort(when)).toBe(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }));
        expect(monthYearLong(when)).toBe(d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
        expect(dayMonthYearTime(when)).toBe(d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
        expect(dayMonthTime(when)).toBe(d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }));
      }
    }
  });

  it('une date invalide donne « Invalid Date », comme avant', () => {
    for (const ms of [NaN, Infinity, 8.64e15 + 1]) {
      expect(shortDate(ms)).toBe(oldShortDate(ms));
      expect(shortDate(ms)).toBe('Invalid Date');
    }
    expect(shortDate(8.64e15)).toBe(oldShortDate(8.64e15));
  });

  it('écrit la date locale AAAA-MM-JJ', () => {
    for (const ms of SAMPLES) expect(formatLocalDate(ms)).toBe(oldLocalDate(ms));
    expect(formatLocalDate(new Date(2026, 8, 3, 23, 59).getTime())).toBe('2026-09-03');
  });

  it('tient les bornes de jour et de mois', () => {
    for (const ms of SAMPLES) {
      expect(startOfMonth(ms)).toBe(oldStartOfMonth(ms));
      expect(startOfDay(ms)).toBeLessThanOrEqual(ms);
      expect(ms - startOfDay(ms)).toBeLessThan(DAY_MS + 3_600_000);
    }
    const jan = new Date(2026, 0, 1).getTime();
    expect(addMonths(jan, 13)).toBe(new Date(2027, 1, 1).getTime());
    expect(addMonths(jan, -1)).toBe(new Date(2025, 11, 1).getTime());
    expect(addDays(new Date(2026, 2, 28).getTime(), 2)).toBe(new Date(2026, 2, 30).getTime());
  });

  it('empile les sessions par activité dans l’ordre donné', () => {
    const sessions = [{ activityId: 'c' }, { activityId: 'a' }, { activityId: 'c' }, { activityId: 'z' }, { activityId: 'b' }];
    for (const order of [['a', 'b', 'c'], ['c', 'b', 'a'], [], ['z', 'c']]) {
      expect(stacksByActivity(sessions, order)).toEqual(oldStacks(sessions, order));
    }
    expect(stacksByActivity(sessions, ['a', 'b', 'c', 'z'])).toEqual([
      { activityId: 'a', count: 1 }, { activityId: 'b', count: 1 }, { activityId: 'c', count: 2 }, { activityId: 'z', count: 1 },
    ]);
    expect(stacksByActivity([], ['a'])).toEqual([]);
  });
});
