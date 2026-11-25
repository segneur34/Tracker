import type { Activity } from '../core/activities';
import { marksWithin, type SessionMark } from '../core/sessionMarks';
import { DEFAULT_RECORDING, hasPositions } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { formatDuration, formatTimeOfDay } from '../core/units';
import type { NativeStopReason } from './nativeLog';
import type { LocationFix } from '../platform/location';
import {
  addFixAfterManualPause, addFixToStats, EMPTY_RECORDING_STATS, sessionFileName, sessionTitle, splitIntoSegments, type HeartRateFix,
  type PauseClock, type RecordingStats,
} from './session';
import type { RecoveryServices } from '../platform/recovery';
import { closeSessionTest, type SessionTest } from './fitnessTest';
import { buildGpx, buildHeartRateGpx } from './gpxWriter';
import { seriesWithin, type IntervalSeries } from './intervalTimer';
import { journalSessionActivity, type JournalPause, type ParsedJournal } from './journal';

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

/** Ce qu'un enregistrement a gardé : ses positions, ou, sans position (muscu), les mesures de la ceinture. */
export interface RecordedTrack {
  segments: LocationFix[][];
  heart: HeartRateFix[][];
}

/** GPX d'une session enregistrée, prêt à ranger. */
export interface SessionGpx {
  fileName: string;
  content: string;
  /** Positions gardées ; sans position (muscu), mesures de la ceinture (0 : durée seule, lot 210). */
  pointCount: number;
}

/**
 * Vrai si la session se range par ses positions, faux si c'est par les mesures de la ceinture (muscu). Sans calcul
 * connu : des positions s'il y en a, sinon les mesures de la ceinture s'il y en a.
 */
export const recordedWithPositions = (sport: SportType | null, recorded: RecordedTrack): boolean =>
  sport !== null ? hasPositions(sport) : recorded.segments.some((s) => s.length > 0) || !recorded.heart.some((s) => s.length > 0);

/**
 * GPX d'un enregistrement, titré du nom de l'activité (« Session » sans activité, rangée « à classer ») ; `null` s'il
 * n'y a rien à garder : moins de deux positions au total, ou, sans position, moins de deux points à l'heure (FC ou
 * non) et, sans aucune FC, moins d'un intervalle `tickMs` du minuteur hors pauses (lot 210). Les positions sont prises
 * telles quelles (cadence déjà jointe par l'appelant).
 */
export const recordedSessionGpx = (activity: Activity | null, recorded: RecordedTrack, tickMs: number): SessionGpx | null => {
  const sport = activity?.base ?? null;
  const titleName = activity?.name ?? 'Session';
  if (!recordedWithPositions(sport, recorded)) {
    const points = recorded.heart.reduce((n, s) => n + s.length, 0);
    // Mesures de la ceinture, pour le compte de la carte de fin : le point de l'arrêt, sans FC, n'en est pas une.
    const measures = recorded.heart.reduce((n, s) => n + s.filter((f) => f.heartRateBpm !== undefined).length, 0);
    // Sans aucune FC, au moins un intervalle du minuteur hors pauses : « Démarrer » puis « Finir » aussitôt ne garde rien.
    const activeMs = recorded.heart.reduce((ms, s) => ms + (s.length > 1 ? s[s.length - 1].timeMs - s[0].timeMs : 0), 0);
    if (points < 2 || (measures === 0 && activeMs < tickMs)) return null;
    const firstMs = recorded.heart.find((s) => s.length > 0)![0].timeMs;
    return {
      fileName: sessionFileName(firstMs, sport),
      content: buildHeartRateGpx(recorded.heart, { name: sessionTitle(firstMs, titleName), sport }),
      pointCount: measures,
    };
  }
  const pointCount = recorded.segments.reduce((n, s) => n + s.length, 0);
  if (pointCount < 2) return null;
  const startMs = recorded.segments.find((s) => s.length > 0)![0].timeMs;
  return {
    fileName: sessionFileName(startMs, sport),
    content: buildGpx(recorded.segments, { name: sessionTitle(startMs, titleName), sport }),
    pointCount,
  };
};

/** Ce qu'un journal relu apporte à sa session en plus de ses points : repères, séances du compteur, test guidé. */
export interface JournalExtras {
  marks: SessionMark[];
  intervals: IntervalSeries[];
  test: SessionTest | null;
}

/**
 * Repères, séances du compteur et test d'un journal relu. Le démarrage est le plus tôt de l'heure de l'en-tête
 * (horloge du téléphone) et du premier point (heure du GPS) : une horloge du téléphone en avance n'écarte pas les
 * repères du début (lot 232). Séances du compteur : du démarrage au dernier point gardé ; repères : jusqu'à la fin,
 * une note posée en pause manuelle après le dernier point est gardée ; un test coupé finit au dernier point.
 */
export const journalExtras = (parsed: ParsedJournal, withPositions: boolean): JournalExtras => {
  const points: ReadonlyArray<{ timeMs: number }> = withPositions ? parsed.fixes : parsed.heartFixes;
  const earliest = Math.min(parsed.header?.startedAtMs ?? Infinity, points[0]?.timeMs ?? Infinity);
  const fromMs = Number.isFinite(earliest) ? earliest : 0;
  const toMs = points[points.length - 1]?.timeMs ?? fromMs;
  return {
    marks: marksWithin(parsed.marks, fromMs, Infinity),
    intervals: seriesWithin(parsed.intervalRuns, fromMs, toMs),
    test: parsed.test ? closeSessionTest(parsed.test, toMs) : null,
  };
};

/** Session reconstruite d'un journal relu (`sessionFromJournal`). */
export interface JournalSession extends SessionGpx, JournalExtras {
  /** `null` sans calcul lisible : rangée « à classer ». */
  activity: Activity | null;
}

/**
 * Session d'un journal relu, comme la reprise au lancement la reconstruit (`journalSessionActivity`, points, repères,
 * séances, test, GPX), sans la cadence, que seule la capture donne ; `null` s'il n'y a rien à garder.
 * `activities` : celles de l'utilisateur ; `tickMs` : l'intervalle d'enregistrement de son activité.
 */
export const sessionFromJournal = (parsed: ParsedJournal, activities: Activity[], tickMs: number): JournalSession | null => {
  const activity = journalSessionActivity(parsed, activities);
  const recorded: RecordedTrack = {
    segments: splitIntoSegments(parsed.fixes, parsed.breaks),
    heart: splitIntoSegments(parsed.heartFixes, parsed.heartBreaks),
  };
  const gpx = recordedSessionGpx(activity, recorded, tickMs);
  return gpx && { ...gpx, activity, ...journalExtras(parsed, recordedWithPositions(activity?.base ?? null, recorded)) };
};

/**
 * Ce que disent la carte de fin et l'analyse d'une session interrompue rangée d'office (lot 232) : l'heure où sa trace
 * s'arrête, et pourquoi. `reason` : l'arrêt par la garde du service de position, application fermée (`still`, le
 * téléphone n'a pas bougé ; `timeout`, durée maximale après la fermeture), d'après Gtracker 403 ; `null` : le
 * téléphone ou l'application l'a coupé. Les durées dites sont celles de la garde (`RecordingProfile`).
 */
export const interruptedNotice = (atMs: number, reason: NativeStopReason | null = null): string => {
  const at = formatTimeOfDay(atMs);
  if (reason === 'still') {
    return `Enregistrement arrêté seul à ${at} : application fermée, le téléphone n'avait pas bougé depuis ${formatDuration(DEFAULT_RECORDING.guardStillDelayS * 1000)}.`;
  }
  if (reason === 'timeout') {
    return `Enregistrement arrêté seul à ${at}, ${formatDuration(DEFAULT_RECORDING.guardMaxClosedS * 1000)} après la fermeture de l'application.`;
  }
  return `Enregistrement interrompu à ${at} : le téléphone ou l'application s'est arrêté, la trace s'arrête là.`;
};

/**
 * Heure à laquelle un enregistrement interrompu s'est arrêté (`interruptedNotice`) : son dernier point gardé, sinon sa
 * dernière ligne ; `null` s'il a été arrêté par « Arrêter » (l'utilisateur l'a vu finir) ou sans rien de daté. Arrêté
 * par la garde du service (`guardStop`, sa ligne `stop` au journal) : l'heure de la garde.
 */
export const interruptedAtMs = (parsed: ParsedJournal, guardStop: { atMs: number } | null = null): number | null => {
  if (guardStop !== null) return guardStop.atMs;
  if (parsed.stoppedAtMs !== null) return null;
  const lastFix = parsed.fixes[parsed.fixes.length - 1]?.timeMs;
  const lastHeart = parsed.heartFixes[parsed.heartFixes.length - 1]?.timeMs;
  const last = Math.max(lastFix ?? -Infinity, lastHeart ?? -Infinity);
  return Number.isFinite(last) ? last : parsed.lastLineMs;
};
