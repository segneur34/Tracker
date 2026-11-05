import {
  AGE_GRADE_AGES, AGE_GRADE_BELOW_LABEL, AGE_GRADE_CLASSES, AGE_GRADE_DISTANCES_M, AGE_GRADE_STANDARDS,
  type AgeGradeDistance, type AgeGradeSex,
} from './ageGradeTables';

/**
 * Pourcentage de la référence de l'âge en course sur route (lot 146) : le temps standard de l'âge et du sexe
 * (`ageGradeTables.ts`, tables WMA et USATF d'Alan Jones) divisé par le temps réalisé. 100 % : le record de
 * l'âge ; les classes des calculateurs WMA et USATF le rangent (mondial, national, régional, local, loisir).
 */

/** Distance des tables qui vaut `distanceM` exactement, `null` sinon. */
const distanceOf = (distanceM: number): AgeGradeDistance | null =>
  (Object.keys(AGE_GRADE_DISTANCES_M) as AgeGradeDistance[]).find((d) => AGE_GRADE_DISTANCES_M[d] === distanceM) ?? null;

/** Temps standard, en secondes, à l'âge (entier, borné aux âges des tables) ; `null` hors des distances des tables. */
export const ageGradeStandardS = (sex: AgeGradeSex, age: number, distanceM: number): number | null => {
  const distance = distanceOf(distanceM);
  if (distance === null || !Number.isFinite(age)) return null;
  const clamped = Math.min(AGE_GRADE_AGES.max, Math.max(AGE_GRADE_AGES.min, Math.floor(age)));
  return AGE_GRADE_STANDARDS[sex][distance][clamped - AGE_GRADE_AGES.min] ?? null;
};

/**
 * Pourcentage de la référence de l'âge, `null` hors des distances des tables (5 km, 10 km, semi, marathon) ou
 * pour un temps qui n'est pas positif. L'âge est borné à 5 et 100 ans.
 */
export const ageGradePercent = (sex: AgeGradeSex, age: number, distanceM: number, timeS: number): number | null => {
  if (!Number.isFinite(timeS) || timeS <= 0) return null;
  const standard = ageGradeStandardS(sex, age, distanceM);
  return standard === null ? null : (standard / timeS) * 100;
};

export type AgeGradeClass = (typeof AGE_GRADE_CLASSES)[number]['key'] | 'loisir';

/** Classe d'un pourcentage : la plus haute dont il atteint le minimum, « loisir » en dessous. */
export const ageGradeClass = (percent: number): { key: AgeGradeClass; label: string } => {
  const found = AGE_GRADE_CLASSES.find((c) => percent >= c.minPercent);
  return found ? { key: found.key, label: found.label } : { key: 'loisir', label: AGE_GRADE_BELOW_LABEL };
};
