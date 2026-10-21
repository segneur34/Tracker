import { useCallback, useSyncExternalStore } from 'react';
import { isMapBase, MAP_BASE_DEFAULT, type MapBase } from '../core/mapBase';
import type { SportFamily } from '../core/sportProfiles';
import { jsonStore } from '../platform/storage';

/**
 * Fond de carte choisi par famille (plan ou satellite), propre à l'appareil
 * (clé `tracker.fondCarte`), changé par le bouton posé sur la carte
 * (`BaseTileLayer`). Suivi en direct : toutes les cartes d'une famille
 * basculent ensemble, la vue agrandie d'une analyse comprise.
 */

const STORAGE_KEY = 'tracker.fondCarte';

type StoredBases = Partial<Record<SportFamily, unknown>>;

export const readMapBase = (family: SportFamily): MapBase => {
  const value = jsonStore.read<StoredBases>(STORAGE_KEY)?.[family];
  return isMapBase(value) ? value : MAP_BASE_DEFAULT;
};

/** Fond de `family` et son changement ; sans famille (vignettes de la bibliothèque), le plan, qui ne change pas. */
export const useMapBase = (family: SportFamily | null): [MapBase, (base: MapBase) => void] => {
  const base = useSyncExternalStore(jsonStore.subscribe, () => (family ? readMapBase(family) : 'plan'));
  const setBase = useCallback((next: MapBase) => {
    if (family) jsonStore.write(STORAGE_KEY, { ...jsonStore.read<StoredBases>(STORAGE_KEY), [family]: next });
  }, [family]);
  return [base, setBase];
};
