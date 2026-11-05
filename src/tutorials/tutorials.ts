import type { SportFamily } from '../core/sportProfiles';
import { LESSONS, type Lesson } from './lessons';

/**
 * Tutoriels, règles pures (lot 147) : quelle leçon montrer aujourd'hui, et
 * l'état gardé sur l'appareil (jours d'ouverture, leçons lues, carte fermée).
 * Le jour n (n-ième jour civil distinct où l'application a été ouverte,
 * aujourd'hui compris) montre la n-ième leçon du programme, celles des
 * familles cachées sautées ; au-delà du programme, plus de carte.
 */

/** État des tutoriels sur cet appareil. */
export interface TutorialState {
  /** Jours d'ouverture, `AAAA-MM-JJ` locaux, dans l'ordre, chacun une fois. */
  days: string[];
  /** Identifiants des leçons lues. */
  read: string[];
  /** Jour où la carte du jour a été fermée, `null` sinon. */
  dismissed: string | null;
}

export const EMPTY_TUTORIAL_STATE: TutorialState = { days: [], read: [], dismissed: null };

/** Jours gardés au plus : bien au-delà du programme, sans grossir sans fin. */
export const TUTORIAL_DAYS_MAX = 400;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Jour civil local de `date`, `AAAA-MM-JJ`. */
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Relecture contrôlée de l'état rangé (il peut venir d'une version ancienne ou être abîmé). */
export const readTutorialState = (raw: unknown): TutorialState => {
  if (!raw || typeof raw !== 'object') return EMPTY_TUTORIAL_STATE;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const days = [...new Set(strings(r.days).filter((d) => DAY_RE.test(d)))].slice(-TUTORIAL_DAYS_MAX);
  return {
    days,
    read: [...new Set(strings(r.read))],
    dismissed: typeof r.dismissed === 'string' && DAY_RE.test(r.dismissed) ? r.dismissed : null,
  };
};

/** L'application ouverte `today` : le jour compté une fois. L'état rendu tel quel s'il l'est déjà. */
export const markOpened = (state: TutorialState, today: string): TutorialState =>
  state.days.includes(today) ? state : { ...state, days: [...state.days, today].slice(-TUTORIAL_DAYS_MAX) };

/** La carte du jour fermée d'un toucher : elle ne revient pas de la journée. */
export const dismissToday = (state: TutorialState, today: string): TutorialState =>
  state.dismissed === today ? state : { ...state, dismissed: today };

/** Une leçon ouverte : elle est lue. */
export const markRead = (state: TutorialState, id: string): TutorialState =>
  state.read.includes(id) ? state : { ...state, read: [...state.read, id] };

/** Leçons du programme montrées : celles dont une famille au moins est visible, ou sans famille. */
export const shownLessons = (hiddenFamilies: readonly SportFamily[], lessons: readonly Lesson[] = LESSONS): Lesson[] =>
  lessons.filter((l) => !l.families || l.families.length === 0 || l.families.some((f) => !hiddenFamilies.includes(f)));

/** Leçon du jour `dayIndex` (1 : le premier jour d'ouverture), familles cachées sautées ; `null` au-delà du programme. */
export const lessonOfDay = (dayIndex: number, hiddenFamilies: readonly SportFamily[], lessons: readonly Lesson[] = LESSONS): Lesson | null => {
  if (!Number.isInteger(dayIndex) || dayIndex < 1) return null;
  return shownLessons(hiddenFamilies, lessons)[dayIndex - 1] ?? null;
};

/** Rang de `today` parmi les jours d'ouverture (1 pour le premier) ; pas encore compté, le jour suivant le dernier. */
export const dayIndexOf = (state: TutorialState, today: string): number => {
  const at = state.days.indexOf(today);
  return at >= 0 ? at + 1 : state.days.length + 1;
};

/**
 * Leçon de la carte du jour, `null` s'il n'y en a pas : au-delà du programme,
 * carte fermée aujourd'hui, ou leçon déjà lue (depuis la carte ou la liste).
 */
export const todayLesson = (
  state: TutorialState, today: string, hiddenFamilies: readonly SportFamily[], lessons: readonly Lesson[] = LESSONS,
): Lesson | null => {
  if (state.dismissed === today) return null;
  const lesson = lessonOfDay(dayIndexOf(state, today), hiddenFamilies, lessons);
  return lesson && !state.read.includes(lesson.id) ? lesson : null;
};

/**
 * Ordre de l'accueil : la mémoire, les autorisations, le pop-up du profil, puis la carte du jour,
 * qui ne s'empile pas sur eux. `wait` tant que l'un n'est pas décidé (`null`) ; `blocked` si l'un
 * est à l'écran : elle attend alors le lancement suivant ; `free` sinon.
 */
export const tutorialCardGate = ({ memoryNeedsAction, memoryReady, permissionsShown, profileShown }: {
  memoryNeedsAction: boolean;
  memoryReady: boolean;
  permissionsShown: boolean | null;
  profileShown: boolean | null;
}): 'wait' | 'blocked' | 'free' => {
  if (memoryNeedsAction || permissionsShown === true || profileShown === true) return 'blocked';
  if (!memoryReady || permissionsShown === null || profileShown === null) return 'wait';
  return 'free';
};
