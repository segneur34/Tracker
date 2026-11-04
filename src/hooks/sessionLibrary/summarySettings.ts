import { baseActivity, sessionActivity, type Activity } from '../../core/activities';
import type { SportType } from '../../core/types';
import {
  newRecord as buildNewRecord, recordFor as buildRecordFor, type NewRecordContext, type NewRecordOptions,
} from '../../library/newRecord';
import {
  sameJson, type RecordWithoutSummary, type SessionRecord, type SessionSource, type SessionSummary,
  type SummaryActivitySettings,
} from '../../library/record';
import {
  activityValues, noteGestures, readSummaryGestures, settleGestures, waitingGestureActivities, type SummaryGestures,
} from '../../library/summaryGestures';
import {
  analyzeGpx, isSummaryOutdated, sessionActivitySettings, type ActivitySummarySettings, type AnalyzedGpx,
} from '../../library/summaryOptions';
import type { MemoryFolder } from '../../platform/memoryFolder';
import { jsonStore, storageStartupFailure } from '../../platform/storage';
import { effectiveFoil, effectiveThresholdOverride, readStoredActivities } from '../useSportSettings';
import { lib } from './memory';

/**
 * Réglages des résumés (lot 113) : ceux de l'activité d'une session, les gestes dans Réglages qui les changent
 * (`library/summaryGestures.ts`), le test « résumé à refaire » et la fiche neuve d'une session.
 */

/** Activité d'une session : la sienne, sinon la première de son calcul, sinon le calcul lui-même. */
export const activityOfSession = (sport: SportType, activityId: string | null | undefined): Activity =>
  sessionActivity(readStoredActivities(), activityId, sport) ?? baseActivity(sport);

/**
 * Réglages de l'activité d'une session qui changent son résumé (seuil, foil),
 * lus dans Réglages pour le calcul retenu (`analyzeGpx`, `summaryOptions`).
 */
export const activitySummarySettings = (activityId: string | null | undefined) => (sport: SportType): ActivitySummarySettings => {
  const activity = activityOfSession(sport, activityId);
  return { thresholdOverride: effectiveThresholdOverride(activity), foil: effectiveFoil(activity) };
};

/**
 * Résumé d'un GPX hors de la mémoire (image de partage d'une session en
 * attente), avec les réglages de son activité, comme la fiche le calculerait.
 * `null` si la trace a moins de deux points ; lève si le XML est illisible.
 */
export const summarizeGpxText = (text: string, sport: SportType, activityId: string | null): SessionSummary | null =>
  analyzeGpx(text, sport, null, activitySummarySettings(activityId))?.summary ?? null;

/** Gestes dans Réglages qui changent les résumés (`library/summaryGestures.ts`), rangés sur l'appareil : ils ne voyagent pas. */
const GESTURES_KEY = 'tracker.summaryGestures';

export const readGestures = (): SummaryGestures | null => readSummaryGestures(jsonStore.read<unknown>(GESTURES_KEY));

/**
 * Compare les réglages de l'appareil à la dernière comparaison : un changement devient un geste à appliquer
 * aux sessions de l'activité, gardé jusqu'à ce qu'elles soient refaites, même d'un lancement à l'autre.
 * `adopted` : réglages repris d'eux-mêmes (appareil neuf), pas un geste. Stockage illisible au démarrage : aucune
 * comparaison, des défauts passeraient pour un geste.
 */
export const noteSettingsGestures = (adopted = false): void => {
  if (storageStartupFailure()) return;
  const before = readGestures();
  const values = activityValues(readStoredActivities(), (activity) => ({ thresholdOverride: effectiveThresholdOverride(activity), foil: effectiveFoil(activity) }));
  const next = noteGestures(before, values, adopted);
  if (!before || !sameJson(before, next)) jsonStore.write(GESTURES_KEY, next);
};

/**
 * Activité dont un geste s'applique à une session : la sienne, ou la première de son calcul sans activité
 * choisie ; `null` si son activité a été supprimée : elle ne suit plus aucun geste et garde ce qu'elle porte.
 */
const gestureActivityId = (sport: SportType, activityId: string | null | undefined): string | null => {
  if (!activityId) return activityOfSession(sport, null).id;
  return readStoredActivities().some((a) => a.id === activityId && a.base === sport) ? activityId : null;
};

/**
 * Réglages de l'appareil et geste en attente pour chaque activité, lus une fois chacun : à reprendre à
 * chaque passage, les réglages ayant pu changer.
 */
const activitySettingsReader = () => {
  const gestures = readGestures();
  const withPending = gestures !== null && Object.keys(gestures.pending).length > 0;
  const read = new Map<string, { device: ActivitySummarySettings; pending: SummaryActivitySettings | undefined }>();
  return (activityId: string | null | undefined, sport: SportType) => {
    const key = `${activityId ?? ''}|${sport}`;
    let settings = read.get(key);
    if (!settings) {
      const gesture = withPending ? gestureActivityId(sport, activityId) : null;
      settings = { device: activitySummarySettings(activityId)(sport), pending: gesture === null ? undefined : gestures?.pending[gesture] };
      read.set(key, settings);
    }
    return settings;
  };
};

/**
 * Réglages du résumé d'une session (`analyzeGpx`) : le geste en attente, ceux que sa fiche porte, sinon ceux de
 * l'appareil (`sessionActivitySettings`). Sans fiche (session neuve, hors de la mémoire) : ceux de l'appareil.
 */
export const sessionSummarySettings = (
  record: RecordWithoutSummary | null | undefined,
  activityId: string | null | undefined = record?.activityId
) => (sport: SportType): ActivitySummarySettings => {
  const { device, pending } = activitySettingsReader()(activityId, sport);
  return sessionActivitySettings(record, device, pending);
};

/** Test « résumé à refaire » (`isSummaryOutdated`) pour tout un passage sur la liste. */
export const summaryOutdatedTest = (): ((record: SessionRecord) => boolean) => {
  const reader = activitySettingsReader();
  return (record) => isSummaryOutdated(
    record,
    (sport) => reader(record.activityId, sport).device,
    (sport) => reader(record.activityId, sport).pending
  );
};

/**
 * Traces dont le résumé n'a pas pu être refait depuis l'ouverture de la mémoire (GPX illisible,
 * fiche non relue) : elles ne sont pas retentées par le recalcul qui suit un réglage changé, mais
 * le sont à la prochaine ouverture ou à « Mettre à jour ».
 */
export const refreshFailed = new Set<string>();

/** Gestes dont plus aucune session n'est à refaire, ni en échec (reprises à la prochaine ouverture), retirés. Rien en lecture seule : rien n'a été réécrit. */
export const settleSettingsGestures = (f: MemoryFolder): void => {
  const gestures = readGestures();
  if (!gestures || Object.keys(gestures.pending).length === 0 || f.readOnly) return;
  const isOutdated = summaryOutdatedTest();
  const waiting = waitingGestureActivities(lib.all, (session) => refreshFailed.has(session.file) || isOutdated(session.record), gestureActivityId);
  const next = settleGestures(gestures, (id) => waiting.has(id));
  if (!sameJson(next, gestures)) jsonStore.write(GESTURES_KEY, next);
};

const LEGACY_NOTES_KEY = 'tracker.sailingNotes';

/** Horloge et notes anciennes d'une fiche neuve (`library/newRecord.ts`). */
const recordContext: NewRecordContext = {
  now: () => Date.now(),
  legacyNotes: () => jsonStore.read<Record<string, unknown>>(LEGACY_NOTES_KEY),
};

export const newRecord = (gpx: string, analyzed: AnalyzedGpx, source: SessionSource, activityId: string | null = null): SessionRecord =>
  buildNewRecord(gpx, analyzed, source, activityId, recordContext);

/** Fiche d'une session qui entre dans la mémoire sous le nom `gpx` (`library/newRecord.ts`). */
export const recordFor = (gpx: string, analyzed: AnalyzedGpx, source: SessionSource, options: NewRecordOptions): SessionRecord =>
  buildRecordFor(gpx, analyzed, source, options, recordContext);
