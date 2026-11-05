import { useCallback } from 'react';
import { jsonStore } from '../platform/storage';
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

/** Clés de `tracker.sections` où les onglets ouverts des analyses étaient retenus jusqu'au 05/11 (`useOpenSections`, « avancé »). */
const FORMER_TAB_KEYS = ['analyses-avance', 'sailing-onglets', 'running', 'cycling', 'intervals', 'muscu', 'surf'];

/**
 * Efface au démarrage les onglets ouverts que les analyses retenaient avant le
 * 05/11 : ces clés-là seulement, les replis des graphes (`running.graphes`…), la
 * barre cachée (`analyses-barre`) et les tailles des panneaux restent. Rien
 * n'est écrit quand elles sont déjà parties : le nettoyage ne se fait qu'une fois.
 */
export const forgetFormerAnalysisTabs = (): void => {
  const sections = jsonStore.read<Record<string, unknown>>('tracker.sections');
  if (!sections || typeof sections !== 'object' || !FORMER_TAB_KEYS.some((key) => Object.hasOwn(sections, key))) return;
  const kept = Object.fromEntries(Object.entries(sections).filter(([key]) => !FORMER_TAB_KEYS.includes(key)));
  jsonStore.write('tracker.sections', kept);
};
