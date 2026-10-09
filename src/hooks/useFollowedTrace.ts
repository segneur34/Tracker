import { useSyncExternalStore } from 'react';
import { jsonStore } from '../platform/storage';
import { FOLLOWED_TRACE_TOLERANCE_M, followedTraceFromPoints, thinFollowedTrace, type FollowedTrace } from '../recording/followedTrace';
import { sanitizeMarkGuide } from '../recording/markGuide';

/**
 * Trace suivie pendant l'enregistrement, gardée hors des pages : elle reste
 * affichée quand on quitte la page Enregistrer et qu'on y revient. Gardée sur
 * l'appareil jusqu'à « Retirer », fermeture de l'application ou plantage
 * compris ; propre à l'appareil, elle ne voyage pas dans `reglages.json`.
 * Amincie dès qu'on la choisit (`thinFollowedTrace`) : la même trace est
 * suivie et gardée, et elle pèse peu dans le stockage de l'appareil.
 */

const STORAGE_KEY = 'tracker.followedTrace';

/** Trace gardée, relue avec sa forme vérifiée ; `null` si absente ou illisible. */
const readStored = (): FollowedTrace | null => {
  const stored = jsonStore.read<Partial<FollowedTrace>>(STORAGE_KEY);
  if (!stored || typeof stored.name !== 'string' || !Array.isArray(stored.points)) return null;
  if (stored.source !== 'route' && stored.source !== 'session') return null;
  const activityId = typeof stored.activityId === 'string' && stored.activityId !== '' ? stored.activityId : null;
  const marks = Array.isArray(stored.marks) ? stored.marks : undefined;
  const trace = followedTraceFromPoints(stored.points, stored.name, stored.source, activityId, marks);
  const markGuide = sanitizeMarkGuide(stored.markGuide);
  return trace && markGuide ? { ...trace, markGuide } : trace;
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
  if (followed === undefined) {
    const stored = readStored();
    followed = stored && thinFollowedTrace(stored, FOLLOWED_TRACE_TOLERANCE_M);
    // Trace gardée avant l'amincissement : récrite une fois, allégée.
    if (stored && followed && followed.points.length < stored.points.length) jsonStore.write(STORAGE_KEY, followed);
  }
  return followed;
};

const set = (next: FollowedTrace | null) => {
  followed = next && thinFollowedTrace(next, FOLLOWED_TRACE_TOLERANCE_M);
  jsonStore.write(STORAGE_KEY, followed);
  for (const listener of listeners) listener();
};

export const followTrace = (trace: FollowedTrace): void => set(trace);

export const clearFollowedTrace = (): void => set(null);

export const useFollowedTrace = (): FollowedTrace | null => useSyncExternalStore(subscribe, getSnapshot);

/** Trace suivie, hors React (guidage vers les balises). */
export const getFollowedTrace = (): FollowedTrace | null => getSnapshot();

/** Changements de la trace suivie, hors React ; rend le désabonnement. */
export const subscribeToFollowedTrace = (listener: () => void): (() => void) => subscribe(listener);
