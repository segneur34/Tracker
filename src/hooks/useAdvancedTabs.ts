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
 *
 * La nouvelle session est reconnue dès le rendu où sa clé change (`fresh`) :
 * « avancé » y est déjà fermé et « général » ouvert (`useAnalysisTabs`), sans
 * monter d'abord les panneaux avancés de l'ancienne session ; l'écriture en
 * mémoire suit, dans l'effet.
 */
export const useAdvancedTabs = (sessionKey: string | null, setGeneral: (open: boolean) => void) => {
  const { value, update } = useStoredRecord(NAMESPACE, KEY, ADVANCED_DEFAULTS);
  /** Session autre que la dernière analysée, pas encore écrite en mémoire : « général » seul. */
  const fresh = isNewAnalysisSession(value.session, sessionKey);
  const open = fresh ? false : value.ouvert;

  // Relu dans la mémoire au moment d'écrire, comme `update`.
  useEffect(() => {
    if (!isNewAnalysisSession(readStoredRecord(NAMESPACE, KEY, ADVANCED_DEFAULTS).session, sessionKey)) return;
    update({ ouvert: false, session: sessionKey });
    setGeneral(true);
    // Seule la trace compte ; `update` et `setGeneral` sont laissés hors des dépendances (règle `react/exhaustive-deps`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const toggle = useCallback(() => {
    const next = !open;
    update({ ouvert: next });
    setGeneral(generalOpenAfterAdvanced(next));
  }, [open, update, setGeneral]);
  return { open, toggle, fresh };
};
