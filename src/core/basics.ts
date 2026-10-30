/**
 * Petites briques sans domaine, communes à tout le code : borne d'un nombre,
 * gardes de type et lectures de fichiers, arrondis, moyenne, médianes, message d'une
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

const JSON_INDENT = '  ';

/** Élément d'un tableau écrit sur une ligne : nombre, `null` ou booléen. */
const isFlatJsonItem = (value: unknown): boolean => value === null || typeof value === 'number' || typeof value === 'boolean';

/** Tableau écrit sur une ligne : nombres, `null` ou booléens, ou tableaux de tels éléments (voies, courbes). */
const isFlatJsonArray = (array: readonly unknown[]): boolean =>
  array.every((item) => isFlatJsonItem(item) || (Array.isArray(item) && item.every(isFlatJsonItem)));

/** Texte JSON d'une valeur sous la clé `key`, en retrait `pad` ; `undefined` : valeur omise (comme `JSON.stringify`). */
const writeJson = (value: unknown, key: string, pad: string): string | undefined => {
  let v = value;
  if (typeof v === 'object' && v !== null && typeof (v as { toJSON?: unknown }).toJSON === 'function') {
    v = (v as { toJSON: (key: string) => unknown }).toJSON(key);
  }
  if (typeof v !== 'object' || v === null || v instanceof Number || v instanceof String || v instanceof Boolean) return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (isFlatJsonArray(v)) return JSON.stringify(v);
    const inner = pad + JSON_INDENT;
    const items: string[] = [];
    for (let i = 0; i < v.length; i++) items.push(inner + (writeJson(v[i], String(i), inner) ?? 'null'));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  const inner = pad + JSON_INDENT;
  const entries: string[] = [];
  for (const k of Object.keys(v)) {
    const text = writeJson((v as Record<string, unknown>)[k], k, inner);
    if (text !== undefined) entries.push(`${inner}${JSON.stringify(k)}: ${text}`);
  }
  return entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${pad}}`;
};

/**
 * Texte JSON lisible et compact, pour les fichiers du dossier mémoire (fiches,
 * réglages) : objets indentés de deux espaces comme `JSON.stringify(value,
 * null, 2)`, mais un tableau de nombres (altitude, histogramme, courbe, voies)
 * sur une seule ligne. `JSON.parse` en relit exactement la même valeur.
 */
export function stringifyJson(value: object): string;
export function stringifyJson(value: unknown): string | undefined;
export function stringifyJson(value: unknown): string | undefined {
  return writeJson(value, '', '');
}

/** Moyenne d'une liste de nombres ; `null` si elle est vide. */
export const meanOf = (values: readonly number[]): number | null =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/** Médiane d'une suite rangée par ordre croissant (0 si elle est vide) : moyenne des deux valeurs centrales pour un nombre pair. */
export const medianOfSorted = (sorted: ArrayLike<number>): number => {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Médiane d'une liste (0 si elle est vide), comme `medianOfSorted` ; la liste n'est pas touchée. */
export const median = (values: number[]): number =>
  values.length === 0 ? 0 : medianOfSorted([...values].sort((a, b) => a - b));

/**
 * Médiane haute d'une suite rangée par ordre croissant : la valeur du milieu,
 * la plus haute des deux centrales pour un nombre pair, sans moyenne (mesures
 * des capteurs, cadence). Une suite vide ne rend rien d'utilisable.
 */
export const upperMedianOfSorted = (sorted: ArrayLike<number>): number => sorted[Math.floor(sorted.length / 2)];

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
