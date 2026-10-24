import { useCallback, useEffect } from 'react';
import { generalOpenAfterAdvanced, isNewAnalysisSession } from '../core/analysisTabs';
import { readStoredRecord, useStoredRecord } from './useStoredRecord';

const NAMESPACE = 'tracker.sections';
const KEY = 'analyses-avance';
const ADVANCED_DEFAULTS: { ouvert: boolean; session: string | null } = { ouvert: false, session: null };

/**
 * Rangée « avancé » des analyses, sous « général » : un seul état pour toutes
 * les analyses, retenu sur l'appareil (22/10). L'ouvrir ferme « général », la
 * refermer le rouvre ; une session autre que la dernière analysée s'ouvre sur
 * « général », « avancé » fermé, ses onglets gardés pour sa réouverture (23/10).
 * Le module le lit pour replier les panneaux de la rangée (`maskAdvancedTabs`),
 * le passe à sa barre (`CollapsibleSectionTabs`) et lui confie l'ouverture de
 * son « général » (`setGeneral`).
 */
export const useAdvancedTabs = (sessionKey: string | null, setGeneral: (open: boolean) => void) => {
  const { value, update } = useStoredRecord(NAMESPACE, KEY, ADVANCED_DEFAULTS);

  // Lu dans la mémoire et non dans `value`, encore à son défaut au premier rendu.
  useEffect(() => {
    if (!isNewAnalysisSession(readStoredRecord(NAMESPACE, KEY, ADVANCED_DEFAULTS).session, sessionKey)) return;
    update({ ouvert: false, session: sessionKey });
    setGeneral(true);
    // Seule la trace compte : `setGeneral` est refait à chaque rendu du module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const toggle = useCallback(() => {
    const next = !value.ouvert;
    update({ ouvert: next });
    setGeneral(generalOpenAfterAdvanced(next));
  }, [value.ouvert, update, setGeneral]);
  return { open: value.ouvert, toggle };
};
