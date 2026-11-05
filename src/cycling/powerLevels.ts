import type { AgeGradeSex } from '../running/ageGradeTables';

/**
 * Niveau à vélo d'après la puissance au seuil rapportée au poids (lot 146).
 *
 * Source : barème usuel dérivé des profils de puissance d'Andrew Coggan, tel que publié par bikecalcs.uk
 * (« benchmarks approximatifs ») : ce n'est pas une table de la population, seulement des repères. Le seuil est
 * pris ici à 95 % de la meilleure puissance moyenne sur 20 minutes, et la puissance est celle du modèle du vélo
 * (`cycling/energy.ts`), mécanique et estimée.
 */

/** Part de la meilleure puissance moyenne sur 20 minutes retenue comme puissance au seuil. */
export const THRESHOLD_FROM_20MIN = 0.95;

/** Libellés des niveaux, du plus bas au plus haut. */
export const POWER_LEVEL_LABELS = [
  'non entraîné', 'loisir', 'entraîné', 'compétiteur', 'coureur de 3e ou 4e catégorie',
  'coureur de 1re ou 2e catégorie', 'professionnel', 'élite mondiale',
] as const;

/** Bornes basses en W/kg de chaque niveau au-dessus du premier (`POWER_LEVEL_LABELS[1]` et suivants), par sexe. */
export const POWER_LEVEL_BOUNDS: Record<AgeGradeSex, readonly number[]> = {
  h: [2.0, 2.5, 3.2, 3.8, 4.2, 4.8, 5.5],
  f: [1.7, 2.2, 2.8, 3.4, 3.8, 4.3, 4.8],
};

/** Niveau d'une puissance au seuil de `wkg` W/kg : le plus haut dont elle atteint la borne basse. */
export const powerLevel = (sex: AgeGradeSex, wkg: number): string => {
  const bounds = POWER_LEVEL_BOUNDS[sex];
  let level = 0;
  for (let k = 0; k < bounds.length; k++) if (wkg >= bounds[k]) level = k + 1;
  return POWER_LEVEL_LABELS[level];
};

/** Puissance au seuil, en W/kg, d'après la meilleure puissance moyenne sur 20 minutes ; `null` sans poids valable. */
export const thresholdWkg = (best20minW: number, riderKg: number | null): number | null =>
  riderKg !== null && riderKg > 0 && Number.isFinite(best20minW) ? (best20minW * THRESHOLD_FROM_20MIN) / riderKg : null;
