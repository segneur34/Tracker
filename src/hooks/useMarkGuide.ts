import { isManualPause, isRecordingSession } from '../recording/session';
import { useSyncExternalStore } from 'react';
import { activityFamily } from '../core/activities';
import { usesMarkCourse } from '../core/sportProfiles';
import { getBeeper } from '../platform/beeper';
import type { LocationFix } from '../platform/location';
import {
  START_MARK_GUIDE, aimAtTarget, beepIntervalMs, isCourseFinished, markGuideView, resumedGuideState, skipMark as skipInState, stepMarkGuide,
  type LatLon, type MarkGuideSettings, type MarkGuideState, type MarkGuideView,
} from '../recording/markGuide';
import { getFollowedTrace, subscribeToFollowedTrace } from './useFollowedTrace';
import { getRecorderState, subscribeToFixes, subscribeToRecorder } from './useRecorder';
import { effectiveMarkGuide } from './useSportSettings';
import { createStore } from './createStore';

/**
 * Guidage vers les balises pendant l'enregistrement, hors des composants
 * comme l'enregistreur : il tourne écran éteint, page fermée. Il guide quand
 * un enregistrement de voile suit un itinéraire à balises (`FollowedTrace.marks`),
 * et s'arrête avec lui, au retrait de la trace ou au passage à une autre
 * famille. Les bips sont ceux du parcours s'il en a de propres, sinon ceux
 * de l'activité (Réglages).
 *
 * À chaque position reçue (`subscribeToFixes`), l'état avance
 * (`stepMarkGuide`) et le rythme des bips est réglé (`platform/beeper.ts`) ;
 * le greffon Android tient ce rythme entre deux positions. Pendant une pause
 * manuelle, le GPS est coupé : silence. La page le lit par `useMarkGuide`
 * et le pilote par `skipMark` (« Passer ») et `setBeepsMuted` (« Bips »).
 */

const INACTIVE: MarkGuideView = {
  active: false,
  marks: [],
  target: 0,
  outcomes: [],
  distanceM: null,
  bearingDeg: null,
  remainingM: null,
  finished: false,
  muted: false,
  validationRadiusM: 0,
};

interface Session {
  marks: LatLon[];
  /** Bips propres au parcours suivi, qui priment sur ceux de l'activité. */
  courseGuide: MarkGuideSettings | null;
  activityId: string;
  settings: MarkGuideSettings;
  state: MarkGuideState;
  distanceM: number | null;
  bearingDeg: number | null;
  muted: boolean;
  /** Dernier rythme envoyé au greffon, pour ne pas le renvoyer à chaque position. */
  sent: { intervalMs: number | null; vibrate: boolean } | null;
  /** Vrai pendant une pause manuelle : à la reprise, la position d'avant la pause est oubliée. */
  manualPause: boolean;
}

let session: Session | null = null;
const store = createStore<MarkGuideView>(INACTIVE);

const publish = () => {
  store.set(session ? markGuideView(session) : INACTIVE);
};

/** Règle le rythme d'approche de la balise visée, s'il a changé. */
const applyRhythm = (current: Session) => {
  const manualPause = isManualPause(getRecorderState());
  const intervalMs = current.muted || manualPause || current.distanceM === null
    ? null
    : beepIntervalMs(current.distanceM, current.settings);
  const vibrate = current.settings.vibrate;
  if (current.sent && current.sent.intervalMs === intervalMs && current.sent.vibrate === vibrate) return;
  current.sent = { intervalMs, vibrate };
  void getBeeper().setInterval(intervalMs, vibrate).catch(() => {});
};

/** Distance et cap de la dernière position à la balise visée. */
const aimFromLastPosition = (current: Session) => {
  const from = current.state.previous;
  if (!from) return;
  const aim = aimAtTarget(from, current.state, current.marks);
  current.distanceM = aim.distanceM;
  current.bearingDeg = aim.bearingDeg;
};

const onFix = (fix: LocationFix) => {
  const current = session;
  if (!current) return;
  const step = stepMarkGuide(current.state, fix, current.marks, current.settings);
  current.state = step.state;
  current.distanceM = step.distanceM;
  current.bearingDeg = step.bearingDeg;
  if (step.event && !current.muted) {
    const vibrate = current.settings.vibrate;
    const beeper = getBeeper();
    void (step.event === 'finished' ? beeper.finished(vibrate) : beeper.validated(vibrate)).catch(() => {});
    // Le greffon s'est tu : le rythme sera renvoyé.
    current.sent = null;
  }
  applyRhythm(current);
  publish();
};

/** Démarre, met à jour ou arrête le guidage selon l'enregistreur et la trace suivie. */
const sync = () => {
  const recorder = getRecorderState();
  const trace = getFollowedTrace();
  const marks = trace?.marks;
  const recording = isRecordingSession(recorder);
  const activity = recorder.activity;
  const guided = recording && activity !== null && usesMarkCourse(activityFamily(activity)) && marks !== undefined && marks.length > 0;

  if (!guided) {
    if (session) {
      session = null;
      void getBeeper().stop().catch(() => {});
      publish();
    }
    return;
  }
  if (!session || session.marks !== marks) {
    const courseGuide = trace?.markGuide ?? null;
    session = {
      marks,
      courseGuide,
      activityId: activity.id,
      settings: courseGuide ?? effectiveMarkGuide(activity),
      state: START_MARK_GUIDE,
      distanceM: null,
      bearingDeg: null,
      muted: false,
      sent: null,
      manualPause: false,
    };
    publish();
    return;
  }
  // Pause manuelle : à la reprise, la position d'avant la pause est oubliée
  // (le segment qui enjambe la pause n'a pas été parcouru).
  if (isManualPause(recorder)) {
    session.manualPause = true;
  } else if (session.manualPause && recorder.status === 'recording') {
    session.manualPause = false;
    session.state = resumedGuideState(session.state);
  }
  if (session.activityId !== activity.id) {
    // Une autre activité de voile : ses propres bips, sauf si le parcours a les siens.
    session.activityId = activity.id;
    session.settings = session.courseGuide ?? effectiveMarkGuide(activity);
    session.sent = null;
    publish();
  }
  // Pause manuelle (GPS coupé) : silence ; à la reprise, la position suivante relance le rythme.
  applyRhythm(session);
};

let started = false;

/** Branche le guidage sur l'enregistreur ; à appeler une fois au démarrage de l'application. */
export const startMarkGuide = (): void => {
  if (started) return;
  started = true;
  subscribeToRecorder(sync);
  subscribeToFollowedTrace(sync);
  subscribeToFixes(onFix);
  sync();
};

/** « Passer » : la balise visée est laissée, la suivante prend le relais. */
export const skipMark = (): void => {
  const current = session;
  if (!current || isCourseFinished(current.state, current.marks)) return;
  current.state = skipInState(current.state, current.marks);
  aimFromLastPosition(current);
  applyRhythm(current);
  publish();
};

/** Coupe ou remet les bips et les vibrations, jusqu'à la fin de l'enregistrement. */
export const setBeepsMuted = (muted: boolean): void => {
  const current = session;
  if (!current || current.muted === muted) return;
  current.muted = muted;
  applyRhythm(current);
  publish();
};

/** État du guidage, hors React (notification de l'enregistrement). */
export const getMarkGuideView = (): MarkGuideView => store.get();

/** État du guidage, relu à chaque position. */
export const useMarkGuide = (): MarkGuideView => useSyncExternalStore(store.subscribe, store.get);
