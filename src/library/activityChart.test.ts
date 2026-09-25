import { describe, expect, it } from 'vitest';
import { buildActivityChart, isoWeek, startOfIsoWeek, type ChartSession } from './activityChart';

// Dates construites à l'heure locale : les tests ne dépendent pas du fuseau de la machine.
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

const session = (file: string, startMs: number, activityId = 'voile', durationS = 3600, distanceM = 10_000): ChartSession =>
  ({ file, startMs, durationS, distanceM, activityId });

describe('isoWeek', () => {
  it('numérote comme la norme ISO, y compris aux bords d’année', () => {
    expect(isoWeek(at(2026, 9, 25))).toEqual({ year: 2026, week: 39 });
    // Le 1er janvier 2027 est un vendredi : il appartient à la semaine 53 de 2026.
    expect(isoWeek(at(2027, 1, 1))).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(at(2027, 1, 4))).toEqual({ year: 2027, week: 1 });
    // Le 29 décembre 2025 est un lundi de la semaine 1 de 2026.
    expect(isoWeek(at(2025, 12, 29))).toEqual({ year: 2026, week: 1 });
    // Après le passage à l'heure d'été (29 mars 2026).
    expect(isoWeek(at(2026, 3, 30))).toEqual({ year: 2026, week: 14 });
  });

  it('commence la semaine le lundi', () => {
    expect(startOfIsoWeek(at(2026, 9, 27))).toBe(new Date(2026, 8, 21).getTime());
    expect(startOfIsoWeek(at(2026, 9, 21, 0))).toBe(new Date(2026, 8, 21).getTime());
  });
});

describe('buildActivityChart', () => {
  const now = at(2026, 9, 25, 18); // vendredi, semaine 39

  it('semaine : du lundi au dimanche, jours à venir marqués, sessions du même jour empilées', () => {
    const chart = buildActivityChart(
      [session('a', at(2026, 9, 22, 10)), session('b', at(2026, 9, 22, 16), 'trail'), session('c', at(2026, 9, 14))],
      'semaine', now, ['voile', 'trail']
    );
    expect(chart.title).toBe('Semaine 39');
    expect(chart.bars.map((b) => b.label)).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    expect(chart.bars.map((b) => b.future)).toEqual([false, false, false, false, false, true, true]);
    expect(chart.bars[1].stacks).toEqual([{ activityId: 'voile', count: 1 }, { activityId: 'trail', count: 1 }]);
    // La session de la semaine précédente n'entre pas dans les totaux.
    expect(chart.totals.map((t) => [t.activityId, t.sessions])).toEqual([['voile', 1], ['trail', 1]]);
  });

  it('30 jours : un jour par barre, repère de semaine chaque lundi', () => {
    const chart = buildActivityChart([session('a', at(2026, 8, 27)), session('b', at(2026, 8, 26, 23))], 'trente', now, []);
    expect(chart.bars).toHaveLength(30);
    expect(chart.bars[0].label).toBe('S35'); // 27 août
    expect(chart.bars[0].sessions.map((s) => s.file)).toEqual(['a']);
    const mondays = chart.bars.filter((b) => b.weekStart).map((b) => b.label);
    expect(mondays).toEqual(['S36', 'S37', 'S38', 'S39']);
    expect(chart.totals).toEqual([{ activityId: 'voile', sessions: 1, durationS: 3600, distanceM: 10_000 }]);
  });

  it('6 mois et année : une barre par semaine, les totaux cumulés', () => {
    const sessions = [session('a', at(2026, 9, 21)), session('b', at(2026, 9, 27)), session('c', at(2026, 1, 2)), session('d', at(2025, 12, 28))];
    const six = buildActivityChart(sessions, 'sixmois', now, ['voile']);
    expect(six.bars).toHaveLength(26);
    expect(six.bars[25].stacks).toEqual([{ activityId: 'voile', count: 2 }]);
    expect(six.range).toBe('S14 à S39');
    const year = buildActivityChart(sessions, 'annee', now, ['voile']);
    expect(year.bars).toHaveLength(39);
    expect(year.bars[0].label).toBe('S1');
    // Le 28 décembre 2025 est en semaine 52 de 2025 : hors de l'année 2026.
    expect(year.totals).toEqual([{ activityId: 'voile', sessions: 3, durationS: 3 * 3600, distanceM: 30_000 }]);
  });

  it("range une activité inconnue de l'ordre après les autres", () => {
    const chart = buildActivityChart(
      [session('a', at(2026, 9, 23), 'kite'), session('b', at(2026, 9, 23, 14), 'voile')],
      'semaine', now, ['voile']
    );
    expect(chart.bars[2].stacks.map((s) => s.activityId)).toEqual(['voile', 'kite']);
  });
});
