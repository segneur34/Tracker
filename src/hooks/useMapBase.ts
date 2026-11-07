import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { isMapBase, MAP_BASE_DEFAULT, resolveMapBase, type MapBase } from '../core/mapBase';
import type { SportFamily } from '../core/sportProfiles';
import { jsonStore } from '../platform/storage';
import { updateSessionRecord, useLibrarySession } from './useSessionLibrary';

/**
 * Fond de carte (plan ou satellite). Celui d'une famille est propre à
 * l'appareil (clé `tracker.fondCarte`) : il sert à la planification, au direct
 * et de départ aux sessions. Celui d'une analyse est propre à sa session, dans
 * sa fiche (`mapBase`), changé tout de suite par le bouton de la carte, comme
 * le support ; sans fond rangé, la session prend celui de sa famille.
 */

const STORAGE_KEY = 'tracker.fondCarte';

type StoredBases = Partial<Record<SportFamily, unknown>>;

export const readMapBase = (family: SportFamily): MapBase => {
  const value = jsonStore.read<StoredBases>(STORAGE_KEY)?.[family];
  return isMapBase(value) ? value : MAP_BASE_DEFAULT;
};

/**
 * Session dont la carte montre le fond : posée par `AnalysisBaseLayers` pour les couches de la carte
 * d'une analyse (fond, trace). `undefined` hors d'une analyse (planification, direct) : le fond de la famille.
 * `null` : analyse d'un GPX hors de la mémoire.
 */
export const MapBaseSessionContext = createContext<string | null | undefined>(undefined);

/** Fond choisi pour un GPX hors de la mémoire, le temps de l'application : aucune fiche où le ranger. */
let looseBase: MapBase | null = null;
const looseListeners = new Set<() => void>();
const subscribeLoose = (listener: () => void): (() => void) => {
  looseListeners.add(listener);
  return () => void looseListeners.delete(listener);
};

/**
 * Fond de `family` et son changement ; sans famille (vignettes de la bibliothèque), le plan, qui ne change pas.
 * Avec une session (`file`, ou celle du contexte d'une analyse), le fond de sa fiche s'il existe, et le
 * changement l'écrit dans sa fiche sans toucher à celui de la famille.
 */
export const useMapBase = (family: SportFamily | null, file?: string | null): [MapBase, (base: MapBase) => void] => {
  const contextFile = useContext(MapBaseSessionContext);
  const scope = file !== undefined ? file : contextFile;
  const familyBase = useSyncExternalStore(jsonStore.subscribe, () => (family ? readMapBase(family) : 'plan'));
  const session = useLibrarySession(scope ?? null);
  const loose = useSyncExternalStore(subscribeLoose, () => looseBase);
  const base = !family ? familyBase : scope === undefined
    ? familyBase
    : resolveMapBase(session ? session.record.mapBase : loose, familyBase);
  const setBase = useCallback((next: MapBase) => {
    if (!family) return;
    if (scope === undefined) {
      jsonStore.write(STORAGE_KEY, { ...jsonStore.read<StoredBases>(STORAGE_KEY), [family]: next });
    } else if (session === undefined) {
      looseBase = next;
      looseListeners.forEach((listener) => listener());
    } else if (!session.readOnly && scope !== null) {
      updateSessionRecord(scope, { mapBase: next });
    }
  }, [family, scope, session]);
  return [base, setBase];
};
