/**
 * La dernière demande gagne (lot 235, d'après Gtracker) : un seul calcul en vol à la fois ; une demande qui arrive
 * pendant ce temps attend, et remplace celle qui attendait déjà, rendue « dépassée » sans avoir été calculée. Le
 * calcul en vol va à son terme (un worker ne s'interrompt pas), mais si une demande plus récente existe à son retour,
 * il est rendu « dépassé » lui aussi : seule la dernière demande peut être rendue comme bonne. `cancel` rend dépassées
 * la demande en attente et celle en vol (page quittée). Trois réglages tirés vite à la suite : la première et la
 * dernière valeur sont calculées, seule la dernière est montrée.
 */

/** Issue d'une demande : son résultat si elle est restée la dernière, sinon « dépassée ». */
export type LatestOutcome<T> = { current: true; value: T } | { current: false };

export interface LatestRequest<I, T> {
  /**
   * Demande un calcul. La promesse rend son résultat s'il est encore le dernier demandé à son retour, « dépassée »
   * sinon ; elle n'est rejetée que par l'erreur du calcul de la dernière demande.
   */
  run(input: I): Promise<LatestOutcome<T>>;
  /** Rend dépassées la demande en attente et celle en vol ; une demande suivante repart normalement. */
  cancel(): void;
}

const OUTDATED: LatestOutcome<never> = { current: false };

interface Waiting<I, T> {
  input: I;
  generation: number;
  resolve(outcome: LatestOutcome<T>): void;
  reject(error: unknown): void;
}

export const createLatestRequest = <I, T>(compute: (input: I) => Promise<T>): LatestRequest<I, T> => {
  /** Rang de la dernière demande ; une demande d'un autre rang est dépassée. */
  let generation = 0;
  let inFlight = false;
  let waiting: Waiting<I, T> | null = null;

  const start = (job: Waiting<I, T>): void => {
    inFlight = true;
    const settle = (outcome: () => void): void => {
      inFlight = false;
      if (job.generation === generation) outcome();
      else job.resolve(OUTDATED);
      const next = waiting;
      waiting = null;
      if (next) start(next);
    };
    // Un calcul qui lève sans promesse est traité comme une promesse rejetée.
    new Promise<T>((resolve) => {
      resolve(compute(job.input));
    }).then(
      (value) => settle(() => job.resolve({ current: true, value })),
      (error: unknown) => settle(() => job.reject(error))
    );
  };

  return {
    run: (input) => {
      generation += 1;
      const current = generation;
      return new Promise<LatestOutcome<T>>((resolve, reject) => {
        const job: Waiting<I, T> = { input, generation: current, resolve, reject };
        waiting?.resolve(OUTDATED);
        waiting = null;
        if (inFlight) waiting = job;
        else start(job);
      });
    },
    cancel: () => {
      generation += 1;
      waiting?.resolve(OUTDATED);
      waiting = null;
    },
  };
};
