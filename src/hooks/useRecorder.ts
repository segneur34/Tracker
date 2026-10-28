import { useEffect, useState, useSyncExternalStore } from 'react';
import { BASE_COLOR, baseActivity, findActivity, type Activity } from '../core/activities';
import { marksWithin, type SessionMark } from '../core/sessionMarks';
import { decodeImu } from '../core/imuFile';
import { getSportProfile, hasPositions, type RecordingProfile } from '../core/sportProfiles';
import { cadenceSeries, joinCadence } from '../running/cadence';
import type { SportType } from '../core/types';
import { effectiveFoil, effectiveRecordingProfile, readStoredActivities, rememberRecordActivity } from './useSportSettings';
import { recordingJournal } from '../platform/files';
import {
  findMotionCapture, pauseMotionCapture, readMotionCapture, removeMotionCapture, resumeMotionCapture, startMotionCapture,
  stopMotionCapture, type MotionCapture, type MotionSetup,
} from '../platform/motion';
import {
  RECORDING_BELT_HOLDER, beltState, holdBelt, keepBeltAlive, latestHeartRate, releaseOrphanedBelt, stopBeltKeepAlive, subscribeBeltState, subscribeHeartRate,
  type BeltState, type HeartRateBelt, type HeartRateSample,
} from '../platform/heartRate';
import { stopOrphanedDeviceLocation, type LocationFix, type LocationSource, type LocationWatchOptions, type StopLocation } from '../platform/location';
import { buildGpx, buildHeartRateGpx } from '../recording/gpxWriter';
import { closeSessionTest, type SessionTest } from '../recording/fitnessTest';
import { heartRateAt } from '../recording/heartRate';
import { seriesWithin, type IntervalRun, type IntervalSeries } from '../recording/intervalTimer';
import {
  journalActivityLine, journalBreakLine, journalFixLine, journalHeaderLine, journalHeartRateLine, journalIntervalsLine, journalNoteLine, journalTestLine,
  parseJournal,
} from '../recording/journal';
import {
  EMPTY_RECORDING_STATS,
  addFixToStats,
  displayedDurationMs,
  evaluateAutoPause,
  isNewerFix,
  keepHeartRateSample,
  roundFix,
  sessionFileName,
  sessionTitle,
  shouldFlushJournal,
  splitIntoSegments,
  withStopPoint,
  type HeartRateFix,
  type PauseClock,
  type RecordingStats,
} from '../recording/session';
import { saveRecordedSession } from './useSessionLibrary';
import { createListeners } from './createStore';

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
 * écrites dans le journal et rangées avec la session ; de même les repères
 * du bouton « Note » (`addRecordingMark`) et le test guidé (`useFitnessTest`,
 * `noteFitnessTest`). La mesure des sauts,
 * demandée au départ, fait capter accéléromètre et gyroscope par le
 * téléphone (`platform/motion.ts`) ; la capture suit la pause manuelle et se
 * range à côté du GPX (`.imu`). La ceinture cardio, demandée au départ, est
 * tenue jusqu'à l'arrêt (`platform/heartRate.ts`) : sa dernière mesure est
 * jointe à chaque position reçue, donc au journal et au GPX (`gpxtpx:hr`).
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
 *
 * Session sans position (muscu, lot I du 25/10, `hasPositions`) : aucune
 * source GPS ; la ceinture est obligatoire et chaque mesure (une par seconde
 * au plus, `keepHeartRateSample`) est gardée à part des positions
 * (`heartFixes`), au journal (`journalHeartRateLine`) et dans un GPX sans
 * position (`buildHeartRateGpx`). Un service au premier plan tient
 * l'application écran éteint (`keepBeltAlive`). La pause manuelle garde la
 * ceinture et ignore ses mesures ; pas de pause automatique. À l'arrêt, un
 * dernier point sans FC fait aller la durée jusqu'à lui (`withStopPoint`).
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping';

/** Session terminée, pas encore rangée : l'utilisateur doit l'analyser ou la jeter. */
export interface PendingSession {
  fileName: string;
  /** Le GPX lui-même, pour le ranger ou le télécharger sans le reconstruire. */
  content: string;
  sport: SportType;
  activity: Activity;
  /** Positions gardées ; sans position (muscu), mesures de la ceinture. */
  pointCount: number;
  /** Vrai si elle a été reconstruite depuis le journal d'un enregistrement interrompu. */
  recovered: boolean;
  /** Séances du compteur faites pendant l'enregistrement, bornées à lui. */
  intervals: IntervalSeries[];
  /** Repères du bouton « Note », dans l'ordre du temps. */
  marks: SessionMark[];
  /** Capture des capteurs (sauts), dans le dossier privé, rangée avec la session ; `null` sans mesure. */
  motion: MotionCapture | null;
  /** Octets de la capture déjà lus à l'arrêt (cadence), pour ne pas les relire à « Analyser » ; `null` sinon. */
  motionBytes: Uint8Array | null;
  /** Test guidé fait pendant l'enregistrement ; `null` sans test. */
  test: SessionTest | null;
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
  /** Horloge de la pause en cours, pour la durée affichée (`displayedDurationMs`) ; `null` hors pause. */
  pauseClock: PauseClock | null;
  /** Vrai tant que les capteurs du téléphone mesurent (sauts, pumping, cadence). */
  measuringMotion: boolean;
  /** Ce que la capture en cours mesure, `null` sans capture. */
  motionSetup: MotionSetup | null;
  /** Ceinture cardio de l'enregistrement : état de la connexion et dernière fréquence ; `null` sans ceinture. */
  heartRate: { state: BeltState; bpm: number | null } | null;
  /** Repères du bouton « Note » de l'enregistrement en cours, pour la carte du direct ; vide au repos. */
  marks: SessionMark[];
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
  pauseClock: null,
  measuringMotion: false,
  motionSetup: null,
  heartRate: null,
  marks: [],
  stats: EMPTY_RECORDING_STATS,
  pending: null,
  saved: null,
  error: null,
};

let state = INITIAL_STATE;
const listeners = createListeners();

const setState = (patch: Partial<RecorderState>): void => {
  state = { ...state, ...patch };
  listeners.notify();
};

const subscribe = listeners.subscribe;

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
/** Session sans position (muscu) : mesures de la ceinture gardées, à la place des positions. */
let heartFixes: HeartRateFix[] = [];
/** Indices, dans `heartFixes`, où reprend un nouveau segment. */
let heartBreaks: number[] = [];
/** Vrai pendant l'enregistrement d'une session sans position : ses points sont les mesures de la ceinture. */
let heartOnly = false;
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
/** Position de `lastReceivedMs` : celle d'un repère posé en pause automatique, où rien n'est gardé dans `fixes`. */
let lastReceivedFix: LocationFix | null = null;
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
/** Repères posés pendant l'enregistrement, dans l'ordre. */
let marks: SessionMark[] = [];
/** Test guidé de l'enregistrement, dans son dernier état ; `null` sans test. */
let currentTest: SessionTest | null = null;
/** Écart toléré entre une mesure de la ceinture et une position, en secondes ; `null` sans ceinture. */
let heartRateMaxAgeS: number | null = null;
/** Rend la ceinture et se désabonne de ses mesures ; `null` sans ceinture. */
let dropBelt: (() => void) | null = null;
/** Dernière erreur signalée par la source (localisation coupée…), effacée de l'état à la position suivante. */
let sourceError: string | null = null;

const onSourceError = (message: string): void => {
  sourceError = message;
  setState({ error: message });
};

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
  // La source envoie de nouveau : son erreur, encore affichée, n'a plus lieu d'être.
  if (sourceError !== null) {
    if (state.error === sourceError) setState({ error: null });
    sourceError = null;
  }
  // Comparée à l'heure de réception, pas à celle de la position : la même horloge que la ceinture, et un rejeu marche aussi.
  const heartRateBpm = heartRateMaxAgeS === null ? undefined : heartRateAt(latestHeartRate(), Date.now(), heartRateMaxAgeS);
  const fix = roundFix(heartRateBpm === undefined ? received : { ...received, heartRateBpm });
  lastReceivedMs = fix.timeMs;
  lastReceivedFix = fix;
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
    setState({ status: 'paused', pausedReason: 'auto', pauseClock: { sinceMs: Date.now(), frozenAtMs: null } });
    void flushJournal();
    return;
  }
  if (auto.event === 'resume') {
    pendingBreak = true;
    setState({ status: 'recording', pausedReason: null, pauseClock: null });
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
 * Reçoit une mesure de la ceinture d'une session sans position (muscu) : une
 * par seconde au plus, gardée comme une position l'est. Ignorée en pause.
 */
const receiveHeartSample = (sample: HeartRateSample): void => {
  const recording = currentProfile;
  if (!heartOnly || recording === null || (state.status !== 'starting' && state.status !== 'recording')) return;
  const fix = keepHeartRateSample(lastReceivedMs, sample, recording.intervalMs);
  if (fix === null) return;
  lastReceivedMs = fix.timeMs;
  if (pendingBreak) {
    heartBreaks.push(heartFixes.length);
    pendingLines += journalBreakLine(fix.timeMs);
    pendingBreak = false;
  }
  heartFixes.push(fix);
  pendingLines += journalHeartRateLine(fix);
  setState({ stats: addFixToStats(state.stats, fix) });
  if (shouldFlushJournal(lastFlushMs, fix.timeMs, recording.journalFlushS)) {
    lastFlushMs = fix.timeMs;
    void flushJournal();
  }
};

/**
 * Cadence à pied mesurée sur la capture, si elle la mesurait, jointe à chaque
 * position (`gpxtpx:cad` du GPX). Sans elle, ou si le calcul échoue, les
 * positions telles quelles : la session n'est jamais bloquée par la cadence.
 * Seul l'accéléromètre est décodé ; les octets lus sont rendus aussi, gardés
 * pour « Analyser ».
 */
const withMeasuredCadence = async (
  segments: LocationFix[][], sport: SportType, motion: MotionCapture | null
): Promise<{ segments: LocationFix[][]; bytes: Uint8Array | null }> => {
  const params = getSportProfile(sport).cadence;
  if (!params || !motion) return { segments, bytes: null };
  let bytes: Uint8Array | null = null;
  try {
    bytes = await readMotionCapture(motion.path);
    const recording = bytes ? await decodeImu(bytes, { streams: ['accel'] }) : null;
    if (!recording || !recording.header.setup.cadence) return { segments, bytes };
    const series = cadenceSeries(recording, params);
    return { segments: series ? segments.map((segment) => joinCadence(segment, series)) : segments, bytes };
  } catch {
    return { segments, bytes };
  }
};

/** Ce qu'un enregistrement a gardé : ses positions, ou, sans position (muscu), les mesures de la ceinture. */
interface RecordedTrack {
  segments: LocationFix[][];
  heart: HeartRateFix[][];
}

/**
 * Construit le GPX de segments, sans le ranger : le journal reste jusqu'à la
 * décision de l'utilisateur. Rend `null`, journal effacé, s'il y a moins de
 * deux positions au total (sans position : deux mesures de la ceinture) :
 * aucune trace ne s'en tire, il n'y a rien à garder.
 */
const buildPendingSession = async (
  activity: Activity,
  recorded: RecordedTrack,
  recovered: boolean,
  intervals: IntervalSeries[],
  marks: SessionMark[],
  motion: MotionCapture | null,
  test: SessionTest | null
): Promise<PendingSession | null> => {
  const sport = activity.base;
  if (!hasPositions(sport)) {
    // Mesures de la ceinture : le point de l'arrêt, sans FC, n'en est pas une.
    const measures = recorded.heart.reduce((n, s) => n + s.filter((f) => f.heartRateBpm !== undefined).length, 0);
    if (measures < 2) {
      await recordingJournal.remove();
      return null;
    }
    const firstMs = recorded.heart.find((s) => s.length > 0)![0].timeMs;
    const gpx = buildHeartRateGpx(recorded.heart, { name: sessionTitle(firstMs, activity.name), sport });
    return {
      fileName: sessionFileName(firstMs, sport), content: gpx, sport, activity, pointCount: measures, recovered, intervals, marks,
      motion: null, motionBytes: null, test,
    };
  }
  const { segments } = recorded;
  const pointCount = segments.reduce((n, s) => n + s.length, 0);
  if (pointCount < 2) {
    await recordingJournal.remove();
    if (motion) await removeMotionCapture(motion.path);
    return null;
  }
  const startMs = segments.find((s) => s.length > 0)![0].timeMs;
  const fileName = sessionFileName(startMs, sport);
  const measured = await withMeasuredCadence(segments, sport, motion);
  const content = buildGpx(measured.segments, { name: sessionTitle(startMs, activity.name), sport });
  return { fileName, content, sport, activity, pointCount, recovered, intervals, marks, motion, motionBytes: measured.bytes, test };
};

/** Message d'un arrêt sans rien à garder. */
const nothingToKeep = (sport: SportType): string =>
  hasPositions(sport) ? 'Moins de deux positions reçues : rien à enregistrer.' : 'Moins de deux mesures de la ceinture : rien à enregistrer.';

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
    const motion = pending.motion ? pending.motionBytes ?? await readMotionCapture(pending.motion.path).catch(() => null) : null;
    // Le foil de l'activité au moment de l'enregistrement : le matériel du jour, pas une supposition.
    const foil = effectiveFoil(pending.activity);
    const { file, location } = await saveRecordedSession(
      pending.content, pending.sport, pending.activity.id, pending.intervals, motion, pending.marks, foil, pending.test
    );
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

/** Démarrage, pause ou reprise en cours : un second appel pendant qu'elle se fait (double appui) est ignoré. */
let commandBusy = false;

/** La commande, réservée de son premier appel jusqu'à sa fin ; un appel pendant ce temps ne fait rien. */
const exclusive = <A extends unknown[]>(command: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  if (commandBusy) return;
  commandBusy = true;
  try {
    await command(...args);
  } finally {
    commandBusy = false;
  }
};

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
  await releaseOrphanedBelt();
  await stopBeltKeepAlive();
  // Capture restée ouverte après un rechargement de la page : fermée, elle attend avec la session.
  const orphan = await stopMotionCapture().catch(() => null);
  const parsed = parseJournal(text);
  const { header, fixes: list, breaks } = parsed;
  try {
    // Une activité choisie en cours de route prime sur celle du départ.
    const { activityChange } = parsed;
    const sport = activityChange?.sport ?? header?.sport ?? 'wingfoil';
    const saved = activityChange?.activity ?? header?.activity;
    // Sans position (muscu), les mesures de la ceinture tiennent lieu de positions.
    const points: ReadonlyArray<{ timeMs: number }> = hasPositions(sport) ? list : parsed.heartFixes;
    // Séances du compteur : du démarrage à la dernière position gardée.
    const fromMs = header?.startedAtMs ?? points[0]?.timeMs ?? 0;
    const toMs = points[points.length - 1]?.timeMs ?? fromMs;
    const intervals = seriesWithin(parsed.intervalRuns, fromMs, toMs);
    // Une note posée en pause manuelle, après la dernière position, est gardée.
    const recoveredMarks = marksWithin(parsed.marks, fromMs, Infinity);
    const motion = header ? (orphan?.path.endsWith(`/${header.startedAtMs}.imu`) ? orphan : await findMotionCapture(header.startedAtMs)) : null;
    // Test coupé par l'arrêt : une rampe en cours finit à la dernière position.
    const test = parsed.test ? closeSessionTest(parsed.test, toMs) : null;
    const pending = await buildPendingSession(
      journalActivity(sport, saved),
      { segments: splitIntoSegments(list, breaks), heart: splitIntoSegments(parsed.heartFixes, parsed.heartBreaks) },
      true, intervals, recoveredMarks, motion, test
    );
    if (pending) setState({ pending, saved: null, error: null });
  } catch (err) {
    setState({ error: `Session interrompue non récupérée : ${errorMessage(err, 'erreur inconnue')}` });
  }
};

/** Prend la ceinture pour l'enregistrement et suit ses mesures dans l'état. */
const takeBelt = async (belt: HeartRateBelt, maxAgeS: number): Promise<void> => {
  const release = await holdBelt(RECORDING_BELT_HOLDER, belt);
  heartRateMaxAgeS = maxAgeS;
  setState({ heartRate: { state: beltState(), bpm: null } });
  const offSample = subscribeHeartRate((sample) => {
    receiveHeartSample(sample);
    const bpm = sample.contact === false || !(sample.bpm > 0) ? null : sample.bpm;
    if (state.heartRate && (state.heartRate.bpm !== bpm || state.heartRate.state !== beltState())) {
      setState({ heartRate: { state: beltState(), bpm } });
    }
  });
  const offState = subscribeBeltState((beltNow) => {
    if (state.heartRate) setState({ heartRate: { state: beltNow, bpm: beltNow === 'connected' ? state.heartRate.bpm : null } });
  });
  dropBelt = () => {
    offSample();
    offState();
    release();
  };
};

/** Rend la ceinture, s'il y en a une. */
const releaseRecordingBelt = (): void => {
  dropBelt?.();
  dropBelt = null;
  heartRateMaxAgeS = null;
};

/**
 * Suite du départ d'une session sans position (muscu) : journal, ceinture,
 * puis service au premier plan qui tient l'application écran éteint. Sans
 * ceinture qui réponde, pas de session : le départ est annulé.
 */
const startHeartRateRecording = async (activity: Activity, belt: HeartRateBelt): Promise<void> => {
  const sport = activity.base;
  try {
    await recordingJournal.write(journalHeaderLine(sport, startedAtMs, activity));
    await takeBelt(belt, getSportProfile(sport).heartRate.maxAgeS);
  } catch (err) {
    releaseRecordingBelt();
    heartOnly = false;
    currentProfile = null;
    await recordingJournal.remove();
    setState({ status: 'idle', heartRate: null, error: `Démarrage impossible, ceinture cardio injoignable : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  setState({ status: 'recording' });
  try {
    await keepBeltAlive('Tracker enregistre', `Session ${activity.name} en cours`);
  } catch (err) {
    setState({ error: `Service de l'enregistrement impossible : ${errorMessage(err, 'erreur inconnue')}. Gardez l'écran allumé.` });
  }
};

/**
 * Démarre un enregistrement. `motion` : capter l'accéléromètre et le gyroscope
 * (sauts, pumping en surf), avec l'emplacement du téléphone et le foil ; si les capteurs ne démarrent pas, l'enregistrement
 * continue sans eux, et le dit. `heartRate` : la ceinture cardio à joindre ; de même, sans elle si elle ne répond pas.
 *
 * Sans position (muscu, `hasPositions`), `source` est ignorée : la ceinture
 * est exigée, et le départ refusé sans elle ou si elle ne répond pas.
 */
export const startRecording = exclusive(async (
  activity: Activity,
  source: LocationSource | null,
  options: { motion?: MotionSetup | null; heartRate?: HeartRateBelt | null } = {}
): Promise<void> => {
  if (isBusy()) return;
  const sport = activity.base;
  const withPositions = hasPositions(sport);
  if (!withPositions && !options.heartRate) {
    setState({ error: 'La muscu se fait avec la ceinture cardio : choisissez-la dans Réglages › Capteurs, portez-la, puis démarrez.' });
    return;
  }
  if (withPositions && source === null) return;
  await recoverInterruptedRecording();
  // Le journal d'une session en attente serait écrasé : elle doit être analysée ou jetée d'abord.
  if (state.pending) return;

  const profile = effectiveRecordingProfile(activity);
  fixes = [];
  segmentBreaks = [];
  heartFixes = [];
  heartBreaks = [];
  heartOnly = !withPositions;
  pendingLines = '';
  lastFlushMs = null;
  currentSource = withPositions ? source : null;
  currentProfile = profile;
  lastReceivedMs = null;
  lastReceivedFix = null;
  belowSinceMs = null;
  pendingBreak = false;
  startedAtMs = Date.now();
  intervalRuns = new Map();
  marks = [];
  currentTest = null;
  sourceError = null;
  setState({
    status: 'starting', sport, activity, sourceLabel: withPositions ? source?.label ?? null : 'Ceinture cardio', pausedReason: null, pauseClock: null,
    measuringMotion: false, motionSetup: null, heartRate: null, marks, stats: EMPTY_RECORDING_STATS,
    saved: null, error: null,
  });

  if (!withPositions) {
    await startHeartRateRecording(activity, options.heartRate!);
    return;
  }
  if (source === null) return;
  try {
    await recordingJournal.write(journalHeaderLine(sport, startedAtMs, activity));
    stopSource = await source.start(sourceOptions(activity, profile), receiveFix, onSourceError);
    setState({ status: 'recording' });
  } catch (err) {
    stopSource = null;
    await recordingJournal.remove();
    setState({ status: 'idle', error: `Démarrage impossible : ${errorMessage(err, 'erreur inconnue')}` });
    return;
  }
  if (options.motion) {
    try {
      await startMotionCapture(startedAtMs, options.motion);
      setState({ measuringMotion: true, motionSetup: options.motion });
    } catch (err) {
      setState({ error: `Mesure des capteurs impossible : ${errorMessage(err, 'erreur inconnue')}. L'enregistrement continue sans elle.` });
    }
  }
  if (options.heartRate) {
    try {
      await takeBelt(options.heartRate, getSportProfile(sport).heartRate.maxAgeS);
    } catch (err) {
      releaseRecordingBelt();
      setState({ heartRate: null, error: `Ceinture cardio injoignable : ${errorMessage(err, 'erreur inconnue')}. L'enregistrement continue sans elle.` });
    }
  }
});

/**
 * Pause manuelle : coupe la source GPS pour économiser la batterie sur un
 * arrêt volontaire. `resumeRecording` la relance. Depuis une pause
 * automatique, elle coupe aussi la source : la reprise devient manuelle.
 */
export const pauseRecording = exclusive(async (): Promise<void> => {
  const autoPaused = state.status === 'paused' && state.pausedReason === 'auto';
  if (state.status !== 'recording' && !autoPaused) return;
  // La durée se fige à cet instant ; depuis une pause automatique, celle-ci y reste comptée.
  const frozenAtMs = Date.now();
  const pauseClock: PauseClock = { sinceMs: autoPaused && state.pauseClock ? state.pauseClock.sinceMs : frozenAtMs, frozenAtMs };
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée : on met en pause quand même.
  }
  stopSource = null;
  belowSinceMs = null;
  await flushJournal();
  if (state.measuringMotion) await pauseMotionCapture().catch(() => undefined);
  setState({ status: 'paused', pausedReason: 'manual', pauseClock });
});

/** Relance la source coupée par `pauseRecording`. Le prochain point gardé ouvre un nouveau segment. */
export const resumeRecording = exclusive(async (): Promise<void> => {
  // Sans position (muscu), la ceinture est restée prise : la mesure suivante ouvre le segment.
  if (heartOnly && state.status === 'paused' && state.pausedReason === 'manual') {
    pendingBreak = true;
    setState({ status: 'recording', pausedReason: null, pauseClock: null });
    return;
  }
  if (state.status !== 'paused' || state.pausedReason !== 'manual' || state.activity === null || currentSource === null || currentProfile === null) {
    return;
  }
  const activity = state.activity;
  const source = currentSource;
  const profile = currentProfile;
  try {
    pendingBreak = true;
    sourceError = null;
    stopSource = await source.start(sourceOptions(activity, profile), receiveFix, onSourceError);
    if (state.measuringMotion) await resumeMotionCapture().catch(() => undefined);
    // L'erreur de la source peut arriver avant la fin du démarrage (localisation coupée) : elle reste affichée.
    setState({ status: 'recording', pausedReason: null, pauseClock: null, error: sourceError });
  } catch (err) {
    pendingBreak = false;
    setState({ error: `Reprise impossible : ${errorMessage(err, 'erreur inconnue')}` });
  }
});

/**
 * Change l'activité de l'enregistrement en cours, d'une famille à l'autre
 * comprise : la session sera rangée sous elle et sous son calcul (nom du
 * fichier, `<type>` du GPX, module qui l'analyse), et la pause automatique
 * suit ses réglages dès la position suivante. Le changement est écrit dans le
 * journal : une session récupérée après un plantage garde l'activité choisie.
 * La notification Android garde le nom du départ jusqu'à une reprise après
 * pause manuelle : la changer tout de suite demanderait de relancer la source
 * GPS, au risque d'un trou dans la trace. Jamais d'une session sans position
 * (muscu) à une session à positions, ni l'inverse : l'une n'a pas de GPS en
 * route, l'autre perdrait sa trace.
 */
export const changeRecordingActivity = (activity: Activity): void => {
  // Pas pendant le démarrage : l'en-tête du journal n'est peut-être pas encore écrit.
  if ((state.status !== 'recording' && state.status !== 'paused') || state.activity?.id === activity.id) return;
  if (hasPositions(activity.base) === heartOnly) return;
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
    patch.pauseClock = null;
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

/**
 * Test guidé (`useFitnessTest`), dans son état du moment : gardé pour la
 * session et, si `journal`, écrit dans le journal pour survivre à un plantage
 * (changements de phase, paliers, fin). Sans effet hors d'un enregistrement ;
 * accepté pendant l'arrêt, le temps que le guidage range son dernier état.
 */
export const noteFitnessTest = (test: SessionTest, journal: boolean): void => {
  if (state.status === 'idle') return;
  currentTest = test;
  if (!journal) return;
  pendingLines += journalTestLine(test);
  if (state.status === 'recording' || state.status === 'paused') void flushJournal();
};

/**
 * Bouton « Note » : pose un repère à cet instant, à la dernière position
 * reçue (pause comprise), écrit tout de suite dans le journal. Rend le repère
 * et son numéro, ou `null` hors d'un enregistrement ou sans position encore.
 * Sans position (muscu), le repère est à l'heure seule.
 */
export const addRecordingMark = (): { mark: SessionMark; n: number } | null => {
  if (state.status !== 'recording' && state.status !== 'paused') return null;
  const fix = heartOnly ? null : lastReceivedFix ?? getLastFix();
  if (!heartOnly && !fix) return null;
  // Sans position (muscu) : un repère à l'heure seule.
  const mark: SessionMark = { timeMs: Date.now(), lat: fix?.lat ?? null, lon: fix?.lon ?? null, label: null };
  marks = [...marks, mark];
  setState({ marks });
  pendingLines += journalNoteLine(mark);
  void flushJournal();
  return { mark, n: marks.length };
};

/** Appui long sur le bouton rond : pause manuelle, ou reprise si elle l'est déjà. */
export const togglePauseRecording = (): Promise<void> =>
  state.status === 'paused' && state.pausedReason === 'manual' ? resumeRecording() : pauseRecording();

export const stopRecording = async (): Promise<void> => {
  if ((state.status !== 'recording' && state.status !== 'paused') || state.activity === null) return;
  const activity = state.activity;
  const stoppedAtMs = Date.now();
  const wasRecording = state.status === 'recording';
  setState({ status: 'stopping' });
  try {
    await stopSource?.();
  } catch {
    // La source est peut-être déjà arrêtée (arrêt normal, ou pause manuelle) : on termine quand même.
  }
  stopSource = null;
  currentSource = null;
  currentProfile = null;
  // Sans position : la durée va jusqu'à l'arrêt (pas en pause manuelle, qui l'a figée), point écrit au journal.
  let heart = splitIntoSegments(heartFixes, heartBreaks);
  if (heartOnly && wasRecording) {
    const ended = withStopPoint(heart, stoppedAtMs);
    if (ended !== heart) pendingLines += journalHeartRateLine(ended[ended.length - 1][ended[ended.length - 1].length - 1]);
    heart = ended;
  }
  await flushJournal();
  const motion = state.measuringMotion ? await stopMotionCapture().catch(() => null) : null;
  releaseRecordingBelt();
  if (heartOnly) await stopBeltKeepAlive();

  try {
    const intervals = seriesWithin([...intervalRuns.values()], startedAtMs, stoppedAtMs);
    const pending = await buildPendingSession(
      activity, { segments: splitIntoSegments(fixes, segmentBreaks), heart }, false, intervals, [...marks], motion, currentTest
    );
    setState({
      status: 'idle',
      pausedReason: null,
      pauseClock: null,
      measuringMotion: false,
      motionSetup: null,
      heartRate: null,
      marks: [],
      pending,
      error: pending ? state.error : nothingToKeep(activity.base),
    });
  } catch (err) {
    setState({
      status: 'idle',
      pausedReason: null,
      pauseClock: null,
      measuringMotion: false,
      motionSetup: null,
      heartRate: null,
      marks: [],
      error: `Construction du GPX impossible : ${errorMessage(err, 'erreur inconnue')}. Le journal est gardé et sera repris au prochain démarrage.`,
    });
  }
  fixes = [];
  segmentBreaks = [];
  heartFixes = [];
  heartBreaks = [];
  heartOnly = false;
  intervalRuns = new Map();
  marks = [];
  currentTest = null;
  sourceError = null;
};

/**
 * Mesures de la ceinture d'une session sans position (muscu) en cours, un
 * tableau par segment continu : la FC moyenne du direct. Vide sinon.
 */
export const getLiveHeartSegments = (): HeartRateFix[][] => (isBusy() && heartOnly ? splitIntoSegments(heartFixes, heartBreaks) : []);

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

/** Statut seul de l'enregistreur : ne redessine qu'à son changement, pas à chaque position ni mesure de la ceinture. */
export const useRecorderStatus = (): RecorderStatus => useSyncExternalStore(subscribe, () => state.status);

/**
 * Horloge de l'enregistrement, pour une page : l'instant présent et la durée
 * affichée (`displayedDurationMs`). Elle bat chaque seconde seulement quand
 * c'est utile : en pause automatique, où la durée tourne sans position, et
 * quand `clockShown` (chiffre « Heure » affiché) ; sinon la page est redessinée
 * avec l'état.
 */
export const useRecordingClock = (clockShown: boolean): { nowMs: number; durationMs: number } => {
  const { status, stats, pauseClock } = useRecorder();
  const ticking = status !== 'idle' && ((pauseClock !== null && pauseClock.frozenAtMs === null) || clockShown);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const tick = () => setNowMs(Date.now());
    // Tout de suite, puis chaque seconde : l'instant gardé peut dater.
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [ticking]);
  return { nowMs, durationMs: displayedDurationMs(stats, pauseClock, nowMs) };
};
