import { decodeImuHeader } from '../core/imuFile';
import { JUMPS_CALC_VERSION } from '../core/jumps';
import type { SessionMark } from '../core/sessionMarks';
import type { SessionTest } from '../recording/fitnessTest';
import type { IntervalSeries } from '../recording/intervalTimer';
import {
  RECORD_FORMAT, RECORD_VERSION, findLegacyNotes, readAnalysis, type RecordWithoutSummary, type SessionRecord, type SessionSource,
} from './record';
import { withSummary, type AnalyzedGpx } from './summaryOptions';

/**
 * Fiche d'une session qui entre dans la mémoire (lot 113, sortie de la bibliothèque) : neuve, ou celle qui
 * l'accompagne, avec ce que l'enregistrement y range. L'horloge et les notes anciennes sont passées en
 * paramètres : la bibliothèque donne `Date.now` et la lecture du stockage de l'appareil.
 */

/** Ce que la fiche neuve prend hors du GPX. */
export interface NewRecordContext {
  /** Instant présent, en ms. */
  now: () => number;
  /** Notes saisies avant l'existence du dossier (`tracker.sailingNotes`), lues seulement pour une fiche neuve. */
  legacyNotes: () => Record<string, unknown> | null;
}

/** Ce qu'une session apporte à sa fiche en entrant dans la mémoire (`addGpx` de la bibliothèque). */
export interface NewRecordOptions {
  /** Activité choisie à l'enregistrement. */
  activityId?: string;
  /** Fiche qui accompagne le GPX, lors de l'import d'un dossier ; son résumé est refait. */
  record?: RecordWithoutSummary | null;
  /** Séances du compteur faites pendant l'enregistrement, rangées dans la fiche. */
  intervals?: IntervalSeries[];
  /** Repères du bouton « Note », rangés dans la fiche. */
  marks?: SessionMark[];
  /** Test guidé fait pendant l'enregistrement, rangé dans la fiche. */
  test?: SessionTest;
  /** Capteurs de l'enregistrement (`.imu`), rangés à côté du GPX. */
  motion?: Uint8Array;
  /** Foil de l'activité à l'enregistrement, rangé dans les réglages de la session. */
  foil?: boolean;
}

/** Fiche neuve d'un GPX rangé sous le nom `gpx`, sans nom ni réglages d'analyse. */
export const newRecord = (
  gpx: string, analyzed: AnalyzedGpx, source: SessionSource, activityId: string | null, context: NewRecordContext
): SessionRecord => ({
  format: RECORD_FORMAT,
  version: RECORD_VERSION,
  gpx,
  sport: analyzed.sport,
  activityId,
  source,
  addedAt: new Date(context.now()).toISOString(),
  title: analyzed.title,
  name: null,
  summary: analyzed.summary,
  // Notes saisies avant l'existence du dossier, pour la même trace.
  notes: findLegacyNotes(context.legacyNotes(), analyzed.summary.startMs),
  analysis: null,
});

/**
 * Fiche d'une session qui entre dans la mémoire sous le nom `gpx` : celle qui l'accompagne (import d'un
 * dossier, session en attente), son résumé refait, sinon une neuve, à l'activité et au foil choisis à
 * l'enregistrement ; avec les séances du compteur, les repères et le test guidé de l'enregistrement.
 */
export const recordFor = (
  gpx: string, analyzed: AnalyzedGpx, source: SessionSource, options: NewRecordOptions, context: NewRecordContext
): SessionRecord => {
  const made = options.record
    ? withSummary({ ...options.record, gpx, sport: analyzed.sport }, analyzed.summary)
    : {
      ...newRecord(gpx, analyzed, source, options.activityId ?? null, context),
      ...(options.foil !== undefined ? { analysis: readAnalysis({ foil: options.foil, savedAt: context.now() }) } : {}),
    };
  // Capture de la seule cadence : la fiche dit tout de suite qu'il n'y a pas de sauts à chercher.
  const jumpsUnmeasured = options.motion && decodeImuHeader(options.motion)?.setup.jumps === false;
  return {
    ...made,
    ...(options.intervals && options.intervals.length > 0 ? { intervals: options.intervals } : {}),
    ...(options.marks && options.marks.length > 0 ? { marks: options.marks } : {}),
    ...(options.test ? { test: options.test } : {}),
    ...(jumpsUnmeasured && !made.jumps
      ? { jumps: { version: JUMPS_CALC_VERSION, computedAt: new Date(context.now()).toISOString(), jumps: [], measured: false as const } }
      : {}),
  };
};
