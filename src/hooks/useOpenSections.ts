import { useCallback } from 'react';
import { useStoredRecord } from './useStoredRecord';

/**
 * Sections ouvertes d'un module, mémorisées dans le navigateur : on retrouve
 * la page comme on l'a laissée.
 */
export const useOpenSections = <K extends string>(moduleId: string, defaults: Record<K, boolean>) => {
  const { value, update } = useStoredRecord<Record<K, boolean>>('tracker.sections', moduleId, defaults);

  const toggle = useCallback(
    (key: K) => update({ [key]: !value[key] } as Partial<Record<K, boolean>>),
    [update, value]
  );

  return { open: value, toggle };
};
