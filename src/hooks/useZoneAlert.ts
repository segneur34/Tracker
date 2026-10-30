import { useSyncExternalStore } from 'react';
import { getSportProfile, isTestSport } from '../core/sportProfiles';
import { playPattern } from '../platform/beeper';
import { subscribeHeartRate, type HeartRateSample } from '../platform/heartRate';
import { TEST_SIGNAL_TONES } from '../recording/fitnessTest';
import { readableBpm } from '../recording/heartRate';
import { isRecordingSession } from '../recording/session';
import { startZoneAlert, stepZoneAlert, zoneAlertParams, type ZoneAlertParams, type ZoneAlertState, type ZoneSignal, type ZoneTarget } from '../recording/zoneAlert';
import { createStore } from './createStore';
import { getRecorderState, subscribeToRecorder } from './useRecorder';
import { readHeartRateZoneBounds } from './useRunnerProfile';

/**
 * Bips de sortie de zone cardiaque pendant l'enregistrement (lot 28), hors des
 * composants comme le guidage des tests (`useFitnessTest`) : ils tournent
 * écran éteint, page fermée.
 *
 * La zone visée est armée au départ (`armZoneAlert`, choix d'Enregistrer) ;
 * les bips démarrent avec l'enregistrement, sur les zones du cardio de
 * Pratiquant pour son activité (relues si l'activité change), se taisent
 * pendant une activité de test (qui a son propre guidage) et sont désarmés à
 * l'arrêt. Chaque mesure de la ceinture (`subscribeHeartRate`, environ une
 * par seconde) fait avancer `stepZoneAlert`, active seulement en état
 * `recording` : muette au départ et en pause, manuelle ou automatique. Chaque
 * signal est joué une fois (`playPattern`, vibreur compris) et consigné en
 * `console.debug` (« [zone] … ») pour le banc.
 */

export interface ZoneAlertView {
  /** Vrai pendant un enregistrement dont les bips de zone sont armés. */
  active: boolean;
  /** Zone visée, 0 sans bips. */
  target: ZoneTarget;
}

const INACTIVE: ZoneAlertView = { active: false, target: 0 };

interface Session {
  activityId: string;
  target: ZoneTarget;
  bounds: number[];
  params: ZoneAlertParams;
  state: ZoneAlertState;
}

let armed: ZoneTarget = 0;
let session: Session | null = null;
/** L'enregistreur était en cours d'enregistrement au dernier passage : son arrêt désarme. */
let recordingBefore = false;
const store = createStore<ZoneAlertView>(INACTIVE);

const publish = () => {
  const next = session ? { active: true, target: session.target } : INACTIVE;
  const current = store.get();
  if (current.active !== next.active || current.target !== next.target) store.set(next);
};

const play = (signal: ZoneSignal, timeMs: number) => {
  console.debug(`[zone] ${signal} à ${timeMs}`);
  void playPattern(TEST_SIGNAL_TONES[signal], true).catch(() => {});
};

/** Arme, réarme (autre activité) ou coupe les bips selon l'état de l'enregistreur. */
const sync = () => {
  const recorder = getRecorderState();
  const recording = isRecordingSession(recorder);
  if (!recording) {
    // Fin de l'enregistrement : la zone visée ne vaut que pour lui.
    if (recordingBefore) armed = 0;
    recordingBefore = false;
    session = null;
    publish();
    return;
  }
  recordingBefore = true;
  const activity = recorder.activity;
  if (armed === 0 || activity === null || isTestSport(activity.base)) {
    session = null;
    publish();
    return;
  }
  if (session?.activityId !== activity.id) {
    const bounds = readHeartRateZoneBounds(activity);
    session = bounds === null
      ? null
      : { activityId: activity.id, target: armed, bounds, params: zoneAlertParams(getSportProfile(activity.base).heartRate), state: startZoneAlert() };
  }
  publish();
};

const onHeartRate = (sample: HeartRateSample) => {
  const current = session;
  if (!current) return;
  const active = getRecorderState().status === 'recording';
  const next = stepZoneAlert(current.state, { timeMs: sample.timeMs, bpm: readableBpm(sample), active }, current);
  current.state = next.state;
  if (next.signal) play(next.signal, sample.timeMs);
};

let started = false;

/** Branche les bips de zone sur l'enregistreur et la ceinture ; à appeler une fois au démarrage de l'application. */
export const startZoneAlertGuide = (): void => {
  if (started) return;
  started = true;
  subscribeToRecorder(sync);
  subscribeHeartRate(onHeartRate);
  sync();
};

/** Zone visée au prochain départ (choix d'Enregistrer), 0 sans bips. */
export const armZoneAlert = (target: ZoneTarget): void => {
  armed = target;
  sync();
};

/** Bips de zone de l'enregistrement en cours : armés ou non, et la zone visée. */
export const useZoneAlert = (): ZoneAlertView => useSyncExternalStore(store.subscribe, store.get);
