import { useSyncExternalStore } from 'react';
import { jsonStore } from '../platform/storage';
import { createTickingStore } from './createStore';
import {
  readStopwatch, startStopwatch, stopwatchCommand, stopwatchState,
  type Stopwatch, type StopwatchCommand, type StopwatchState,
} from '../recording/stopwatch';

/**
 * Chronomètre libre de la carte du compteur, hors des composants : il
 * continue quand on change de page, indépendant du compteur et de
 * l'enregistrement. Sans son. Gardé sur l'appareil (`tracker.stopwatch`) pour
 * survivre à une page fermée par Android.
 */

/** Clé de l'appareil où le chrono est gardé. */
const STORAGE_KEY = 'tracker.stopwatch';
/** Rafraîchissement de l'affichage tant qu'une page le regarde, en ms : le chrono montre le dixième. */
const REFRESH_MS = 100;

export interface StopwatchView {
  /** Chrono lancé, `null` avant le départ ou après la remise à zéro. */
  stopwatch: Stopwatch | null;
  /** État à l'instant de la lecture, `null` sans chrono. */
  state: StopwatchState | null;
}

let stopwatch: Stopwatch | null = null;
/** Minuterie d'affichage : seulement quand une page regarde un chrono en marche. */
const ticking = createTickingStore<StopwatchView>({
  initial: { stopwatch: null, state: null },
  compute: () => ({ stopwatch, state: stopwatch ? stopwatchState(stopwatch, Date.now()) : null }),
  isRunning: (view) => view.state?.status === 'running',
  hasWork: () => stopwatch !== null,
  intervalMs: REFRESH_MS,
});
const { publish, subscribe } = ticking;

const persist = (): void => jsonStore.write(STORAGE_KEY, stopwatch);

const command = (kind: StopwatchCommand): void => {
  if (!stopwatch) return;
  const next = stopwatchCommand(stopwatch, kind, Date.now());
  if (next === stopwatch) return;
  stopwatch = next;
  persist();
  publish();
};

/** Départ du chrono, tout de suite ; sans effet s'il est déjà lancé. */
export const startStopwatchRun = (): void => {
  if (stopwatch) return;
  stopwatch = startStopwatch(Date.now());
  persist();
  publish();
};

export const lapStopwatch = (): void => command('lap');
export const pauseStopwatch = (): void => command('pause');
export const resumeStopwatch = (): void => command('resume');

/** Remise à zéro : le chrono et ses tours sont effacés. */
export const resetStopwatch = (): void => {
  stopwatch = null;
  persist();
  publish();
};

/** Vrai tant que le chrono est en marche : la touche retour ne doit pas fermer l'application. */
export const isStopwatchRunning = (): boolean =>
  stopwatch !== null && stopwatchState(stopwatch, Date.now()).status === 'running';

let started = false;

/** Reprend, une fois au démarrage de l'application, le chrono gardé sur l'appareil. */
export const startStopwatchStore = (): void => {
  if (started) return;
  started = true;
  stopwatch = readStopwatch(jsonStore.read<unknown>(STORAGE_KEY));
  publish();
};

/** Le chrono, relu à chaque commande et, en marche, au dixième de seconde. */
export const useStopwatch = (): StopwatchView => useSyncExternalStore(subscribe, ticking.get);

/** Vrai tant qu'un chrono est lancé, en pause comprise ; ne redessine qu'à ce changement. */
export const useStopwatchOpen = (): boolean => useSyncExternalStore(subscribe, () => ticking.get().stopwatch !== null);

/** Vrai tant que le chrono est en marche, pas en pause : l'écran reste allumé ; ne redessine qu'à ce changement. */
export const useStopwatchRunning = (): boolean => useSyncExternalStore(subscribe, () => ticking.get().state?.status === 'running');
