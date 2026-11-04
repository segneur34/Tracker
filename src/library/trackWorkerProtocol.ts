import { prepareTrack, type PreparedTrack, type PrepareTrackOptions } from '../core/prepareTrack';
import { summarizeGpx, type SummarizeGpxOptions } from './summarizeGpx';
import type { AnalyzedGpx } from './summaryOptions';

/**
 * Messages entre l'application et le worker des traces (lot 126 B) : lire un GPX et préparer sa trace pour
 * l'analyse (`prepare`), ou le résumer pour sa fiche (`summarize`). Le worker et le calcul en ligne passent par
 * le même aiguillage (`runTrackJob`) : mêmes chiffres par construction.
 */

/** Ce que prend et rend chaque calcul. */
export interface TrackJobs {
  prepare: { options: PrepareTrackOptions; result: PreparedTrack };
  summarize: { options: SummarizeGpxOptions; result: AnalyzedGpx | null };
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

export type TrackResponse =
  | { id: number; result: TrackJobs[TrackJobKind]['result'] }
  | { id: number; error: TrackJobError };

/** Le calcul demandé, sur le fil où il est appelé. */
export const runTrackJob = <K extends TrackJobKind>(kind: K, gpxText: string, options: TrackJobs[K]['options']): TrackJobs[K]['result'] => {
  // Les deux branches rendent le type de leur calcul ; TypeScript ne relie pas `kind` au type rendu.
  if (kind === 'prepare') return prepareTrack(gpxText, options as PrepareTrackOptions) as TrackJobs[K]['result'];
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

/** Réponse du worker à une demande : le résultat, ou l'erreur levée par le calcul, jamais une exception. */
export const handleTrackRequest = (request: TrackRequest): TrackResponse => {
  try {
    return { id: request.id, result: runTrackJob(request.kind, request.gpxText, request.options) };
  } catch (err) {
    return { id: request.id, error: jobErrorOf(err) };
  }
};
