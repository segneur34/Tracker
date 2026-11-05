import type { BikeType } from '../core/domainTypes';
import { parseGpx } from '../core/gpxParser';
import { SAILING_SPORTS, getSportProfile, hasPositions, isLandTreatment, isSportType, sportTreatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { isValidBikeWeight } from '../cycling/energy';
import { guessSport } from './naming';
import {
  ANALYSIS_SUMMARY_FIELDS, carriedSettings, isSummaryStale, type LibrarySession, type RecordWithoutSummary, type SessionAnalysis, type SessionRecord, type SessionSummary,
  type SummaryActivitySettings,
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
  /**
   * Vélo (lot 146) : type et poids du vélo de l'activité, poids du pratiquant (`null` s'il n'est pas renseigné),
   * pour la meilleure puissance estimée sur 20 min du résumé ; absent hors vélo. Le type et le poids du vélo
   * entrent dans l'empreinte, comme le seuil (§8 : les changer dans Réglages refait les sessions de l'activité) ;
   * le poids du pratiquant n'y entre pas : un résumé fait sans lui est refait une fois, dès qu'il est connu.
   */
  cycling?: CyclingSummarySettings;
}

/** Vélo et pratiquant d'une activité à vélo, pour la puissance du résumé (`ActivitySummarySettings.cycling`). */
export interface CyclingSummarySettings {
  bikeType: BikeType;
  bikeKg: number;
  riderKg: number | null;
}

/**
 * Réglages de l'activité qui valent pour une session : celui d'un geste dans Réglages en attente de
 * recalcul (`pending`, `library/summaryGestures.ts`), sinon ceux portés par sa fiche (Q57, lot 148), sinon
 * ceux de l'appareil (`device`) ; sans fiche ni porté connu, ceux de l'appareil. La seule lecture : liste et
 * analyses passent par elle. Le seuil propre de la session prime encore sur ce résultat (`summaryOptions`).
 */
export const sessionActivitySettings = (
  record: Pick<RecordWithoutSummary, 'sport' | 'analysis' | 'summary'> | null | undefined,
  device: ActivitySummarySettings,
  pending?: SummaryActivitySettings
): ActivitySummarySettings => {
  const carried = record ? carriedSettings(record) : {};
  const threshold = pending?.threshold !== undefined ? pending.threshold : carried.threshold;
  const foil = pending?.foil !== undefined ? pending.foil : carried.foil;
  return {
    thresholdOverride: threshold === undefined ? device.thresholdOverride : threshold ?? undefined,
    foil: foil === undefined ? device.foil : foil,
    ...(device.cycling !== undefined ? { cycling: device.cycling } : {}),
  };
};

/**
 * Foil d'une session pour ce qui ne le saisit pas (Statistiques, image de partage) : le sien, sinon celui de
 * l'activité par `sessionActivitySettings`, sinon non. `deviceFoil` : celui de son activité sur cet appareil.
 */
export const sessionFoil = (
  record: Pick<RecordWithoutSummary, 'sport' | 'analysis' | 'summary'> | null | undefined,
  deviceFoil: boolean | null
): boolean => record?.analysis?.foil ?? sessionActivitySettings(record, { thresholdOverride: undefined, foil: deviceFoil }).foil ?? false;

/** Altitude de la fiche (celle du terrain, et la source choisie) et son test guidé. */
export type SessionElevation = Pick<SessionRecord, 'terrainElevation' | 'elevationSource' | 'test'>;

/**
 * Réglages qui changent le résumé : ceux de l'activité de la session, et ceux
 * de la session (`analysis`, dans sa fiche). Le seuil de la session prime sur
 * celui de l'activité ; l'allure imposée n'existe que pour une session, et
 * qu'en voile. L'altitude du terrain de la fiche remplace celle du GPS en
 * course et à vélo, sauf si l'utilisateur a gardé le GPS. En surf, le foil
 * de la session (sinon de son activité) et son seuil de vague en foil. À vélo,
 * le vélo de l'activité et le poids du pratiquant (le poids du vélo de la
 * session s'il est saisi), pour la puissance des meilleurs 20 min (lot 146).
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
    ...(sportTreatment(sport) === 'velo' && activity.cycling
      ? {
        cyclingPower: {
          bikeType: activity.cycling.bikeType,
          bikeKg: isValidBikeWeight(analysis?.bikeWeightKg) ? analysis.bikeWeightKg : activity.cycling.bikeKg,
          riderKg: activity.cycling.riderKg,
        },
      }
      : {}),
  };
};

/**
 * Empreinte des réglages qui changent le résumé, gardée dans le résumé (`SessionSummary.optionsKey`,
 * lot 37) : seuil, allure imposée, foil en surf (ailleurs il ne change pas le résumé) et seuil de
 * vague ; à vélo, depuis le lot 146, le type et le poids du vélo (cinquième place, absente ailleurs :
 * les empreintes des autres calculs ne changent pas). L'altitude du terrain et le test guidé n'y sont pas :
 * ils sont dans la fiche, et leur changement refait déjà le résumé (`applyRecordPatch`).
 */
export const summaryOptionsKey = (sport: SportType, options: SummaryOptions): string =>
  JSON.stringify([
    options.activeThreshold ?? null,
    options.referenceSpeedOverrideMs ?? null,
    getSportProfile(sport).surf ? options.foil ?? false : null,
    options.waveThreshold ?? null,
    ...(options.cyclingPower ? [[options.cyclingPower.bikeType, options.cyclingPower.bikeKg]] : []),
  ]);

/**
 * Vrai si le résumé est à refaire : calculé par une version antérieure du calcul, ou d'avant
 * l'empreinte, ou avec d'autres réglages que ceux de sa fiche (allure imposée de la session changée,
 * fiche changée sur un autre appareil : le test est le même sur les deux, donc pas de renvoi), ou si
 * un geste dans Réglages attend d'être appliqué à son activité (`pendingOf`). Des réglages différents
 * sur cet appareil, seuls, ne rendent rien à refaire (Q57) : `activityOf` ne vaut que pour ce que la fiche
 * ne porte pas. Ne lit que la fiche allégée et les réglages, jamais le GPX. Sans calcul connu ou sans
 * positions (muscu, résumé sans réglage), seule la version compte.
 */
export const isSummaryOutdated = (
  record: SessionRecord,
  activityOf: (sport: SportType) => ActivitySummarySettings,
  pendingOf?: (sport: SportType) => SummaryActivitySettings | undefined
): boolean => {
  if (isSummaryStale(record)) return true;
  const { sport } = record;
  if (sport === null || !isSportType(sport) || !hasPositions(sport)) return false;
  const expected = summaryOptionsKey(sport, summaryOptions(sport, record.analysis, sessionActivitySettings(record, activityOf(sport))));
  if (record.summary.optionsKey !== expected) return true;
  // Vélo : puissance des meilleurs 20 min cherchée sans poids du pratiquant, qui est connu maintenant (lot 146).
  if (sportTreatment(sport) === 'velo' && (activityOf(sport).cycling?.riderKg ?? null) !== null && record.summary.bests?.powerRiderKg === undefined) return true;
  const pending = pendingOf?.(sport);
  if (!pending) return false;
  const carried = carriedSettings(record);
  return (pending.threshold !== undefined && pending.threshold !== carried.threshold)
    || (pending.foil !== undefined && pending.foil !== carried.foil);
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

/** Réglages de l'activité à porter dans le résumé. Foil : en surf seulement, comme l'empreinte. */
const portedSettings = (sport: SportType, activity: ActivitySummarySettings): SummaryActivitySettings => ({
  threshold: activity.thresholdOverride ?? null,
  ...(getSportProfile(sport).surf ? { foil: activity.foil ?? null } : {}),
});

/**
 * Phrase discrète de l'onglet réglages quand la session garde un seuil que Réglages ne dit plus sur cet
 * appareil, `null` sinon (porté inconnu, ou le même). `show` : le seuil avec son unité.
 */
export const carriedThresholdNote = (
  carried: number | null | undefined,
  device: number | null,
  show: (threshold: number) => string
): string | null => {
  if (carried === undefined || carried === device) return null;
  const computed = carried === null ? 'Calculée sans seuil réglé pour l\'activité.' : `Calculée avec ${show(carried)}, le réglage de l'activité à ce moment-là.`;
  return device === null
    ? `${computed} Réglages n'en règle aucun sur cet appareil : en régler un recalcule les sessions de l'activité.`
    : `${computed} Réglages dit ${show(device)} sur cet appareil : le changer recalcule les sessions de l'activité.`;
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
  if (resolved !== null && !hasPositions(resolved)) {
    const summary = summarizeHeartRateSession(parsed.timedPoints, resolved);
    return summary ? { summary, sport: resolved, title: parsed.trackName ?? null } : null;
  }
  const activity = resolved === null ? null : activityOf(resolved);
  const options = resolved === null || activity === null ? {} : summaryOptions(resolved, analysis, activity, elevation);
  const summary = summarizeSession(parsed.rawPoints, resolved, options);
  if (!summary) return null;
  // Empreinte des réglages du calcul : un réglage changé plus tard rendra ce résumé à refaire ;
  // et ceux de l'activité, que la session garde (Q57).
  return {
    summary: resolved === null || activity === null
      ? summary
      : { ...summary, optionsKey: summaryOptionsKey(resolved, options), activitySettings: portedSettings(resolved, activity) },
    sport: resolved,
    title: parsed.trackName ?? null,
  };
};

/** Nouveau résumé, en gardant les chiffres posés par la dernière analyse (manœuvres, pumping, vent, puissance). */
export const withSummary = (record: RecordWithoutSummary, summary: SessionSummary): SessionRecord => {
  const kept: Partial<SessionSummary> = {};
  for (const field of ANALYSIS_SUMMARY_FIELDS) {
    const value = record.summary?.[field];
    if (value !== undefined) (kept as Record<string, unknown>)[field] = value;
  }
  return { ...record, summary: { ...summary, ...kept } };
};
