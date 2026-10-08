import { useSyncExternalStore } from 'react';
import { BASE_COLOR, baseActivity, findActivity, type Activity } from '../core/activities';
import type { RecordingProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { effectiveRecordingProfile, readStoredActivities, rememberRecordActivity } from './useSportSettings';
import { recordingJournal } from '../platform/files';
import {
  findMotionCapture, pauseMotionCapture, readMotionCapture, removeMotionCapture, resumeMotionCapture, startMotionCapture,
  stopMotionCapture, type MotionCapture, type MotionSetup,
} from '../platform/motion';
import { stopOrphanedDeviceLocation, type LocationFix, type LocationSource, type LocationWatchOptions, type StopLocation } from '../platform/location';
import { buildGpx } from '../recording/gpxWriter';
import { seriesWithin, type IntervalRun, type IntervalSeries } from '../recording/intervalTimer';
import {
  journalActivityLine, journalBreakLine, journalFixLine, journalHeaderLine, journalIntervalsLine, parseJournal,
} from '../recording/journal';
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
 * `stopRecording`, `pauseRecording`/`resumeRecording` (pause manuelle),
 * `changeRecordingActivity`, `analyzePendingSession`/`discardPendingSession`
 * et `recoverInterruptedRecording`. Le guidage vers les balises
 * (`useMarkGuide`), hors React lui aussi, s'abonne aux positions reçues
 * (`subscribeToFixes`) et à l'état (`subscribeToRecorder`). Le compteur du
 * fractionné (`useIntervalTimer`) lui confie ses séances (`noteIntervalRun`),
 * écrites dans le journal et rangées avec la session. La mesure des sauts,
 * demandée au départ, fait capter accéléromètre et gyroscope par le
 * téléphone (`platform/motion.ts`) ; la capture suit la pause manuelle et se
 * range à côté du GPX (`.imu`).
 *
 * Chaîne : chaque position reçue est arrondie (`roundFix`), gardée en mémoire
 * et ajoutée au journal, écrit par paquets à l'arrivée des positions
 * (`shouldFlushJournal`). À l'arrêt, le GPX est construit depuis la mémoire,
 * un `<trkseg>` par segment continu (`splitIntoSegments`), et la session
 * attend une décision (`pending`) : « Analyser » la range dans la
 * bibliothèque (`saveRecordedSession`), « Jeter » l'abandonne. Rien n'entre
 * dans la mémoire sans cette décision, pour ne pas l'encombrer d'essais.
 * Tant qu'elle attend, le journal est gardé : après un arrêt brutal ou une
 * fermeture, la session est reconstruite depuis lui au démarrage suivant, et
 * attend de nouveau. Le journal n'est effacé qu'une fois le GPX écrit, ou la
 * session jetée.
 *
 * Deux pauses : manuelle (l'utilisateur coupe la source GPS, batterie
 * économisée, reprise explicite) et automatique (immobilité prolongée,
 * détectée par `evaluateAutoPause` — la source reste active pour détecter la
 * reprise du mouvement). Les deux ouvrent un nouveau segment à la reprise.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/** Session terminée, pas encore rangée : l'utilisateur doit l'analyser ou la jeter. */
export interface PendingSession {
  fileName: string;
  /** Le GPX lui-même, pour le ranger ou le télécharger sans le reconstruire. */
  content: string;
  sport: SportType;
  activity: Activity;
  pointCount: number;
  /** Vrai si elle a été reconstruite depuis le journal d'un enregistrement interrompu. */
  recovered: boolean;
  /** Séances du compteur faites pendant l'enregistrement, bornées à lui. */
  intervals: IntervalSeries[];
  /** Capture des capteurs (sauts), dans le dossier privé, rangée avec la session ; `null` sans mesure. */
  motion: MotionCapture | null;
}

/** Session rangée par « Analyser ». */
export interface SavedSession {
  fileName: string;
  /** Nom dans la mémoire, `null` si la session n'a pas pu y entrer (en attente, ou aucune mémoire). */
  libraryFile: string | null;
  /** Où la trouver, en clair. */
  location: string;
  /** Le GPX lui-même, pour l'analyser ou le télécharger sans le relire. */
  content: string;
  sport: SportType;
  activity: Activity;
  pointCount: number;
  /** Vrai si elle a été reconstruite depuis le journal d'un enregistrement interrompu. */
  recovered: boolean;
}

export interface RecorderState {
  status: RecorderStatus;
  /** Calcul de l'activité en cours, `null` au repos. */
  sport: SportType | null;
  activity: Activity | null;
  sourceLabel: string | null;
  /** Raison de la pause en cours, `null` sinon. */
  pausedReason: 'manual' | 'auto' | null;
  /** Vrai tant que les capteurs mesurent les sauts. */
  measuringJumps: boolean;
  stats: RecordingStats;
  /** Session arrêtée qui attend « Analyser » ou « Jeter » ; aucun nouvel enregistrement d'ici là. */
  pending: PendingSession | null;
  saved: SavedSession | null;
  error: string | null;
}

const INITIAL_STATE: RecorderState = {
  status: 'idle',
  sport: null,
  activity: null,
  sourceLabel: null,
  pausedReason: null,
  measuringJumps: false,
  stats: EMPTY_RECORDING_STATS,
  pending: null,
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

/** État de l'enregistreur, hors React. */
export const getRecorderState = (): RecorderState => state;

/** Changements d'état de l'enregistreur, hors React ; rend le désabonnement. */
export const subscribeToRecorder = (listener: () => void): (() => void) => subscribe(listener);

/** Abonnés aux positions reçues. */
const fixListeners = new Set<(fix: LocationFix) => void>();

/**
 * Chaque position nouvelle reçue pendant l'enregistrement, pause
 * automatique comprise (la source tourne encore) : la seule boucle sûre
 * écran éteint. Rend le désabonnement.
 */
export const subscribeToFixes = (listener: (fix: LocationFix) => void): (() => void) => {
  fixListeners.add(listener);
  return () => {
    fixListeners.delete(listener);
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
/** Réglage effectif de la session en cours : celui de son activité, relu quand elle change. */
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
/** Instant du démarrage, à l'horloge : le début de la fenêtre des séances du compteur. */
let startedAtMs = 0;
/** Séances du compteur confiées pendant l'enregistrement, chacune dans son dernier état. */
let intervalRuns = new Map<number, IntervalRun>();

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

/** Reçoit une position de la source. Le réglage est relu à chaque fois : l'activité peut changer en route. */
const receiveFix = (received: LocationFix): void => {
  const acceptedStatus =
    state.status === 'starting' || state.status === 'recording' || (state.status === 'paused' && state.pausedReason === 'auto');
  const recording = currentProfile;
  if (!acceptedStatus || recording === null) return;
  if (!isNewerFix(lastReceivedMs, received)) return;
  const fix = roundFix(received);
  lastReceivedMs = fix.timeMs;
  for (const listener of fixListeners) {
    try {
      listener(fix);
    } catch {
      // Un abonné en échec n'arrête pas l'enregistrement.
    }
  }

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
 * Construit le GPX de segments, sans le ranger : le journal reste jusqu'à la
 * décision de l'utilisateur. Rend `null`, journal effacé, s'il y a moins de
 * deux positions au total : aucune trace ne s'en tire, il n'y a rien à garder.
 */
const buildPendingSession = async (
  activity: Activity,
  segments: LocationFix[][],
  recovered: boolean,
  intervals: IntervalSeries[],
  motion: MotionCapture | null
): Promise<PendingSession | null> => {
  const sport = activity.base;
  const pointCount = segments.reduce((n, s) => n + s.length, 0);
  if (pointCount < 2) {
    await recordingJournal.remove();
    if (motion) await removeMotionCapture(motion.path);
    return null;
  }
  const startMs = segments.find((s) => s.length > 0)![0].timeMs;
  const fileName = sessionFileName(startMs, sport);
  const content = buildGpx(segments, { name: sessionTitle(startMs, activity.name), sport });
  return { fileName, content, sport, activity, pointCount, recovered, intervals, motion };
};

/**
 * « Analyser » : range la session en attente dans la bibliothèque, puis
 * efface le journal. Rend la session rangée, ou `null` si l'écriture échoue :
 * la session reste alors en attente, journal compris.
 */
export const analyzePendingSession = async (): Promise<SavedSession | null> => {
  const pending = state.pending;
  if (!pending) return null;
  try {
    // Capteurs illisibles ou absents : la session est rangée sans eux.
    const motion = pending.motion ? await readMotionCapture(pending.motion.path).catch(() => null) : null;
    const { file, location } = await saveRecordedSession(pending.content, pending.sport, pending.activity.id, pending.intervals, motion);
    await recordingJournal.remove();
    if (pending.motion) await removeMotionCapture(pending.motion.path);
    const saved: SavedSession = { ...pending, fileName: file ?? pending.fileName, libraryFile: file, location };
    setState({ pending: null, saved, error: null });
    return saved;
  } catch (err) {
    setState({ error: `Enregistrement du GPX impossible : ${errorMessage(err, 'erreur inconnue')}. La session reste en attente.` });
    return null;
  }
};

/** « Jeter » : abandonne la session en attente et efface son journal. */
export const discardPendingSession = async (): Promise<void> => {
  if (!state.pending) return;
  await recordingJournal.remove();
  if (state.pending.motion) await removeMotionCapture(state.pending.motion.path);
  setState({ pending: null, error: null });
};

/** Options de démarrage d'une source, communes au premier démarrage et à une reprise manuelle. */
const sourceOptions = (activity: Activity, recording: RecordingProfile): LocationWatchOptions => ({
  intervalMs: recording.intervalMs,
  distanceFilterM: recording.distanceFilterM,
  notificationTitle: 'Tracker enregistre',
  notificationText: `Session ${activity.name} en cours`,
});

/**
 * Activité d'un journal relu : celle de la liste si elle existe encore, sinon
 * reconstruite sous le nom gardé dans l'en-tête (la fiche la rangera sous son
 * calcul), sinon l'activité de base du calcul.
 */
const journalActivity = (sport: SportType, saved: { id: string; name: string } | undefined): Activity => {
  if (!saved) return baseActivity(sport);
  const found = findActivity(readStoredActivities(), saved.id);
  return found && found.base === sport ? found : { id: saved.id, name: saved.name, base: sport, color: BASE_COLOR[sport] };
};

const isBusy = (): boolean => state.status !== 'idle';

/** Vrai tant qu'un enregistrement est en cours : la touche retour ne doit pas fermer l'application. */
export const isRecordingActive = (): boolean => isBusy();

/**
 * Reprend un enregistrement que l'application n'a pas vu se conclure (arrêt
 * brutal, ou session arrêtée puis application fermée sans décision) : relit
 * le journal et remet la session en attente. À appeler au démarrage de
 * l'application.
 */
export const recoverInterruptedRecording = async (): Promise<void> => {
  if (isBusy() || state.pending) return;
  const text = await recordingJournal.read();
  if (text === null) return;
  await stopOrphanedDeviceLocation();
  // Capture restée ouverte après un rechargement de la page : fermée, elle attend avec la session.
  const orphan = await stopMotionCapture().catch(() => null);
  const parsed = parseJournal(text);
  const { header, fixes: list, breaks } = parsed;
  try {
    // Une activité choisie en cours de route prime sur celle du départ.
    const { activityChange } = parsed;
    const sport = activityChange?.sport ?? header?.sport ?? 'wingfoil';
    const saved = activityChange?.activity ?? header?.activity;
    // Séances du compteur : du démarrage à la dernière position gardée.
    const fromMs = header?.startedAtMs ?? list[0]?.timeMs ?? 0;
    const toMs = list[list.length - 1]?.timeMs ?? fromMs;
    const intervals = seriesWithin(parsed.intervalRuns, fromMs, toMs);
    const motion = header ? (orphan?.path.endsWith(`/${header.startedAtMs}.imu`) ? orphan : await findMotionCapture(header.startedAtMs)) : null;
    const pending = await buildPendingSession(journalActivity(sport, saved), splitIntoSegments(list, breaks), true, intervals, motion);
    if (pending) setState({ pending, saved: null, error: null });
  } catch (err) {
    setState({ error: `Session interrompue non récupérée : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Démarre un enregistrement. `jumps` : mesurer les sauts, avec l'emplacement
 * du téléphone et le foil ; si les capteurs ne démarrent pas, l'enregistrement
 * continue sans eux, et le dit.
 */
export const startRecording = async (
  activity: Activity,
  source: LocationSource,
  options: { jumps?: MotionSetup | null } = {}
): Promise<void> => {
  if (isBusy()) return;
  await recoverInterruptedRecording();
  // Le journal d'une session en attente serait écrasé : elle doit être analysée ou jetée d'abord.
  if (state.pending) return;

  const sport = activity.base;
  const profile = effectiveRecordingProfile(activity);
  fixes = [];
  segmentBreaks = [];
  pendingLines = '';
  lastFlushMs = null;
  currentSource = source;
  currentProfile = profile;
  lastReceivedMs = null;
  belowSinceMs = null;
  pendingBreak = false;
  startedAtMs = Date.now();
  intervalRuns = new Map();
  setState({
    status: 'starting', sport, activity, sourceLabel: source.label, pausedReason: null, measuringJumps: false, stats: EMPTY_RECORDING_STATS,
    saved: null, error: null,
  });

  try {
    await recordingJournal.write(journalHeaderLine(sport, startedAtMs, activity));
    stopSource = await source.start(sourceOptions(activity, profile), receiveFix, (message) => setState({ error: message }));
    setState({ status: 'recording' });
  } catch (err) {
    stopSource = null;
    await recordingJournal.remove();
    setState({ status: 'idle', error: `Démarrage impossible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (options.jumps) {
    try {
      await startMotionCapture(startedAtMs, options.jumps);
      setState({ measuringJumps: true });
    } catch (err) {
      setState({ error: `Mesure des sauts impossible : ${errorMessage(err, 'erreur inconnue')}. L'enregistrement continue sans elle.` });
    }
  }
};

/**
 * Pause manuelle : coupe la source GPS pour économiser la batterie sur un
 * arrêt volontaire. `resumeRecording` la relance. Depuis une pause
 * automatique, elle coupe aussi la source : la reprise devient manuelle.
 */
export const pauseRecording = async (): Promise<void> => {
  const autoPaused = state.status === 'paused' && state.pausedReason === 'auto';
  if (state.status !== 'recording' && !autoPaused) return;
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée : on met en pause quand même.
  }
  stopSource = null;
  belowSinceMs = null;
  await flushJournal();
  if (state.measuringJumps) await pauseMotionCapture().catch(() => undefined);
  setState({ status: 'paused', pausedReason: 'manual' });
};

/** Relance la source coupée par `pauseRecording`. Le prochain point gardé ouvre un nouveau segment. */
export const resumeRecording = async (): Promise<void> => {
  if (state.status !== 'paused' || state.pausedReason !== 'manual' || state.activity === null || currentSource === null || currentProfile === null) {
    return;
  }
  const activity = state.activity;
  const source = currentSource;
  const profile = currentProfile;
  try {
    pendingBreak = true;
    stopSource = await source.start(sourceOptions(activity, profile), receiveFix, (message) => setState({ error: message }));
    if (state.measuringJumps) await resumeMotionCapture().catch(() => undefined);
    setState({ status: 'recording', pausedReason: null, error: null });
  } catch (err) {
    pendingBreak = false;
    setState({ error: `Reprise impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/**
 * Change l'activité de l'enregistrement en cours, d'une famille à l'autre
 * comprise : la session sera rangée sous elle et sous son calcul (nom du
 * fichier, `<type>` du GPX, module qui l'analyse), et la pause automatique
 * suit ses réglages dès la position suivante. Le changement est écrit dans le
 * journal : une session récupérée après un plantage garde l'activité choisie.
 * La notification Android garde le nom du départ jusqu'à une reprise après
 * pause manuelle : la changer tout de suite demanderait de relancer la source
 * GPS, au risque d'un trou dans la trace.
 */
export const changeRecordingActivity = (activity: Activity): void => {
  // Pas pendant le démarrage : l'en-tête du journal n'est peut-être pas encore écrit.
  if ((state.status !== 'recording' && state.status !== 'paused') || state.activity?.id === activity.id) return;
  const profile = effectiveRecordingProfile(activity);
  currentProfile = profile;
  belowSinceMs = null;
  pendingLines += journalActivityLine(activity.base, activity);
  const patch: Partial<RecorderState> = { sport: activity.base, activity };
  // En pause automatique, une activité qui n'en a pas ne la lèverait jamais : l'enregistrement reprend.
  if (state.status === 'paused' && state.pausedReason === 'auto' && profile.autoPauseSpeedMs <= 0) {
    pendingBreak = true;
    patch.status = 'recording';
    patch.pausedReason = null;
  }
  setState(patch);
  rememberRecordActivity(activity.id);
  void flushJournal();
};

/**
 * Séance du compteur du fractionné, dans son état du moment : gardée pour la
 * session et écrite dans le journal, pour survivre à un plantage. Sans effet
 * hors d'un enregistrement. Pendant le démarrage, la ligne attend le premier
 * paquet du journal, écrit après son en-tête.
 */
export const noteIntervalRun = (run: IntervalRun): void => {
  if (state.status === 'idle') return;
  intervalRuns.set(run.startedAtMs, run);
  pendingLines += journalIntervalsLine(run);
  if (state.status === 'recording' || state.status === 'paused') void flushJournal();
};

/** Appui long sur le bouton rond : pause manuelle, ou reprise si elle l'est déjà. */
export const togglePauseRecording = (): Promise<void> =>
  state.status === 'paused' && state.pausedReason === 'manual' ? resumeRecording() : pauseRecording();

export const stopRecording = async (): Promise<void> => {
  if ((state.status !== 'recording' && state.status !== 'paused') || state.activity === null) return;
  const activity = state.activity;
  const stoppedAtMs = Date.now();
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
  const motion = state.measuringJumps ? await stopMotionCapture().catch(() => null) : null;

  try {
    const intervals = seriesWithin([...intervalRuns.values()], startedAtMs, stoppedAtMs);
    const pending = await buildPendingSession(activity, splitIntoSegments(fixes, segmentBreaks), false, intervals, motion);
    setState({
      status: 'idle',
      measuringJumps: false,
      pending,
      error: pending ? state.error : 'Moins de deux positions reçues : rien à enregistrer.',
    });
  } catch (err) {
    setState({
      status: 'idle',
      measuringJumps: false,
      error: `Construction du GPX impossible : ${errorMessage(err, 'erreur inconnue')}. Le journal est gardé et sera repris au prochain démarrage.`,
    });
  }
  fixes = [];
  segmentBreaks = [];
  intervalRuns = new Map();
};

/** Trace de l'enregistrement en cours, un tableau par segment continu : la carte et les statistiques en direct. */
export const getLiveSegments = (): LocationFix[][] => (isBusy() ? splitIntoSegments(fixes, segmentBreaks) : []);

/** Positions de l'enregistrement en cours, toutes pauses confondues, sans recopie : à ne pas modifier. */
export const getLiveFixes = (): ReadonlyArray<LocationFix> => (isBusy() ? fixes : []);

/** Dernière position gardée de l'enregistrement en cours. */
export const getLastFix = (): LocationFix | null => (isBusy() && fixes.length > 0 ? fixes[fixes.length - 1] : null);

/** Efface le compte rendu de la dernière session et le dernier message d'erreur. */
export const dismissRecorderResult = (): void => setState({ saved: null, error: null });

/** État de l'enregistreur, relu à chaque changement. */
export const useRecorder = (): RecorderState => useSyncExternalStore(subscribe, () => state);
