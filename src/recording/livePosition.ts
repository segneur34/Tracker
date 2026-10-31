/**
 * Position de la carte du direct. Hors pause manuelle, la dernière position
 * gardée ; en pause manuelle, le GPS reste allumé sans rien garder (lot 104) :
 * la flèche suit la dernière position reçue depuis la pause, et son cap se
 * tire de ces positions, depuis le point de la pause.
 */

interface TimedPoint {
  timeMs: number;
}

/** Position montrée : la dernière reçue depuis la pause manuelle s'il y en a, sinon la dernière gardée. */
export const shownLiveFix = <F extends TimedPoint>(lastKept: F | null, pauseFixes: ReadonlyArray<F>): F | null =>
  pauseFixes[pauseFixes.length - 1] ?? lastKept;

/**
 * Positions d'où se tire le cap de la flèche (`travelHeading`) : la trace
 * gardée hors pause ; en pause manuelle, le point de la pause suivi des
 * positions reçues depuis.
 */
export const headingFixes = <F extends TimedPoint>(kept: ReadonlyArray<F>, pauseFixes: ReadonlyArray<F>): ReadonlyArray<F> => {
  if (pauseFixes.length === 0) return kept;
  const last = kept[kept.length - 1];
  return last ? [last, ...pauseFixes] : pauseFixes;
};
