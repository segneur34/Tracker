/**
 * Tracés sur la carte des passages d'une zone (pente, cadence, FC) : une même
 * mesure, posée sur des pas différents.
 */

/** Un pas de la trace, du point `from` au point `to` (`from < to`). */
export interface TrackStep {
  from: number;
  to: number;
}

/**
 * Suites de positions `[lat, lon]` des pas retenus par `keep` : un tracé se
 * prolonge tant que chaque pas retenu part du point où le précédent finit, et
 * reprend au point de départ du pas sinon (zone quittée, pause, trou).
 */
export const pathsWhere = <S extends TrackStep>(
  points: ReadonlyArray<{ lat: number; lon: number }>,
  steps: Iterable<S>,
  keep: (step: S) => boolean
): [number, number][][] => {
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  let last = -1;
  for (const step of steps) {
    if (!keep(step)) continue;
    if (current === null || last !== step.from) {
      current = [[points[step.from].lat, points[step.from].lon]];
      paths.push(current);
    }
    for (let k = step.from + 1; k <= step.to; k++) current.push([points[k].lat, points[k].lon]);
    last = step.to;
  }
  return paths;
};

/** Les pas d'un point au suivant, sur toute la trace. */
export function* consecutiveSteps(length: number): Generator<TrackStep> {
  for (let i = 1; i < length; i++) yield { from: i - 1, to: i };
}
