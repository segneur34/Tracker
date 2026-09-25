import { useSyncExternalStore } from 'react';
import { jsonStore } from '../platform/storage';
import { followedTraceFromPoints, type FollowedTrace } from '../recording/followedTrace';

/**
 * Trace suivie pendant l'enregistrement, gardée hors des pages : elle reste
 * affichée quand on quitte la page Enregistrer et qu'on y revient. Gardée sur
 * l'appareil jusqu'à « Retirer », fermeture de l'application ou plantage
 * compris ; propre à l'appareil, elle ne voyage pas dans `reglages.json`.
 */

const STORAGE_KEY = 'tracker.followedTrace';

/** Trace gardée, relue avec sa forme vérifiée ; `null` si absente ou illisible. */
const readStored = (): FollowedTrace | null => {
  const stored = jsonStore.read<Partial<FollowedTrace>>(STORAGE_KEY);
  if (!stored || typeof stored.name !== 'string' || !Array.isArray(stored.points)) return null;
  if (stored.source !== 'route' && stored.source !== 'session') return null;
  return followedTraceFromPoints(stored.points, stored.name, stored.source);
};

// Lue au premier besoin, pas au chargement du module : `initStorage` doit avoir chargé le stockage natif.
let followed: FollowedTrace | null | undefined;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): FollowedTrace | null => {
  if (followed === undefined) followed = readStored();
  return followed;
};

const set = (next: FollowedTrace | null) => {
  followed = next;
  jsonStore.write(STORAGE_KEY, next);
  for (const listener of listeners) listener();
};

export const followTrace = (trace: FollowedTrace): void => set(trace);

export const clearFollowedTrace = (): void => set(null);

export const useFollowedTrace = (): FollowedTrace | null => useSyncExternalStore(subscribe, getSnapshot);
