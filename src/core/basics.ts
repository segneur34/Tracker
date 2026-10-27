/**
 * Petites briques sans domaine, communes à tout le code : borne d'un nombre,
 * gardes de type des lectures de fichiers, pluriel d'un compte. Pur.
 */

/** Valeur ramenée dans `[min, max]`. */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Objet simple (ni `null`, ni tableau), pour lire un JSON de confiance limitée. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nombre fini (ni `NaN`, ni infini). */
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

/** « 1 session », « 3 sessions » : le compte suivi du mot, accordé. */
export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;
