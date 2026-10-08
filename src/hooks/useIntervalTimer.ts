import { useSyncExternalStore } from 'react';
import { getIntervalClock } from '../platform/beeper';
import { jsonStore } from '../platform/storage';
import {
  phaseName, readIntervalRun, runCommand, startRun, timerStateAt, upcomingSchedule,
  type IntervalCommand, type IntervalRun, type IntervalTimerState, type IntervalWorkout,
} from '../recording/intervalTimer';
import { getRecorderState, noteIntervalRun, subscribeToRecorder } from './useRecorder';
import { rememberIntervalWorkout } from './useSportSettings';

/**
 * Compteur du fractionné (§10, point 89), hors des composants : il continue
 * quand on change de page, avec ou sans enregistrement. Les pages le lisent
 * par `useIntervalTimer` et le pilotent par `startIntervals`,
 * `pauseIntervals`, `resumeIntervals`, `skipIntervalPhase`, `stopIntervals`
 * et `closeIntervals`.
 *
 * L'état se déduit de l'heure (`recording/intervalTimer.ts`) ; les sons, eux,
 * sont confiés en entier au téléphone à chaque commande (`getIntervalClock`) :
 * écran éteint, la page ne tourne plus, Android joue le programme. Pendant un
 * enregistrement, chaque état de la séance est confié à l'enregistreur
 * (`noteIntervalRun`), qui la range avec la session.
 *
 * La séance est aussi gardée sur l'appareil (`tracker.intervalRun`) : si
 * Android ferme la page pendant qu'elle court, la page rouverte la reprend
 * telle quelle, et peut encore l'arrêter.
 */

/** Clé de l'appareil où la séance en cours est gardée. */
const STORAGE_KEY = 'tracker.intervalRun';

/** Délai entre le dernier son de la séance et l'arrêt du service qui les joue, en ms. */
const END_GRACE_MS = 4000;
/** Rafraîchissement de l'affichage tant qu'une page le regarde, en ms. */
const REFRESH_MS = 250;
/** Vibration avec les sons : toujours, dans cette première version. */
const VIBRATE = true;

export interface IntervalTimerView {
  /** Séance lancée, `null` avant tout lancement ou une fois fermée. */
  run: IntervalRun | null;
  /** État à l'instant `nowMs`, `null` sans séance. */
  state: IntervalTimerState | null;
  nowMs: number;
  /** Dernier échec du téléphone à jouer le programme, `null` sinon. */
  error: string | null;
}

let run: IntervalRun | null = null;
let error: string | null = null;
let view: IntervalTimerView = { run: null, state: null, nowMs: 0, error: null };
const listeners = new Set<() => void>();
let refresh: ReturnType<typeof setInterval> | null = null;

const isActive = (state: IntervalTimerState | null): boolean => state?.status === 'running' || state?.status === 'paused';

const publish = (): void => {
  const nowMs = Date.now();
  view = { run, state: run ? timerStateAt(run, nowMs) : null, nowMs, error };
  listeners.forEach((listener) => listener());
  syncRefresh();
};

/** Minuterie d'affichage : seulement quand une page regarde une séance qui avance. */
const syncRefresh = (): void => {
  const wanted = listeners.size > 0 && view.state?.status === 'running';
  if (wanted && refresh === null) refresh = setInterval(publish, REFRESH_MS);
  if (!wanted && refresh !== null) {
    clearInterval(refresh);
    refresh = null;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Une page qui arrive voit l'état du moment, pas celui de la dernière fois qu'on a regardé.
  if (run) queueMicrotask(publish);
  syncRefresh();
  return () => {
    listeners.delete(listener);
    syncRefresh();
  };
};

/**
 * Confie au téléphone le programme de la séance à partir de maintenant :
 * sons et notification en marche, notification seule en pause, rien une fois
 * close. `announce` : la phase en cours vient de commencer (« Passer »), un bip long l'annonce.
 */
const reschedule = (announce: boolean): void => {
  const clock = getIntervalClock();
  const onError = (err: unknown) => {
    error = err instanceof Error && err.message ? err.message : 'Les bips du compteur ne peuvent pas être joués.';
    publish();
  };
  error = null;
  if (!run) {
    clock.stop().catch(onError);
    return;
  }
  const nowMs = Date.now();
  const state = timerStateAt(run, nowMs);
  if (state.status === 'running') {
    const { tones, cues } = upcomingSchedule(run, nowMs, announce);
    const lastToneMs = tones.reduce((m, t) => Math.max(m, t.delayMs), 0);
    clock.schedule({ tones, cues, stopAfterMs: lastToneMs + END_GRACE_MS }, VIBRATE).catch(onError);
  } else if (state.status === 'paused' && state.phase) {
    const title = `En pause · ${phaseName(state.phase, run.workout.reps)}`;
    clock.schedule({ tones: [], cues: [{ delayMs: 0, title, phaseMs: 0 }], stopAfterMs: 0 }, VIBRATE).catch(onError);
  } else {
    clock.stop().catch(onError);
  }
};

/** Garde la séance sur l'appareil, ou l'efface. */
const persist = (): void => jsonStore.write(STORAGE_KEY, run);

const command = (kind: IntervalCommand, announce: boolean): void => {
  if (!run) return;
  const next = runCommand(run, kind, Date.now());
  if (next === run) return;
  run = next;
  persist();
  noteIntervalRun(run);
  reschedule(announce);
  publish();
};

/** Lance une séance, tout de suite ; une séance en cours est remplacée. */
export const startIntervals = (workout: IntervalWorkout): void => {
  if (run && isActive(timerStateAt(run, Date.now()))) {
    run = runCommand(run, 'stop', Date.now());
    noteIntervalRun(run);
  }
  run = startRun(workout, Date.now());
  persist();
  rememberIntervalWorkout(workout);
  noteIntervalRun(run);
  // Le compte à rebours du départ porte son propre signal.
  reschedule(false);
  publish();
};

export const pauseIntervals = (): void => command('pause', false);
export const resumeIntervals = (): void => command('resume', false);
/** « Passer » : la phase suivante commence tout de suite, annoncée par un bip long. */
export const skipIntervalPhase = (): void => command('skip', true);
export const stopIntervals = (): void => command('stop', false);

/** Ferme une séance close (finie ou arrêtée) : le compteur revient au choix de la séance. */
export const closeIntervals = (): void => {
  if (run && isActive(timerStateAt(run, Date.now()))) return;
  run = null;
  persist();
  reschedule(false);
  publish();
};

/** Vrai tant qu'une séance court ou attend en pause : la touche retour ne doit pas fermer l'application. */
export const isIntervalTimerActive = (): boolean => run !== null && isActive(timerStateAt(run, Date.now()));

let started = false;
let wasRecording = false;

/**
 * Branche le compteur, une fois, au démarrage de l'application : une séance
 * gardée qui court encore est reprise, et son programme rendu au téléphone ;
 * une séance close est oubliée, et un service resté seul, arrêté. Puis un
 * enregistrement lancé pendant une séance la reçoit.
 */
export const startIntervalTimer = (): void => {
  if (started) return;
  started = true;
  const stored = readIntervalRun(jsonStore.read<unknown>(STORAGE_KEY));
  run = stored && isActive(timerStateAt(stored, Date.now())) ? stored : null;
  if (!run && stored) persist();
  reschedule(false);
  publish();
  subscribeToRecorder(() => {
    const recording = getRecorderState().status !== 'idle';
    if (recording && !wasRecording && run && isActive(timerStateAt(run, Date.now()))) noteIntervalRun(run);
    wasRecording = recording;
  });
};

/** Le compteur, relu à chaque changement et, pendant une séance qui avance, au quart de seconde. */
export const useIntervalTimer = (): IntervalTimerView => useSyncExternalStore(subscribe, () => view);

/** Vrai tant qu'une séance est lancée, close comprise jusqu'à « Fermer » ; ne redessine qu'à ce changement. */
export const useIntervalTimerOpen = (): boolean => useSyncExternalStore(subscribe, () => view.run !== null);
