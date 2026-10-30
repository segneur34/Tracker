import type { BikeType } from '../core/domainTypes';
import type { Treatment } from '../core/sportProfiles';
import { WAY_TYPES, type WayType } from './brouterProfile';

/**
 * Types de voie cochés d'un tronçon et d'un réglage, sans autre dépendance
 * (lot 72) : les réglages des activités les lisent sans tirer `route.ts` dans
 * le paquet du démarrage.
 */

/** Séparateur des types dans un mode : `route+grandeRoute`. */
export const WAYS_SEPARATOR = '+';

/** Types optionnels, mis bout à bout dans l'ordre de `WAY_TYPES` ; `''` pour aucun. */
type JoinWays<A extends string, B extends string> = A extends '' ? B : B extends '' ? A : `${A}${typeof WAYS_SEPARATOR}${B}`;
type OptionalWay<T extends WayType> = T | '';

/**
 * Mode d'un tronçon calculé : les types cochés, dans l'ordre de `WAY_TYPES`,
 * joints par « + » (`route+grandeRoute`). Un seul type garde son nom : les
 * fiches et préférences d'avant les cases (`piste`, `grandeRoute`…) se
 * relisent telles quelles ; « Chemin », devenu « Sentier », est traduit
 * (`readRouteMode`).
 */
export type WaysMode = Exclude<
  JoinWays<JoinWays<JoinWays<OptionalWay<'sentier'>, OptionalWay<'piste'>>, OptionalWay<'route'>>, OptionalWay<'grandeRoute'>>,
  ''
>;

/** Mode des types donnés, remis dans l'ordre et sans doublon ; `null` sans aucun type. */
export const waysMode = (types: Iterable<WayType>): WaysMode | null => {
  const chosen = new Set(types);
  const kept = WAY_TYPES.filter((t) => chosen.has(t));
  // Types connus, dans l'ordre : la chaîne est bien un `WaysMode`.
  return kept.length > 0 ? (kept.join(WAYS_SEPARATOR) as WaysMode) : null;
};

/** Types de voie d'un mode, dans l'ordre de `WAY_TYPES`. */
export const wayTypesOf = (mode: WaysMode): WayType[] => {
  const parts = mode.split(WAYS_SEPARATOR);
  return WAY_TYPES.filter((t) => parts.includes(t));
};

export const isWayType = (value: string): value is WayType => (WAY_TYPES as readonly string[]).includes(value);

/** À vélo, types de voie cochés d'office selon le type de vélo (§10, point 81). */
export const BIKE_WAY_TYPES: Record<BikeType, WayType[]> = {
  route: ['route'],
  ville: ['route'],
  gravel: ['piste'],
  vtt: ['sentier', 'piste'],
};

/**
 * Types de voie cochés d'office en planification pour une activité qui n'en
 * a pas de réglés ni de pré-réglés (`settings/activityPresets.ts`) : selon son
 * type de vélo, la route à pied ; aucun en voile, où les balises sont
 * reliées en ligne droite.
 */
export const presetWayTypes = (treatment: Treatment, bikeType: BikeType): WayType[] => {
  if (treatment === 'velo') return BIKE_WAY_TYPES[bikeType];
  return treatment === 'course' ? ['route'] : [];
};

/** Types de voie d'un réglage : connus, dans l'ordre, sans doublon ; `null` si la valeur n'en est pas une liste non vide. */
export const sanitizeWayTypes = (value: unknown): WayType[] | null => {
  if (!Array.isArray(value) || !value.every((v): v is WayType => typeof v === 'string' && isWayType(v))) return null;
  const mode = waysMode(value);
  return mode ? wayTypesOf(mode) : null;
};
