import { clearRecordingNotification, updateRecordingNotification } from '../platform/notification';
import { timerStateAt } from '../recording/intervalTimer';
import { travelHeading } from '../recording/heading';
import type { LiveFieldContext } from '../recording/liveFields';
import { liveNotification, liveNotificationKey } from '../recording/liveNotification';
import { recordingDurationMs } from '../recording/session';
import { getIntervalRun, subscribeToIntervalCommands } from './useIntervalTimer';
import { getLiveRecording, subscribeToLiveRecording } from './useLiveRecording';
import { getMarkGuideView } from './useMarkGuide';
import { getLiveFixes, getRecorderState, subscribeToFixes, subscribeToRecorder } from './useRecorder';
import { readHeartRateZoneBounds } from './useRunnerProfile';
import { effectiveDistanceUnit, effectiveNotificationFields, effectiveSpeedUnit } from './useSportSettings';

/**
 * Notification de l'enregistrement, tenue hors des composants : elle vit
 * écran éteint, page fermée. Les chiffres choisis pour l'activité dans
 * Réglages (`effectiveNotificationFields`) y sont repris du direct
 * (`useLiveRecording`), sans calcul en double ; le texte est composé par
 * `liveNotification` et posé par `platform/notification.ts`.
 *
 * Rythme : à l'arrivée des positions et des recalculs du direct, au plus
 * toutes les `MIN_UPDATE_MS`, et seulement si le texte change ; tout de suite
 * à un changement d'état (pause, reprise, pause automatique, activité), de
 * phase du compteur du fractionné, et au premier calcul du direct. Le chronomètre d'Android fait tourner la
 * durée, ou le décompte de la phase, entre deux envois.
 *
 * Le service GPS repose sa propre notification à chaque démarrage (départ,
 * reprise après une pause manuelle) : la première position qui suit la fait
 * récrire. En pause manuelle, le service est arrêté et la notification est
 * posée seule ; elle est effacée à l'arrêt de l'enregistrement.
 */

/** Intervalle minimal entre deux envois sans changement d'état, en millisecondes. */
const MIN_UPDATE_MS = 5000;

/** Dernier envoi : sa clé et son instant. */
let sentKey: string | null = null;
let sentAtMs = 0;
/** État du dernier envoi (pause, activité, phase du compteur) : un changement part tout de suite. */
let sentStateKey: string | null = null;
/** Une notification de l'application est peut-être affichée. */
let shown = false;
/** Le service GPS vient de (re)démarrer : sa notification est à récrire à la prochaine position. */
let rewriteOnFix = false;
/** État de l'enregistreur au changement précédent. */
let previous = { status: getRecorderState().status, pausedReason: getRecorderState().pausedReason };

/** État qui commande un envoi immédiat ; les premiers chiffres du direct aussi, pour ne pas attendre avec des « - ». */
const stateKeyNow = (nowMs: number): string => {
  const { status, pausedReason, activity } = getRecorderState();
  const run = getIntervalRun();
  const timer = run ? timerStateAt(run, nowMs) : null;
  const phase = timer?.phase ? `${timer.status}:${timer.phase.kind}:${timer.phase.rep}:${timer.phase.startS}` : '';
  const computed = getLiveRecording().updatedMs !== null;
  return `${status}|${pausedReason ?? ''}|${activity?.id ?? ''}|${phase}|${computed}`;
};

const clear = () => {
  sentKey = null;
  sentStateKey = null;
  if (!shown) return;
  shown = false;
  void clearRecordingNotification().catch(() => {});
};

const update = (force: boolean) => {
  const recorder = getRecorderState();
  const { status, activity } = recorder;
  if ((status !== 'recording' && status !== 'paused') || activity === null) {
    clear();
    return;
  }
  const nowMs = Date.now();
  const stateKey = stateKeyNow(nowMs);
  if (!force && stateKey === sentStateKey && nowMs - sentAtMs < MIN_UPDATE_MS) return;

  const fields = effectiveNotificationFields(activity);
  const live = getLiveRecording();
  const mark = getMarkGuideView();
  const run = getIntervalRun();
  const timer = run ? timerStateAt(run, nowMs) : null;
  const context: LiveFieldContext = {
    speedUnit: effectiveSpeedUnit(activity),
    distanceUnit: effectiveDistanceUnit(activity),
    stats: live.stats,
    durationMs: recordingDurationMs(recorder.stats),
    nowMs,
    remainingM: mark.active ? mark.remainingM : live.progress?.remainingM ?? null,
    // Le cap parcourt la trace : calculé seulement s'il est demandé.
    headingDeg: fields.includes('heading') ? travelHeading(getLiveFixes()).headingDeg : null,
    markDistanceM: mark.active ? mark.distanceM : null,
    markBearingDeg: mark.active ? mark.bearingDeg : null,
    heartRateBpm: recorder.heartRate?.bpm ?? null,
    heartRateZoneBounds: fields.includes('heartRateZone') ? readHeartRateZoneBounds(activity.base) : null,
  };
  const paused = status === 'paused' ? recorder.pausedReason ?? 'auto' : null;
  const content = liveNotification({
    activityName: activity.name,
    fields,
    context,
    paused,
    startedAtMs: recorder.stats.firstMs,
    interval: timer?.phase && run && (timer.status === 'running' || timer.status === 'paused') ? { state: timer, reps: run.workout.reps } : null,
    nowMs,
  });
  const standalone = paused === 'manual';
  const key = liveNotificationKey(content, standalone);
  if (!force && key === sentKey) return;
  sentKey = key;
  sentStateKey = stateKey;
  sentAtMs = nowMs;
  shown = true;
  void updateRecordingNotification(content, { standalone }).catch(() => {});
};

const onRecorder = () => {
  const { status, pausedReason } = getRecorderState();
  // Départ, ou reprise d'une pause manuelle : le service GPS va poser sa notification.
  if (status === 'recording' && (previous.status === 'starting' || previous.pausedReason === 'manual')) rewriteOnFix = true;
  previous = { status, pausedReason };
  update(false);
};

const onFix = () => {
  const force = rewriteOnFix;
  rewriteOnFix = false;
  update(force);
};

let started = false;

/**
 * Branche la notification sur l'enregistreur ; à appeler une fois au
 * démarrage de l'application. Sans enregistrement, une notification de pause
 * restée après un arrêt brutal est effacée.
 */
export const startRecordingNotification = (): void => {
  if (started) return;
  started = true;
  subscribeToRecorder(onRecorder);
  subscribeToFixes(onFix);
  subscribeToLiveRecording(() => update(false));
  subscribeToIntervalCommands(() => update(false));
  if (getRecorderState().status === 'idle') {
    shown = true;
    clear();
  }
};
