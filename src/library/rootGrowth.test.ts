import { describe, expect, it } from 'vitest';
import { levelText, periodIndex, periodStart, rootGrowth, ROOT_GOAL, ROOT_RULES, type RootSession } from './rootGrowth';

/** Instant local : `day` jours après le lundi 5 janvier 2026, à `hour` heures. */
const at = (day: number, hour = 10, minute = 0): number => new Date(2026, 0, 5 + day, hour, minute).getTime();
/** Lundi de la semaine `w` (0 : celle du 5 janvier 2026), à midi. */
const week = (w: number, day = 0): number => at(w * 7 + day, 12);
const session = (w: number, minutes: number, day = 0): RootSession => ({ startMs: at(w * 7 + day), durationS: minutes * 60 });
/** Une session tenue (45 min) chaque semaine de `from` à `to` inclus. */
const held = (from: number, to: number): RootSession[] => Array.from({ length: to - from + 1 }, (_, k) => session(from + k, 45));
const GOAL = ROOT_GOAL.defaultMin;

describe('périodes', () => {
  it('à 7 jours, la période est la semaine du lundi au dimanche', () => {
    // Le 19/10/2026 est un lundi, le 25 un dimanche.
    const monday = periodIndex(new Date(2026, 9, 19, 0, 5).getTime(), 7);
    expect(periodIndex(new Date(2026, 9, 25, 23, 55).getTime(), 7)).toBe(monday);
    expect(periodIndex(new Date(2026, 9, 26, 0, 5).getTime(), 7)).toBe(monday + 1);
    expect(periodStart(monday, 7)).toBe(new Date(2026, 9, 19).getTime());
  });

  it('le passage à l\'heure d\'hiver (25/10) ne décale pas les jours', () => {
    const i = periodIndex(new Date(2026, 9, 24, 12).getTime(), 1);
    expect(periodIndex(new Date(2026, 9, 25, 12).getTime(), 1)).toBe(i + 1);
    expect(periodIndex(new Date(2026, 9, 26, 0, 30).getTime(), 1)).toBe(i + 2);
  });
});

describe('rootGrowth', () => {
  it('la règle du 25/10 : 26 semaines, −3, −6, la graine ; 45 min par défaut', () => {
    expect(ROOT_RULES).toEqual({ periodDays: 7, growthSteps: 26, losses: [3, 6, Infinity] });
    expect(ROOT_GOAL).toEqual({ defaultMin: 45, min: 15, max: 600 });
  });

  it('sans session : la graine', () => {
    const g = rootGrowth([], GOAL, week(0));
    expect(g).toMatchObject({ level: 0, maxLevel: 0, fraction: 0, minutes: 0, held: false, progress: 0, missedInRow: 0, lossStep: 3, losing: false });
  });

  it('une étape par semaine tenue ; la semaine en cours ne compte qu\'à sa fin', () => {
    const g = rootGrowth(held(0, 2), GOAL, week(3));
    expect(g).toMatchObject({ level: 3, growthSteps: 26 });
    expect(g.fraction).toBeCloseTo(3 / 26);
    const now = rootGrowth([...held(0, 2), session(3, 30)], GOAL, week(3, 2));
    expect(now).toMatchObject({ level: 3, minutes: 30, held: false });
    expect(now.progress).toBeCloseTo(30 / 45);
  });

  it('l\'objectif se tient à plusieurs sessions dans la semaine, du lundi au dimanche', () => {
    expect(rootGrowth([session(0, 20, 0), session(0, 25, 6)], GOAL, week(1)).level).toBe(1);
    expect(rootGrowth([session(0, 44)], GOAL, week(1)).level).toBe(0);
  });

  it('semaines manquées d\'affilée : −3, puis −6 de plus, puis la graine', () => {
    const sessions = held(0, 19);
    expect(rootGrowth(sessions, GOAL, week(20)).level).toBe(20);
    expect(rootGrowth(sessions, GOAL, week(21))).toMatchObject({ level: 17, maxLevel: 20, missedInRow: 1, lossStep: 6, losing: true });
    expect(rootGrowth(sessions, GOAL, week(22))).toMatchObject({ level: 11, missedInRow: 2, lossStep: Infinity, losing: true });
    expect(rootGrowth(sessions, GOAL, week(23))).toMatchObject({ level: 0, maxLevel: 20, missedInRow: 3, losing: true });
    // À la graine, plus rien à perdre.
    expect(rootGrowth(sessions, GOAL, week(24))).toMatchObject({ level: 0, losing: false });
  });

  it('une semaine tenue remet le compte à zéro', () => {
    // 10 tenues, 1 manquée (−3), 1 tenue, 1 manquée : de nouveau −3.
    const sessions = [...held(0, 9), session(11, 45)];
    expect(rootGrowth(sessions, GOAL, week(12))).toMatchObject({ level: 8, missedInRow: 0, lossStep: 3, losing: false });
    expect(rootGrowth(sessions, GOAL, week(13))).toMatchObject({ level: 5, missedInRow: 1 });
  });

  it('jamais sous la graine', () => {
    expect(rootGrowth(held(0, 1), GOAL, week(3)).level).toBe(0);
    expect(rootGrowth(held(0, 1), GOAL, week(3)).maxLevel).toBe(2);
  });

  it('au-delà du tour, la racine continue de compter (racine mûre)', () => {
    const g = rootGrowth(held(0, 29), GOAL, week(30));
    expect(g.level).toBe(30);
    expect(g.fraction).toBeCloseTo(30 / 26);
  });

  it('les sessions à venir sont ignorées', () => {
    expect(rootGrowth([session(5, 45)], GOAL, week(2)).level).toBe(0);
  });

  it('une règle passée en paramètre', () => {
    const rules = { periodDays: 1, growthSteps: 10, losses: [1] };
    const g = rootGrowth([0, 1, 2].map((d) => ({ startMs: at(d), durationS: 1200 })), 15, at(5, 12), rules);
    expect(g).toMatchObject({ level: 1, maxLevel: 3, growthSteps: 10, lossStep: 1 });
  });
});

describe('levelText', () => {
  it('entier, ou une décimale', () => {
    expect(levelText(4)).toBe('4');
    expect(levelText(3.5)).toBe('3,5');
  });
});
