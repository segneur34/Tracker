/**
 * Petites briques sans domaine, communes à tout le code : borne d'un nombre,
 * gardes de type et lectures de fichiers, arrondis, moyenne, message d'une
 * erreur, pluriel d'un compte, identifiant tiré au hasard. Pur, hors `newId`.
 */

/** Valeur ramenée dans `[min, max]`. */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Objet simple (ni `null`, ni tableau), pour lire un JSON de confiance limitée. */
export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nombre fini (ni `NaN`, ni infini). */
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && isFinite(value);

/** Nombre fini compris (bornes comprises) entre `min` et `max`. */
export const inRange = (value: unknown, min: number, max: number): value is number =>
  isFiniteNumber(value) && value >= min && value <= max;

/** Le nombre s'il est fini, sinon `fallback` (`null`, `undefined` ou une valeur par défaut). */
export const finiteOr = <T>(value: unknown, fallback: T): number | T => (isFiniteNumber(value) ? value : fallback);

/** Texte JSON lu ; `undefined` s'il est illisible (jamais d'exception). */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Moyenne d'une liste de nombres ; `null` si elle est vide. */
export const meanOf = (values: readonly number[]): number | null =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/** Arrondi à `decimals` décimales par `Math.round` (2,675 donne 2,68). */
export const roundTo = (x: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(x * factor) / factor;
};

/** Arrondi à `decimals` décimales par `toFixed` (2,675 donne 2,67) : pas la même formule que `roundTo`. */
export const toFixedNumber = (x: number, decimals: number): number => parseFloat(x.toFixed(decimals));

/** Message d'une erreur attrapée ; `fallback` si ce n'est pas une `Error` ou si son message est vide. */
export const errorMessage = (err: unknown, fallback = 'erreur inconnue'): string =>
  err instanceof Error && err.message ? err.message : fallback;

/** Commande datée d'un journal (chrono, compteur) : un genre connu et l'instant. */
export interface DatedCommand<K extends string> {
  kind: K;
  atMs: number;
}

/**
 * Commandes d'un journal relues : celles dont le genre est dans `kinds` et
 * l'instant un nombre fini, les autres écartées ; `null` si `raw` n'est pas une liste.
 */
export const readCommands = <K extends string>(raw: unknown, kinds: readonly K[]): DatedCommand<K>[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: DatedCommand<K>[] = [];
  for (const c of raw) {
    if (typeof c !== 'object' || c === null) continue;
    const { kind, atMs } = c as Record<string, unknown>;
    if (kinds.includes(kind as K) && typeof atMs === 'number' && isFinite(atMs)) out.push({ kind: kind as K, atMs });
  }
  return out;
};

/** Rang d'une valeur parmi des bornes croissantes : 0 sous la première, puis 1 à `bounds.length`. */
export const bandIndex = (value: number, bounds: readonly number[]): number => {
  let band = 0;
  for (const b of bounds) if (value >= b) band++;
  return band;
};

/** « 1 session », « 3 sessions » : le compte suivi du mot, accordé. */
export const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Identifiant tiré au hasard, stable une fois rangé : `crypto.randomUUID`, sinon l'heure et un tirage. */
export const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
