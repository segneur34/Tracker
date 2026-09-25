import { useSyncExternalStore } from 'react';
import { getSportProfile, type RecordingProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { effectiveRecordingProfile } from './useSportSettings';
import { recordingJournal } from '../platform/files';
import { stopOrphanedDeviceLocation, type LocationFix, type LocationSource, type LocationWatchOptions, type StopLocation } from '../platform/location';
import { buildGpx } from '../recording/gpxWriter';
import { journalBreakLine, journalFixLine, journalHeaderLine, parseJournal } from '../recording/journal';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  evaluateAutoPause,
  isNewerFix,
  roundFix,
  sessionFileName,
  sessionTitle,
  shouldFlushJournal,
  splitIntoSegments,
  type RecordingStats,
} from '../recording/session';
import { saveRecordedSession } from './useSessionLibrary';

/**
 * Enregistreur de session. Il vit hors des composants, dans ce module : on
 * peut changer de page pendant un enregistrement sans l'interrompre. Les
 * pages le lisent par `useRecorder` et le pilotent par `startRecording`,
 * `stopRecording`, `pauseRecording`/`resumeRecording` (pause manuelle) et
 * `recoverInterruptedRecording`.
 *
 * Chaîne : chaque position reçue est arrondie (`roundFix`), gardée en mémoire
 * et ajoutée au journal, écrit par paquets à l'arrivée des positions
 * (`shouldFlushJournal`). À l'arrêt, le GPX est construit depuis la mémoire,
 * un `<trkseg>` par segment continu (`splitIntoSegments`), et rangé dans la
 * bibliothèque (`saveRecordedSession`) ; après un arrêt brutal, il est
 * reconstruit depuis le journal au démarrage suivant. Le journal n'est
 * effacé qu'une fois le GPX écrit.
 *
 * Deux pauses : manuelle (l'utilisateur coupe la source GPS, batterie
 * économisée, reprise explicite) et automatique (immobilité prolongée,
 * détectée par `evaluateAutoPause` — la source reste active pour détecter la
 * reprise du mouvement). Les deux ouvrent un nouveau segment à la reprise.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

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
  /** Raison de la pause en cours, `null` sinon. */
  pausedReason: 'manual' | 'auto' | null;
  stats: RecordingStats;
  saved: SavedSession | null;
  error: string | null;
}

const INITIAL_STATE: RecorderState = {
  status: 'idle',
  sport: null,
  sourceLabel: null,
  pausedReason: null,
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
/** Indices, dans `fixes`, où reprend un nouveau segment (une pause à chacun). */
let segmentBreaks: number[] = [];
let pendingLines = '';
let lastFlushMs: number | null = null;
let stopSource: StopLocation | null = null;
/** Source active, gardée pour relancer une pause manuelle sans la redemander à la page. */
let currentSource: LocationSource | null = null;
/** Réglage effectif de la session en cours, figé au démarrage. */
let currentProfile: RecordingProfile | null = null;
/**
 * Dernière position reçue, redélivrances comprises : distinct de
 * `stats.lastMs`, qui gèle pendant une pause alors que la source continue
 * d'envoyer des positions (pause automatique).
 */
let lastReceivedMs: number | null = null;
/** Depuis quand la vitesse est sous le seuil d'auto-pause, ou `null`. */
let belowSinceMs: number | null = null;
/** Une pause vient de se terminer : le prochain point gardé ouvre un nouveau segment. */
let pendingBreak = false;
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

const receiveFix = (recording: RecordingProfile) => (received: LocationFix): void => {
  const acceptedStatus =
    state.status === 'starting' || state.status === 'recording' || (state.status === 'paused' && state.pausedReason === 'auto');
  if (!acceptedStatus) return;
  if (!isNewerFix(lastReceivedMs, received)) return;
  const fix = roundFix(received);
  lastReceivedMs = fix.timeMs;

  const auto = evaluateAutoPause(state.status === 'paused', belowSinceMs, fix, {
    speedMs: recording.autoPauseSpeedMs,
    delayS: recording.autoPauseDelayS,
  });
  belowSinceMs = auto.belowSinceMs;
  if (auto.event === 'pause') {
    setState({ status: 'paused', pausedReason: 'auto' });
    void flushJournal();
    return;
  }
  if (auto.event === 'resume') {
    pendingBreak = true;
    setState({ status: 'recording', pausedReason: null });
  }
  if (state.status === 'paused') return;

  if (pendingBreak) {
    segmentBreaks.push(fixes.length);
    pendingLines += journalBreakLine(fix.timeMs);
    pendingBreak = false;
  }
  fixes.push(fix);
  pendingLines += journalFixLine(fix);
  setState({ stats: addFixToStats(state.stats, fix) });
  if (shouldFlushJournal(lastFlushMs, fix.timeMs, recording.journalFlushS)) {
    lastFlushMs = fix.timeMs;
    void flushJournal();
  }
};

/**
 * Range le GPX de segments dans la bibliothèque, puis efface le journal.
 * Rend `null` s'il y a moins de deux positions au total : aucune trace ne
 * s'en tire, il n'y a rien à garder.
 */
const saveSession = async (sport: SportType, segments: LocationFix[][], recovered: boolean): Promise<SavedSession | null> => {
  const pointCount = segments.reduce((n, s) => n + s.length, 0);
  if (pointCount < 2) {
    await recordingJournal.remove();
    return null;
  }
  const startMs = segments.find((s) => s.length > 0)![0].timeMs;
  const fileName = sessionFileName(startMs, sport);
  const content = buildGpx(segments, { name: sessionTitle(startMs, sport), sport });
  // Si l'écriture échoue, l'erreur remonte avant l'effacement : le journal
  // reste, et la session sera reconstruite au prochain démarrage.
  const { file, location } = await saveRecordedSession(content, sport);
  await recordingJournal.remove();
  return { fileName: file ?? fileName, libraryFile: file, location, content, sport, pointCount, recovered };
};

/** Options de démarrage d'une source, communes au premier démarrage et à une reprise manuelle. */
const sourceOptions = (sport: SportType, recording: RecordingProfile): LocationWatchOptions => ({
  intervalMs: recording.intervalMs,
  distanceFilterM: recording.distanceFilterM,
  notificationTitle: 'Tracker enregistre',
  notificationText: `Session ${getSportProfile(sport).label} en cours`,
});

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
  const { header, fixes: list, breaks } = parseJournal(text);
  try {
    const saved = await saveSession(header?.sport ?? 'wingfoil', splitIntoSegments(list, breaks), true);
    if (saved) setState({ saved, error: null });
  } catch (err) {
    setState({ error: `Session interrompue non récupérée : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

export const startRecording = async (sport: SportType, source: LocationSource): Promise<void> => {
  if (isBusy()) return;
  await recoverInterruptedRecording();

  const profile = effectiveRecordingProfile(sport);
  fixes = [];
  segmentBreaks = [];
  pendingLines = '';
  lastFlushMs = null;
  currentSource = source;
  currentProfile = profile;
  lastReceivedMs = null;
  belowSinceMs = null;
  pendingBreak = false;
  setState({ status: 'starting', sport, sourceLabel: source.label, pausedReason: null, stats: EMPTY_RECORDING_STATS, saved: null, error: null });

  try {
    await recordingJournal.write(journalHeaderLine(sport, Date.now()));
    stopSource = await source.start(sourceOptions(sport, profile), receiveFix(profile), (message) => setState({ error: message }));
    setState({ status: 'recording' });
  } catch (err) {
    stopSource = null;
    await recordingJournal.remove();
    setState({ status: 'idle', error: `Démarrage impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Pause manuelle : coupe la source GPS pour économiser la batterie sur un
 * arrêt volontaire. `resumeRecording` la relance.
 */
export const pauseRecording = async (): Promise<void> => {
  if (state.status !== 'recording') return;
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée : on met en pause quand même.
  }
  stopSource = null;
  belowSinceMs = null;
  await flushJournal();
  setState({ status: 'paused', pausedReason: 'manual' });
};

/** Relance la source coupée par `pauseRecording`. Le prochain point gardé ouvre un nouveau segment. */
export const resumeRecording = async (): Promise<void> => {
  if (state.status !== 'paused' || state.pausedReason !== 'manual' || state.sport === null || currentSource === null || currentProfile === null) {
    return;
  }
  const sport = state.sport;
  const source = currentSource;
  const profile = currentProfile;
  try {
    pendingBreak = true;
    stopSource = await source.start(sourceOptions(sport, profile), receiveFix(profile), (message) => setState({ error: message }));
    setState({ status: 'recording', pausedReason: null, error: null });
  } catch (err) {
    pendingBreak = false;
    setState({ error: `Reprise impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

export const stopRecording = async (): Promise<void> => {
  if ((state.status !== 'recording' && state.status !== 'paused') || state.sport === null) return;
  const sport = state.sport;
  setState({ status: 'stopping' });
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée (arrêt normal, ou pause manuelle) : on termine quand même.
  }
  stopSource = null;
  currentSource = null;
  currentProfile = null;
  await flushJournal();

  try {
    const saved = await saveSession(sport, splitIntoSegments(fixes, segmentBreaks), false);
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
  segmentBreaks = [];
};

/** Trace de l'enregistrement en cours, un tableau par segment continu : la carte et les statistiques en direct. */
export const getLiveSegments = (): LocationFix[][] => (isBusy() ? splitIntoSegments(fixes, segmentBreaks) : []);

/** Dernière position gardée de l'enregistrement en cours. */
export const getLastFix = (): LocationFix | null => (isBusy() && fixes.length > 0 ? fixes[fixes.length - 1] : null);

/** Efface le compte rendu de la dernière session et le dernier message d'erreur. */
export const dismissRecorderResult = (): void => setState({ saved: null, error: null });

/** État de l'enregistreur, relu à chaque changement. */
export const useRecorder = (): RecorderState => useSyncExternalStore(subscribe, () => state);
