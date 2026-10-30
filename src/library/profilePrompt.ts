import { inRange } from '../core/basics';
import { RUNNER_BOUNDS, runnerName, type RunnerNumberField, type RunnerProfile } from '../running/runnerProfile';
import { ROOT_GOAL } from './rootGrowth';

/**
 * Règles du Profil liées à la mémoire et à l'accueil, pures (lot 72) :
 * objectif de la racine, champs que le pop-up demande, et quand il s'ouvre.
 */

/** Plages plausibles de chaque champ numérique du Profil, objectif de la racine compris. */
export const PROFILE_BOUNDS: Record<RunnerNumberField, [number, number]> = {
  ...RUNNER_BOUNDS,
  rootWeeklyGoalMin: [ROOT_GOAL.min, ROOT_GOAL.max],
};

/** Une valeur numérique saisie et dans sa plage (relue avec contrôle : fichier de réglages importé). */
export const validProfileNumber = (field: RunnerNumberField, raw: unknown): boolean => {
  const [lo, hi] = PROFILE_BOUNDS[field];
  return inRange(raw, lo, hi);
};

/**
 * Objectif par semaine de la racine du Profil, `ROOT_GOAL.defaultMin` à défaut ;
 * relu avec contrôle (fichier de réglages importé) : une valeur hors plage est
 * ignorée. Les anciens réglages de la racine (période, tour, recul, objectif
 * par période d'essai du 22/10) sont sans effet.
 */
export const runnerRootGoalMin = (profile: Partial<Pick<RunnerProfile, 'rootWeeklyGoalMin'>>): number => {
  const raw: unknown = profile.rootWeeklyGoalMin;
  const [lo, hi] = PROFILE_BOUNDS.rootWeeklyGoalMin;
  return inRange(raw, lo, hi) ? raw : ROOT_GOAL.defaultMin;
};

/** Champs que le pop-up de l'accueil demande tant qu'ils manquent ; la FC max et la FC repos viennent des tests. */
export const PROFILE_PROMPT_FIELDS = ['name', 'birthYear', 'sex', 'weightKg', 'heightCm'] as const;
export type ProfilePromptField = (typeof PROFILE_PROMPT_FIELDS)[number];

/** Champs du pop-up qui manquent au profil, dans leur ordre ; vide : le profil est rempli. */
export const missingProfileFields = (profile: Partial<RunnerProfile>): ProfilePromptField[] =>
  PROFILE_PROMPT_FIELDS.filter((field) => {
    switch (field) {
      case 'name': return runnerName({ name: profile.name ?? null }) === null;
      case 'sex': return profile.sex !== 'f' && profile.sex !== 'm';
      default: return !validProfileNumber(field, profile[field]);
    }
  });

/**
 * Le pop-up du profil s'ouvre-t-il sur l'accueil ? Dans l'application seulement,
 * une fois par lancement, tant qu'un champ manque, et jamais par-dessus la carte
 * de la mémoire ou celle des autorisations (il attend alors le lancement suivant).
 */
export const shouldPromptProfile = ({ native, missing, askedThisLaunch, otherCardShown }: {
  native: boolean;
  missing: readonly ProfilePromptField[];
  askedThisLaunch: boolean;
  otherCardShown: boolean;
}): boolean => native && missing.length > 0 && !askedThisLaunch && !otherCardShown;

/**
 * Ordre de l'accueil : la mémoire, puis les autorisations, puis le profil. Le pop-up
 * n'est posé qu'une fois les deux décidées (`permissionsShown` : `null` tant que les
 * autorisations ne sont pas lues) ; `otherCardShown` : l'une d'elles est à l'écran.
 */
export const profilePromptGate = ({ memoryNeedsAction, memoryReady, permissionsShown }: {
  memoryNeedsAction: boolean;
  memoryReady: boolean;
  permissionsShown: boolean | null;
}): { mount: boolean; otherCardShown: boolean } => ({
  mount: memoryNeedsAction || (memoryReady && permissionsShown !== null),
  otherCardShown: memoryNeedsAction || permissionsShown === true,
});
