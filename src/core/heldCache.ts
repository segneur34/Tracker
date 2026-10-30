/**
 * Cache de valeurs qu'on libère à la main (adresses d'objet des vignettes de
 * la bibliothèque) : au plus `max` valeurs, les moins récemment demandées
 * libérées d'abord (`dispose`), jamais une valeur retenue. Qui affiche une
 * valeur la retient (`acquire`, `put`) jusqu'à `release` ; tant que toutes
 * sont retenues, le cache dépasse `max` plutôt que de libérer une valeur
 * encore affichée.
 */
export interface HeldCache<V> {
  /** Valeur de `key`, retenue par l'appelant ; `undefined` si elle manque. */
  acquire(key: string): V | undefined;
  /**
   * Range `value` sous `key`, retenue par l'appelant ; si `key` y est déjà,
   * `value` est libérée et c'est la valeur rangée qui est rendue (et retenue).
   */
  put(key: string, value: V): V;
  /** Relâche une valeur retenue par `acquire` ou `put`. */
  release(key: string): void;
  readonly size: number;
}

export const createHeldCache = <V>(max: number, dispose: (value: V) => void): HeldCache<V> => {
  /** Dans l'ordre de la dernière demande, la plus ancienne en tête. */
  const entries = new Map<string, { value: V; holders: number }>();

  const trim = () => {
    if (entries.size <= max) return;
    for (const [key, entry] of entries) {
      if (entries.size <= max) break;
      if (entry.holders > 0) continue;
      entries.delete(key);
      dispose(entry.value);
    }
  };

  const touch = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    entries.delete(key);
    entries.set(key, entry);
    entry.holders++;
    return entry.value;
  };

  return {
    acquire: touch,
    put: (key, value) => {
      const known = touch(key);
      if (known !== undefined) {
        dispose(value);
        return known;
      }
      entries.set(key, { value, holders: 1 });
      trim();
      return value;
    },
    release: (key) => {
      const entry = entries.get(key);
      if (!entry || entry.holders === 0) return;
      entry.holders--;
      trim();
    },
    get size() {
      return entries.size;
    },
  };
};
