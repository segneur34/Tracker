import { SPORT_PROFILES } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import type { RecordWithoutSummary, SessionAnalysis } from './record';
import { analyzeGpx, type ActivitySummarySettings, type AnalyzedGpx, type SessionElevation } from './summaryOptions';

/**
 * Résumé d'un GPX en une fonction pure dont les réglages sont des données (lot 126 B) : `analyzeGpx` prend les
 * réglages de l'activité par une fonction, qui ne traverse pas un message vers le worker
 * (`library/trackWorker.ts`). Ils sont donc résolus avant l'envoi, en une table par calcul.
 */

export interface SummarizeGpxOptions {
  /** Calcul de la session ; `undefined` : deviné depuis la trace ; `null` : aucun (`analyzeGpx`). */
  sport: SportType | null | undefined;
  /** Réglages d'analyse de la fiche (seuil, allure), s'il y en a. */
  analysis: SessionAnalysis | null | undefined;
  /** Réglages de l'activité de la session par calcul : celui de la session, ou les onze quand il est à deviner. */
  activitySettings: Partial<Record<SportType, ActivitySummarySettings>>;
  /** Altitude du terrain de la fiche, la source choisie et son test guidé. */
  elevation: SessionElevation | null | undefined;
}

/** Les onze calculs, pour une session dont le calcul est à deviner. */
const ALL_SPORTS = Object.keys(SPORT_PROFILES) as SportType[];

/**
 * Options du résumé d'une session (`summarizeGpx`) : le calcul, l'analyse et l'altitude de sa fiche
 * (`record`, absente pour un GPX neuf : calcul deviné ; `addGpx` y passe le calcul qu'il impose, `undefined` s'il
 * est à deviner) ; les réglages de son activité lus par `activityOf` pour le calcul de la fiche, ou pour chacun
 * des onze si le calcul est à deviner.
 */
export const summarizeGpxOptions = (
  record: (Partial<Pick<RecordWithoutSummary, 'analysis' | 'terrainElevation' | 'elevationSource' | 'test'>> & { sport: SportType | null | undefined }) | null | undefined,
  activityOf: (sport: SportType) => ActivitySummarySettings
): SummarizeGpxOptions => {
  const sport = record ? record.sport : undefined;
  const sports = sport === undefined ? ALL_SPORTS : sport === null ? [] : [sport];
  const activitySettings: Partial<Record<SportType, ActivitySummarySettings>> = {};
  for (const s of sports) activitySettings[s] = activityOf(s);
  return {
    sport,
    analysis: record?.analysis,
    activitySettings,
    elevation: record
      ? {
        ...(record.terrainElevation !== undefined ? { terrainElevation: record.terrainElevation } : {}),
        ...(record.elevationSource !== undefined ? { elevationSource: record.elevationSource } : {}),
        ...(record.test !== undefined ? { test: record.test } : {}),
      }
      : undefined,
  };
};

/**
 * Lit un GPX et le résume, comme `analyzeGpx` avec les mêmes réglages. Rend `null` si la trace a moins de deux
 * points, lève si le XML est illisible, ou si la table ne porte pas le calcul retenu (options mal formées).
 */
export const summarizeGpx = (gpxText: string, { sport, analysis, activitySettings, elevation }: SummarizeGpxOptions): AnalyzedGpx | null =>
  analyzeGpx(gpxText, sport, analysis, (s) => {
    const settings = activitySettings[s];
    if (!settings) throw new Error(`Réglages de l'activité absents pour le calcul ${s}.`);
    return settings;
  }, elevation);
