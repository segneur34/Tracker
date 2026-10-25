import type { ClockTone } from '../platform/beeper';

/**
 * Test de FC repos (Entraînement › Tests, 24/10) : 3 minutes immobile, la FC
 * lue sur la ceinture, sans GPS. Le résultat est la moyenne de 30 secondes la
 * plus basse après la première minute, le temps que le cœur se pose
 * (`running/restingHrResults.ts` ; 10 s sur les 3 minutes jusqu'au 25/10 : une
 * fenêtre si courte saisit le creux d'une expiration, plus bas que le repos).
 *
 * Le test ne passe pas par l'enregistreur : pas de position, donc ni pause
 * automatique (immobile, on y serait vite), ni trou de GPS, ni service. Il
 * avance à l'heure des mesures de la ceinture et à celle de l'horloge, jamais
 * en nombre de mesures (règle 2) : une ceinture à 1 Hz et à 5 Hz donne la même
 * chose. Pur : l'horloge et les mesures viennent du hook.
 */

export type RestingHrTestId = 'fc-repos';

/** Protocole d'un test de FC au repos, en secondes et en bpm. */
export interface RestingHrProtocol {
  id: RestingHrTestId;
  label: string;
  /** Version du protocole, rangée avec le résultat. */
  version: number;
  /** Temps de s'installer après « Démarrer », avant le bip de départ. */
  leadInS: number;
  /** Durée mesurée. */
  durationS: number;
  /** Début de la mesure écarté de la recherche : le cœur se pose. */
  settleS: number;
  /** Fenêtre de la moyenne la plus basse. */
  windowS: number;
  /** Part minimale d'une fenêtre couverte par des mesures pour qu'elle compte. */
  minWindowCoverage: number;
  /** Part minimale de la durée couverte pour dire le test complet. */
  minCoverage: number;
  /** Une mesure vaut jusqu'à tant de secondes après elle, faute d'une plus récente (ceinture sans contact : rien). */
  holdS: number;
  /** Mesures hors de cet intervalle ignorées (parasite de la ceinture). */
  minBpm: number;
  maxBpm: number;
}

export const RESTING_HR_TEST: RestingHrProtocol = {
  id: 'fc-repos',
  label: 'FC repos',
  version: 2,
  leadInS: 10,
  durationS: 180,
  settleS: 60,
  windowS: 30,
  minWindowCoverage: 0.7,
  minCoverage: 0.8,
  holdS: 5,
  minBpm: 25,
  maxBpm: 250,
};

/** Une mesure de la ceinture ; `bpm` nul : plus de contact avec la peau. */
export interface RestingSample {
  timeMs: number;
  bpm: number | null;
}

export type RestingPhase = 'preparation' | 'mesure' | 'fini';

export type RestingSignal = 'debut' | 'fin';

export interface RestingHrState {
  protocol: RestingHrProtocol;
  phase: RestingPhase;
  /** Instant du « Démarrer », à l'horloge. */
  pressedMs: number;
  /** Instant du bip de départ, début de la durée mesurée. */
  startMs: number;
  /** Mesures reçues depuis « Démarrer », celles de la préparation comprises (la dernière se prolonge sur le départ). */
  samples: RestingSample[];
}

export const startRestingTest = (nowMs: number, protocol: RestingHrProtocol = RESTING_HR_TEST): RestingHrState => ({
  protocol,
  phase: 'preparation',
  pressedMs: nowMs,
  startMs: nowMs + protocol.leadInS * 1000,
  samples: [],
});

/** Instant de la fin de la mesure. */
export const restingEndMs = (state: RestingHrState): number => state.startMs + state.protocol.durationS * 1000;

/**
 * Fait avancer le test à l'instant `nowMs`, avec une mesure s'il y en a une.
 * Rend le nouvel état et les signaux à jouer, dans l'ordre : l'écran verrouillé
 * peut ne rendre la main qu'après le départ, voire la fin.
 */
export const advanceRestingTest = (
  previous: RestingHrState,
  nowMs: number,
  sample?: RestingSample
): { state: RestingHrState; signals: RestingSignal[] } => {
  if (previous.phase === 'fini') return { state: previous, signals: [] };
  const state: RestingHrState = { ...previous, samples: sample ? [...previous.samples, sample] : previous.samples };
  const signals: RestingSignal[] = [];
  if (state.phase === 'preparation' && nowMs >= state.startMs) {
    state.phase = 'mesure';
    signals.push('debut');
  }
  if (state.phase === 'mesure' && nowMs >= restingEndMs(state)) {
    state.phase = 'fini';
    signals.push('fin');
  }
  return { state, signals };
};

/** Secondes restantes de la phase en cours (avant le départ, puis avant la fin) ; 0 une fois fini. */
export const restingRemainingS = (state: RestingHrState, nowMs: number): number => {
  if (state.phase === 'fini') return 0;
  const toMs = state.phase === 'preparation' ? state.startMs : restingEndMs(state);
  return Math.max(0, (toMs - nowMs) / 1000);
};

// --- Sons ---

/** Départ : un court. Fin : un long. Les mêmes sons que les tests guidés (`fitnessTest.ts`). */
export const RESTING_SIGNAL_TONES: Record<RestingSignal, ClockTone[]> = {
  debut: [{ delayMs: 0, tone: 'court' }],
  fin: [{ delayMs: 0, tone: 'long' }],
};

// --- Exemple, pour essayer le test sans ceinture (navigateur) ---

/**
 * FC d'exemple d'une personne qui se pose : elle redescend de 70 vers 56 bpm
 * en une minute et demie, avec un léger bruit déterministe (le banc la
 * rejoue à l'identique). `tS` : secondes depuis le départ.
 */
export const exampleRestingHr = (tS: number): number => {
  const settle = 56 + 14 * Math.exp(-tS / 30);
  const noise = 1.5 * Math.sin(tS * 1.7) + 1 * Math.sin(tS * 0.45 + 1);
  return Math.round(settle + noise);
};
