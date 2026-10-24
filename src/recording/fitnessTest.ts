import { kmhToMs } from '../core/units';
import type { ClockTone } from '../platform/beeper';

/**
 * Tests guidés par bips (Entraînement › Tests, 24/10), d'abord la FC max :
 * un échauffement à une FC cible, une rampe de +0,6 km/h par minute tenue
 * jusqu'à ce qu'on lâche, puis une récupération mesurée.
 *
 * Le test avance à chaque position, sur l'heure des positions (le rejeu le
 * fait donc tourner à sa vitesse), pauses manuelles ôtées : son temps est le
 * « temps actif », en millisecondes depuis le premier point. L'échauffement
 * se guide sur la FC lissée, la rampe sur la vitesse GPS lissée (la FC y
 * répond avec 30 à 60 s de retard). Les moyennes sont pondérées par le temps
 * (chaque mesure vaut depuis la précédente) : une trace à 1 Hz et à 5 Hz
 * donnent les mêmes signaux.
 *
 * Signaux (réponses de l'utilisateur, 24/10) : 1 bip court = bien, 2 = trop
 * vite, 3 = accélère ; un bip long au début de la rampe et à chaque palier ;
 * corrections espacées de 10 s au moins, « bien » de 30 s. Début, fin de la
 * rampe et fin du test : choix montrés dans le plan du lot.
 */

export type FitnessTestId = 'fc-max';

export const FITNESS_TEST_IDS: readonly FitnessTestId[] = ['fc-max'];

export const isFitnessTestId = (value: unknown): value is FitnessTestId =>
  typeof value === 'string' && (FITNESS_TEST_IDS as readonly string[]).includes(value);

/** Protocole d'un test, en unités SI ; les fenêtres et délais en secondes. */
export interface FitnessTestProtocol {
  id: FitnessTestId;
  label: string;
  /** Version du protocole, rangée dans la fiche. */
  version: number;
  /** Durée de l'échauffement par défaut, réglable. */
  warmupS: number;
  /** Cible de l'échauffement, en part de la FC max de référence ; réglable. */
  warmupPct: number;
  /** FC max de référence : `hrMaxBase` − âge (220 − âge, pas l'estimation de Tanaka du cardio). */
  hrMaxBase: number;
  /** Âge pris sans année de naissance dans Pratiquant. */
  defaultAge: number;
  /** Demi-largeur de la bande de FC de l'échauffement, en bpm. */
  hrBandBpm: number;
  /** Début de l'échauffement sans correction, le temps que la FC monte. */
  warmupGraceS: number;
  /** Durée d'un palier de la rampe. */
  stepS: number;
  /** Hausse de la vitesse cible à chaque palier, en m/s. */
  stepMs: number;
  /** Vitesse de départ : moyenne de la fin de l'échauffement sur cette durée… */
  startWindowS: number;
  /** … arrondie à ce pas, en m/s. */
  startRoundMs: number;
  /** Départ sans aucune vitesse mesurée pendant l'échauffement, en m/s. */
  fallbackStartMs: number;
  /** Lissage de la vitesse et de la FC du guidage. */
  smoothS: number;
  /** Tolérance autour de la vitesse cible, en m/s. */
  speedToleranceMs: number;
  /** Fin de la rampe : vitesse lissée sous la cible d'au moins tant (m/s)… */
  failDeficitMs: number;
  /** … pendant tant de secondes. */
  failS: number;
  /** Sans correction après un palier, une reprise ou le départ de la rampe. */
  stepGraceS: number;
  /** Récupération mesurée après la rampe. */
  recoveryS: number;
  /** Écart minimal entre une correction et le signal précédent. */
  correctionGapS: number;
  /** Écart minimal entre deux « bien ». */
  goodGapS: number;
  /** Au-delà de ce trou entre deux positions, la mesure repart de zéro (aucun signal tant qu'elle n'est pas refaite). */
  fixGapS: number;
  /** Lissage de la FC des résultats (pic). */
  resultHrSmoothS: number;
  /** FC de récupération lue tant de secondes après la fin de la rampe. */
  recoveryReadS: number;
}

export const FITNESS_TESTS: Record<FitnessTestId, FitnessTestProtocol> = {
  'fc-max': {
    id: 'fc-max',
    label: 'FC max',
    version: 1,
    warmupS: 480,
    warmupPct: 0.45,
    hrMaxBase: 220,
    defaultAge: 35,
    hrBandBpm: 5,
    warmupGraceS: 30,
    stepS: 60,
    stepMs: kmhToMs(0.6),
    startWindowS: 60,
    startRoundMs: kmhToMs(0.5),
    fallbackStartMs: kmhToMs(8),
    smoothS: 10,
    speedToleranceMs: kmhToMs(0.3),
    failDeficitMs: kmhToMs(0.5),
    failS: 20,
    stepGraceS: 10,
    recoveryS: 120,
    correctionGapS: 10,
    goodGapS: 30,
    fixGapS: 5,
    resultHrSmoothS: 5,
    recoveryReadS: 60,
  },
};

/** Réglages de l'utilisateur, avant « Lancer ». */
export interface FitnessTestSettings {
  warmupS: number;
  warmupPct: number;
}

export const FITNESS_TEST_LIMITS = {
  warmupS: { min: 180, max: 1200, step: 60 },
  warmupPct: { min: 0.3, max: 0.7, step: 0.05 },
} as const;

const inRange = (value: unknown, { min, max }: { min: number; max: number }): value is number =>
  typeof value === 'number' && isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9;

/** Réglages rangés, valeurs hors bornes remplacées par celles du protocole. */
export const sanitizeFitnessTestSettings = (raw: unknown, protocol: FitnessTestProtocol): FitnessTestSettings => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    warmupS: inRange(r.warmupS, FITNESS_TEST_LIMITS.warmupS) ? Math.round(r.warmupS) : protocol.warmupS,
    warmupPct: inRange(r.warmupPct, FITNESS_TEST_LIMITS.warmupPct) ? r.warmupPct : protocol.warmupPct,
  };
};

export type AgeSource = 'profil' | 'defaut';

/** Ce qu'il faut pour guider un test : le protocole, les réglages et la cible tirée de l'âge. */
export interface FitnessTestParams {
  protocol: FitnessTestProtocol;
  warmupS: number;
  warmupPct: number;
  age: number;
  ageSource: AgeSource;
  /** FC max de référence (220 − âge). */
  hrMaxRefBpm: number;
  /** Cible de l'échauffement. */
  targetBpm: number;
}

/** Âge admis pour la FC max de référence. */
const isUsableAge = (age: number | null): age is number => age !== null && isFinite(age) && age >= 8 && age <= 100;

export const resolveFitnessTestParams = (
  protocol: FitnessTestProtocol,
  settings: FitnessTestSettings,
  age: number | null
): FitnessTestParams => {
  const usable = isUsableAge(age);
  const used = usable ? age : protocol.defaultAge;
  const hrMaxRefBpm = protocol.hrMaxBase - used;
  return {
    protocol,
    warmupS: settings.warmupS,
    warmupPct: settings.warmupPct,
    age: used,
    ageSource: usable ? 'profil' : 'defaut',
    hrMaxRefBpm,
    targetBpm: Math.round(settings.warmupPct * hrMaxRefBpm),
  };
};

// --- Fiche ---

export type TestSignal = 'debut' | 'bien' | 'trop' | 'accelere' | 'palier' | 'finRampe' | 'finTest';

const TEST_SIGNALS: readonly TestSignal[] = ['debut', 'bien', 'trop', 'accelere', 'palier', 'finRampe', 'finTest'];

/** Ce que dit chaque signal, en clair. */
export const TEST_SIGNAL_LABEL: Record<TestSignal, string> = {
  debut: 'Début',
  bien: 'Bien',
  trop: 'Trop vite',
  accelere: 'Accélère',
  palier: 'Palier',
  finRampe: 'Fin de la rampe',
  finTest: 'Fin du test',
};

/** Fin de la rampe : vitesse tenue sous la cible, « Finir la rampe », ou enregistrement arrêté (ou activité changée) avant. */
export type TestEndReason = 'auto' | 'manuel' | 'arret';

/** Un palier de la rampe : son début et sa vitesse cible. */
export interface TestStep {
  startMs: number;
  targetMs: number;
}

/**
 * Test fait pendant un enregistrement, rangé dans la fiche (`record.test`)
 * et dans le journal. Instants en heure des positions, comme la trace.
 */
export interface SessionTest {
  protocol: FitnessTestId;
  version: number;
  settings: { warmupS: number; warmupPct: number; age: number; ageSource: AgeSource; targetBpm: number; bandBpm: number };
  startMs: number;
  rampStartMs: number | null;
  /** Vitesse du premier palier. */
  v0Ms: number | null;
  steps: TestStep[];
  rampEndMs: number | null;
  /** Début du manque qui a fini la rampe (fin automatique) ; l'appui sinon. */
  dropMs: number | null;
  endReason: TestEndReason | null;
  /** Fin de la récupération. */
  endMs: number | null;
  signals: { t: number; s: TestSignal }[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Test d'une fiche ou d'un journal ; `null` s'il est mal formé. */
export const readSessionTest = (raw: unknown): SessionTest | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isFitnessTestId(r.protocol) || !isNum(r.version) || !isNum(r.startMs)) return null;
  const s = typeof r.settings === 'object' && r.settings !== null ? (r.settings as Record<string, unknown>) : null;
  if (!s || !isNum(s.warmupS) || !isNum(s.warmupPct) || !isNum(s.age) || !isNum(s.targetBpm) || !isNum(s.bandBpm)) return null;
  const steps = Array.isArray(r.steps)
    ? r.steps.filter((x): x is TestStep => typeof x === 'object' && x !== null && isNum((x as TestStep).startMs) && isNum((x as TestStep).targetMs))
      .map(({ startMs, targetMs }) => ({ startMs, targetMs }))
    : [];
  const signals = Array.isArray(r.signals)
    ? r.signals.filter((x): x is { t: number; s: TestSignal } =>
      typeof x === 'object' && x !== null && isNum((x as { t: unknown }).t) && TEST_SIGNALS.includes((x as { s: TestSignal }).s))
      .map(({ t, s: kind }) => ({ t, s: kind }))
    : [];
  const endReason = r.endReason === 'auto' || r.endReason === 'manuel' || r.endReason === 'arret' ? r.endReason : null;
  return {
    protocol: r.protocol,
    version: r.version,
    settings: {
      warmupS: s.warmupS, warmupPct: s.warmupPct, age: s.age, ageSource: s.ageSource === 'profil' ? 'profil' : 'defaut',
      targetBpm: s.targetBpm, bandBpm: s.bandBpm,
    },
    startMs: r.startMs,
    rampStartMs: numOrNull(r.rampStartMs),
    v0Ms: numOrNull(r.v0Ms),
    steps,
    rampEndMs: numOrNull(r.rampEndMs),
    dropMs: numOrNull(r.dropMs),
    endReason,
    endMs: numOrNull(r.endMs),
    signals,
  };
};

// --- Guidage ---

export type TestPhase = 'attente' | 'echauffement' | 'rampe' | 'recuperation' | 'fini';

/** Une mesure : l'heure de la position, sa vitesse et la FC jointe, si elles y sont. */
export interface TestSample {
  timeMs: number;
  speedMs?: number;
  hrBpm?: number;
}

interface WindowSample {
  activeMs: number;
  speedMs?: number;
  hrBpm?: number;
}

export interface FitnessTestState {
  params: FitnessTestParams;
  phase: TestPhase;
  /** Temps actif depuis le premier point, pauses manuelles ôtées. */
  activeMs: number;
  lastTimeMs: number | null;
  /** Mesures récentes, en temps actif ; vidée après un trou. */
  window: WindowSample[];
  /** Vitesse de tout l'échauffement (somme pondérée et durée), repli de la vitesse de départ. */
  warmupSpeed: { sum: number; durMs: number };
  rampStartActiveMs: number | null;
  rampEndActiveMs: number | null;
  /** Indice du palier en cours. */
  step: number;
  /** Début du manque en cours (temps actif, heure de la position), `null` sans manque. */
  deficit: { activeMs: number; timeMs: number } | null;
  graceUntilMs: number;
  lastSignalMs: number;
  lastGoodMs: number | null;
  /** Dernier signal joué : pour la carte du direct. */
  lastSignal: { signal: TestSignal; timeMs: number } | null;
  test: SessionTest | null;
}

export const startFitnessTest = (params: FitnessTestParams): FitnessTestState => ({
  params,
  phase: 'attente',
  activeMs: 0,
  lastTimeMs: null,
  window: [],
  warmupSpeed: { sum: 0, durMs: 0 },
  rampStartActiveMs: null,
  rampEndActiveMs: null,
  step: 0,
  deficit: null,
  graceUntilMs: 0,
  lastSignalMs: -Infinity,
  lastGoodMs: null,
  lastSignal: null,
  test: null,
});

/**
 * Moyenne pondérée par le temps d'un champ sur les `windowS` dernières
 * secondes actives : chaque mesure vaut depuis la précédente. `null` si la
 * fenêtre n'en couvre pas la moitié (départ, reprise après un trou).
 */
const windowMean = (window: WindowSample[], field: 'speedMs' | 'hrBpm', windowS: number, nowMs: number): number | null => {
  const fromMs = nowMs - windowS * 1000;
  let sum = 0;
  let dur = 0;
  for (let i = window.length - 1; i > 0; i--) {
    const cur = window[i];
    const prevMs = window[i - 1].activeMs;
    if (cur.activeMs <= fromMs) break;
    const value = cur[field];
    if (value === undefined) continue;
    const w = cur.activeMs - Math.max(prevMs, fromMs);
    sum += value * w;
    dur += w;
  }
  return dur >= (windowS * 1000) / 2 ? sum / dur : null;
};

/** Signal de guidage, s'il respecte les écarts : 10 s après tout signal, et 30 s entre deux « bien ». */
const allowed = (state: FitnessTestState, kind: 'bien' | 'trop' | 'accelere'): boolean => {
  const { protocol } = state.params;
  if (state.activeMs < state.graceUntilMs) return false;
  if (state.activeMs - state.lastSignalMs < protocol.correctionGapS * 1000) return false;
  return kind !== 'bien' || state.lastGoodMs === null || state.activeMs - state.lastGoodMs >= protocol.goodGapS * 1000;
};

/** Écart d'une valeur à sa cible, en signal : au-dessus, en dessous ou dans la tolérance. */
const verdict = (value: number, target: number, tolerance: number): 'bien' | 'trop' | 'accelere' =>
  value > target + tolerance ? 'trop' : value < target - tolerance ? 'accelere' : 'bien';

/** Range un signal dans l'état (mutable : appelé sur une copie). */
const emit = (state: FitnessTestState, signal: TestSignal, timeMs: number): TestSignal => {
  state.lastSignalMs = state.activeMs;
  if (signal === 'bien') state.lastGoodMs = state.activeMs;
  state.lastSignal = { signal, timeMs };
  if (state.test) state.test.signals.push({ t: timeMs, s: signal });
  return signal;
};

/** Copie de travail : l'état rendu ne partage rien de modifiable avec celui reçu. */
const copyState = (state: FitnessTestState): FitnessTestState => ({
  ...state,
  window: state.window.slice(),
  warmupSpeed: { ...state.warmupSpeed },
  test: state.test ? { ...state.test, steps: state.test.steps.slice(), signals: state.test.signals.slice() } : null,
});

const newTest = (params: FitnessTestParams, startMs: number): SessionTest => ({
  protocol: params.protocol.id,
  version: params.protocol.version,
  settings: {
    warmupS: params.warmupS, warmupPct: params.warmupPct, age: params.age, ageSource: params.ageSource,
    targetBpm: params.targetBpm, bandBpm: params.protocol.hrBandBpm,
  },
  startMs,
  rampStartMs: null,
  v0Ms: null,
  steps: [],
  rampEndMs: null,
  dropMs: null,
  endReason: null,
  endMs: null,
  signals: [],
});

/** Vitesse cible du palier en cours. */
export const stepTargetMs = (state: FitnessTestState): number | null => {
  const v0 = state.test?.v0Ms ?? null;
  return v0 === null ? null : v0 + state.step * state.params.protocol.stepMs;
};

/** Vitesse de départ de la rampe : la fin de l'échauffement, sinon tout l'échauffement, sinon le repli ; arrondie. */
const startSpeedMs = (state: FitnessTestState): number => {
  const { protocol } = state.params;
  const last = windowMean(state.window, 'speedMs', protocol.startWindowS, state.activeMs);
  const raw = last ?? (state.warmupSpeed.durMs > 0 ? state.warmupSpeed.sum / state.warmupSpeed.durMs : protocol.fallbackStartMs);
  return Math.max(1, Math.round(raw / protocol.startRoundMs)) * protocol.startRoundMs;
};

/**
 * Une position de plus. `resumed` : l'enregistrement sort d'une pause
 * manuelle depuis la position précédente ; le temps de la pause ne compte
 * pas, et une grâce s'ouvre. Rend le nouvel état et le signal à jouer.
 */
export const stepFitnessTest = (
  previous: FitnessTestState,
  sample: TestSample,
  options: { resumed?: boolean } = {}
): { state: FitnessTestState; signal: TestSignal | null } => {
  if (previous.phase === 'fini') return { state: previous, signal: null };
  if (previous.lastTimeMs !== null && sample.timeMs <= previous.lastTimeMs) return { state: previous, signal: null };
  const state = copyState(previous);
  const { protocol } = state.params;
  const { timeMs } = sample;

  // Premier point : l'échauffement commence.
  if (state.lastTimeMs === null) {
    state.lastTimeMs = timeMs;
    state.phase = 'echauffement';
    state.test = newTest(state.params, timeMs);
    state.window.push({ activeMs: 0, speedMs: sample.speedMs, hrBpm: sample.hrBpm });
    state.graceUntilMs = protocol.warmupGraceS * 1000;
    return { state, signal: emit(state, 'debut', timeMs) };
  }

  const dtMs = timeMs - state.lastTimeMs;
  state.lastTimeMs = timeMs;
  if (options.resumed) {
    // Pause manuelle : son temps ne compte pas ; la mesure repart, une grâce s'ouvre.
    state.window = [];
    state.deficit = null;
    state.graceUntilMs = Math.max(state.graceUntilMs, state.activeMs + protocol.stepGraceS * 1000);
  } else {
    state.activeMs += dtMs;
    if (dtMs > protocol.fixGapS * 1000) {
      // Trou sans position : la mesure repart de zéro.
      state.window = [];
      state.deficit = null;
    } else if (state.phase === 'echauffement' && sample.speedMs !== undefined) {
      state.warmupSpeed.sum += sample.speedMs * dtMs;
      state.warmupSpeed.durMs += dtMs;
    }
  }
  state.window.push({ activeMs: state.activeMs, speedMs: sample.speedMs, hrBpm: sample.hrBpm });
  const keepMs = Math.max(protocol.smoothS, protocol.startWindowS) * 1000 + protocol.fixGapS * 1000;
  while (state.window.length > 2 && state.window[1].activeMs < state.activeMs - keepMs) state.window.shift();
  const test = state.test!;

  if (state.phase === 'echauffement') {
    if (state.activeMs >= state.params.warmupS * 1000) {
      const v0 = startSpeedMs(state);
      state.phase = 'rampe';
      state.rampStartActiveMs = state.activeMs;
      state.step = 0;
      test.rampStartMs = timeMs;
      test.v0Ms = v0;
      test.steps.push({ startMs: timeMs, targetMs: v0 });
      state.graceUntilMs = state.activeMs + protocol.stepGraceS * 1000;
      return { state, signal: emit(state, 'palier', timeMs) };
    }
    const hr = windowMean(state.window, 'hrBpm', protocol.smoothS, state.activeMs);
    if (hr === null) return { state, signal: null };
    const kind = verdict(hr, state.params.targetBpm, protocol.hrBandBpm);
    return { state, signal: allowed(state, kind) ? emit(state, kind, timeMs) : null };
  }

  if (state.phase === 'rampe') {
    const speed = windowMean(state.window, 'speedMs', protocol.smoothS, state.activeMs);
    const target = stepTargetMs(state)!;
    // Manque : une vitesse lissée tenue sous la cible ; pendant la grâce, un manque en cours continue, aucun ne commence.
    if (speed === null || speed >= target - protocol.failDeficitMs) state.deficit = null;
    else if (state.deficit === null && state.activeMs >= state.graceUntilMs) state.deficit = { activeMs: state.activeMs, timeMs };
    if (state.deficit !== null && state.activeMs - state.deficit.activeMs >= protocol.failS * 1000) {
      endRamp(state, timeMs, 'auto', state.deficit.timeMs);
      return { state, signal: emit(state, 'finRampe', timeMs) };
    }
    const step = Math.floor((state.activeMs - state.rampStartActiveMs!) / (protocol.stepS * 1000));
    if (step > state.step) {
      state.step = step;
      test.steps.push({ startMs: timeMs, targetMs: stepTargetMs(state)! });
      state.graceUntilMs = state.activeMs + protocol.stepGraceS * 1000;
      return { state, signal: emit(state, 'palier', timeMs) };
    }
    if (speed === null) return { state, signal: null };
    const kind = verdict(speed, target, protocol.speedToleranceMs);
    return { state, signal: allowed(state, kind) ? emit(state, kind, timeMs) : null };
  }

  if (state.phase === 'recuperation' && state.activeMs - state.rampEndActiveMs! >= protocol.recoveryS * 1000) {
    state.phase = 'fini';
    test.endMs = timeMs;
    return { state, signal: emit(state, 'finTest', timeMs) };
  }
  return { state, signal: null };
};

/** Fin de la rampe (mutable : appelé sur une copie). */
const endRamp = (state: FitnessTestState, timeMs: number, reason: TestEndReason, dropMs: number) => {
  state.phase = 'recuperation';
  state.rampEndActiveMs = state.activeMs;
  state.deficit = null;
  state.graceUntilMs = Infinity;
  const test = state.test!;
  test.rampEndMs = timeMs;
  test.dropMs = dropMs;
  test.endReason = reason;
};

/** « Finir la rampe », à l'heure de la dernière position ; sans effet hors de la rampe. */
export const finishRamp = (previous: FitnessTestState): { state: FitnessTestState; signal: TestSignal | null } => {
  if (previous.phase !== 'rampe' || previous.lastTimeMs === null) return { state: previous, signal: null };
  const state = copyState(previous);
  const timeMs = previous.lastTimeMs;
  endRamp(state, timeMs, 'manuel', timeMs);
  return { state, signal: emit(state, 'finRampe', timeMs) };
};

/**
 * Test interrompu (arrêt de l'enregistrement, autre activité) : une rampe en
 * cours finit à la dernière position, raison « arret ». Rend le test à ranger,
 * `null` s'il n'a pas commencé.
 */
export const closeFitnessTest = (state: FitnessTestState): SessionTest | null => {
  if (!state.test) return null;
  if (state.phase !== 'rampe' || state.lastTimeMs === null) return state.test;
  return { ...state.test, rampEndMs: state.lastTimeMs, dropMs: state.lastTimeMs, endReason: 'arret' };
};

/** Temps restant de la phase en cours, en secondes ; `null` hors d'une phase minutée. */
export const phaseRemainingS = (state: FitnessTestState): number | null => {
  const { protocol } = state.params;
  if (state.phase === 'echauffement') return Math.max(0, state.params.warmupS - state.activeMs / 1000);
  if (state.phase === 'rampe' && state.rampStartActiveMs !== null) {
    const inStepMs = (state.activeMs - state.rampStartActiveMs) % (protocol.stepS * 1000);
    return Math.max(0, protocol.stepS - inStepMs / 1000);
  }
  if (state.phase === 'recuperation' && state.rampEndActiveMs !== null) {
    return Math.max(0, protocol.recoveryS - (state.activeMs - state.rampEndActiveMs) / 1000);
  }
  return null;
};

/** Valeurs lissées que lit le guidage, pour la carte du direct. */
export const guideReadings = (state: FitnessTestState): { speedMs: number | null; hrBpm: number | null } => ({
  speedMs: windowMean(state.window, 'speedMs', state.params.protocol.smoothS, state.activeMs),
  hrBpm: windowMean(state.window, 'hrBpm', state.params.protocol.smoothS, state.activeMs),
});

// --- Sons ---

/** Écart entre les débuts de deux bips courts d'un même signal : assez serré pour qu'on les compte. */
const SHORT_SPACING_MS = 350;
/** Écart entre les débuts des sons de la fin de rampe, comme la fin de séance du compteur. */
const END_SPACING_MS = 1000;

const shorts = (n: number): ClockTone[] => Array.from({ length: n }, (_, i) => ({ delayMs: i * SHORT_SPACING_MS, tone: 'court' as const }));

export const TEST_SIGNAL_TONES: Record<TestSignal, ClockTone[]> = {
  debut: shorts(1),
  bien: shorts(1),
  trop: shorts(2),
  accelere: shorts(3),
  palier: [{ delayMs: 0, tone: 'long' }],
  finRampe: [{ delayMs: 0, tone: 'court' }, { delayMs: END_SPACING_MS, tone: 'long' }, { delayMs: 2 * END_SPACING_MS, tone: 'final' }],
  finTest: [{ delayMs: 0, tone: 'long' }],
};

// --- Plan, pour le graphique du protocole ---

export interface TestPlanPoint {
  tS: number;
  /** Vitesse cible, `null` hors de la rampe. */
  targetMs: number | null;
  /** FC d'exemple, pour l'allure de la courbe. */
  hrBpm: number;
}

export interface TestPlan {
  points: TestPlanPoint[];
  phases: { phase: 'echauffement' | 'rampe' | 'recuperation'; startS: number; endS: number }[];
  /** Bande de FC de l'échauffement. */
  hrBand: { lowBpm: number; highBpm: number };
  beeps: { tS: number; signal: TestSignal }[];
}

/** FC d'exemple au repos, au départ du graphique. */
const EXAMPLE_REST_BPM = 70;
/** Baisse d'exemple de la FC après la rampe : à 1 min, puis à 2 min. */
const EXAMPLE_DROP_BPM = [25, 40];
/** Pas des points du plan. */
const PLAN_STEP_S = 5;

/**
 * Déroulé prévu d'un test, pour un départ et un nombre de paliers d'exemple :
 * vitesse cible en marches, FC d'exemple (montée vers la cible, rampe jusqu'à
 * la FC max de référence, baisse en récupération), phases et bips.
 */
export const testPlan = (params: FitnessTestParams, example: { v0Ms: number; steps: number }): TestPlan => {
  const { protocol, warmupS, targetBpm, hrMaxRefBpm } = params;
  const rampS = example.steps * protocol.stepS;
  const rampEndS = warmupS + rampS;
  const endS = rampEndS + protocol.recoveryS;
  const hrAt = (t: number): number => {
    if (t <= warmupS) return Math.min(targetBpm, EXAMPLE_REST_BPM + ((targetBpm - EXAMPLE_REST_BPM) * t) / 90);
    if (t <= rampEndS) return targetBpm + ((hrMaxRefBpm - targetBpm) * (t - warmupS)) / rampS;
    const r = t - rampEndS;
    const drop = r <= 60 ? (EXAMPLE_DROP_BPM[0] * r) / 60 : EXAMPLE_DROP_BPM[0] + ((EXAMPLE_DROP_BPM[1] - EXAMPLE_DROP_BPM[0]) * (r - 60)) / 60;
    return hrMaxRefBpm - drop;
  };
  const targetAt = (t: number): number | null => {
    if (t < warmupS || t >= rampEndS) return null;
    return example.v0Ms + Math.floor((t - warmupS) / protocol.stepS) * protocol.stepMs;
  };
  const points: TestPlanPoint[] = [];
  for (let t = 0; t <= endS; t += PLAN_STEP_S) points.push({ tS: t, targetMs: targetAt(t), hrBpm: Math.round(hrAt(t)) });
  // Dernière marche tenue jusqu'au bout de la rampe.
  points.push({ tS: rampEndS, targetMs: example.v0Ms + (example.steps - 1) * protocol.stepMs, hrBpm: Math.round(hrAt(rampEndS)) });
  points.sort((a, b) => a.tS - b.tS || (a.targetMs === null ? 1 : -1));
  const beeps: TestPlan['beeps'] = [{ tS: 0, signal: 'debut' }];
  for (let k = 0; k < example.steps; k++) beeps.push({ tS: warmupS + k * protocol.stepS, signal: 'palier' });
  beeps.push({ tS: rampEndS, signal: 'finRampe' }, { tS: endS, signal: 'finTest' });
  return {
    points,
    phases: [
      { phase: 'echauffement', startS: 0, endS: warmupS },
      { phase: 'rampe', startS: warmupS, endS: rampEndS },
      { phase: 'recuperation', startS: rampEndS, endS },
    ],
    hrBand: { lowBpm: targetBpm - protocol.hrBandBpm, highBpm: targetBpm + protocol.hrBandBpm },
    beeps,
  };
};
