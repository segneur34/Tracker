/**
 * Magasins hors React : un état de module, des abonnés, un instantané lu par
 * `useSyncExternalStore`. Les hooks `useRecorder`, `useSessionLibrary`,
 * `useIntervalTimer`, `useStopwatch`, `useFitnessTest`, `useMarkGuide`,
 * `useFollowedTrace` et `useLiveRecording` s'y appuient : une seule écriture
 * de l'abonnement, du désabonnement et de la minuterie d'affichage.
 */

/** Abonnés d'un magasin : `subscribe` rend le désabonnement, `notify` les prévient tous. */
export interface Listeners {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
  size: () => number;
}

export const createListeners = (): Listeners => {
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify: () => listeners.forEach((listener) => listener()),
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
