import type { RecordingProfile } from '../core/sportProfiles';

/**
 * Veille du GPS pendant un enregistrement (lot 115, décisions du 01/11) : le
 * GPS est dit perdu après `gpsLostDelayS` sans position (1 min), une seule
 * fois par perte, sans rappel ; une nouvelle perte n'est signalée qu'après le
 * retour du GPS pendant `gpsLostRearmS` (2 min) de positions sans trou d'au
 * moins `gpsLostDelayS`. Tout s'efface au retour d'une position.
 *
 * Machine pure, sur l'heure de réception (horloge du téléphone, la même que
 * le minuteur qui la sert) : l'enregistreur (`hooks/useRecorder.ts`) lui
 * passe chaque position, l'échéance du minuteur, la pause manuelle et la
 * reprise, et applique ce qu'elle rend : armer le minuteur pour un délai,
 * le désarmer, signaler la perte, l'effacer. Le minuteur lui-même est natif
 * (`platform/beeper.ts`) : écran éteint, ceux de la WebView ralentissent.
 *
 * Phases : `waiting` avant la première position (rien n'est armé : un GPS
 * qui ne trouve jamais sa position n'est pas « perdu ») ; `watching`, le
 * minuteur repoussé à chaque position ; `lost`, signalé, plus rien d'armé ;
 * `rearming`, revenu, rien d'armé ni de signalé jusqu'au réarmement.
 *
 * La veille de la ceinture (lot 177) est la même machine, sur une autre source :
 * chaque mesure lisible y tient lieu de position, avec ses propres délais
 * (`beltWatchSettings`). Une ceinture jamais jointe n'est donc pas « perdue ».
 */

export type GpsWatchPhase = 'waiting' | 'watching' | 'lost' | 'rearming';

export interface GpsWatchState {
  phase: GpsWatchPhase;
  /** Pause manuelle en cours : aucune veille. */
  paused: boolean;
  /** Réception de la dernière position, en ms ; `null` avant la première. */
  lastFixMs: number | null;
  /** Début du retour en cours (`rearming`), en ms ; `null` hors de cette phase. */
  returnedMs: number | null;
  /** Échéance du minuteur armé, en ms ; `null` sans minuteur. */
  deadlineMs: number | null;
}

/** Délais de la veille, en secondes (`RecordingProfile`). */
export type GpsWatchSettings = Pick<RecordingProfile, 'gpsLostDelayS' | 'gpsLostRearmS'>;

/** Ce que l'enregistreur doit faire après un événement. */
export interface GpsWatchStep {
  state: GpsWatchState;
  /** Armer (ou repousser) le minuteur pour ce délai, en ms ; `null` : ne pas y toucher. */
  armMs: number | null;
  /** Désarmer le minuteur. */
  disarm: boolean;
  /** Le GPS vient d'être perdu : alerte, notification (le son part du minuteur lui-même). */
  lost: boolean;
  /** L'alerte de perte est à effacer. */
  cleared: boolean;
}

/** Délais de la veille de la ceinture, dans les termes de la machine. */
export const beltWatchSettings = (recording: Pick<RecordingProfile, 'beltLostDelayS' | 'beltLostRearmS'>): GpsWatchSettings => ({
  gpsLostDelayS: recording.beltLostDelayS,
  gpsLostRearmS: recording.beltLostRearmS,
});

export const START_GPS_WATCH: GpsWatchState = { phase: 'waiting', paused: false, lastFixMs: null, returnedMs: null, deadlineMs: null };

/**
 * Vrai si l'enregistrement peut veiller sur son GPS : avec des positions, et
 * sans filtre de distance (une source qui n'envoie qu'après un déplacement se
 * tait à l'arrêt, sans être perdue).
 */
export const watchesGps = (recording: Pick<RecordingProfile, 'distanceFilterM'>, withPositions: boolean): boolean =>
  withPositions && recording.distanceFilterM <= 0;

const step = (state: GpsWatchState, patch: Partial<Omit<GpsWatchStep, 'state'>> = {}): GpsWatchStep => ({
  state, armMs: null, disarm: false, lost: false, cleared: false, ...patch,
});

/** Arme le minuteur à partir de `nowMs`. */
const armed = (state: GpsWatchState, nowMs: number, settings: GpsWatchSettings, patch: Partial<Omit<GpsWatchStep, 'state'>> = {}): GpsWatchStep => {
  const armMs = settings.gpsLostDelayS * 1000;
  return step({ ...state, phase: 'watching', returnedMs: null, deadlineMs: nowMs + armMs }, { ...patch, armMs });
};

/** Une position reçue à `nowMs` (jamais en pause manuelle). */
export const gpsWatchOnFix = (state: GpsWatchState, nowMs: number, settings: GpsWatchSettings): GpsWatchStep => {
  if (state.paused) return step(state);
  const delayMs = settings.gpsLostDelayS * 1000;
  switch (state.phase) {
    case 'waiting':
    case 'watching':
      return armed({ ...state, lastFixMs: nowMs }, nowMs, settings);
    case 'lost':
      // Le GPS revient : l'alerte s'efface, le réarmement commence.
      return step({ ...state, phase: 'rearming', lastFixMs: nowMs, returnedMs: nowMs, deadlineMs: null }, { cleared: true });
    case 'rearming': {
      // Un trou aussi long qu'une perte pendant le retour : le retour recommence à cette position.
      const gap = state.lastFixMs === null || nowMs - state.lastFixMs >= delayMs;
      const returnedMs = gap || state.returnedMs === null ? nowMs : state.returnedMs;
      const next: GpsWatchState = { ...state, lastFixMs: nowMs, returnedMs };
      return nowMs - returnedMs >= settings.gpsLostRearmS * 1000 ? armed(next, nowMs, settings) : step(next);
    }
  }
};

/**
 * Le minuteur est échu à `nowMs`. Revérifiée : une échéance périmée (une
 * position l'a repoussée entre-temps, ou la veille ne l'attend plus) est
 * ignorée.
 */
export const gpsWatchOnExpired = (state: GpsWatchState, nowMs: number): GpsWatchStep => {
  if (state.paused || state.phase !== 'watching' || state.deadlineMs === null || nowMs < state.deadlineMs) return step(state);
  return step({ ...state, phase: 'lost', deadlineMs: null }, { lost: true });
};

/** Pause manuelle : plus de veille ; une alerte en cours s'efface, sans nouvelle alerte avant le réarmement. */
export const gpsWatchOnPause = (state: GpsWatchState): GpsWatchStep => {
  if (state.paused) return step(state);
  const wasLost = state.phase === 'lost';
  const phase: GpsWatchPhase = wasLost ? 'rearming' : state.phase;
  return step({ ...state, paused: true, phase, deadlineMs: null, returnedMs: wasLost ? null : state.returnedMs }, { disarm: true, cleared: wasLost });
};

/** Reprise après une pause manuelle, à `nowMs` : la veille reprend, minuteur armé depuis la reprise. */
export const gpsWatchOnResume = (state: GpsWatchState, nowMs: number, settings: GpsWatchSettings): GpsWatchStep => {
  if (!state.paused) return step(state);
  const resumed: GpsWatchState = { ...state, paused: false };
  // Rien avant la première position ; pendant un réarmement, rien non plus : le retour se compte aux positions qui suivent.
  if (resumed.phase !== 'watching') return step(resumed);
  return armed(resumed, nowMs, settings);
};
