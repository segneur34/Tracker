import { useCallback, useMemo } from 'react';
import type { Activity } from '../core/activities';
import { maskAdvancedTabs, maskHiddenTabs, shownTabs, type AnalysisTab } from '../core/analysisTabs';
import { useAdvancedTabs } from './useAdvancedTabs';
import { useResetChartHover } from './useChartHover';
import { useMapHighlight } from './useMapHighlight';
import { useOpenSections } from './useOpenSections';
import { effectiveTabChoices } from './useSportSettings';

export interface AnalysisTabsInput<K extends string> {
  /** Clé des onglets ouverts mémorisés (`tracker.sections`) : ne pas la renommer. */
  storageId: string;
  /** Onglets du module, dans l'ordre de sa barre ; ils peuvent changer avec l'activité (course et vélo). */
  tabs: readonly AnalysisTab<K>[];
  /** Onglets ouverts à la première visite (`tabDefaults`) : une constante du module. */
  defaults: Record<K, boolean>;
  activity: Activity;
  /** Trace affichée : une autre session s'ouvre sur « général », et le point survolé s'efface. */
  sessionKey: string | null;
}

/**
 * Onglets d'un module d'analyse, les mêmes pour les quatre : sections ouvertes
 * mémorisées (`useOpenSections`), celles cachées par l'activité dans Réglages
 * fermées (`maskHiddenTabs`), celles de la rangée « avancé » repliées tant
 * qu'elle est fermée (`maskAdvancedTabs`, `useAdvancedTabs`) ; la surbrillance
 * unique de la carte, rattachée aux onglets ouverts (`useMapHighlight`) ; le
 * point survolé des graphes effacé à chaque session (`useResetChartHover`).
 */
export const useAnalysisTabs = <K extends string>({ storageId, tabs, defaults, activity, sessionKey }: AnalysisTabsInput<K>) => {
  const { open: storedOpen, toggle, set } = useOpenSections<K>(storageId, defaults);
  // Onglets de l'activité : ceux cachés dans Réglages sont fermés, même laissés ouverts.
  const tabChoices = useMemo(() => effectiveTabChoices(activity), [activity]);
  /** Rangée « avancé » : refermée, ses onglets et leurs panneaux se replient, mémorisés pour sa réouverture. */
  const setGeneral = useCallback((shown: boolean) => set({ general: shown } as Partial<Record<K, boolean>>), [set]);
  const advanced = useAdvancedTabs(sessionKey, setGeneral);
  const open = useMemo(
    () => maskAdvancedTabs(maskHiddenTabs(storedOpen, tabs, tabChoices), tabs, advanced.open),
    [storedOpen, tabs, tabChoices, advanced.open]
  );
  /** Une seule surbrillance sur la carte, effacée quand son onglet se ferme. */
  const highlight = useMapHighlight(open);
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

  return { open, toggle, toggleOf, set, tabChoices, advanced, shown, highlight };
};
