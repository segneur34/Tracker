/**
 * Trait de raccord de la carte du direct : la trace calculée (`useLiveRecording`,
 * toutes les 2 s au plus) est prolongée jusqu'à la position du moment par un
 * trait à part, entre deux calculs. Ce trait ne joint jamais deux segments :
 * juste après une reprise, la position est déjà dans le nouveau segment alors
 * que la trace calculée s'arrête encore au point de la pause (lot 104, trait
 * droit vers la nouvelle position à la reprise d'une pause manuelle).
 */

interface LatLonPoint {
  lat: number;
  lon: number;
}

/**
 * Les deux bouts du raccord, ou `null` : `segments` est la trace calculée, un
 * tableau par segment ; `positionSegment` le rang, dans l'enregistrement, du
 * segment de la position (le dernier pour une position gardée), `null` pour
 * une position qui n'est pas gardée. Raccord seulement si la position est dans
 * le dernier segment calculé (de longueur nulle juste après un calcul).
 */
export const liveTail = <P extends LatLonPoint>(
  segments: ReadonlyArray<ReadonlyArray<P>>,
  position: P | null,
  positionSegment: number | null
): [P, P] | null => {
  const last = segments[segments.length - 1]?.at(-1);
  if (!last || !position || positionSegment !== segments.length - 1) return null;
  return [last, position];
};
