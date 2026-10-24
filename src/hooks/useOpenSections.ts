import { useCallback } from 'react';
import { useStoredRecord } from './useStoredRecord';

/**
 * Sections ouvertes d'un module, mémorisées dans le navigateur : on retrouve
 * la page comme on l'a laissée.
 */
export const useOpenSections = <K extends string>(moduleId: string, defaults: Record<K, boolean>) => {
  const { value, update } = useStoredRecord<Record<K, boolean>>('tracker.sections', moduleId, defaults);

  const toggle = useCallback(
    (key: K) => update((current) => ({ [key]: !current[key] }) as Partial<Record<K, boolean>>),
    [update]
  );

  /** Ouvrir ou fermer des clés données, sans les basculer. */
  const set = useCallback((patch: Partial<Record<K, boolean>>) => update(patch), [update]);

  /** Tout fermer, clés mémorisées hors des défauts comprises (activités de Réglages). */
  const closeAll = useCallback(
    () => update((current) => Object.fromEntries(Object.keys({ ...defaults, ...current }).map((k) => [k, false])) as Record<K, boolean>),
    // `defaults` est une constante de module chez tous les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [update]
  );

  return { open: value, toggle, set, closeAll };
};
