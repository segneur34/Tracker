import { useCallback, useEffect, useState } from 'react';
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

export const useStoredRecord = <T extends object>(
  namespace: string,
  key: string | null,
  defaults: T
) => {
  const [value, setValue] = useState<T>(defaults);

  // Relecture à chaque changement de clé, donc de session.
  useEffect(() => {
    if (key === null) {
      setValue(defaults);
      return;
    }
    const stored = readAll<T>(namespace)[key];
    setValue(stored ? { ...defaults, ...stored } : defaults);
    // `defaults` est une constante de module chez tous les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, key]);

  const update = useCallback(
    (patch: Partial<T>) => {
      setValue((current) => {
        const next = { ...current, ...patch };
        if (key !== null) {
          const all = readAll<T>(namespace);
          all[key] = next;
          writeAll(namespace, all);
        }
        return next;
      });
    },
    [namespace, key]
  );

  return { value, update };
};
