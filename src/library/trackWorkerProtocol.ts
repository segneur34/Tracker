import { prepareTrack, type PreparedTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import { createAnalysisStore, type AnalyzeSailingOptions, type SailingAnalysisReply } from './analysisStore';
import { summarizeGpx, type SummarizeGpxOptions } from './summarizeGpx';
import type { AnalyzedGpx } from './summaryOptions';
import {
  isPreparedTrackMessage, packPreparedTrack, preparedTrackTransfer, unpackPreparedTrack, type PreparedTrackMessage,
} from './trackMessage';

/**
 * Messages entre l'application et le worker des traces (lot 126 B) : lire un GPX et préparer sa trace pour
 * l'analyse (`prepare`), ou le résumer pour sa fiche (`summarize`) ; depuis le lot 235, analyser la session à voile
 * ouverte (`analyzeSailing`) et oublier sa mémoire quand la page la quitte (`release`). Le worker et le calcul en
 * ligne passent par le même aiguillage (`runTrackJob`) : mêmes chiffres par construction.
 */

/**
 * Mémoire de la session ouverte (`analysisStore.ts`) : dans le worker, celle du worker ; en ligne, celle du fil de
 * l'affichage. Un worker recréé, ou une demande refaite en ligne, la trouve vide : la tâche relit alors la trace.
 */
const analysisMemory = createAnalysisStore();

/** Clé de la session gardée dans la mémoire de ce fil, `null` : aucune (tests du client). */
export const analysisMemoryKey = (): string | null => analysisMemory.key;

/** Options de `prepare` : celles de `prepareTrack`, et la clé sous laquelle garder la trace pour l'analyse qui suit. */
export interface PrepareJobOptions extends PrepareTrackOptions {
  /** Clé de la session donnée par la page : la trace lue est gardée pour `analyzeSailing`. Absente : rien n'est gardé. */
  analysisKey?: string;
  /** Numéro de cette lecture dans la page (`AnalysisTarget`), avec `analysisKey`. */
  traceId?: number;
}

/** Options de `release` : la clé de la session quittée. */
export interface ReleaseOptions {
  key: string;
}

/** Ce que prend et rend chaque calcul. */
export interface TrackJobs {
  prepare: { options: PrepareJobOptions; result: PreparedTrack };
  summarize: { options: SummarizeGpxOptions; result: AnalyzedGpx | null };
  analyzeSailing: { options: AnalyzeSailingOptions; result: SailingAnalysisReply };
  /** Le texte du GPX n'y sert pas : une chaîne vide. */
  release: { options: ReleaseOptions; result: null };
}

export type TrackJobKind = keyof TrackJobs;

export type TrackRequest = {
  [K in TrackJobKind]: { id: number; kind: K; gpxText: string; options: TrackJobs[K]['options'] };
}[TrackJobKind];

/** Erreur d'un calcul, rendue par son nom et son message : une `Error` ne garde que cela d'un clonage à l'autre. */
export interface TrackJobError {
  name: string;
  message: string;
}

/**
 * Réponse du worker. La trace préparée (`prepare`) y voyage en colonnes (`trackMessage.ts`, lot 235) : le client la
 * refait (`resultFromWorker`) avant de la rendre ; tout autre résultat voyage tel quel.
 */
export type TrackResponse =
  | { id: number; result: TrackJobs[TrackJobKind]['result'] | PreparedTrackMessage }
  | { id: number; error: TrackJobError };

/** Le calcul demandé, sur le fil où il est appelé. */
export const runTrackJob = <K extends TrackJobKind>(kind: K, gpxText: string, options: TrackJobs[K]['options']): TrackJobs[K]['result'] => {
  // Chaque branche rend le type de son calcul ; TypeScript ne relie pas `kind` au type rendu.
  if (kind === 'prepare') {
    const { analysisKey, traceId, ...prepare } = options as PrepareJobOptions;
    const prepared = prepareTrack(gpxText, prepare);
    if (analysisKey !== undefined) analysisMemory.keepTrack({ key: analysisKey, traceId: traceId ?? 0, prepare }, prepared);
    return prepared as TrackJobs[K]['result'];
  }
  if (kind === 'analyzeSailing') return analysisMemory.analyzeSailing(gpxText, options as AnalyzeSailingOptions) as TrackJobs[K]['result'];
  if (kind === 'release') {
    analysisMemory.release((options as ReleaseOptions).key);
    return null as TrackJobs[K]['result'];
  }
  return summarizeGpx(gpxText, options as SummarizeGpxOptions) as TrackJobs[K]['result'];
};

/** Erreur d'un calcul, en nom et message ; une valeur levée qui n'est pas une `Error` devient son texte. */
export const jobErrorOf = (err: unknown): TrackJobError =>
  err instanceof Error ? { name: err.name, message: err.message } : { name: 'Error', message: String(err) };

/** `Error` refaite d'une erreur rendue par le worker : même nom, même message que celle levée en ligne. */
export const errorFromJob = ({ name, message }: TrackJobError): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/**
 * Réponse du worker à une demande : le résultat, ou l'erreur levée par le calcul, jamais une exception. La trace
 * préparée part en colonnes : la page la refait en une boucle au lieu de recevoir ses objets un à un.
 */
export const handleTrackRequest = (request: TrackRequest): TrackResponse => {
  try {
    const result = runTrackJob(request.kind, request.gpxText, request.options);
    return { id: request.id, result: request.kind === 'prepare' ? packPreparedTrack(result as PreparedTrack) : result };
  } catch (err) {
    return { id: request.id, error: jobErrorOf(err) };
  }
};

/** Résultat d'une réponse du worker tel que le calcul en ligne le rend : la trace préparée refaite de ses colonnes. */
export const resultFromWorker = (result: TrackJobs[TrackJobKind]['result'] | PreparedTrackMessage): TrackJobs[TrackJobKind]['result'] =>
  isPreparedTrackMessage(result) ? unpackPreparedTrack(result) : result;

/** Mémoires à transférer sans copie avec une réponse : celles de la trace en colonnes, faites pour ce message. */
export const responseTransfer = (response: TrackResponse): ArrayBuffer[] =>
  'result' in response && isPreparedTrackMessage(response.result) ? preparedTrackTransfer(response.result) : [];
