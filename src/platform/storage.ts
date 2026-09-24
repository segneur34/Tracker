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
 * ne doivent jamais casser l'interface. La valeur vaut alors pour la session
 * en cours, comme avant l'existence de ce module.
 */

/** Stockage clé → texte. `localStorage` y répond tel quel. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface JsonStore {
  /** Valeur enregistrée sous `key`, ou `null` si elle est absente, illisible ou inaccessible. */
  read<T>(key: string): T | null;
  /** Enregistre `value` sous `key`, sérialisée en JSON ; sans effet si le stockage refuse. */
  write(key: string, value: unknown): void;
  /**
   * Appelle `listener` avec la clé de chaque écriture, même refusée par le
   * stockage : la valeur vaut alors pour la session en cours, et doit être
   * suivie comme une autre. Rend la fonction qui désabonne.
   */
  subscribe(listener: (key: string) => void): () => void;
}

/**
 * Le stockage est obtenu à chaque appel, et non une fois pour toutes : un
 * navigateur qui bloque les données de site lève une erreur dès l'accès à
 * `localStorage`, et cette erreur doit tomber dans le `try`.
 */
export const createJsonStore = (getBackend: () => StorageBackend): JsonStore => {
  const listeners = new Set<(key: string) => void>();
  return {
    read: <T,>(key: string): T | null => {
      try {
        const raw = getBackend().getItem(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      } catch {
        return null;
      }
    },
    write: (key: string, value: unknown): void => {
      try {
        getBackend().setItem(key, JSON.stringify(value));
      } catch {
        // Stockage indisponible : la valeur vaut pour la session en cours.
      }
      listeners.forEach((listener) => listener(key));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
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

/**
 * À attendre avant le premier rendu. Sur le téléphone, charge en mémoire les
 * Preferences natives, que le système ne vide pas comme il peut vider le
 * `localStorage` d'une WebView ; les écritures y sont ensuite recopiées une à
 * une. Dans le navigateur, ne fait rien. Un échec de chargement laisse
 * `localStorage` en place plutôt que d'empêcher l'application de démarrer.
 */
export const initStorage = async (): Promise<void> => {
  if (!isNativeApp()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { keys } = await Preferences.keys();
    const entries = await Promise.all(
      keys.map(async (key) => [key, (await Preferences.get({ key })).value] as const)
    );
    const initial: Record<string, string> = {};
    for (const [key, value] of entries) if (value !== null) initial[key] = value;
    nativeBackend = createMirroredBackend(initial, (key, value) => {
      Preferences.set({ key, value }).catch(() => {
        // Écriture refusée : la valeur vaut pour la session en cours.
      });
    });
  } catch {
    // Preferences indisponibles : on reste sur `localStorage`.
  }
};
