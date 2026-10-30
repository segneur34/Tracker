import { isNativeApp } from './runtime';

/**
 * Stockage persistant de l'application : seul point d'accès autorisé.
 *
 * Dans le navigateur, le `localStorage`. Dans l'application Android
 * (Capacitor, voir `docs/ETAT_DU_PROJET.md` §12), les Preferences natives,
 * parce que le système peut vider le `localStorage` d'une WebView.
 * L'interface reste synchrone dans les deux cas : les hooks lisent pendant le
 * rendu, et la version native charge tout en mémoire au démarrage
 * (`initStorage`) plutôt que de les obliger à attendre.
 *
 * Aucune erreur ne remonte : stockage bloqué, quota dépassé ou JSON illisible
 * ne doivent jamais casser l'interface. Une valeur que le stockage refuse
 * vaut pour la session en cours, gardée en mémoire et relue à sa place, et
 * le refus est signalé (`subscribeFailure`) pour être dit à l'utilisateur.
 */

/** Stockage clé → texte. `localStorage` y répond tel quel. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface JsonStore {
  /**
   * Valeur enregistrée sous `key`, ou `null` si elle est absente, illisible ou
   * inaccessible. Le même objet est rendu tant que la valeur ne change pas :
   * ne jamais le modifier (copier avant de changer).
   */
  read<T>(key: string): T | null;
  /**
   * Enregistre `value` sous `key`, sérialisée en JSON. Si le stockage refuse,
   * la valeur vaut pour la session en cours et le refus est signalé.
   */
  write(key: string, value: unknown): void;
  /**
   * Appelle `listener` avec la clé de chaque écriture, même refusée par le
   * stockage : la valeur vaut alors pour la session en cours, et doit être
   * suivie comme une autre. Rend la fonction qui désabonne.
   */
  subscribe(listener: (key: string) => void): () => void;
  /**
   * Appelle `listener` à chaque écriture de `key` seulement, même refusée par
   * le stockage : les écritures des autres clés ne réveillent pas l'abonné.
   * Rend la fonction qui désabonne.
   */
  subscribeKey(key: string, listener: () => void): () => void;
  /** Appelle `listener` avec la clé de chaque écriture refusée par le stockage. Rend la fonction qui désabonne. */
  subscribeFailure(listener: (key: string) => void): () => void;
  /** Signale le refus d'une écriture constaté plus tard (Preferences natives, qui écrivent en arrière-plan). */
  reportFailure(key: string): void;
}

/** Gèle un objet lu et tout ce qu'il contient : une modification lève une erreur au lieu de corrompre le cache. */
const deepFreeze = (value: unknown): void => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
};

/**
 * Le stockage est obtenu à chaque appel, et non une fois pour toutes : un
 * navigateur qui bloque les données de site lève une erreur dès l'accès à
 * `localStorage`, et cette erreur doit tomber dans le `try`.
 */
export const createJsonStore = (getBackend: () => StorageBackend): JsonStore => {
  const listeners = new Set<(key: string) => void>();
  const failureListeners = new Set<(key: string) => void>();
  /** Valeurs refusées par le stockage, relues à la place de l'ancienne valeur jusqu'à la fermeture. */
  const unsaved = new Map<string, string>();
  /**
   * Dernière lecture de chaque clé : tant que la valeur brute ne change pas, le
   * même objet est rendu, sans relire le JSON (les réglages, plusieurs dizaines
   * de Ko, sont lus à chaque ligne de la bibliothèque). Partagé entre tous les
   * appelants : il ne doit jamais être modifié, d'où le gel en développement.
   */
  const parsedCache = new Map<string, { raw: string; value: unknown }>();
  const parse = <T,>(key: string, raw: string | null): T | null => {
    if (raw === null) return null;
    const cached = parsedCache.get(key);
    if (cached?.raw === raw) return cached.value as T;
    const value: unknown = JSON.parse(raw);
    // `?.` : hors de Vite (scripts Node du banc), `import.meta.env` n'existe pas.
    if (import.meta.env?.DEV) deepFreeze(value);
    parsedCache.set(key, { raw, value });
    return value as T;
  };
  const reportFailure = (key: string): void => failureListeners.forEach((listener) => listener(key));
  return {
    read: <T,>(key: string): T | null => {
      try {
        const kept = unsaved.get(key);
        return parse<T>(key, kept !== undefined ? kept : getBackend().getItem(key));
      } catch {
        return null;
      }
    },
    write: (key: string, value: unknown): void => {
      const raw = JSON.stringify(value);
      let refused = false;
      try {
        getBackend().setItem(key, raw);
        unsaved.delete(key);
      } catch {
        unsaved.set(key, raw);
        refused = true;
      }
      listeners.forEach((listener) => listener(key));
      if (refused) reportFailure(key);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeKey: (key, listener) => {
      const onWrite = (written: string): void => {
        if (written === key) listener();
      };
      listeners.add(onWrite);
      return () => {
        listeners.delete(onWrite);
      };
    },
    subscribeFailure: (listener) => {
      failureListeners.add(listener);
      return () => {
        failureListeners.delete(listener);
      };
    },
    reportFailure,
  };
};

/**
 * Stockage en mémoire, amorcé par `initial`, qui recopie chaque écriture vers
 * `persist`. C'est la forme native : lecture synchrone depuis la mémoire,
 * écriture durable en arrière-plan.
 */
export const createMirroredBackend = (
  initial: Record<string, string>,
  persist: (key: string, value: string) => void
): StorageBackend => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
      persist(key, value);
    },
  };
};

/** Stockage natif une fois chargé ; `null` dans le navigateur, qui garde `localStorage`. */
let nativeBackend: StorageBackend | null = null;

/** Stockage de l'application. */
export const jsonStore = createJsonStore(() => nativeBackend ?? localStorage);

/** Ce que le stockage natif a su lire, clé par clé. */
export interface NativeStorageLoad {
  initial: Record<string, string>;
  /** Clés restées illisibles après un second essai : leur valeur sur le téléphone est inconnue. */
  failedKeys: string[];
}

/** Les Preferences natives, réduites à ce que le chargement en lit. */
export interface PreferencesReader {
  keys(): Promise<{ keys: string[] }>;
  get(options: { key: string }): Promise<{ value: string | null }>;
}

/**
 * Lit les Preferences clé par clé : une lecture qui échoue est refaite une
 * fois, puis la clé est relevée sans retenir les autres. Lève si la liste des
 * clés elle-même est illisible.
 */
export const loadNativeEntries = async (preferences: PreferencesReader): Promise<NativeStorageLoad> => {
  const { keys } = await preferences.keys();
  const read = async (key: string): Promise<{ key: string; value: string | null } | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { key, value: (await preferences.get({ key })).value };
      } catch {
        // Second essai, puis la clé est relevée.
      }
    }
    return null;
  };
  const results = await Promise.all(keys.map(read));
  const initial: Record<string, string> = {};
  const failedKeys: string[] = [];
  results.forEach((result, i) => {
    if (!result) failedKeys.push(keys[i]);
    else if (result.value !== null) initial[result.key] = result.value;
  });
  return { initial, failedKeys };
};

/** Échec du chargement du stockage natif au démarrage : `all` si rien n'a pu être lu. */
export interface StorageStartupFailure {
  all: boolean;
  keys: readonly string[];
}

let startupFailure: StorageStartupFailure | null = null;

/**
 * Échec du chargement du stockage au démarrage, `null` s'il n'y en a pas eu.
 * Les réglages touchés valent alors par défaut et ne sont gardés qu'en mémoire
 * jusqu'à la fermeture : à dire à l'utilisateur, et à ne pas recopier dans le
 * dossier mémoire.
 */
export const storageStartupFailure = (): StorageStartupFailure | null => startupFailure;

/**
 * À attendre avant le premier rendu. Sur le téléphone, charge en mémoire les
 * Preferences natives, que le système ne vide pas comme il peut vider le
 * `localStorage` d'une WebView ; les écritures y sont ensuite recopiées une à
 * une. Dans le navigateur, ne fait rien. Une clé illisible vaut par défaut et
 * reste en mémoire seulement, sans jamais être recopiée dans les Preferences
 * (sa vraie valeur y est peut-être encore) ; si rien ne peut être lu, tout le
 * stockage reste en mémoire, jamais sur le `localStorage` de la WebView en
 * silence. L'échec est relevé (`storageStartupFailure`).
 */
export const initStorage = async (): Promise<void> => {
  if (!isNativeApp()) return;
  let preferences: typeof import('@capacitor/preferences').Preferences;
  let load: NativeStorageLoad;
  try {
    ({ Preferences: preferences } = await import('@capacitor/preferences'));
    load = await loadNativeEntries(preferences);
  } catch {
    startupFailure = { all: true, keys: [] };
    nativeBackend = createMirroredBackend({}, () => undefined);
    return;
  }
  const unreadable = new Set(load.failedKeys);
  if (unreadable.size > 0) startupFailure = { all: false, keys: load.failedKeys };
  nativeBackend = createMirroredBackend(load.initial, (key, value) => {
    if (unreadable.has(key)) return;
    // Écriture refusée : la valeur, déjà en mémoire, vaut pour la session en cours.
    preferences.set({ key, value }).catch(() => jsonStore.reportFailure(key));
  });
};
