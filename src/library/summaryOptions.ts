import { parseGpx } from '../core/gpxParser';
import { SAILING_SPORTS, getSportProfile, hasPositions, isLandTreatment, isSportType, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { guessSport } from './naming';
import {
  isSummaryStale, type LibrarySession, type RecordWithoutSummary, type SessionAnalysis, type SessionRecord, type SessionSummary,
} from './record';
import { summarizeHeartRateSession, summarizeSession, type SummaryOptions } from './summary';

/**
 * Préparation du résumé d'une fiche (lot 72) : les réglages qui le changent,
 * la lecture du GPX et le nouveau résumé gardé avec ses manœuvres. Pur : les
 * réglages de l'activité sont lus par l'appelant (`useSessionLibrary`) et
 * passés en paramètre.
 */

/** Réglages de l'activité d'une session qui changent son résumé, lus dans Réglages par l'appelant. */
export interface ActivitySummarySettings {
  /** Seuil réglé ou pré-réglé pour l'activité, dans l'unité du profil ; `undefined` sans l'un ni l'autre. */
  thresholdOverride: number | undefined;
  /** Foil de l'activité (voile, surf) ; `null` ailleurs. */
  foil: boolean | null;
}

/** Altitude de la fiche (celle du terrain, et la source choisie) et son test guidé. */
export type SessionElevation = Pick<SessionRecord, 'terrainElevation' | 'elevationSource' | 'test'>;

/**
 * Réglages qui changent le résumé : ceux de l'activité de la session, et ceux
 * de la session (`analysis`, dans sa fiche). Le seuil de la session prime sur
 * celui de l'activité ; l'allure imposée n'existe que pour une session, et
 * qu'en voile. L'altitude du terrain de la fiche remplace celle du GPS en
 * course et à vélo, sauf si l'utilisateur a gardé le GPS. En surf, le foil
 * de la session (sinon de son activité) et son seuil de vague en foil.
 */
export const summaryOptions = (
  sport: SportType | null,
  analysis: SessionAnalysis | null | undefined,
  activity: ActivitySummarySettings,
  elevation?: SessionElevation | null
): SummaryOptions => {
  if (sport === null) return {};
  return {
    // Le seuil de la session, sinon celui réglé ou pré-réglé pour son activité (0 : aucun seuil réglé, arrêts complets ôtés d'office).
    activeThreshold: analysis?.activeThreshold ?? activity.thresholdOverride,
    referenceSpeedOverrideMs: SAILING_SPORTS.includes(sport) ? analysis?.referenceSpeedMs ?? undefined : undefined,
    terrainElevation:
      isLandTreatment(sportTreatment(sport)) && elevation?.elevationSource !== 'gps' ? elevation?.terrainElevation : undefined,
    // Surf : le foil de la session, sinon celui de son activité ; son seuil de vague en foil.
    foil: analysis?.foil ?? activity.foil ?? undefined,
    waveThreshold: analysis?.waveThreshold ?? undefined,
    test: elevation?.test,
  };
};

/**
 * Empreinte des réglages qui changent le résumé, gardée dans le résumé (`SessionSummary.optionsKey`,
 * lot 37) : seuil, allure imposée, foil en surf (ailleurs il ne change pas le résumé) et seuil de
 * vague. L'altitude du terrain et le test guidé n'y sont pas : ils sont dans la fiche, et leur
 * changement refait déjà le résumé (`applyRecordPatch`).
 */
export const summaryOptionsKey = (sport: SportType, options: SummaryOptions): string =>
  JSON.stringify([
    options.activeThreshold ?? null,
    options.referenceSpeedOverrideMs ?? null,
    getSportProfile(sport).surf ? options.foil ?? false : null,
    options.waveThreshold ?? null,
  ]);

/**
 * Vrai si le résumé est à refaire : calculé par une version antérieure du calcul, ou avec d'autres
 * réglages que ceux d'aujourd'hui (seuil de l'activité changé dans Réglages, allure imposée de la
 * session changée…), ou d'avant l'empreinte. Ne lit que la fiche allégée et les réglages, jamais le
 * GPX. Sans calcul connu ou sans positions (muscu, résumé sans réglage), seule la version compte.
 */
export const isSummaryOutdated = (
  record: SessionRecord,
  activityOf: (sport: SportType) => ActivitySummarySettings
): boolean => {
  if (isSummaryStale(record)) return true;
  const { sport } = record;
  if (sport === null || !isSportType(sport) || !hasPositions(sport)) return false;
  return record.summary.optionsKey !== summaryOptionsKey(sport, summaryOptions(sport, record.analysis, activityOf(sport)));
};

/**
 * Sessions dont le résumé est à refaire, dans l'ordre de la liste (la plus récente d'abord) : ni
 * fiche en lecture seule, ni trace déjà tentée sans succès depuis le lancement (`failed`).
 */
export const outdatedRefreshFiles = (
  sessions: readonly Pick<LibrarySession, 'file' | 'record' | 'readOnly'>[],
  isOutdated: (record: SessionRecord) => boolean,
  failed: ReadonlySet<string>
): string[] => sessions.filter((s) => !s.readOnly && !failed.has(s.file) && isOutdated(s.record)).map((s) => s.file);

export interface AnalyzedGpx {
  summary: SessionSummary;
  sport: SportType | null;
  title: string | null;
}

/**
 * Lit un GPX et le résume. `sport` absent : deviné depuis la trace.
 * `analysis` : réglages d'analyse de la fiche (seuil, allure), s'il y en a ;
 * `activityOf` : réglages de l'activité de la session pour le calcul retenu ;
 * `elevation` : son altitude du terrain, la source choisie et son test guidé.
 * Rend `null` si la trace a moins de deux points, lève une erreur si le XML
 * est illisible.
 */
export const analyzeGpx = (
  text: string,
  sport: SportType | null | undefined,
  analysis: SessionAnalysis | null | undefined,
  activityOf: (sport: SportType) => ActivitySummarySettings,
  elevation?: SessionElevation | null
): AnalyzedGpx | null => {
  const parsed = parseGpx(text);
  const resolved = sport === undefined ? guessSport(parsed.trackType) : sport;
  // Session sans trace (muscu) : ses points n'ont que l'heure et la FC.
  if (resolved !== null && !hasPositions(resolved)) {
    const summary = summarizeHeartRateSession(parsed.timedPoints, resolved);
    return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
  }
  const options = resolved === null ? {} : summaryOptions(resolved, analysis, activityOf(resolved), elevation);
  const summary = summarizeSession(parsed.rawPoints, resolved, options);
  if (!summary) return null;
  // Empreinte des réglages du calcul : un réglage changé plus tard rendra ce résumé à refaire.
  return {
    summary: resolved === null ? summary : { ...summary, optionsKey: summaryOptionsKey(resolved, options) },
    sport: resolved,
    title: parsed.trackName ?? null,
  };
};

/** Nouveau résumé, en gardant le nombre et la réussite des manœuvres de la dernière analyse. */
export const withSummary = (record: RecordWithoutSummary, summary: SessionSummary): SessionRecord => ({
  ...record,
  summary: {
    ...summary,
    ...(record.summary?.maneuverCount !== undefined ? { maneuverCount: record.summary.maneuverCount } : {}),
    ...(record.summary?.maneuverResults !== undefined ? { maneuverResults: record.summary.maneuverResults } : {}),
  },
});
