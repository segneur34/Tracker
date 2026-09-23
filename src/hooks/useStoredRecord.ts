import { useCallback, useEffect, useState } from 'react';
import { jsonStore } from '../platform/storage';

/**
 * Enregistrement persistant dans le navigateur, rangé par espace de noms et
 * par clé. Sert aux notes rattachées à une session : elles reviennent quand
 * la même trace est rechargée.
 *
 * Sans clé, rien n'est lu ni écrit : c'est le cas tant qu'aucun fichier n'a
 * été chargé.
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
  const [loaded, setLoaded] = useState(false);

  // Relecture à chaque changement de clé, donc de session.
  useEffect(() => {
    if (key === null) {
      setValue(defaults);
      setLoaded(false);
      return;
    }
    const stored = readAll<T>(namespace)[key];
    setValue(stored ? { ...defaults, ...stored } : defaults);
    setLoaded(true);
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

  /** Dernier enregistrement écrit dans cet espace, toutes clés confondues. */
  const readLatest = useCallback((): T | null => {
    const all = readAll<T & { savedAt?: number }>(namespace);
    let latest: (T & { savedAt?: number }) | null = null;
    for (const entry of Object.values(all)) {
      if (!latest || (entry.savedAt ?? 0) > (latest.savedAt ?? 0)) latest = entry;
    }
    return latest;
  }, [namespace]);

  return { value, update, loaded, readLatest };
};
