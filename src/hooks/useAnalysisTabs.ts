import { useCallback, useMemo, useState } from 'react';
import type { Activity } from '../core/activities';
import {
  closeAllTabs, generalOpenAfterAdvanced, initialTabsState, maskAdvancedTabs, maskHiddenTabs, shownTabs, tabsStateFor,
  type AnalysisTab, type AnalysisTabsState,
} from '../core/analysisTabs';
import { useResetChartHover } from './useChartHover';
import { useMapHighlight, type HighlightKeys } from './useMapHighlight';
import { effectiveTabChoices } from './useSportSettings';

export interface AnalysisTabsInput<K extends string> {
  /** Onglets du module, dans l'ordre de sa barre ; ils peuvent changer avec l'activité (course et vélo). */
  tabs: readonly AnalysisTab<K>[];
  /** Onglets ouverts à chaque ouverture (`tabDefaults`) : une constante du module. */
  defaults: Record<K, boolean>;
  activity: Activity;
  /** Trace affichée : une autre session s'ouvre sur « général », et le point survolé s'efface. */
  sessionKey: string | null;
}

/**
 * Onglets d'un module d'analyse, les mêmes pour les quatre : sections ouvertes
 * en mémoire vive, rendues aux défauts (« général » seul, « avancé » fermé) à
 * chaque ouverture d'une analyse et à chaque autre session (05/11,
 * `tabsStateFor`) ; celles cachées par l'activité dans Réglages fermées
 * (`maskHiddenTabs`), celles de la rangée « avancé » repliées tant qu'elle est
 * fermée (`maskAdvancedTabs`) ; la surbrillance unique de la carte, rattachée
 * aux onglets ouverts (`useMapHighlight`) ; le point survolé des graphes effacé
 * à chaque session (`useResetChartHover`).
 * `T` donne le type des clés de surbrillance d'un onglet (`zones` : une zone de pente).
 */
export const useAnalysisTabs = <K extends string, T extends HighlightKeys<K> = Record<never, never>>({ tabs, defaults, activity, sessionKey }: AnalysisTabsInput<K>) => {
  const [stored, setStored] = useState<AnalysisTabsState<K>>(() => initialTabsState(defaults, sessionKey));
  // Une autre session est reconnue dès le rendu où sa clé change : « général » seul, sans monter d'abord les
  // panneaux de l'ancienne ; l'état rangé suit au premier geste (`change`).
  const state = tabsStateFor(stored, defaults, sessionKey);
  /** Modifie l'état de la trace affichée (celui d'une autre trace repart des défauts). */
  const change = useCallback(
    (next: (current: AnalysisTabsState<K>) => AnalysisTabsState<K>) => setStored((current) => next(tabsStateFor(current, defaults, sessionKey))),
    // `defaults` est une constante de module chez tous les appelants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionKey]
  );
  const toggle = useCallback((key: K) => change((s) => ({ ...s, open: { ...s.open, [key]: !s.open[key] } })), [change]);
  /** Ouvrir ou fermer des clés données, sans les basculer. */
  const set = useCallback((patch: Partial<Record<K, boolean>>) => change((s) => ({ ...s, open: { ...s.open, ...patch } })), [change]);
  /** « tout fermer » : chaque onglet fermé, « général » compris ; « avancé » reste comme il est. */
  const closeAll = useCallback(() => change((s) => ({ ...s, open: closeAllTabs(s.open) })), [change]);

  // Onglets de l'activité : ceux cachés dans Réglages sont fermés, même laissés ouverts.
  const tabChoices = useMemo(() => effectiveTabChoices(activity), [activity]);
  /** Rangée « avancé » : l'ouvrir ferme « général », la refermer le rouvre ; refermée, ses onglets et leurs panneaux se replient, gardés pour sa réouverture. */
  const toggleAdvanced = useCallback(
    () => change((s) => ({ ...s, advanced: !s.advanced, open: { ...s.open, general: generalOpenAfterAdvanced(!s.advanced) } })),
    [change]
  );
  const advanced = useMemo(() => ({ open: state.advanced, toggle: toggleAdvanced }), [state.advanced, toggleAdvanced]);
  const open = useMemo(
    () => maskAdvancedTabs(maskHiddenTabs(state.open, tabs, tabChoices), tabs, state.advanced),
    [state.open, tabs, tabChoices, state.advanced]
  );
  /** Une seule surbrillance sur la carte, effacée quand son onglet se ferme. */
  const highlight = useMapHighlight<K, T>(open);
  // Point survolé hors de l'état du module (`useChartHover`) : effacé à chaque session et au démontage.
  useResetChartHover(sessionKey);

  /** Rappel stable qui ouvre ou ferme l'onglet `key` : un par clé des défauts, gardé tant que `toggle` ne change pas. */
  const toggleOf = useMemo(() => {
    const byKey = Object.fromEntries((Object.keys(defaults) as K[]).map((key) => [key, () => toggle(key)])) as Record<K, () => void>;
    return (key: K): (() => void) => byKey[key];
  }, [toggle, defaults]);

  /** Onglets montrés par l'activité, dans l'ordre de la barre, puis ceux que `keep` garde (données de la session). */
  const shown = useCallback(
    (keep?: (tab: AnalysisTab<K>) => boolean) => {
      const list = shownTabs(tabs, tabChoices);
      return keep ? list.filter(keep) : list;
    },
    [tabs, tabChoices]
  );

  return { open, toggle, toggleOf, set, closeAll, tabChoices, advanced, shown, highlight };
};
