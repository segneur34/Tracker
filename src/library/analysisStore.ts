import { prepareTrack, type PreparedTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import type { SpeedRangeMs } from '../core/speedGradient';
import type { SportProfile, Treatment } from '../core/sportProfiles';
import { effectiveSpeedRange, trackColorCodes, type TrackColorCodes } from '../core/trackColor';
import type { SportType } from '../core/types';
import { runSailingAnalysis, sailingAnalysisResult, type SailingAnalysisResult, type SailingAnalysisStages } from '../sailing/sailingSession';

/**
 * Mémoire de l'analyse ouverte (lot 235, d'après Gtracker), dans le calcul en arrière-plan, ou en ligne, sur le fil de
 * l'affichage, quand il n'y a pas de worker : une seule session à la fois, désignée par une clé que donne la page. Elle
 * garde la trace préparée, la préparation voile tant que calcul, profil et trace ne changent pas, le dernier résultat
 * au seuil tant que le seuil ne change pas (un vent seul changé ne refait que les manœuvres, la VMG et la polaire), et
 * les dernières couleurs de la trace. La préparation voile porte des fonctions (détection des virages, étage polaire
 * du vent) : elle ne traverse pas un message, d'où cette mémoire sur place.
 *
 * Clé absente ou trace d'une autre source (worker recréé, repli en ligne, autre session ouverte), la trace est refaite
 * par `prepareTrack`, avec les options données : mêmes fonctions, mêmes arguments, mêmes chiffres. Aucun seuil n'est
 * résolu ici : la page passe un seuil déjà accordé à l'allure de la session (règle 4). Seule la voile y passe ; le
 * surf et les modules à pied et à vélo calculent encore sur le fil de l'affichage (mesure du 26/11).
 */

/** Ce que prennent les couleurs de la trace (`trackColorCodes`) : traitement et bornes, avant leur ordre de priorité. */
export interface TrackColorOptions {
  treatment: Treatment;
  /** Bornes de la session (brouillon, puis fiche) ; `null` : aucune. */
  sessionRange: SpeedRangeMs | null;
  /** Bornes de l'activité, réglées dans Réglages ; `null` : aucune. */
  activityRange: SpeedRangeMs | null;
  /** Bornes par défaut de l'activité ou du calcul. */
  fallback: SpeedRangeMs;
}

/**
 * La session visée : la clé de sa page, le numéro de la lecture de sa trace (une par tâche `prepare` de la page), et
 * les options de cette lecture (`prepareTrack`), celles de la tâche `prepare`.
 */
export interface AnalysisTarget {
  key: string;
  traceId: number;
  prepare: PrepareTrackOptions;
}

/**
 * Nom de l'erreur d'une analyse demandée sans le texte du GPX (lot 235) pour une trace que la mémoire ne tient pas
 * (worker relancé, mémoire libérée, autre session lue depuis) : la page renvoie alors la demande avec le texte
 * (`analyzeOnKeptTrace`).
 */
export const MISSING_TRACE = 'TraceAbsente';

/** Vrai pour l'erreur d'une trace absente de la mémoire (`MISSING_TRACE`), venue du worker ou levée en ligne. */
export const isMissingTrace = (err: unknown): boolean => err instanceof Error && err.name === MISSING_TRACE;

/**
 * Valeur mise en texte pour comparer deux demandes : comme `JSON.stringify`, mais un nombre infini, `NaN` ou `-0`
 * garde son texte à lui (`JSON.stringify` rend `null` pour les trois premiers, `0` pour le dernier), pour que deux
 * entrées différentes ne passent jamais pour les mêmes.
 */
export const stableText = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0)) ? `#${Object.is(v, -0) ? '-0' : String(v)}` : v);

/** Une analyse à voile demandée : calcul, profil, seuil des calculs déjà résolu, vent saisi, couleurs. */
export interface AnalyzeSailingOptions extends AnalysisTarget {
  sport: SportType;
  profile: SportProfile;
  /** Seuil des calculs, en nœuds, déjà résolu et accordé à l'allure (`resolveSailingThresholds`). */
  thresholdKn: number;
  /** Vent saisi, en degrés ; `null` : vent estimé. */
  windDeg: number | null;
  /** Couleurs de la trace ; `null` : pas de couleurs. */
  color: TrackColorOptions | null;
}

/** Réponse d'une analyse à voile : ses chiffres et les couleurs compactes de la trace (`null` sans couleurs demandées). */
export interface SailingAnalysisReply {
  analysis: SailingAnalysisResult;
  colors: TrackColorCodes | null;
}

/** Calculs faits par la mémoire, par étape : ce qu'elle évite se lit là (tests). */
export interface AnalysisWork {
  prepareTrack: number;
  prepareSailing: number;
  atThreshold: number;
  wind: number;
  colors: number;
}

interface SailingMemory {
  /** Calcul et profil de la préparation. */
  sig: string;
  stages: SailingAnalysisStages;
  thresholdKn: number;
  windDeg: number | null;
}

interface ColorMemory {
  treatment: Treatment;
  minMs: number;
  maxMs: number;
  colors: TrackColorCodes;
}

interface Memory {
  key: string;
  traceId: number;
  /** Options de lecture de la trace, mises en texte (`prepareSignature`). */
  prepareSig: string;
  track: PreparedTrack;
  sailing: SailingMemory | null;
  colors: ColorMemory | null;
}

/** Options de lecture en texte, champ par champ : deux objets aux mêmes valeurs, dans un autre ordre, donnent le même texte. */
const prepareSignature = ({ fileName, profile, referenceSpeedOverrideMs }: PrepareTrackOptions): string =>
  stableText([
    fileName ?? null,
    profile ? [profile.id, profile.medianWindowSeconds, profile.maxDetourRatio, profile.maxPlausibleSpeedMs, profile.maxGapS] : null,
    referenceSpeedOverrideMs ?? null,
  ]);

export interface AnalysisStore {
  /** Garde la trace que la tâche `prepare` vient de lire, sous la clé de la page et son numéro : elle remplace toute la mémoire. */
  keepTrack(target: AnalysisTarget, track: PreparedTrack): void;
  /**
   * Analyse de la trace visée. Sans texte (`gpxText` vide), seulement si la mémoire la tient : sinon lève l'erreur
   * `MISSING_TRACE`. Avec le texte, la trace est relue au besoin et gardée.
   */
  analyzeSailing(gpxText: string, options: AnalyzeSailingOptions): SailingAnalysisReply;
  /** Vide la mémoire si elle tient cette clé : une page quittée ne libère pas la session d'une page ouverte depuis. */
  release(key: string): void;
  /** Clé de la session en mémoire, `null` : aucune. */
  readonly key: string | null;
  readonly work: Readonly<AnalysisWork>;
}

export const createAnalysisStore = (): AnalysisStore => {
  let memory: Memory | null = null;
  const work: AnalysisWork = { prepareTrack: 0, prepareSailing: 0, atThreshold: 0, wind: 0, colors: 0 };

  const keepTrack = ({ key, traceId, prepare }: AnalysisTarget, track: PreparedTrack): Memory => {
    memory = { key, traceId, prepareSig: prepareSignature(prepare), track, sailing: null, colors: null };
    return memory;
  };

  /**
   * La mémoire de la session visée, si elle tient cette lecture de sa trace (même page, même numéro, mêmes options) ;
   * sinon la trace relue du texte, ou l'erreur `MISSING_TRACE` sans texte.
   */
  const memoryFor = (gpxText: string, target: AnalysisTarget): Memory => {
    const { key, traceId, prepare } = target;
    if (memory && memory.key === key && memory.traceId === traceId && memory.prepareSig === prepareSignature(prepare)) return memory;
    if (gpxText === '') {
      const error = new Error('Trace absente de la mémoire du calcul : la demande doit porter le texte du GPX.');
      error.name = MISSING_TRACE;
      throw error;
    }
    work.prepareTrack += 1;
    return keepTrack(target, prepareTrack(gpxText, prepare));
  };

  /** Couleurs compactes de la trace, aux bornes effectives (`effectiveSpeedRange`), comme le module les ordonne. */
  const colorsFor = (target: Memory, color: TrackColorOptions | null, suggested: SpeedRangeMs | null): TrackColorCodes | null => {
    if (!color) return null;
    const { minMs, maxMs } = effectiveSpeedRange({
      sessionRange: color.sessionRange, activityRange: color.activityRange, suggested, fallback: color.fallback,
    });
    const kept = target.colors;
    if (kept && kept.treatment === color.treatment && Object.is(kept.minMs, minMs) && Object.is(kept.maxMs, maxMs)) return kept.colors;
    work.colors += 1;
    const colors = trackColorCodes(target.track.track, color.treatment, { minMs, maxMs });
    target.colors = { treatment: color.treatment, minMs, maxMs, colors };
    return colors;
  };

  const analyzeSailing = (gpxText: string, options: AnalyzeSailingOptions): SailingAnalysisReply => {
    const target = memoryFor(gpxText, options);
    const { sport, profile, thresholdKn, windDeg } = options;
    const sig = stableText([sport, profile]);
    const kept = target.sailing?.sig === sig ? target.sailing : null;
    // Une étape n'est reprise qu'avec celles dont elle découle, et si ses propres entrées n'ont pas bougé.
    const reuse: Partial<SailingAnalysisStages> = {};
    if (kept) {
      reuse.prepared = kept.stages.prepared;
      if (Object.is(kept.thresholdKn, thresholdKn)) {
        reuse.atThreshold = kept.stages.atThreshold;
        if (Object.is(kept.windDeg, windDeg)) {
          reuse.wind = kept.stages.wind;
          reuse.polarGraphData = kept.stages.polarGraphData;
        }
      }
    }
    if (!reuse.prepared) work.prepareSailing += 1;
    if (!reuse.atThreshold) work.atThreshold += 1;
    if (!reuse.wind) work.wind += 1;
    const { track, referenceSpeedMs, cumulative } = target.track;
    const stages = runSailingAnalysis(track, { sport, profile, referenceSpeedMs, cumulative }, thresholdKn, windDeg, reuse);
    target.sailing = { sig, stages, thresholdKn, windDeg };
    return { analysis: sailingAnalysisResult(stages), colors: colorsFor(target, options.color, stages.prepared.suggestedSpeedRangeMs) };
  };

  return {
    keepTrack: (target, track) => {
      keepTrack(target, track);
    },
    analyzeSailing,
    release: (key) => {
      if (memory?.key === key) memory = null;
    },
    get key() {
      return memory?.key ?? null;
    },
    work,
  };
};
