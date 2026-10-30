import { bandIndex } from '../core/basics';
import { windowMean, type WindowSample } from './fitnessTest';

/**
 * Bips de sortie de zone cardiaque pendant un enregistrement (lot 28) : la
 * zone visée est choisie sur Enregistrer, avant de partir, avec une ceinture
 * connectée. Machine d'état pure, sans horloge ni son : chaque mesure de la
 * ceinture la fait avancer et elle rend le signal à jouer.
 *
 * Hors de la zone visée (FC lissée sur `smoothS`) depuis `firstDelayS`
 * d'affilée : un premier signal, deux bips brefs trop haut (`trop`), trois
 * trop bas (`accelere`) ; un deuxième `secondDelayS` après, puis
 * `repeatCount` rappels toutes les `repeatEveryS`, chaque délai compté depuis
 * le signal réellement joué ; ensuite silence tant qu'on reste dehors. Au
 * retour dans la zone, après au moins un signal, un « ok » (`bien`), une
 * fois. Deux signaux sont toujours séparés d'au moins `minGapS`.
 *
 * Une FC absente (ceinture sans contact), une pause ou un trou de mesure
 * plus long que `gapS` font oublier la sortie en cours : rien ne sonne, le
 * compte repart de zéro à la reprise. Un changement de côté (trop haut puis
 * trop bas) repart aussi de zéro.
 */

/** Zone visée : 1 à 5, 0 pour aucune. */
export type ZoneTarget = 0 | 1 | 2 | 3 | 4 | 5;

export const ZONE_TARGETS: readonly ZoneTarget[] = [0, 1, 2, 3, 4, 5];

/** Signal de zone : les sons du test guidé (`TEST_SIGNAL_TONES`). */
export type ZoneSignal = 'trop' | 'accelere' | 'bien';

/** Délais des signaux, en secondes. */
export interface ZoneAlertDelays {
  /** Temps hors zone avant le premier signal. */
  firstDelayS: number;
  /** Écart entre le premier et le deuxième signal. */
  secondDelayS: number;
  /** Écart entre deux rappels, après le deuxième signal. */
  repeatEveryS: number;
  /** Nombre de rappels après le deuxième signal ; ensuite silence. */
  repeatCount: number;
  /** Écart minimal entre deux signaux de zone, « ok » compris. */
  minGapS: number;
}

export const ZONE_ALERT_DEFAULTS: ZoneAlertDelays = { firstDelayS: 10, secondDelayS: 40, repeatEveryS: 60, repeatCount: 3, minGapS: 3 };

export interface ZoneAlertParams extends ZoneAlertDelays {
  /** Lissage de la FC, en secondes (profil du calcul, `heartRate.smoothS`). */
  smoothS: number;
  /** Intervalle sans mesure au-delà duquel la sortie est oubliée, en secondes (`heartRate.gapS`). */
  gapS: number;
}

/** Paramètres des bips : lissage et trou du profil cardio du calcul, délais par défaut, surchargeables. */
export const zoneAlertParams = (heartRate: { smoothS: number; gapS: number }, overrides: Partial<ZoneAlertParams> = {}): ZoneAlertParams => ({
  ...ZONE_ALERT_DEFAULTS,
  smoothS: heartRate.smoothS,
  gapS: heartRate.gapS,
  ...overrides,
});

type Side = 'haut' | 'bas';

/** Sortie de zone en cours. */
interface ZoneExit {
  side: Side;
  /** Heure à laquelle la FC lissée est sortie de ce côté. */
  sinceMs: number;
  /** Signaux joués pendant cette sortie. */
  count: number;
  /** Heure du dernier signal de cette sortie, `null` avant le premier. */
  lastMs: number | null;
}

export interface ZoneAlertState {
  /** Mesures récentes (heure de la mesure dans `activeMs`), vidée à chaque oubli. */
  window: WindowSample[];
  lastTimeMs: number | null;
  exit: ZoneExit | null;
  /** Un « ok » est dû : retour dans la zone après au moins un signal. */
  owesGood: boolean;
  /** Heure du dernier signal joué, toutes sorties confondues. */
  lastSignalMs: number;
}

export const startZoneAlert = (): ZoneAlertState => ({ window: [], lastTimeMs: null, exit: null, owesGood: false, lastSignalMs: -Infinity });

/** Une mesure de la ceinture : son heure, la FC lisible (`null` sans contact), vrai si l'enregistrement tourne (ni pause ni départ). */
export interface ZoneAlertSample {
  timeMs: number;
  bpm: number | null;
  active: boolean;
}

export interface ZoneAlertSetup {
  /** Bornes croissantes des zones 1 à 5 (`readHeartRateZoneBounds`). */
  bounds: readonly number[];
  target: ZoneTarget;
  params: ZoneAlertParams;
}

/** Délai attendu avant le prochain signal de la sortie, en ms ; `null` une fois les rappels épuisés. */
const nextDueMs = (exit: ZoneExit, params: ZoneAlertParams): number | null => {
  if (exit.count === 0) return exit.sinceMs + params.firstDelayS * 1000;
  if (exit.lastMs === null) return null;
  if (exit.count === 1) return exit.lastMs + params.secondDelayS * 1000;
  if (exit.count < 2 + params.repeatCount) return exit.lastMs + params.repeatEveryS * 1000;
  return null;
};

/** Avance d'une mesure : nouvel état et signal à jouer, s'il y en a un. */
export const stepZoneAlert = (
  state: ZoneAlertState,
  sample: ZoneAlertSample,
  setup: ZoneAlertSetup
): { state: ZoneAlertState; signal: ZoneSignal | null } => {
  const { timeMs, bpm, active } = sample;
  const { params } = setup;
  if (state.lastTimeMs !== null && timeMs <= state.lastTimeMs) return { state, signal: null };
  if (setup.target === 0) return { state, signal: null };

  // Pause, FC absente ou trou : la sortie en cours est oubliée.
  const gap = state.lastTimeMs !== null && timeMs - state.lastTimeMs > params.gapS * 1000;
  if (!active || bpm === null) {
    return { state: { ...startZoneAlert(), lastSignalMs: state.lastSignalMs }, signal: null };
  }
  const base: ZoneAlertState = gap ? { ...startZoneAlert(), lastSignalMs: state.lastSignalMs } : state;

  // Fenêtre glissante en temps : la mesure la plus ancienne gardée borne la première tranche.
  const fromMs = timeMs - params.smoothS * 1000;
  const window = [...base.window, { activeMs: timeMs, hrBpm: bpm }];
  while (window.length > 1 && window[1].activeMs <= fromMs) window.shift();
  const next: ZoneAlertState = { ...base, window, lastTimeMs: timeMs };

  const smoothed = windowMean(window, 'hrBpm', params.smoothS, timeMs);
  if (smoothed === null) return { state: next, signal: null };

  const zone = bandIndex(Math.round(smoothed), setup.bounds);
  const side: Side | null = zone > setup.target ? 'haut' : zone < setup.target ? 'bas' : null;
  const gapOk = timeMs - next.lastSignalMs >= params.minGapS * 1000;

  if (side === null) {
    const owesGood = next.owesGood || (next.exit !== null && next.exit.count > 0);
    if (owesGood && gapOk) return { state: { ...next, exit: null, owesGood: false, lastSignalMs: timeMs }, signal: 'bien' };
    return { state: { ...next, exit: null, owesGood }, signal: null };
  }

  const exit: ZoneExit = next.exit !== null && next.exit.side === side ? next.exit : { side, sinceMs: timeMs, count: 0, lastMs: null };
  const due = nextDueMs(exit, params);
  if (due !== null && timeMs >= due && gapOk) {
    return {
      state: { ...next, exit: { ...exit, count: exit.count + 1, lastMs: timeMs }, owesGood: false, lastSignalMs: timeMs },
      signal: side === 'haut' ? 'trop' : 'accelere',
    };
  }
  return { state: { ...next, exit, owesGood: false }, signal: null };
};
