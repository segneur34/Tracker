import { useCallback } from 'react';
import { useStoredRecord } from './useStoredRecord';

const ADVANCED_DEFAULTS = { ouvert: false };

/**
 * Rangée « avancé » des analyses, sous « général » : fermée au départ, un seul
 * état pour toutes les analyses, retenu sur l'appareil (22/10). Le module le
 * lit pour replier les panneaux de la rangée (`maskAdvancedTabs`) et le passe
 * à sa barre (`CollapsibleSectionTabs`).
 */
export const useAdvancedTabs = () => {
  const { value, update } = useStoredRecord('tracker.sections', 'analyses-avance', ADVANCED_DEFAULTS);
  const toggle = useCallback(() => update((current) => ({ ouvert: !current.ouvert })), [update]);
  return { open: value.ouvert, toggle };
};
