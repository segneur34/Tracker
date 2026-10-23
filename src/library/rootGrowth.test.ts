import { describe, expect, it } from 'vitest';
import { levelText, periodIndex, periodStart, rootGrowth, ROOT_DEFAULTS, type RootSession, type RootSettings } from './rootGrowth';

/** Instant local : `day` d'octobre 2026, à `hour` heures. */
const at = (day: number, hour = 10, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();
const session = (day: number, minutes: number, hour = 10): RootSession => ({ startMs: at(day, hour), durationS: minutes * 60 });

const DAILY: RootSettings = { goalMin: 15, periodDays: 1, growthPeriods: 15, lossPeriods: 30 };
const WEEKLY: RootSettings = { goalMin: 15, periodDays: 7, growthPeriods: 26, lossPeriods: 6.5 };

describe('périodes', () => {
  it('une période d\'un jour va de minuit à minuit', () => {
    const i = periodIndex(at(20, 23, 59), 1);
    expect(periodIndex(at(21, 0, 1), 1)).toBe(i + 1);
    expect(periodStart(i, 1)).toBe(new Date(2026, 9, 20).getTime());
  });

  it('à 7 jours, la période est la semaine du lundi au dimanche', () => {
    // Le 19/10/2026 est un lundi, le 25 un dimanche.
    const monday = periodIndex(at(19, 0, 5), 7);
    expect(periodIndex(at(25, 23, 55), 7)).toBe(monday);
    expect(periodIndex(at(26, 0, 5), 7)).toBe(monday + 1);
    expect(periodStart(monday, 7)).toBe(new Date(2026, 9, 19).getTime());
  });

  it('le passage à l\'heure d\'hiver (25/10) ne décale pas les jours', () => {
    const i = periodIndex(at(24, 12), 1);
    expect(periodIndex(at(25, 12), 1)).toBe(i + 1);
    expect(periodIndex(at(26, 0, 30), 1)).toBe(i + 2);
  });
});

describe('rootGrowth', () => {
  it('sans session : la graine', () => {
    const g = rootGrowth([], DAILY, at(22, 12));
    expect(g).toMatchObject({ level: 0, maxLevel: 0, fraction: 0, minutes: 0, held: false, progress: 0 });
  });

  it('une étape par jour tenu ; la période en cours ne compte qu\'à sa fin', () => {
    const g = rootGrowth([session(19, 20), session(20, 30), session(21, 16)], DAILY, at(22, 12));
    expect(g.level).toBe(3);
    expect(g.fraction).toBeCloseTo(3 / 15);
    const today = rootGrowth([session(19, 20), session(20, 30), session(21, 16), session(22, 40, 8)], DAILY, at(22, 12));
    expect(today.level).toBe(3);
    expect(today).toMatchObject({ minutes: 40, held: true, progress: 1 });
  });

  it('l\'objectif se tient à plusieurs sessions dans la période', () => {
    const g = rootGrowth([session(20, 8, 9), session(20, 8, 18)], DAILY, at(22, 12));
    // Le 20 tenu (16 min), le 21 manqué : 1 − 0,5.
    expect(g.level).toBe(0.5);
  });

  it('sous l\'objectif, la période est manquée', () => {
    const g = rootGrowth([session(20, 14)], DAILY, at(21, 12));
    expect(g.level).toBe(0);
  });

  it('un jour manqué recule d\'un trentième de tour (15 / 30 = 0,5 étape), jamais sous la graine', () => {
    const sessions = [18, 19, 20, 21].map((d) => session(d, 20));
    expect(rootGrowth(sessions, DAILY, at(22, 12)).level).toBe(4);
    // Le 22 et le 23 manqués.
    const later = rootGrowth(sessions, DAILY, at(24, 12));
    expect(later).toMatchObject({ level: 3, maxLevel: 4, lossStep: 0.5 });
    expect(rootGrowth(sessions, DAILY, at(31, 12)).level).toBe(0);
  });

  it('en train de tuer la racine : la dernière période close manquée, avec de quoi perdre', () => {
    const sessions = [18, 19, 20, 21].map((d) => session(d, 20));
    expect(rootGrowth(sessions, DAILY, at(22, 12)).losing).toBe(false);
    expect(rootGrowth(sessions, DAILY, at(23, 12)).losing).toBe(true);
    // Le 23 tenu : la racine repart, plus rien ne pend.
    expect(rootGrowth([...sessions, session(23, 20)], DAILY, at(24, 12)).losing).toBe(false);
    // Revenue à la graine : plus rien à perdre.
    expect(rootGrowth(sessions, DAILY, at(31, 12))).toMatchObject({ level: 0, losing: false });
  });

  it('à la semaine, une semaine manquée coûte 4 étapes (26 / 6,5)', () => {
    // Semaines du 28/09, du 05/10 et du 12/10 tenues, celle du 19/10 vide ; on est le lundi 26.
    const sessions = [session(1, 20), session(7, 20), session(14, 20)];
    const g = rootGrowth(sessions, WEEKLY, at(26, 12));
    expect(g).toMatchObject({ level: 0, maxLevel: 3, lossStep: 4 });
    expect(rootGrowth([...sessions, session(21, 20)], WEEKLY, at(26, 12)).level).toBe(4);
  });

  it('au-delà du tour, la racine continue de compter (racine mûre)', () => {
    const sessions = Array.from({ length: 20 }, (_, k) => session(2 + k, 20));
    const g = rootGrowth(sessions, DAILY, at(22, 12));
    expect(g.level).toBe(20);
    expect(g.fraction).toBeCloseTo(20 / 15);
  });

  it('les sessions à venir sont ignorées', () => {
    expect(rootGrowth([session(25, 30)], DAILY, at(22, 12)).level).toBe(0);
  });

  it('les valeurs d\'essai par défaut', () => {
    expect(ROOT_DEFAULTS).toEqual(DAILY);
  });
});

describe('levelText', () => {
  it('entier, ou une décimale', () => {
    expect(levelText(4)).toBe('4');
    expect(levelText(3.5)).toBe('3,5');
  });
});
