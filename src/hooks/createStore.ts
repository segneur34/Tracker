import { jsonStore } from '../platform/storage';

/**
 * Magasins hors React : un état de module, des abonnés, un instantané lu par
 * `useSyncExternalStore`. Les hooks `useRecorder`, `useSessionLibrary`,
 * `useIntervalTimer`, `useStopwatch`, `useFitnessTest`, `useMarkGuide`,
 * `useFollowedTrace`, `useLiveRecording` et `useTheme` s'y appuient : une seule écriture
 * de l'abonnement, du désabonnement et de la minuterie d'affichage.
 */

/**
 * Abonnés d'un magasin : `subscribe` rend le désabonnement, `notify` les
 * prévient tous, avec ses arguments (une position reçue, par exemple).
 */
export interface Listeners<A extends unknown[] = []> {
  subscribe: (listener: (...args: A) => void) => () => void;
  notify: (...args: A) => void;
  size: () => number;
}

/**
 * Ensemble d'abonnés, le seul de l'application (lot 72). `safe` : un abonné
 * qui lève n'empêche pas les suivants d'être prévenus, ni l'appelant de
 * poursuivre (enregistrement, direct, notification).
 */
export const createListeners = <A extends unknown[] = []>({ safe = false }: { safe?: boolean } = {}): Listeners<A> => {
  const listeners = new Set<(...args: A) => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: (...args) => {
      for (const listener of listeners) {
        if (!safe) {
          listener(...args);
          continue;
        }
        try {
          listener(...args);
        } catch {
          // Un abonné en échec n'arrête ni les autres, ni l'appelant.
        }
      }
    },
    size: () => listeners.size,
  };
};

export interface Store<T> {
  get: () => T;
  /** Remplace l'état et prévient les abonnés. */
  set: (next: T) => void;
  /** Fusionne un morceau d'état (état objet) et prévient les abonnés. */
  patch: (patch: Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

/** Magasin d'un état, lu par `useSyncExternalStore(store.subscribe, store.get)`. */
export const createStore = <T>(initial: T): Store<T> => {
  let state = initial;
  const listeners = createListeners();
  return {
    get: () => state,
    set: (next) => {
      state = next;
      listeners.notify();
    },
    patch: (patch) => {
      state = { ...state, ...patch };
      listeners.notify();
    },
    subscribe: listeners.subscribe,
  };
};

export interface TickingStore<V> {
  /** Dernière vue publiée. */
  get: () => V;
  /** Recalcule la vue, prévient les abonnés et règle la minuterie. */
  publish: () => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * Magasin d'une vue qui avance avec l'horloge (compteur d'intervalles, chrono).
 * `compute` rend la vue du moment ; la minuterie d'affichage ne tourne que
 * tant qu'une page regarde (`isRunning` sur la vue) ; `hasWork` dit s'il y a
 * quelque chose à montrer : une page qui arrive voit alors l'état du moment,
 * pas celui de la dernière fois qu'on a regardé.
 */
export const createTickingStore = <V>(options: {
  initial: V;
  compute: () => V;
  isRunning: (view: V) => boolean;
  hasWork: () => boolean;
  intervalMs: number;
}): TickingStore<V> => {
  let view = options.initial;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = createListeners();

  const syncTimer = (): void => {
    const wanted = listeners.size() > 0 && options.isRunning(view);
    if (wanted && timer === null) timer = setInterval(publish, options.intervalMs);
    if (!wanted && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  function publish(): void {
    view = options.compute();
    listeners.notify();
    syncTimer();
  }

  const subscribe = (listener: () => void): (() => void) => {
    const unsubscribe = listeners.subscribe(listener);
    if (options.hasWork()) queueMicrotask(publish);
    syncTimer();
    return () => {
      unsubscribe();
      syncTimer();
    };
  };

  return { get: () => view, publish, subscribe };
};

/** Même valeur au sens du texte JSON : la comparaison par défaut des lectures du magasin. */
export const sameJson = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Lecture mémorisée d'une clé du magasin JSON (`createJsonSelector`). */
export interface JsonSelector<T> {
  /** Sélection du moment, la même référence tant qu'elle ne change pas : l'instantané de `useSyncExternalStore`. */
  get: () => T;
  /** Abonnement aux seules écritures de la clé. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Lecture d'une partie d'une clé du magasin JSON (lot 72), une seule façon de
 * la garder pour tous : `select` n'est refait que si la valeur rangée change,
 * et la sélection précédente est rendue telle quelle tant que `equal` (même
 * texte JSON par défaut) la dit inchangée. Une écriture d'un autre réglage de
 * la même clé ne refait donc rien de ce qui en dépend.
 */
export const createJsonSelector = <T>(
  key: string,
  select: (raw: unknown) => T,
  equal: (previous: T, next: T) => boolean = sameJson
): JsonSelector<T> => {
  let cache: { raw: unknown; value: T } | null = null;
  return {
    get: () => {
      const raw = jsonStore.read<unknown>(key);
      if (cache && cache.raw === raw) return cache.value;
      const next = select(raw);
      cache = { raw, value: cache && equal(cache.value, next) ? cache.value : next };
      return cache.value;
    },
    subscribe: (listener) => jsonStore.subscribeKey(key, listener),
  };
};
