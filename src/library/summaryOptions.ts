import { parseGpx } from '../core/gpxParser';
import { SAILING_SPORTS, hasPositions, isLandTreatment, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { guessSport } from './naming';
import type { RecordWithoutSummary, SessionAnalysis, SessionRecord, SessionSummary } from './record';
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
  const summary = resolved !== null && !hasPositions(resolved)
    ? summarizeHeartRateSession(parsed.timedPoints, resolved)
    : summarizeSession(
      parsed.rawPoints, resolved,
      resolved === null ? {} : summaryOptions(resolved, analysis, activityOf(resolved), elevation)
    );
  return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
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
