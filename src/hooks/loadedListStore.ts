import { createStore, type Store } from './createStore';

/** État d'une liste lue une fois pour toutes les pages qui la montrent. */
export interface LoadedList<T> {
  items: T[];
  /** Vrai dès qu'une lecture a abouti pour la mémoire en cours : avant, le nombre d'éléments n'est pas connu. */
  loaded: boolean;
  error: string | null;
}

export interface LoadedListStore<T> {
  store: Store<LoadedList<T>>;
  /**
   * Lit la liste si ce n'est pas déjà fait pour `key` (la mémoire ouverte, son
   * dossier, sa révision) : dix pages montées ensemble ne font qu'une lecture.
   * Une autre clé vide la liste et la relit.
   */
  ensure: (key: string) => void;
  /** Relit la liste, ce qu'elle montre restant affiché le temps de la lecture (après un rangement ou une suppression). */
  reload: () => void;
}

/**
 * Magasin partagé d'une liste lue dans la mémoire (lot 158), au lieu d'une
 * lecture par page montée : les itinéraires étaient relus en entier (un
 * listage et une lecture par fiche) à chaque montage de chaque page.
 * `list` rend la liste ; `describe` met en clair l'erreur d'une lecture.
 */
export const createLoadedListStore = <T>(list: () => Promise<T[]>, describe: (err: unknown) => string): LoadedListStore<T> => {
  const empty: T[] = [];
  const store = createStore<LoadedList<T>>({ items: empty, loaded: false, error: null });
  let currentKey: string | null = null;
  /** Numéro de la dernière lecture lancée : une réponse plus ancienne est jetée. */
  let generation = 0;

  const run = (): void => {
    const mine = ++generation;
    list().then(
      (items) => {
        if (mine === generation) store.set({ items, loaded: true, error: null });
      },
      (err: unknown) => {
        if (mine === generation) store.patch({ error: describe(err) });
      }
    );
  };

  return {
    store,
    ensure: (key) => {
      if (key === currentKey) return;
      currentKey = key;
      store.set({ items: empty, loaded: false, error: null });
      run();
    },
    reload: () => {
      if (currentKey !== null) run();
    },
  };
};
