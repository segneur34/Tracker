import { isManualPause, isRecordingSession } from '../recording/session';
import { useSyncExternalStore } from 'react';
import type { Activity } from '../core/activities';
import { haversineDistance } from '../core/kinematics';
import { getSportProfile, isTestSport } from '../core/sportProfiles';
import { playPattern } from '../platform/beeper';
import type { LocationFix } from '../platform/location';
import {
  FITNESS_TESTS, TEST_SIGNAL_TONES, closeFitnessTest, finishRamp, guideReadings, phaseRemainingS, resolveFitnessTestParams, startFitnessTest,
  stepFitnessTest, stepTargetMs,
  type FitnessTestId, type FitnessTestParams, type FitnessTestState, type SessionTest, type TestPhase, type TestRunner, type TestSignal,
} from '../recording/fitnessTest';
import { getRecorderState, noteFitnessTest, subscribeToFixes, subscribeToRecorder } from './useRecorder';
import { readRunnerProfile, runnerAge, type RunnerProfile } from './useRunnerProfile';
import { effectiveHrOffset, readFitnessTestSettings } from './useSportSettings';
import { createStore } from './createStore';

/**
 * Guidage d'un test (Entraînement › Tests, d'abord la FC max) pendant
 * l'enregistrement, hors des composants comme l'enregistreur et les balises
 * (`useMarkGuide`) : il tourne écran éteint, page fermée, sur les positions
 * reçues (`subscribeToFixes`), la seule boucle sûre écran éteint.
 *
 * Il démarre quand l'enregistrement porte une activité de test, au départ ou
 * en cours de route, avec les réglages du test armé (`armFitnessTest`, le
 * choix de la rangée « Test ») et les zones du cardio de Pratiquant ; il
 * s'arrête à l'arrêt ou au passage à une activité qui n'est pas un test, et
 * ce qui est fait reste dans la fiche. Un test qui a atteint sa rampe n'est pas refait dans
 * le même enregistrement.
 *
 * À chaque position, l'état avance (`stepFitnessTest`) avec la FC jointe par
 * l'enregistreur et la vitesse du GPS (sinon celle des deux dernières
 * positions) ; une pause manuelle vue depuis la position précédente compte
 * comme reprise. Chaque signal est joué une fois (`playPattern`, vibreur
 * compris) et consigné en `console.debug` (« [test] … ») pour le banc. Le
 * test va à l'enregistreur à chaque position (`noteFitnessTest`), au journal
 * à chaque phase, palier et fin.
 */

export interface FitnessTestView {
  /** Vrai pendant un enregistrement d'une activité de test. */
  active: boolean;
  params: FitnessTestParams | null;
  phase: TestPhase;
  /** Temps restant de la phase, en secondes ; `null` hors d'une phase minutée. */
  remainingS: number | null;
  /** Palier en cours, compté depuis 1 ; 0 avant la rampe. */
  step: number;
  /** Vitesse cible du palier en cours, `null` hors de la rampe. */
  targetMs: number | null;
  /** FC et vitesse lissées que lit le guidage. */
  hrBpm: number | null;
  speedMs: number | null;
  lastSignal: { signal: TestSignal; timeMs: number } | null;
}

const INACTIVE: FitnessTestView = {
  active: false,
  params: null,
  phase: 'attente',
  remainingS: null,
  step: 0,
  targetMs: null,
  hrBpm: null,
  speedMs: null,
  lastSignal: null,
};

/** Écart maximal entre deux positions pour en tirer une vitesse, faute de celle du GPS. */
const DERIVED_SPEED_MAX_GAP_MS = 5000;

interface Session {
  state: FitnessTestState;
  /** Position précédente, pour la vitesse quand le GPS n'en donne pas. */
  previous: LocationFix | null;
  /** Pause manuelle vue depuis la position précédente. */
  sawPause: boolean;
}

/** Ce que le test lit de Pratiquant : âge, FC et seuils ; modèle des zones et décalage de l'activité de test (celui du calcul de test sans elle). */
export const fitnessTestRunner = (profile: RunnerProfile, activity: Activity | null = null): TestRunner => ({
  athlete: profile,
  age: runnerAge(profile),
  zoneModel: getSportProfile(activity?.base ?? 'run-test').heartRate.zoneModel,
  offsetBpm: activity ? effectiveHrOffset(activity) : getSportProfile('run-test').heartRate.thresholdOffsetBpm,
});

let armed: FitnessTestId = 'fc-max';
let session: Session | null = null;
/** Dernier test fini dans cet enregistrement, pour ne pas en relancer un après sa rampe ; effacé au repos. */
let closed: SessionTest | null = null;
const store = createStore<FitnessTestView>(INACTIVE);

const publish = () => {
  if (!session) {
    store.set(INACTIVE);
    return;
  }
  const { state } = session;
  const readings = guideReadings(state);
  store.set({
    active: true,
    params: state.params,
    phase: state.phase,
    remainingS: phaseRemainingS(state),
    step: state.phase === 'rampe' ? state.step + 1 : 0,
    targetMs: state.phase === 'rampe' ? stepTargetMs(state) : null,
    hrBpm: readings.hrBpm,
    speedMs: readings.speedMs,
    lastSignal: state.lastSignal,
  });
};

const play = (signal: TestSignal, timeMs: number) => {
  console.debug(`[test] ${signal} à ${timeMs}`);
  void playPattern(TEST_SIGNAL_TONES[signal], true).catch(() => {});
};

/** Vitesse de la position : celle du GPS, sinon celle tirée de la précédente, proche. */
const fixSpeedMs = (fix: LocationFix, previous: LocationFix | null): number | undefined => {
  if (fix.speedMs !== undefined) return fix.speedMs;
  if (!previous) return undefined;
  const dtMs = fix.timeMs - previous.timeMs;
  if (dtMs <= 0 || dtMs > DERIVED_SPEED_MAX_GAP_MS) return undefined;
  return haversineDistance(previous.lat, previous.lon, fix.lat, fix.lon) / (dtMs / 1000);
};

/** Le test avance d'un état à l'autre : signal joué, enregistreur tenu à jour, journal aux phases et paliers. */
const advance = (current: Session, next: { state: FitnessTestState; signal: TestSignal | null }) => {
  const before = current.state;
  if (next.state === before) return;
  current.state = next.state;
  if (next.signal && next.state.lastSignal) play(next.signal, next.state.lastSignal.timeMs);
  const milestone = next.state.phase !== before.phase || next.state.test?.steps.length !== before.test?.steps.length;
  if (next.state.test) noteFitnessTest(next.state.test, milestone);
};

const onFix = (fix: LocationFix) => {
  const current = session;
  if (!current) return;
  const resumed = current.sawPause;
  current.sawPause = false;
  const speedMs = fixSpeedMs(fix, current.previous);
  current.previous = fix;
  advance(current, stepFitnessTest(current.state, { timeMs: fix.timeMs, speedMs, hrBpm: fix.heartRateBpm }, { resumed }));
  publish();
};

/** Ferme le test en cours : son dernier état va à l'enregistreur et au journal. */
const end = () => {
  if (!session) return;
  const test = closeFitnessTest(session.state);
  if (test) {
    noteFitnessTest(test, true);
    closed = test;
  }
  session = null;
  publish();
};

/** Démarre ou arrête le guidage selon l'état de l'enregistreur. */
const sync = () => {
  const recorder = getRecorderState();
  const recording = isRecordingSession(recorder);
  if (recorder.status === 'idle') closed = null;
  const testing = recording && recorder.activity !== null && isTestSport(recorder.activity.base);
  if (!testing) {
    end();
    return;
  }
  if (!session) {
    if (closed?.rampStartMs != null) return;
    const protocol = FITNESS_TESTS[armed];
    const params = resolveFitnessTestParams(protocol, readFitnessTestSettings(armed), fitnessTestRunner(readRunnerProfile(), recorder.activity!));
    session = { state: startFitnessTest(params), previous: null, sawPause: false };
    publish();
  }
  if (isManualPause(recorder)) session.sawPause = true;
};

let started = false;

/** Branche le guidage des tests sur l'enregistreur ; à appeler une fois au démarrage de l'application. */
export const startFitnessTestGuide = (): void => {
  if (started) return;
  started = true;
  subscribeToRecorder(sync);
  subscribeToFixes(onFix);
  sync();
};

/** Test à guider au prochain départ d'une activité de test (rangée « Test » d'Enregistrer). */
export const armFitnessTest = (id: FitnessTestId): void => {
  armed = id;
};

/** « Finir la rampe », à l'heure de la dernière position ; sans effet hors de la rampe. */
export const finishFitnessRamp = (): void => {
  const current = session;
  if (!current) return;
  advance(current, finishRamp(current.state));
  publish();
};

/** État du guidage, hors React (notification de l'enregistrement : le palier). */
export const getFitnessTestView = (): FitnessTestView => store.get();

/** État du guidage, relu à chaque position. */
export const useFitnessTest = (): FitnessTestView => useSyncExternalStore(store.subscribe, store.get);
