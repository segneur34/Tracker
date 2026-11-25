import { useCallback, useMemo, useState } from 'react';
import { keepOpenTabEntries } from '../core/analysisTabs';

/**
 * Ce que les onglets d'une analyse font dessiner sur la carte, rattaché à
 * l'onglet qui l'a demandé : fermer cet onglet (pastille, titre replié,
 * « tout fermer », « avancé » refermé, onglet caché par Réglages, autre
 * session) l'efface, et le rouvrir ne le ramène pas.
 * - La surbrillance, une seule à la fois (un top, un podium de manœuvres, une
 *   zone de pente, une répétition, un saut, le tronçon d'un graphe zoomé) : en
 *   montrer une autre la remplace.
 * - Les cases cumulables (virements, empannages et indécis de la voile) :
 *   chacune s'allume ou s'éteint seule, sans toucher à la surbrillance. Toute
 *   case d'onglet qui dessine sur la carte passe par là, sans état à part.
 */

/** Type des clés montrées par onglet (`zones` : une zone de pente…) ; un onglet absent garde des clés libres. */
export type HighlightKeys<P extends string> = { [Q in P]?: string };
/** Clé de l'onglet `Q` : celle de `T`, sinon une chaîne. */
export type HighlightKey<T, Q> = Q extends keyof T ? Exclude<T[Q], undefined> : string;

/** Une demande d'un onglet : la clé `key` montrée depuis l'onglet `panel`. */
interface TabEntry<P extends string> {
  panel: P;
  key: string;
}

export interface MapHighlight<P extends string, T extends HighlightKeys<P> = Record<never, never>> {
  /** Clé montrée depuis l'onglet `panel`, sinon `null` ; jamais le tronçon zoomé, qui a `zoomPanel`. */
  shownIn: <Q extends P>(panel: Q) => HighlightKey<T, Q> | null;
  /** Montre `key` depuis `panel`, à la place de la précédente ; `null` l'efface. */
  show: <Q extends P>(panel: Q, key: HighlightKey<T, Q> | null) => void;
  /** Onglet dont le graphe zoomé est montré sur la carte (« +carte », `useZoomOnMap`), sinon `null`. */
  zoomPanel: P | null;
  /** Montre le tronçon zoomé du graphe de `panel`, à la place de la surbrillance précédente. */
  showZoom: (panel: P) => void;
  /** Vrai quand la case `key` de l'onglet `panel` est allumée (et l'onglet ouvert). */
  toggled: (panel: P, key: string) => boolean;
  /** Allume ou éteint la case `key` de l'onglet `panel`, les autres cases et la surbrillance restant. */
  toggle: (panel: P, key: string) => void;
}

/** Clé réservée au tronçon d'un graphe zoomé : aucune autre surbrillance ne la prend. */
const ZOOM_KEY = 'zoom:graphe';

/** Rendue stable tant que la surbrillance ne change pas : ses rappels peuvent passer à un panneau mémoïsé. */
export const useMapHighlight = <P extends string, T extends HighlightKeys<P> = Record<never, never>>(
  open: Record<P, boolean>
): MapHighlight<P, T> => {
  const [shown, setShown] = useState<TabEntry<P> | null>(null);
  const [toggles, setToggles] = useState<readonly TabEntry<P>[]>([]);
  // Onglet fermé : sa surbrillance et ses cases s'effacent pendant ce rendu même
  // (React refait aussitôt le rendu du composant), pour ne pas revenir à sa réouverture.
  if (shown !== null && !open[shown.panel]) setShown(null);
  const live = shown !== null && open[shown.panel] ? shown : null;
  const liveToggles = keepOpenTabEntries(toggles, open);
  if (liveToggles !== toggles) setToggles(liveToggles);
  const show = useCallback(
    <Q extends P>(panel: Q, key: HighlightKey<T, Q> | null) => setShown(key === null ? null : { panel, key }),
    []
  );
  const showZoom = useCallback((panel: P) => setShown({ panel, key: ZOOM_KEY }), []);
  const toggle = useCallback(
    (panel: P, key: string) =>
      setToggles((current) =>
        current.some((entry) => entry.panel === panel && entry.key === key)
          ? current.filter((entry) => entry.panel !== panel || entry.key !== key)
          : [...current, { panel, key }]
      ),
    []
  );
  return useMemo(() => {
    // Les clés sont rangées en chaînes ; leur type par onglet est celui qu'a reçu `show`.
    const shownIn = <Q extends P>(panel: Q) =>
      (live !== null && live.panel === panel && live.key !== ZOOM_KEY ? live.key : null) as HighlightKey<T, Q> | null;
    const toggled = (panel: P, key: string) => liveToggles.some((entry) => entry.panel === panel && entry.key === key);
    return { shownIn, show, zoomPanel: live !== null && live.key === ZOOM_KEY ? live.panel : null, showZoom, toggled, toggle };
  }, [live, show, showZoom, liveToggles, toggle]);
};
