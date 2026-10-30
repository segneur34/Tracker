import type { GearGroup, GearItem } from '../library/notes';
import { newId } from '../core/basics';
import type { StoredSettings } from './activitySettings';

/**
 * Matériel d'une activité, pur (lot 72) : intitulés des deux champs des notes
 * hors voile, et matériel enregistré (groupes et pièces), relus et nettoyés.
 * La lecture et l'écriture du magasin restent dans `hooks/useSportSettings.ts`.
 */

/** Intitulés des champs de matériel des notes à défaut de réglage. */
export const DEFAULT_GEAR_LABELS: [string, string] = ['Matériel 1', 'Matériel 2'];
export const MAX_GEAR_LABEL_LENGTH = 30;

/** Intitulés de matériel rognés et tronqués ; `null` s'ils sont mal formés ou tous deux vides (intitulés par défaut). */
export const sanitizeGearLabels = (value: unknown): [string, string] | null => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'string')) return null;
  const labels = value.map((v: string) => v.trim().slice(0, MAX_GEAR_LABEL_LENGTH)) as [string, string];
  return labels[0] === '' && labels[1] === '' ? null : labels;
};

/** Intitulés effectifs : ceux réglés, chacun remplacé par le défaut s'il est vide. */
export const resolveGearLabels = (stored: StoredSettings, id: string): [string, string] => {
  const own = sanitizeGearLabels(stored.gearLabels?.[id]);
  return [own?.[0] || DEFAULT_GEAR_LABELS[0], own?.[1] || DEFAULT_GEAR_LABELS[1]];
};

/** Nom d'un groupe ou d'une pièce : rogné, tronqué ; vide s'il n'est pas un texte. */
export const cleanGearName = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_GEAR_LABEL_LENGTH) : '';

/** Même nom, aux espaces et à la casse près. */
export const sameGearName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

/**
 * Matériel enregistré relu : noms rognés et tronqués, groupes et pièces sans
 * identifiant ou sans nom écartés, identifiants en double écartés, ceux qui
 * restent gardés tels quels ; `null` s'il n'est pas une liste (option coupée).
 * Une liste vide est gardée : l'option est cochée, rien n'est encore créé.
 */
export const sanitizeGearGroups = (value: unknown): GearGroup[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const fresh = (id: unknown): id is string => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  return value.flatMap((group): GearGroup[] => {
    if (typeof group !== 'object' || group === null) return [];
    const { id, name, items } = group as { id?: unknown; name?: unknown; items?: unknown };
    const groupName = cleanGearName(name);
    if (groupName === '' || !fresh(id)) return [];
    const kept = (Array.isArray(items) ? items : []).flatMap((item): GearItem[] => {
      if (typeof item !== 'object' || item === null) return [];
      const itemName = cleanGearName((item as { name?: unknown }).name);
      const itemId = (item as { id?: unknown }).id;
      return itemName !== '' && fresh(itemId) ? [{ id: itemId, name: itemName }] : [];
    });
    return [{ id, name: groupName, items: kept }];
  });
};

/**
 * Liste avec une pièce de plus dans un groupe ; une pièce du même nom déjà
 * dans le groupe est reprise plutôt que doublée. `null` si le nom est vide ou
 * le groupe introuvable.
 */
export const withGearItem = (
  groups: readonly GearGroup[], groupId: string, name: string, id: string = newId()
): { groups: GearGroup[]; item: GearItem } | null => {
  const clean = cleanGearName(name);
  const group = groups.find((g) => g.id === groupId);
  if (clean === '' || !group) return null;
  const existing = group.items.find((item) => sameGearName(item.name, clean));
  if (existing) return { groups: [...groups], item: existing };
  const item = { id, name: clean };
  return { groups: groups.map((g) => (g.id === groupId ? { ...g, items: [...g.items, item] } : g)), item };
};

/** Matériel enregistré en vigueur : `null` si l'option est coupée ou qu'aucun groupe n'est créé (champs de texte d'avant). */
export const resolveGearGroups = (stored: StoredSettings, id: string): GearGroup[] | null => {
  const groups = sanitizeGearGroups(stored.gearGroups?.[id]);
  return groups && groups.length > 0 ? groups : null;
};
