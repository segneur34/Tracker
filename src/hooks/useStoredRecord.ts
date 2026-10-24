import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [value, setValue] = useState<T>(defaults);
  // Dernière valeur, pour enchaîner deux `update` sans attendre le rendu et écrire hors d'un updater
  // (React les exécute pendant le rendu : l'écriture notifie des abonnés d'autres composants).
  const latest = useRef(value);

  const apply = useCallback((next: T) => {
    latest.current = next;
    setValue(next);
  }, []);

  // Relecture à chaque changement de clé, donc de session.
  useEffect(() => {
    apply(key === null ? defaults : readStoredRecord(namespace, key, defaults));
    // `defaults` est une constante de module chez tous les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, key]);

  const update = useCallback(
    (patch: Partial<T> | ((current: T) => Partial<T>)) => {
      const current = latest.current;
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      apply(next);
      if (key !== null) {
        const all = readAll<T>(namespace);
        all[key] = next;
        writeAll(namespace, all);
      }
    },
    [namespace, key, apply]
  );

  return { value, update };
};
