/**
 * Index d'une liste par une clé, tenu tant que la liste garde son identité (lot 113) : la liste des sessions
 * de la bibliothèque et celle qu'elle publie sont toujours remplacées, jamais modifiées en place.
 */

/** Index d'une liste par une clé, la première de chaque clé gardée (comme `find`). */
export type ListIndex<T, K> = WeakMap<readonly T[], Map<K, T>>;

/** Index de `list` par `key`, fait au premier appel pour cette liste puis repris tel quel. */
export const indexed = <T, K>(index: ListIndex<T, K>, list: readonly T[], key: (item: T) => K): Map<K, T> => {
  let map = index.get(list);
  if (!map) {
    map = new Map();
    for (const item of list) {
      const k = key(item);
      if (!map.has(k)) map.set(k, item);
    }
    index.set(list, map);
  }
  return map;
};
