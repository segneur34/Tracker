import { haversineDistance } from '../core/geo';
import { heartRateZones, type HeartRateAthlete, type HeartRateZoneModel, type HeartRateZones, type ZoneMethod } from '../core/heartRate';
import { kmhToMs } from '../core/units';
import { windowMean, type WindowSample } from '../core/windowMean';
import type { LocationFix } from '../platform/location';
import { finiteOr, isFiniteNumber } from '../core/basics';
import type { TestSignal } from './signalTones';

/**
 * Tests guidés par bips (Entraînement › Tests, 24/10), d'abord la FC max :
 * un échauffement dans une bande de FC, une rampe de +0,6 km/h par minute tenue
 * jusqu'à ce qu'on lâche, puis une récupération mesurée.
 *
 * Le test avance à chaque position, sur l'heure des positions (le rejeu le
 * fait donc tourner à sa vitesse), pauses manuelles ôtées : son temps est le
 * « temps actif », en millisecondes depuis le premier point. L'échauffement
 * se guide sur la FC lissée, croisée avec la tendance de la vitesse (la FC
 * répond avec 30 à 60 s de retard : on ne dit pas de ralentir à qui ralentit
 * déjà), la rampe sur la vitesse GPS lissée. Les moyennes sont pondérées par
 * le temps (chaque mesure vaut depuis la précédente) : une trace à 1 Hz et à
 * 5 Hz donnent les mêmes signaux.
 *
 * Signaux (réponses de l'utilisateur, 24/10) : 1 bip court = bien, 2 = trop
 * vite, 3 = accélère ; un bip long au début de la rampe et à chaque palier ;
 * corrections espacées de 10 s au moins, « bien » de 30 s ; la même correction
 * trois fois de suite, les suivantes de 30 s. Échauffement en zones 2 à 3 du
 * cardio, plafonné (155 bpm par défaut, réglable).
 *
 * Protocole v2 (31/10, lot 85) : l'athlète est supposé se donner à fond. Sur
 * la rampe, « trop vite » ne vient qu'à 1 km/h au-dessus de la cible pendant
 * 20 s (ne pas monter la rampe trop vite) ; la fin automatique n'est décidée
 * que sur un effondrement net et durable de la vitesse (20 % sous la cible
 * pendant 30 s, ou 50 % pendant 10 s), jamais sur un virage ou un bout de terrain.
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
  /** Bande de FC de l'échauffement : du bas de la zone `from` au haut de la zone `to`, zones du cardio de Pratiquant. */
  warmupZones: { from: number; to: number };
  /** Plafond de la bande d'échauffement par défaut, réglable : son haut n'en passe pas. */
  warmupCeilingBpm: number;
  /** Largeur minimale de la bande sous le plafond : son bas est repoussé d'autant sous lui au besoin. */
  warmupMinBandBpm: number;
  /** Tendance de la vitesse à l'échauffement : moyenne de ces dernières secondes… */
  warmupTrendRecentS: number;
  /** … moins celle de ces secondes d'avant. */
  warmupTrendBeforeS: number;
  /** Une correction d'échauffement se tait si la vitesse va déjà dans son sens d'au moins tant, en m/s. */
  warmupTrendMs: number;
  /** Âge pris sans année de naissance dans Pratiquant, pour estimer la FC max des zones. */
  defaultAge: number;
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
  /** « Trop vite » sur la rampe : vitesse lissée au-dessus de la cible d'au moins tant (m/s)… */
  rampTooFastMs: number;
  /** … pendant tant de secondes. */
  rampTooFastS: number;
  /** Fin automatique de la rampe : vitesse lissée sous la cible d'au moins cette part, pendant tant de secondes ; la première règle tenue la finit. */
  collapseRules: readonly { deficitRatio: number; holdS: number }[];
  /** Sans correction après un palier, une reprise ou le départ de la rampe. */
  stepGraceS: number;
  /** Récupération mesurée après la rampe. */
  recoveryS: number;
  /** Écart minimal entre une correction et le signal précédent. */
  correctionGapS: number;
  /** Écart minimal entre deux « bien ». */
  goodGapS: number;
  /** Après tant de fois de suite la même correction… */
  repeatCount: number;
  /** … les suivantes s'espacent d'autant. */
  repeatGapS: number;
  /** Au-delà de ce trou entre deux positions, la mesure repart de zéro (aucun signal tant qu'elle n'est pas refaite). */
  fixGapS: number;
  /** Écart maximal entre deux positions pour tirer la vitesse de leur distance, faute de celle du GPS. */
  derivedSpeedMaxGapS: number;
  /** Lissage de la FC des résultats (pic). */
  resultHrSmoothS: number;
  /** FC de récupération lue tant de secondes après la fin de la rampe. */
  recoveryReadS: number;
}

export const FITNESS_TESTS: Record<FitnessTestId, FitnessTestProtocol> = {
  'fc-max': {
    id: 'fc-max',
    label: 'FC max',
    version: 2,
    warmupS: 480,
    warmupZones: { from: 2, to: 3 },
    warmupCeilingBpm: 155,
    warmupMinBandBpm: 10,
    warmupTrendRecentS: 20,
    warmupTrendBeforeS: 30,
    warmupTrendMs: kmhToMs(0.5),
    defaultAge: 35,
    warmupGraceS: 30,
    stepS: 60,
    stepMs: kmhToMs(0.6),
    startWindowS: 60,
    startRoundMs: kmhToMs(0.5),
    fallbackStartMs: kmhToMs(8),
    smoothS: 10,
    speedToleranceMs: kmhToMs(0.3),
    rampTooFastMs: kmhToMs(1),
    rampTooFastS: 20,
    collapseRules: [{ deficitRatio: 0.2, holdS: 30 }, { deficitRatio: 0.5, holdS: 10 }],
    stepGraceS: 10,
    recoveryS: 120,
    correctionGapS: 10,
    goodGapS: 30,
    repeatCount: 3,
    repeatGapS: 30,
    fixGapS: 5,
    derivedSpeedMaxGapS: 5,
    resultHrSmoothS: 5,
    recoveryReadS: 60,
  },
};

/**
 * Vitesse d'une position pour le guidage : celle du GPS, sinon celle tirée de
 * la position précédente, si elle date de `maxGapS` secondes au plus (et
 * qu'elle est plus ancienne) ; `undefined` sinon.
 */
export const fixSpeedMs = (fix: LocationFix, previous: LocationFix | null, maxGapS: number): number | undefined => {
  if (fix.speedMs !== undefined) return fix.speedMs;
  if (!previous) return undefined;
  const dtMs = fix.timeMs - previous.timeMs;
  if (dtMs <= 0 || dtMs > maxGapS * 1000) return undefined;
  return haversineDistance(previous.lat, previous.lon, fix.lat, fix.lon) / (dtMs / 1000);
};

/** Réglages de l'utilisateur, avant « Lancer ». */
export interface FitnessTestSettings {
  warmupS: number;
  warmupCeilingBpm: number;
}

export const FITNESS_TEST_LIMITS = {
  warmupS: { min: 180, max: 1200, step: 60 },
  warmupCeilingBpm: { min: 120, max: 180, step: 5 },
} as const;

const inRange = (value: unknown, { min, max }: { min: number; max: number }): value is number =>
  typeof value === 'number' && isFinite(value) && value >= min - 1e-9 && value <= max + 1e-9;

/** Réglages rangés, valeurs hors bornes remplacées par celles du protocole. */
export const sanitizeFitnessTestSettings = (raw: unknown, protocol: FitnessTestProtocol): FitnessTestSettings => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    warmupS: inRange(r.warmupS, FITNESS_TEST_LIMITS.warmupS) ? Math.round(r.warmupS) : protocol.warmupS,
    warmupCeilingBpm: inRange(r.warmupCeilingBpm, FITNESS_TEST_LIMITS.warmupCeilingBpm) ? Math.round(r.warmupCeilingBpm) : protocol.warmupCeilingBpm,
  };
};

export type AgeSource = 'profil' | 'defaut';

/** Ce que le test lit de Pratiquant : âge, FC et seuils du cardio, et le modèle des zones et le décalage de l'activité de test. */
export interface TestRunner {
  athlete: HeartRateAthlete;
  age: number | null;
  zoneModel: HeartRateZoneModel;
  offsetBpm: number;
}

/** Ce qu'il faut pour guider un test : le protocole, les réglages et la bande tirée des zones du cardio. */
export interface FitnessTestParams {
  protocol: FitnessTestProtocol;
  warmupS: number;
  age: number;
  ageSource: AgeSource;
  /** Zones du cardio, FC max estimée par l'âge (celui par défaut au besoin) si elle n'est pas saisie. */
  zones: HeartRateZones;
  /** FC max de référence : celle des zones. */
  hrMaxRefBpm: number;
  /** Plafond de la bande d'échauffement. */
  warmupCeilingBpm: number;
  /** Bande de FC de l'échauffement, coupée au plafond. */
  warmupLowBpm: number;
  warmupHighBpm: number;
}

/** Âge admis pour la FC max de référence. */
const isUsableAge = (age: number | null): age is number => age !== null && isFinite(age) && age >= 8 && age <= 100;

export const resolveFitnessTestParams = (
  protocol: FitnessTestProtocol,
  settings: FitnessTestSettings,
  runner: TestRunner
): FitnessTestParams => {
  const { age } = runner;
  const usable = isUsableAge(age);
  const used = usable ? age : protocol.defaultAge;
  // Toujours des zones : l'âge (au besoin celui par défaut) donne une FC max.
  const zones = heartRateZones(runner.athlete, used, runner.zoneModel, runner.offsetBpm)!;
  const { from, to } = protocol.warmupZones;
  const ceiling = settings.warmupCeilingBpm;
  return {
    protocol,
    warmupS: settings.warmupS,
    age: used,
    ageSource: usable ? 'profil' : 'defaut',
    zones,
    hrMaxRefBpm: zones.hrMax!,
    warmupCeilingBpm: ceiling,
    // Haut coupé au plafond ; bas repoussé sous lui s'il le faut, pour garder une bande.
    warmupLowBpm: Math.min(zones.bounds[from - 1], ceiling - protocol.warmupMinBandBpm),
    warmupHighBpm: Math.min(zones.bounds[to], ceiling),
  };
};

// --- Fiche ---

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

/** Fin de la rampe : vitesse effondrée sous la cible, « Finir la rampe », ou enregistrement arrêté (ou activité changée) avant. */
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
  /** Bande de l'échauffement, et d'où viennent les zones. */
  settings: { warmupS: number; age: number; ageSource: AgeSource; lowBpm: number; highBpm: number; zoneMethod: ZoneMethod };
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

/** Test d'une fiche ou d'un journal ; `null` s'il est mal formé. */
export const readSessionTest = (raw: unknown): SessionTest | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isFitnessTestId(r.protocol) || !isFiniteNumber(r.version) || !isFiniteNumber(r.startMs)) return null;
  const s = typeof r.settings === 'object' && r.settings !== null ? (r.settings as Record<string, unknown>) : null;
  if (!s || !isFiniteNumber(s.warmupS) || !isFiniteNumber(s.age) || !isFiniteNumber(s.lowBpm) || !isFiniteNumber(s.highBpm)) return null;
  const steps = Array.isArray(r.steps)
    ? r.steps.filter((x): x is TestStep => typeof x === 'object' && x !== null && isFiniteNumber((x as TestStep).startMs) && isFiniteNumber((x as TestStep).targetMs))
      .map(({ startMs, targetMs }) => ({ startMs, targetMs }))
    : [];
  const signals = Array.isArray(r.signals)
    ? r.signals.filter((x): x is { t: number; s: TestSignal } =>
      typeof x === 'object' && x !== null && isFiniteNumber((x as { t: unknown }).t) && TEST_SIGNALS.includes((x as { s: TestSignal }).s))
      .map(({ t, s: kind }) => ({ t, s: kind }))
    : [];
  const endReason = r.endReason === 'auto' || r.endReason === 'manuel' || r.endReason === 'arret' ? r.endReason : null;
  return {
    protocol: r.protocol,
    version: r.version,
    settings: {
      warmupS: s.warmupS, age: s.age, ageSource: s.ageSource === 'profil' ? 'profil' : 'defaut',
      lowBpm: s.lowBpm, highBpm: s.highBpm, zoneMethod: s.zoneMethod === 'saisis' || s.zoneMethod === 'perso' ? 'saisis' : s.zoneMethod === 'reserve' ? 'reserve' : 'max',
    },
    startMs: r.startMs,
    rampStartMs: finiteOr(r.rampStartMs, null),
    v0Ms: finiteOr(r.v0Ms, null),
    steps,
    rampEndMs: finiteOr(r.rampEndMs, null),
    dropMs: finiteOr(r.dropMs, null),
    endReason,
    endMs: finiteOr(r.endMs, null),
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
  /** Début du manque en cours de chaque règle d'effondrement (temps actif, heure de la position), `null` sans manque. */
  collapseSince: ({ activeMs: number; timeMs: number } | null)[];
  /** Début (temps actif) de l'avance sur la cible qui mène à « trop vite », `null` sans avance. */
  tooFastSince: number | null;
  graceUntilMs: number;
  lastSignalMs: number;
  lastGoodMs: number | null;
  /** Dernier signal émis et combien de fois de suite. */
  repeat: { signal: TestSignal | null; count: number };
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
  collapseSince: params.protocol.collapseRules.map(() => null),
  tooFastSince: null,
  graceUntilMs: 0,
  lastSignalMs: -Infinity,
  lastGoodMs: null,
  repeat: { signal: null, count: 0 },
  lastSignal: null,
  test: null,
});

/**
 * Tendance de la vitesse : moyenne des `recentS` dernières secondes moins
 * celle des `beforeS` d'avant ; `null` si l'une n'est pas couverte à moitié.
 */
export const speedTrendMs = (window: WindowSample[], recentS: number, beforeS: number, nowMs: number): number | null => {
  const recent = windowMean(window, 'speedMs', recentS, nowMs);
  const before = windowMean(window, 'speedMs', beforeS, nowMs, nowMs - recentS * 1000);
  return recent === null || before === null ? null : recent - before;
};

/**
 * Signal de guidage, s'il respecte les écarts : 10 s après tout signal, 30 s
 * entre deux « bien », et 30 s quand la même correction est déjà venue trois
 * fois de suite.
 */
const allowed = (state: FitnessTestState, kind: 'bien' | 'trop' | 'accelere'): boolean => {
  const { protocol } = state.params;
  if (state.activeMs < state.graceUntilMs) return false;
  const repeated = kind !== 'bien' && state.repeat.signal === kind && state.repeat.count >= protocol.repeatCount;
  const gapS = repeated ? protocol.repeatGapS : protocol.correctionGapS;
  if (state.activeMs - state.lastSignalMs < gapS * 1000) return false;
  return kind !== 'bien' || state.lastGoodMs === null || state.activeMs - state.lastGoodMs >= protocol.goodGapS * 1000;
};

/** Place d'une valeur par rapport à sa bande, en signal : au-dessus, en dessous ou dedans. */
const verdict = (value: number, low: number, high: number): 'bien' | 'trop' | 'accelere' =>
  value > high ? 'trop' : value < low ? 'accelere' : 'bien';

/** Range un signal dans l'état (mutable : appelé sur une copie). */
const emit = (state: FitnessTestState, signal: TestSignal, timeMs: number): TestSignal => {
  state.lastSignalMs = state.activeMs;
  if (signal === 'bien') state.lastGoodMs = state.activeMs;
  state.repeat = state.repeat.signal === signal ? { signal, count: state.repeat.count + 1 } : { signal, count: 1 };
  state.lastSignal = { signal, timeMs };
  if (state.test) state.test.signals.push({ t: timeMs, s: signal });
  return signal;
};

/** Copie de travail : l'état rendu ne partage rien de modifiable avec celui reçu. */
const copyState = (state: FitnessTestState): FitnessTestState => ({
  ...state,
  window: state.window.slice(),
  collapseSince: state.collapseSince.slice(),
  warmupSpeed: { ...state.warmupSpeed },
  test: state.test ? { ...state.test, steps: state.test.steps.slice(), signals: state.test.signals.slice() } : null,
});

const newTest = (params: FitnessTestParams, startMs: number): SessionTest => ({
  protocol: params.protocol.id,
  version: params.protocol.version,
  settings: {
    warmupS: params.warmupS, age: params.age, ageSource: params.ageSource,
    lowBpm: params.warmupLowBpm, highBpm: params.warmupHighBpm, zoneMethod: params.zones.method,
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
    resetRampCounts(state);
    state.graceUntilMs = Math.max(state.graceUntilMs, state.activeMs + protocol.stepGraceS * 1000);
  } else {
    state.activeMs += dtMs;
    if (dtMs > protocol.fixGapS * 1000) {
      // Trou sans position : la mesure repart de zéro.
      state.window = [];
      resetRampCounts(state);
    } else if (state.phase === 'echauffement' && sample.speedMs !== undefined) {
      state.warmupSpeed.sum += sample.speedMs * dtMs;
      state.warmupSpeed.durMs += dtMs;
    }
  }
  state.window.push({ activeMs: state.activeMs, speedMs: sample.speedMs, hrBpm: sample.hrBpm });
  const keepMs = Math.max(protocol.smoothS, protocol.startWindowS, protocol.warmupTrendRecentS + protocol.warmupTrendBeforeS) * 1000
    + protocol.fixGapS * 1000;
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
    const kind = verdict(hr, state.params.warmupLowBpm, state.params.warmupHighBpm);
    // La FC suit avec retard : une correction se tait si la vitesse va déjà dans son sens ; sans tendance mesurable, elle se dit.
    if (kind !== 'bien') {
      const trend = speedTrendMs(state.window, protocol.warmupTrendRecentS, protocol.warmupTrendBeforeS, state.activeMs);
      if (trend !== null && (kind === 'trop' ? trend <= -protocol.warmupTrendMs : trend >= protocol.warmupTrendMs)) return { state, signal: null };
    }
    return { state, signal: allowed(state, kind) ? emit(state, kind, timeMs) : null };
  }

  if (state.phase === 'rampe') {
    const speed = windowMean(state.window, 'speedMs', protocol.smoothS, state.activeMs);
    const target = stepTargetMs(state)!;
    const outOfGrace = state.activeMs >= state.graceUntilMs;
    // Effondrement : vitesse lissée tenue sous la cible d'une part de celle-ci, règle par règle ; pendant la grâce,
    // un manque en cours continue, aucun ne commence. Sur la cible du palier en cours, avant son changement.
    protocol.collapseRules.forEach((rule, i) => {
      if (speed === null || speed >= target * (1 - rule.deficitRatio)) state.collapseSince[i] = null;
      else if (state.collapseSince[i] === null && outOfGrace) state.collapseSince[i] = { activeMs: state.activeMs, timeMs };
    });
    const collapsed = protocol.collapseRules.some((rule, i) => {
      const since = state.collapseSince[i];
      return since !== null && state.activeMs - since.activeMs >= rule.holdS * 1000;
    });
    if (collapsed) {
      // Début du manque le plus ancien : celui de la règle la moins sévère.
      const dropMs = Math.min(...state.collapseSince.flatMap((x) => (x === null ? [] : [x.timeMs])));
      endRamp(state, timeMs, 'auto', dropMs);
      return { state, signal: emit(state, 'finRampe', timeMs) };
    }
    // Avance sur la cible, comptée comme le manque (même grâce, mêmes remises à zéro).
    if (speed === null || speed <= target + protocol.rampTooFastMs) state.tooFastSince = null;
    else if (state.tooFastSince === null && outOfGrace) state.tooFastSince = state.activeMs;
    const step = Math.floor((state.activeMs - state.rampStartActiveMs!) / (protocol.stepS * 1000));
    if (step > state.step) {
      state.step = step;
      test.steps.push({ startMs: timeMs, targetMs: stepTargetMs(state)! });
      state.graceUntilMs = state.activeMs + protocol.stepGraceS * 1000;
      return { state, signal: emit(state, 'palier', timeMs) };
    }
    if (speed === null) return { state, signal: null };
    const kind = rampVerdict(state, speed, target);
    return { state, signal: kind !== null && allowed(state, kind) ? emit(state, kind, timeMs) : null };
  }

  if (state.phase === 'recuperation' && state.activeMs - state.rampEndActiveMs! >= protocol.recoveryS * 1000) {
    state.phase = 'fini';
    test.endMs = timeMs;
    return { state, signal: emit(state, 'finTest', timeMs) };
  }
  return { state, signal: null };
};

/**
 * Signal de la rampe : sous la cible moins la tolérance, « accélère » ; en
 * avance tenue assez longtemps, « trop vite » ; à la cible, « bien » ; un peu
 * en avance, rien (ni « bien » à qui monte trop vite, ni frein).
 */
const rampVerdict = (state: FitnessTestState, speed: number, target: number): 'bien' | 'trop' | 'accelere' | null => {
  const { protocol } = state.params;
  if (speed < target - protocol.speedToleranceMs) return 'accelere';
  if (state.tooFastSince !== null && state.activeMs - state.tooFastSince >= protocol.rampTooFastS * 1000) return 'trop';
  return speed <= target + protocol.speedToleranceMs ? 'bien' : null;
};

/** Comptes de la rampe (manques, avance) remis à zéro : trou, reprise, fin (mutable : appelé sur une copie). */
const resetRampCounts = (state: FitnessTestState) => {
  state.collapseSince = state.collapseSince.map(() => null);
  state.tooFastSince = null;
};

/** Fin de la rampe (mutable : appelé sur une copie). */
const endRamp = (state: FitnessTestState, timeMs: number, reason: TestEndReason, dropMs: number) => {
  state.phase = 'recuperation';
  state.rampEndActiveMs = state.activeMs;
  resetRampCounts(state);
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
 * Rejoue en silence un test sur les positions déjà gardées, à la reprise après une chute du moteur de la page
 * (lot 156) ; `kept` est le test relu du journal : le rejeu part de son premier point et respecte « Finir la rampe »,
 * qu'aucune position ne dit. Entre deux segments, une reprise de pause. `previous` : la dernière position rejouée.
 */
export const replayFitnessTest = (
  params: FitnessTestParams,
  segments: ReadonlyArray<ReadonlyArray<LocationFix>>,
  kept: SessionTest
): { state: FitnessTestState; previous: LocationFix | null } => {
  let state = startFitnessTest(params);
  let previous: LocationFix | null = null;
  const manualEndMs = kept.endReason === 'manuel' ? kept.rampEndMs : null;
  for (const segment of segments) {
    let opening = true;
    for (const fix of segment) {
      if (fix.timeMs < kept.startMs) continue;
      if (manualEndMs !== null && fix.timeMs > manualEndMs) state = finishRamp(state).state;
      const speedMs = fixSpeedMs(fix, previous, params.protocol.derivedSpeedMaxGapS);
      state = stepFitnessTest(state, { timeMs: fix.timeMs, speedMs, hrBpm: fix.heartRateBpm }, { resumed: opening }).state;
      opening = false;
      previous = fix;
    }
  }
  return { state, previous };
};

/**
 * Test interrompu (arrêt de l'enregistrement, autre activité) : une rampe en
 * cours finit à la dernière position, raison « arret ». Rend le test à ranger,
 * `null` s'il n'a pas commencé.
 */
export const closeFitnessTest = (state: FitnessTestState): SessionTest | null =>
  state.test && state.lastTimeMs !== null ? closeSessionTest(state.test, state.lastTimeMs) : state.test;

/**
 * Test relu d'un journal (arrêt brutal) ou interrompu : une rampe commencée et
 * pas finie finit à `lastMs`, la dernière position, raison « arret ».
 */
export const closeSessionTest = (test: SessionTest, lastMs: number): SessionTest =>
  test.rampStartMs !== null && test.rampEndMs === null
    ? { ...test, rampEndMs: lastMs, dropMs: lastMs, endReason: 'arret' }
    : test;

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
  const { protocol, warmupS, hrMaxRefBpm, warmupLowBpm, warmupHighBpm } = params;
  // FC d'exemple de l'échauffement : le milieu de la bande.
  const targetBpm = Math.round((warmupLowBpm + warmupHighBpm) / 2);
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
    hrBand: { lowBpm: warmupLowBpm, highBpm: warmupHighBpm },
    beeps,
  };
};
