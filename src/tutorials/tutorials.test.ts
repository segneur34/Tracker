import { describe, expect, it } from 'vitest';
import { LESSONS, type Lesson } from './lessons';
import {
  EMPTY_TUTORIAL_STATE, TUTORIAL_DAYS_MAX, dayIndexOf, dayKey, dismissToday, lessonOfDay, markOpened, markRead,
  readTutorialState, shownLessons, todayLesson, tutorialCardGate,
} from './tutorials';

const lesson = (id: string, families?: Lesson['families']): Lesson => ({ id, title: id, hook: id, families, icon: 'analyse', target: '/', body: [id] });

describe('programme des tutoriels', () => {
  it('quatorze leçons, identifiants uniques, chacune avec un titre, une accroche et 3 à 6 paragraphes', () => {
    expect(LESSONS).toHaveLength(14);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(14);
    for (const l of LESSONS) {
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.hook.length).toBeGreaterThan(0);
      expect(l.body.length).toBeGreaterThanOrEqual(3);
      expect(l.body.length).toBeLessThanOrEqual(6);
    }
  });

  it('jour 1 : enregistrer une session', () => {
    expect(lessonOfDay(1, [])?.id).toBe('enregistrer');
    expect(lessonOfDay(1, [])?.title).toBe('Enregistrer une session');
  });

  it('une famille cachée : sa leçon est sautée, le jour montre la suivante', () => {
    const lessons = [lesson('a'), lesson('b'), lesson('voile', ['voile']), lesson('d')];
    expect(lessonOfDay(3, [], lessons)?.id).toBe('voile');
    expect(lessonOfDay(3, ['voile'], lessons)?.id).toBe('d');
    // Le vrai programme : la leçon de la voile (12e) cède la place aux sauts.
    expect(lessonOfDay(12, [])?.id).toBe('voile');
    expect(lessonOfDay(12, ['voile'])?.id).toBe('capteurs');
  });

  it("une leçon de deux familles n'est sautée que si les deux sont cachées", () => {
    expect(shownLessons(['voile']).some((l) => l.id === 'capteurs')).toBe(true);
    expect(shownLessons(['voile', 'velo']).some((l) => l.id === 'capteurs')).toBe(false);
  });

  it('au-delà du programme : plus de leçon', () => {
    expect(lessonOfDay(14, [])?.id).toBe('partage');
    expect(lessonOfDay(15, [])).toBeNull();
    expect(lessonOfDay(14, ['voile'])).toBeNull();
    expect(lessonOfDay(0, [])).toBeNull();
  });
});

describe('état des tutoriels', () => {
  it('la même journée ouverte deux fois ne compte qu\'une fois', () => {
    const once = markOpened(EMPTY_TUTORIAL_STATE, '2026-11-05');
    const twice = markOpened(once, '2026-11-05');
    expect(twice).toBe(once);
    expect(twice.days).toEqual(['2026-11-05']);
    expect(dayIndexOf(markOpened(twice, '2026-11-07'), '2026-11-07')).toBe(2);
  });

  it("un jour pas encore compté est le suivant du dernier", () => {
    expect(dayIndexOf(EMPTY_TUTORIAL_STATE, '2026-11-05')).toBe(1);
    expect(dayIndexOf({ ...EMPTY_TUTORIAL_STATE, days: ['2026-11-01', '2026-11-03'] }, '2026-11-05')).toBe(3);
    expect(dayIndexOf({ ...EMPTY_TUTORIAL_STATE, days: ['2026-11-01', '2026-11-03'] }, '2026-11-01')).toBe(1);
  });

  it('la carte du jour : la leçon du jour, rien une fois fermée aujourd\'hui, de retour le lendemain', () => {
    const day1 = markOpened(EMPTY_TUTORIAL_STATE, '2026-11-05');
    expect(todayLesson(day1, '2026-11-05', [])?.id).toBe('enregistrer');
    const closed = dismissToday(day1, '2026-11-05');
    expect(todayLesson(closed, '2026-11-05', [])).toBeNull();
    const day2 = markOpened(closed, '2026-11-06');
    expect(todayLesson(day2, '2026-11-06', [])?.id).toBe('analyse');
  });

  it('une leçon lue ne revient pas sur la carte', () => {
    const day1 = markRead(markOpened(EMPTY_TUTORIAL_STATE, '2026-11-05'), 'enregistrer');
    expect(todayLesson(day1, '2026-11-05', [])).toBeNull();
    expect(markRead(day1, 'enregistrer')).toBe(day1);
  });

  it('au-delà du programme : plus de carte', () => {
    const days = Array.from({ length: 15 }, (_, k) => `2026-10-${String(k + 1).padStart(2, '0')}`);
    expect(todayLesson({ ...EMPTY_TUTORIAL_STATE, days }, '2026-10-15', [])).toBeNull();
  });

  it(`relecture contrôlée, jours plafonnés à ${TUTORIAL_DAYS_MAX}`, () => {
    expect(readTutorialState(null)).toEqual(EMPTY_TUTORIAL_STATE);
    expect(readTutorialState({ days: ['2026-11-05', 'x', 3, '2026-11-05'], read: ['a', 1], dismissed: 'hier' }))
      .toEqual({ days: ['2026-11-05'], read: ['a'], dismissed: null });
    const many = Array.from({ length: TUTORIAL_DAYS_MAX + 20 }, (_, k) => dayKey(new Date(2025, 0, 1 + k)));
    const read = readTutorialState({ days: many, read: [], dismissed: '2026-11-05' });
    expect(read.days).toHaveLength(TUTORIAL_DAYS_MAX);
    expect(read.dismissed).toBe('2026-11-05');
    let state = { ...EMPTY_TUTORIAL_STATE, days: read.days };
    state = markOpened(state, '2030-01-01');
    expect(state.days).toHaveLength(TUTORIAL_DAYS_MAX);
    expect(state.days.at(-1)).toBe('2030-01-01');
  });

  it('jour local, sur deux chiffres', () => {
    expect(dayKey(new Date(2026, 0, 3, 23, 59))).toBe('2026-01-03');
    expect(dayKey(new Date(2026, 10, 25, 0, 1))).toBe('2026-11-25');
  });
});

describe("garde de la carte du jour sur l'accueil", () => {
  const base = { memoryNeedsAction: false, memoryReady: true, permissionsShown: false, profileShown: false };
  it('libre quand rien d\'autre n\'est à l\'écran', () => {
    expect(tutorialCardGate(base)).toBe('free');
  });
  it('attend que la mémoire, les autorisations et le profil soient décidés', () => {
    expect(tutorialCardGate({ ...base, memoryReady: false })).toBe('wait');
    expect(tutorialCardGate({ ...base, permissionsShown: null })).toBe('wait');
    expect(tutorialCardGate({ ...base, profileShown: null })).toBe('wait');
  });
  it("ne s'empile pas sur la mémoire, les autorisations ni le pop-up du profil", () => {
    expect(tutorialCardGate({ ...base, memoryNeedsAction: true, memoryReady: false, permissionsShown: null, profileShown: null })).toBe('blocked');
    expect(tutorialCardGate({ ...base, permissionsShown: true, profileShown: null })).toBe('blocked');
    expect(tutorialCardGate({ ...base, profileShown: true })).toBe('blocked');
  });
});
