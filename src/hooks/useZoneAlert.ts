import { useSyncExternalStore } from 'react';
import type { Activity } from '../core/activities';
import { getSportProfile, isTestSport } from '../core/sportProfiles';
import { playPattern } from '../platform/beeper';
import { subscribeHeartRate, type HeartRateSample } from '../platform/heartRate';
import { jsonStore } from '../platform/storage';
import { TEST_SIGNAL_TONES } from '../recording/signalTones';
import { readableBpm } from '../recording/heartRate';
import { isRecordingSession } from '../recording/session';
import {
  sanitizeBand, startZoneAlert, stepZoneAlert, validBand, zoneAlertParams,
  type HeartBand, type ZoneAlertParams, type ZoneAlertSetup, type ZoneAlertState, type ZoneSignal, type ZoneTarget,
} from '../recording/zoneAlert';
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
 *
 * Pendant l'enregistrement, la zone visée reste aussi sur l'appareil, le temps de
 * le reprendre après une coupure (lot 156) ; effacée à l'arrêt, écrasée au départ
 * suivant : un départ ordinaire ne la relit jamais.
 *
 * « Course à bornes » (Entraînement, 05/11) : à la place d'une zone, une bande de
 * FC (`HeartBand`, mini et/ou maxi), armée de même, rangée de même (un objet à la
 * place du numéro de zone), et changeable pendant l'enregistrement
 * (`setLiveBand`), le compte des signaux remis à zéro ; elle ne demande pas les
 * zones du pratiquant.
 */

/** Clé de l'appareil de la zone visée (un numéro) ou de la bande (un objet) pendant l'enregistrement. */
const STORAGE_KEY = 'tracker.zoneAlertTarget';

/** Guidage cardio armé : une zone visée (0 : aucun), ou une bande de la course à bornes. */
export type HeartGuide = ZoneTarget | HeartBand;

/** Guidage gardé pour une session reprise : zone, ou bande (format du 05/11) ; 0 si absent ou illisible. */
const readStoredGuide = (): HeartGuide => {
  const value = jsonStore.read<unknown>(STORAGE_KEY);
  if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
  return sanitizeBand(value) ?? 0;
};

export interface ZoneAlertView {
  /** Vrai pendant un enregistrement dont les bips de zone sont armés. */
  active: boolean;
  /** Zone visée, 0 sans bips ou avec une bande. */
  target: ZoneTarget;
  /** Bande de la course à bornes, `null` sans elle. */
  band: HeartBand | null;
}

const INACTIVE: ZoneAlertView = { active: false, target: 0, band: null };

interface Session {
  activityId: string;
  target: ZoneTarget;
  band: HeartBand | null;
  setup: ZoneAlertSetup;
  state: ZoneAlertState;
}

let armed: HeartGuide = 0;
let session: Session | null = null;
/** L'enregistreur était en cours d'enregistrement au dernier passage : son arrêt désarme. */
let recordingBefore = false;
const store = createStore<ZoneAlertView>(INACTIVE);

const publish = () => {
  const next: ZoneAlertView = session ? { active: true, target: session.target, band: session.band } : INACTIVE;
  const current = store.get();
  if (current.active !== next.active || current.target !== next.target || current.band !== next.band) store.set(next);
};

/** Réglage des bips pour l'activité : la bande telle quelle, ou la zone sur les bornes du pratiquant ; `null` sans zones. */
const setupFor = (guide: HeartGuide, activity: Activity): Omit<Session, 'activityId' | 'state'> | null => {
  const params: ZoneAlertParams = zoneAlertParams(getSportProfile(activity.base).heartRate);
  if (typeof guide !== 'number') return validBand(guide) ? { target: 0, band: guide, setup: { band: guide, params } } : null;
  const bounds = readHeartRateZoneBounds(activity);
  return bounds === null ? null : { target: guide, band: null, setup: { bounds, target: guide, params } };
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
    if (recordingBefore) {
      armed = 0;
      jsonStore.write(STORAGE_KEY, null);
    }
    recordingBefore = false;
    session = null;
    publish();
    return;
  }
  if (!recordingBefore) {
    if (recorder.resuming) armed = readStoredGuide();
    jsonStore.write(STORAGE_KEY, armed === 0 ? null : armed);
  }
  recordingBefore = true;
  const activity = recorder.activity;
  if (armed === 0 || activity === null || isTestSport(activity.base)) {
    session = null;
    publish();
    return;
  }
  if (session?.activityId !== activity.id) {
    const setup = setupFor(armed, activity);
    session = setup === null ? null : { activityId: activity.id, ...setup, state: startZoneAlert() };
  }
  publish();
};

const onHeartRate = (sample: HeartRateSample) => {
  const current = session;
  if (!current) return;
  const active = getRecorderState().status === 'recording';
  const next = stepZoneAlert(current.state, { timeMs: sample.timeMs, bpm: readableBpm(sample), active }, current.setup);
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

/** Bande de la course à bornes au prochain départ (choix d'Enregistrer) ; une bande inutilisable n'arme rien. */
export const armHeartBand = (band: HeartBand): void => {
  armed = validBand(band) ? band : 0;
  sync();
};

/**
 * Bande changée pendant l'enregistrement (« Modifier », sous la tuile BPM) : les
 * bips la suivent dès la mesure suivante, le compte des signaux repart de zéro ;
 * gardée sur l'appareil pour une reprise. Une bande inutilisable est ignorée.
 */
export const setLiveBand = (band: HeartBand): void => {
  if (!validBand(band)) return;
  armed = band;
  if (recordingBefore) jsonStore.write(STORAGE_KEY, band);
  const current = session;
  if (current) {
    const params = current.setup.params;
    session = { ...current, target: 0, band, setup: { band, params }, state: { ...startZoneAlert(), lastSignalMs: current.state.lastSignalMs } };
  }
  sync();
};

/** Zone visée armée, hors React ; 0 sans bips ou avec une bande. */
export const getZoneAlertTarget = (): ZoneTarget => (typeof armed === 'number' ? armed : 0);

/** Guidage cardio armé, hors React : zone, bande, ou 0. */
export const getHeartGuide = (): HeartGuide => armed;

/** Bips de zone de l'enregistrement en cours : armés ou non, et la zone visée. */
export const useZoneAlert = (): ZoneAlertView => useSyncExternalStore(store.subscribe, store.get);
