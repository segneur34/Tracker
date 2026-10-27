import { useCallback, useRef, useSyncExternalStore } from 'react';
import { jsonStore } from '../platform/storage';

/**
 * Enregistrement persistant de l'appareil, rangé par espace de noms et par
 * clé : sections ouvertes d'un module, profil du coureur.
 *
 * Sans clé, rien n'est lu ni écrit.
 */

const readAll = <T,>(namespace: string): Record<string, T> =>
  jsonStore.read<Record<string, T>>(namespace) ?? {};

const writeAll = <T,>(namespace: string, all: Record<string, T>): void => jsonStore.write(namespace, all);

/** Valeur rangée sous `key`, complétée par `defaults` : la même que le hook, hors composant. */
export const readStoredRecord = <T extends object>(namespace: string, key: string, defaults: T): T => {
  const stored = readAll<T>(namespace)[key];
  return stored ? { ...defaults, ...stored } : defaults;
};

export const useStoredRecord = <T extends object>(
  namespace: string,
  key: string | null,
  defaults: T
) => {
  /**
   * Dernière valeur rendue, et l'objet rangé dont elle vient : tant que celui-ci
   * ne change pas (le stockage rend le même objet tant que la valeur ne change
   * pas), la même valeur est rendue, et le composant n'est pas redessiné.
   */
  const snapshot = useRef<{ namespace: string; key: string | null; stored: T | undefined; value: T } | null>(null);
  const getValue = (): T => {
    const stored = key === null ? undefined : readAll<T>(namespace)[key];
    const last = snapshot.current;
    if (last && last.namespace === namespace && last.key === key && last.stored === stored) return last.value;
    const value = stored ? { ...defaults, ...stored } : defaults;
    snapshot.current = { namespace, key, stored, value };
    return value;
  };
  // Abonné au stockage : deux composants qui lisent la même clé (l'accueil et le pop-up du profil)
  // voient chacun les écritures de l'autre, dès le premier rendu (E-B11).
  const value = useSyncExternalStore(jsonStore.subscribe, getValue);

  const update = useCallback(
    (patch: Partial<T> | ((current: T) => Partial<T>)) => {
      if (key === null) return;
      // Relue au moment d'écrire : deux `update` qui s'enchaînent sans rendu se cumulent.
      const current = readStoredRecord(namespace, key, defaults);
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      // Copie : l'objet lu est celui du cache du stockage, partagé.
      writeAll(namespace, { ...readAll<T>(namespace), [key]: next });
    },
    // `defaults` est une constante de module chez tous les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [namespace, key]
  );

  return { value, update };
};
