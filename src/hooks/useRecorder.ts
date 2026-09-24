import { useSyncExternalStore } from 'react';
import { getSportProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { recordingJournal } from '../platform/files';
import { stopOrphanedDeviceLocation, type LocationFix, type LocationSource, type StopLocation } from '../platform/location';
import { buildGpx } from '../recording/gpxWriter';
import { journalFixLine, journalHeaderLine, parseJournal } from '../recording/journal';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  isNewerFix,
  roundFix,
  sessionFileName,
  sessionTitle,
  shouldFlushJournal,
  type RecordingStats,
} from '../recording/session';
import { saveRecordedSession } from './useSessionLibrary';

/**
 * Enregistreur de session. Il vit hors des composants, dans ce module : on
 * peut changer de page pendant un enregistrement sans l'interrompre. Les
 * pages le lisent par `useRecorder` et le pilotent par `startRecording`,
 * `stopRecording` et `recoverInterruptedRecording`.
 *
 * Chaîne : chaque position reçue est arrondie (`roundFix`), gardée en mémoire
 * et ajoutée au journal, écrit par paquets à l'arrivée des positions
 * (`shouldFlushJournal`). À l'arrêt, le GPX est construit depuis la mémoire
 * et rangé dans la bibliothèque (`saveRecordedSession`) ; après un arrêt
 * brutal, il est reconstruit depuis le journal au démarrage suivant. Le
 * journal n'est effacé qu'une fois le GPX écrit.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'stopping';

/** Session terminée, rangée et prête à être analysée. */
export interface SavedSession {
  fileName: string;
  /** Nom dans la mémoire, `null` si la session n'a pas pu y entrer (en attente, ou aucune mémoire). */
  libraryFile: string | null;
  /** Où la trouver, en clair. */
  location: string;
  /** Le GPX lui-même, pour l'analyser ou le télécharger sans le relire. */
  content: string;
  sport: SportType;
  pointCount: number;
  /** Vrai si elle a été reconstruite depuis le journal d'un enregistrement interrompu. */
  recovered: boolean;
}

export interface RecorderState {
  status: RecorderStatus;
  sport: SportType | null;
  sourceLabel: string | null;
  stats: RecordingStats;
  saved: SavedSession | null;
  error: string | null;
}

const INITIAL_STATE: RecorderState = {
  status: 'idle',
  sport: null,
  sourceLabel: null,
  stats: EMPTY_RECORDING_STATS,
  saved: null,
  error: null,
};

let state = INITIAL_STATE;
const listeners = new Set<() => void>();

const setState = (patch: Partial<RecorderState>): void => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const errorMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

// --- Enregistrement en cours ---

let fixes: LocationFix[] = [];
let pendingLines = '';
let lastFlushMs: number | null = null;
let stopSource: StopLocation | null = null;
/** Écritures du journal, enchaînées pour qu'elles arrivent dans l'ordre. */
let writes: Promise<void> = Promise.resolve();

const enqueueWrite = (write: () => Promise<void>): Promise<void> => {
  writes = writes.then(write).catch((err) => {
    setState({ error: `Écriture du journal impossible : ${errorMessage(err, 'erreur inconnue')}` });
  });
  return writes;
};

const flushJournal = (): Promise<void> => {
  if (pendingLines === '') return writes;
  const lines = pendingLines;
  pendingLines = '';
  return enqueueWrite(() => recordingJournal.append(lines));
};

const receiveFix = (journalFlushS: number) => (received: LocationFix): void => {
  if (state.status !== 'recording' && state.status !== 'starting') return;
  if (!isNewerFix(state.stats.lastMs, received)) return;
  const fix = roundFix(received);
  fixes.push(fix);
  pendingLines += journalFixLine(fix);
  setState({ stats: addFixToStats(state.stats, fix) });
  if (shouldFlushJournal(lastFlushMs, fix.timeMs, journalFlushS)) {
    lastFlushMs = fix.timeMs;
    void flushJournal();
  }
};

/**
 * Range le GPX d'une liste de positions dans la bibliothèque, puis efface le
 * journal. Rend `null` s'il y a moins de deux positions : aucune trace ne
 * s'en tire, il n'y a rien à garder.
 */
const saveSession = async (sport: SportType, list: LocationFix[], recovered: boolean): Promise<SavedSession | null> => {
  if (list.length < 2) {
    await recordingJournal.remove();
    return null;
  }
  const startMs = list[0].timeMs;
  const fileName = sessionFileName(startMs, sport);
  const content = buildGpx(list, { name: sessionTitle(startMs, sport), sport });
  // Si l'écriture échoue, l'erreur remonte avant l'effacement : le journal
  // reste, et la session sera reconstruite au prochain démarrage.
  const { file, location } = await saveRecordedSession(content, sport);
  await recordingJournal.remove();
  return { fileName: file ?? fileName, libraryFile: file, location, content, sport, pointCount: list.length, recovered };
};

const isBusy = (): boolean => state.status !== 'idle';

/** Vrai tant qu'un enregistrement est en cours : la touche retour ne doit pas fermer l'application. */
export const isRecordingActive = (): boolean => isBusy();

/**
 * Termine un enregistrement interrompu par un arrêt brutal : relit le
 * journal, écrit le GPX. À appeler au démarrage de l'application.
 */
export const recoverInterruptedRecording = async (): Promise<void> => {
  if (isBusy()) return;
  const text = await recordingJournal.read();
  if (text === null) return;
  await stopOrphanedDeviceLocation();
  const { header, fixes: list } = parseJournal(text);
  try {
    const saved = await saveSession(header?.sport ?? 'wingfoil', list, true);
    if (saved) setState({ saved, error: null });
  } catch (err) {
    setState({ error: `Session interrompue non récupérée : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

export const startRecording = async (sport: SportType, source: LocationSource): Promise<void> => {
  if (isBusy()) return;
  await recoverInterruptedRecording();

  const profile = getSportProfile(sport);
  fixes = [];
  pendingLines = '';
  lastFlushMs = null;
  setState({ status: 'starting', sport, sourceLabel: source.label, stats: EMPTY_RECORDING_STATS, saved: null, error: null });

  try {
    await recordingJournal.write(journalHeaderLine(sport, Date.now()));
    stopSource = await source.start(
      {
        intervalMs: profile.recording.intervalMs,
        distanceFilterM: profile.recording.distanceFilterM,
        notificationTitle: 'Tracker enregistre',
        notificationText: `Session ${profile.label} en cours`,
      },
      receiveFix(profile.recording.journalFlushS),
      (message) => setState({ error: message })
    );
    setState({ status: 'recording' });
  } catch (err) {
    stopSource = null;
    await recordingJournal.remove();
    setState({ status: 'idle', error: `Démarrage impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

export const stopRecording = async (): Promise<void> => {
  if (state.status !== 'recording' || state.sport === null) return;
  const sport = state.sport;
  setState({ status: 'stopping' });
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée : on termine quand même.
  }
  stopSource = null;
  await flushJournal();

  try {
    const saved = await saveSession(sport, fixes, false);
    setState({
      status: 'idle',
      saved,
      error: saved ? state.error : 'Moins de deux positions reçues : rien à enregistrer.',
    });
  } catch (err) {
    setState({
      status: 'idle',
      error: `Enregistrement du GPX impossible : ${errorMessage(err, 'erreur inconnue')}. Le journal est gardé et sera repris au prochain démarrage.`,
    });
  }
  fixes = [];
};

/** Efface le compte rendu de la dernière session et le dernier message d'erreur. */
export const dismissRecorderResult = (): void => setState({ saved: null, error: null });

/** État de l'enregistreur, relu à chaque changement. */
export const useRecorder = (): RecorderState => useSyncExternalStore(subscribe, () => state);
