import { useSyncExternalStore } from 'react';
import type { FollowedTrace } from '../recording/followedTrace';

/**
 * Trace suivie pendant l'enregistrement, gardée hors des pages : elle reste
 * affichée quand on quitte la page Enregistrer et qu'on y revient. Non
 * persistée : elle se perd à la fermeture de l'application.
 */

let followed: FollowedTrace | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const set = (next: FollowedTrace | null) => {
  followed = next;
  for (const listener of listeners) listener();
};

export const followTrace = (trace: FollowedTrace): void => set(trace);

export const clearFollowedTrace = (): void => set(null);

export const useFollowedTrace = (): FollowedTrace | null => useSyncExternalStore(subscribe, () => followed);
