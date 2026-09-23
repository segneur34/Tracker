/**
 * Survol des graphes : relie un point d'un graphe Recharts au point de la
 * trace qu'il représente, pour déplacer le marqueur sur la carte.
 *
 * Les graphes sont sous-échantillonnés (`CHART_MAX_POINTS`) : chaque entrée
 * porte l'indice `index` du point de trace d'origine, et c'est cet indice
 * que la carte attend.
 */

/** Sous-ensemble de l'événement de souris de Recharts utilisé pour le survol. */
export interface ChartHoverEvent {
  isTooltipActive?: boolean;
  /** Recharts 3 accepte aussi un indice sous forme de chaîne. */
  activeTooltipIndex?: number | string | null;
}

/**
 * Indice de trace du point survolé, ou `null` si aucune infobulle n'est
 * active ou si l'indice ne correspond à aucune entrée du graphe.
 */
export const hoveredTrackIndex = (
  e: ChartHoverEvent | null | undefined,
  data: ReadonlyArray<{ index: number }>
): number | null => {
  if (!e || !e.isTooltipActive || e.activeTooltipIndex === undefined || e.activeTooltipIndex === null) {
    return null;
  }
  const chartIndex = Number(e.activeTooltipIndex);
  if (!Number.isInteger(chartIndex)) return null;
  return data[chartIndex]?.index ?? null;
};
