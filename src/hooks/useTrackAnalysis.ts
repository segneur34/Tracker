import { useEffect, useRef, useState } from 'react';
import type { SpeedRangeMs } from '../core/speedGradient';
import { effectiveSpeedRange } from '../core/trackColor';
import { stableText, type TrackColorOptions } from '../library/analysisStore';
import { createLatestRequest } from '../library/latestRequest';
import { runInWorker } from '../library/trackWorkerClient';
import { sameFile, type AnalysisSource, type GpxAnalysisInput } from './useGpxSession';

/**
 * Analyse de la session ouverte faite par le calcul en arrière-plan (lot 235, d'après Gtracker ; la voile seule,
 * `analyzeSailing`), rendue avec la trace sur laquelle elle a été faite : jamais l'analyse d'une session sur la trace
 * d'une autre, dont les indices déborderaient. Tant qu'une trace neuve n'a pas sa première analyse, rien n'est montré
 * (« Lecture de la session… ») ; ensuite, pendant un recalcul (seuil, vent saisi, couleurs, trace relue pour une autre
 * allure ou un autre support), les derniers chiffres restent affichés et l'analyse est dite en attente : rien n'en est
 * recopié dans la fiche. La dernière demande gagne (`latestRequest.ts`) ; quitter la page abandonne le calcul et vide
 * sa mémoire (`release`).
 */

/** Une analyse et la trace sur laquelle elle a été faite, inséparables. */
export interface AnalysisPair<T> {
  source: AnalysisSource;
  /** Entrées de l'analyse mises en texte : seuil, vent, profil, couleurs… */
  inputs: string;
  result: T;
}

/** Ce que la page montre de l'analyse. */
export interface AnalysisView<T> {
  /** Analyse montrée et sa trace ; `null` : aucune (rien de lu, ou une trace neuve dont la première analyse n'est pas arrivée). */
  pair: AnalysisPair<T> | null;
  /** Une trace neuve attend sa première analyse : « Lecture de la session… ». */
  reading: boolean;
  /** L'analyse montrée n'est pas celle de la trace et des entrées demandées : rien n'en est recopié dans la fiche. */
  pending: boolean;
}

/**
 * Ce que la page montre, d'après la dernière analyse reçue et la trace affichée. Une analyse d'un autre fichier n'est
 * jamais montrée ; une analyse du même fichier l'est, en attente si sa trace (relue pour une autre allure ou un autre
 * support) ou ses entrées ne sont plus celles demandées, ou si la lecture de la trace n'est pas à jour (`settled`).
 */
export const analysisView = <T>(
  pair: AnalysisPair<T> | null, source: AnalysisSource | null, inputs: string, settled = true
): AnalysisView<T> => {
  if (source === null) return { pair: null, reading: false, pending: false };
  const shown = pair !== null && sameFile(pair.source.from, source.from) ? pair : null;
  return {
    pair: shown,
    reading: shown === null,
    pending: shown === null || shown.source.prepared !== source.prepared || shown.inputs !== inputs || !settled,
  };
};

/**
 * Traitement et bornes effectives des couleurs d'une analyse, en texte : les bornes ordonnées comme le calcul les
 * ordonne (`effectiveSpeedRange`), avec la suggestion de l'analyse reçue ; sans couleurs, un texte vide.
 */
export const colorKeyOf = (color: TrackColorOptions | null, suggested: SpeedRangeMs | null): string => {
  if (!color) return '';
  const { minMs, maxMs } = effectiveSpeedRange({
    sessionRange: color.sessionRange, activityRange: color.activityRange, suggested, fallback: color.fallback,
  });
  return stableText([color.treatment, minMs, maxMs]);
};

/**
 * Valeur faite pour une trace et une clé (traits de la trace colorée), gardée telle quelle tant que ni l'une ni
 * l'autre ne change : chaque réponse du calcul apporte une copie des couleurs, et la carte redessinerait sinon toute la
 * trace à chaque seuil ou vent touché. `make` n'est appelé qu'au changement.
 */
export const useKeptForTrack = <S>(track: object, key: string, make: () => S): S => {
  const [kept, setKept] = useState(() => ({ value: make(), track, key }));
  if (kept.track === track && kept.key === key) return kept.value;
  const value = make();
  setKept({ value, track, key });
  return value;
};

/** Demandes d'analyse d'une page : la dernière gagne, et quitter vide la mémoire du calcul. */
export interface TrackAnalysisRequests<T> {
  /** Lance un calcul ; rend sa paire s'il est resté la dernière demande à son retour, `null` s'il a été dépassé. */
  request(source: AnalysisSource, inputs: string, compute: () => Promise<T>): Promise<AnalysisPair<T> | null>;
  /** Page quittée : demandes en cours dépassées, mémoire de la session `key` vidée dans le calcul. */
  leave(key: string): Promise<void>;
}

export const createTrackAnalysisRequests = <T>(): TrackAnalysisRequests<T> => {
  const latest = createLatestRequest((compute: () => Promise<T>) => compute());
  return {
    request: (source, inputs, compute) =>
      latest.run(compute).then((outcome) => (outcome.current ? { source, inputs, result: outcome.value } : null)),
    leave: (key) => {
      latest.cancel();
      return runInWorker('release', '', { key }).then(() => undefined);
    },
  };
};

/**
 * Analyse de la trace affichée par `useGpxSession` (`gpx.analysis`) : `compute` la demande au calcul pour une trace ;
 * `inputs` met en texte tout ce dont elle dépend hors de la trace, un autre texte la redemande. Une erreur du calcul
 * remonte au rendu, comme quand l'analyse se faisait sur le fil de l'affichage.
 */
export const useTrackAnalysis = <T>(
  gpx: GpxAnalysisInput, inputs: string, compute: (source: AnalysisSource) => Promise<T>
): AnalysisView<T> => {
  const { key, source, settled } = gpx;
  const [requests] = useState(() => createTrackAnalysisRequests<T>());
  const [pair, setPair] = useState<AnalysisPair<T> | null>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  // Le calcul du dernier rendu : ses options sont celles que `inputs` décrit.
  const computeRef = useRef(compute);
  useEffect(() => {
    computeRef.current = compute;
  });

  // Pas de demande tant que la trace affichée se relit (allure, support) : l'analyse de l'ancienne trace aux nouvelles
  // entrées serait calculée pour rien, et la vraie attendrait derrière elle (un calcul en vol va à son terme).
  useEffect(() => {
    if (source === null || !settled) return;
    let alive = true;
    const run = computeRef.current;
    requests.request(source, inputs, () => run(source)).then(
      (reply) => {
        if (alive && reply) setPair(reply);
      },
      (error: unknown) => {
        if (alive) setFailure({ error });
      }
    );
    return () => {
      alive = false;
    };
  }, [requests, source, inputs, settled]);

  useEffect(() => () => {
    void requests.leave(key);
  }, [requests, key]);

  if (failure) throw failure.error;
  return analysisView(pair, source, inputs, settled);
};
