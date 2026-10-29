/**
 * Intitulé de la plage d'une tranche, pour les tableaux de répartition (zones
 * cardiaques, pas par minute). `bounds` sont les bornes basses des tranches 1 et
 * suivantes : la tranche 0 va jusqu'à `bounds[0]` exclu (« < b »), la dernière
 * commence à sa borne (« ≥ b ») et les autres vont de leur borne basse à celle
 * de la suivante exclue (« a-b », bornes entières).
 */
export const bandRangeLabel = (bounds: readonly number[], band: number): string =>
  band === 0 ? `< ${bounds[0]}` : band === bounds.length ? `≥ ${bounds[band - 1]}` : `${bounds[band - 1]}-${bounds[band] - 1}`;
