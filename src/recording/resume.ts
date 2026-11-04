import { addFixAfterManualPause, addFixToStats, EMPTY_RECORDING_STATS, type PauseClock, type RecordingStats } from './session';
import type { RecoveryServices } from '../platform/recovery';
import type { JournalPause, ParsedJournal } from './journal';

/**
 * Reprise d'un enregistrement interrompu, sans accès au téléphone (lot 156).
 *
 * Quand le moteur de la WebView tombe, seule la page repart : le processus, le service GPS et son verrou survivent
 * (`MainActivity.java`). Le journal et la preuve que le service vit (`platform/recovery.ts`) disent alors que faire :
 * reprendre seul, proposer « Continuer l'enregistrement », ou remettre la session en attente, comme avant.
 */

export const NO_RECOVERY_SERVICES: RecoveryServices = { gps: false, belt: false };

/** Ce qu'un journal relu dit de la reprise ; `null` sans journal. */
export interface RecoveryJournal {
  /** En-tête lisible : sans lui, l'activité est inconnue et rien ne se reprend. */
  hasHeader: boolean;
  /** Une ligne `stop` : l'utilisateur a arrêté la session. */
  stopped: boolean;
  lastLineMs: number | null;
  /** Session à positions (service GPS), sinon à la ceinture seule (muscu). */
  withPositions: boolean;
}

export interface RecoveryFacts {
  journal: RecoveryJournal | null;
  services: RecoveryServices;
  nowMs: number;
  /** `RecordingProfile.resumeOfferMaxAgeS`. */
  offerMaxAgeS: number;
}

/**
 * `none` : rien à faire. `stopServices` : un service tourne sans journal (recherche de position coupée par la chute),
 * à arrêter. `resume` : reprise silencieuse. `offer` : session en attente, avec « Continuer ». `pending` : session en
 * attente seulement.
 */
export type RecoveryChoice = 'none' | 'stopServices' | 'resume' | 'offer' | 'pending';

export const recoveryDecision = ({ journal, services, nowMs, offerMaxAgeS }: RecoveryFacts): RecoveryChoice => {
  if (journal === null) return services.gps || services.belt ? 'stopServices' : 'none';
  if (journal.stopped || !journal.hasHeader) return 'pending';
  if (journal.withPositions ? services.gps : services.belt) return 'resume';
  if (journal.lastLineMs === null) return 'pending';
  const ageMs = nowMs - journal.lastLineMs;
  return ageMs >= 0 && ageMs < offerMaxAgeS * 1000 ? 'offer' : 'pending';
};

/**
 * Statistiques d'une session relue d'un journal, celles que l'enregistreur avait faites point à point. `breaks` : les
 * points qui closent une pause manuelle (indice et part en pause automatique), dont l'écart n'est pas de la durée.
 */
export const rebuildRecordingStats = (
  points: ReadonlyArray<{ timeMs: number; accuracyM?: number }>,
  breaks: ReadonlyArray<{ index: number; autoPartMs: number }>
): RecordingStats => {
  const manual = new Map(breaks.map((b) => [b.index, b.autoPartMs]));
  return points.reduce<RecordingStats>((stats, point, i) => {
    const autoPartMs = manual.get(i);
    return autoPartMs === undefined ? addFixToStats(stats, point) : addFixAfterManualPause(stats, point, autoPartMs);
  }, EMPTY_RECORDING_STATS);
};

/** Où en était la pause au moment de la coupure, tiré des lignes `pause` et `resume` du journal. */
export interface ResumedPhase {
  /** Pause manuelle encore en cours : son horloge, à l'identique ; `null` sinon. */
  pauseClock: PauseClock | null;
  /** Le prochain point gardé ouvre un segment : la coupure en est une ; une pause en cours attend sa reprise. */
  pendingBreak: boolean;
  /** Le prochain point clôt une pause manuelle déjà levée : la part à garder de son écart ; `null` sinon. */
  manualBreakAutoPartMs: number | null;
}

export const resumedPhase = (journal: Pick<ParsedJournal, 'openPause' | 'resumedPause'>): ResumedPhase => {
  const { openPause, resumedPause } = journal;
  if (openPause) {
    return {
      pauseClock: { sinceMs: openPause.atMs - openPause.autoPartMs, frozenAtMs: openPause.atMs },
      pendingBreak: false,
      manualBreakAutoPartMs: null,
    };
  }
  return { pauseClock: null, pendingBreak: true, manualBreakAutoPartMs: resumedPause?.autoPartMs ?? null };
};

/**
 * « Continuer » après une application tuée : ce qui en est dit au journal avant de reprendre. Le temps passé hors de
 * l'application ne compte pas plus qu'une pause manuelle : une pause en cours se lève, une pause déjà levée suit son
 * cours, et sinon une pause est posée à la dernière ligne, levée aussitôt. `pause` : la pause à écrire, `null` si le
 * journal en a déjà une ; `resumeLine` : écrire sa levée.
 */
export const continuedPause = (
  journal: Pick<ParsedJournal, 'openPause' | 'resumedPause' | 'lastLineMs'>,
  nowMs: number
): { pause: JournalPause | null; autoPartMs: number; resumeLine: boolean } => {
  const { openPause, resumedPause, lastLineMs } = journal;
  if (openPause) return { pause: null, autoPartMs: openPause.autoPartMs, resumeLine: true };
  if (resumedPause) return { pause: null, autoPartMs: resumedPause.autoPartMs, resumeLine: false };
  return { pause: { atMs: lastLineMs ?? nowMs, autoPartMs: 0 }, autoPartMs: 0, resumeLine: true };
};
