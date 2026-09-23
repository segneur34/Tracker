/**
 * Stockage persistant de l'application : seul point d'accès autorisé.
 *
 * Aujourd'hui, le `localStorage` du navigateur. Dans l'application Android
 * (Capacitor, voir `docs/ETAT_DU_PROJET.md` §12), ce seront les Preferences
 * natives, parce que le système peut vider le `localStorage` d'une WebView.
 * L'interface reste synchrone dans les deux cas : les hooks lisent pendant le
 * rendu, et la version native chargera tout en mémoire au démarrage plutôt
 * que de les obliger à attendre.
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
}

/**
 * Le stockage est obtenu à chaque appel, et non une fois pour toutes : un
 * navigateur qui bloque les données de site lève une erreur dès l'accès à
 * `localStorage`, et cette erreur doit tomber dans le `try`.
 */
export const createJsonStore = (getBackend: () => StorageBackend): JsonStore => ({
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
  },
});

/** Stockage de l'application. */
export const jsonStore = createJsonStore(() => localStorage);
