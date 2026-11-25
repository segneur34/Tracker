import { useCallback, useSyncExternalStore } from 'react';
import { jsonStore } from '../platform/storage';

/**
 * Carte du direct orientée selon le téléphone (vrai) ou nord en haut (faux,
 * le départ) : choix propre à l'appareil (clé `tracker.carteOrientee`), le même
 * pour toutes les activités, changé par le bouton de la carte.
 */

const STORAGE_KEY = 'tracker.carteOrientee';

export const readMapOriented = (): boolean => jsonStore.read<unknown>(STORAGE_KEY) === true;

export const useMapOrientation = (): [boolean, (oriented: boolean) => void] => {
  const oriented = useSyncExternalStore(jsonStore.subscribe, readMapOriented);
  const setOriented = useCallback((next: boolean) => jsonStore.write(STORAGE_KEY, next), []);
  return [oriented, setOriented];
};
