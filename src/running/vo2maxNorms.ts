import type { AgeGradeSex } from './ageGradeTables';

/**
 * Normes de VO2max de la population générale (lot 146).
 *
 * Source : registre FRIEND, standards de 2022 sur tapis (Kaminsky et al., Mayo Clinic Proceedings 2022,
 * 97(2):285-293, doi 10.1016/j.mayocp.2021.08.020) : adultes américains en bonne santé apparente, de 20 à 89 ans,
 * tests d'effort en laboratoire (RER ≥ 1,10) ; valeurs reprises de fitnessnorms.com, qui les reproduit.
 * Percentiles en ml/kg/min, par décennie et par sexe (`h` hommes, `f` femmes).
 */

/** Percentiles des colonnes des tables. */
export const VO2MAX_PERCENTILES = [5, 25, 50, 75, 95] as const;

/** Une décennie des tables : ses âges (bornes comprises) et la VO2max à chaque percentile de `VO2MAX_PERCENTILES`. */
export interface Vo2maxBand {
  fromAge: number;
  toAge: number;
  values: readonly number[];
}

export const VO2MAX_NORMS: Record<AgeGradeSex, readonly Vo2maxBand[]> = {
  h: [
    { fromAge: 20, toAge: 29, values: [24.8, 37.3, 45.4, 52.6, 62.1] },
    { fromAge: 30, toAge: 39, values: [20.6, 31.3, 38.6, 46.5, 57.9] },
    { fromAge: 40, toAge: 49, values: [19.7, 28.4, 34.8, 41.8, 53.2] },
    { fromAge: 50, toAge: 59, values: [16.5, 23.9, 29.4, 35.5, 46.8] },
    { fromAge: 60, toAge: 69, values: [13.8, 19.7, 24.4, 29.9, 40.2] },
    { fromAge: 70, toAge: 79, values: [11.6, 16.8, 20.6, 25.0, 35.2] },
    { fromAge: 80, toAge: 89, values: [12.2, 15.9, 17.7, 20.9, 25.6] },
  ],
  f: [
    { fromAge: 20, toAge: 29, values: [19.3, 28.6, 35.6, 42.2, 50.1] },
    { fromAge: 30, toAge: 39, values: [16.6, 23.1, 28.3, 34.5, 45.5] },
    { fromAge: 40, toAge: 49, values: [15.3, 21.3, 25.9, 30.9, 40.7] },
    { fromAge: 50, toAge: 59, values: [14.5, 19.5, 23.1, 27.3, 35.3] },
    { fromAge: 60, toAge: 69, values: [12.0, 16.4, 19.4, 23.1, 29.7] },
    { fromAge: 70, toAge: 79, values: [11.3, 14.8, 17.1, 20.0, 24.2] },
    { fromAge: 80, toAge: 89, values: [10.7, 12.8, 15.1, 17.2, 20.7] },
  ],
};

/** Décennie d'un âge : avant 20 ans, la première ; après 89, la dernière. */
export const vo2maxBand = (sex: AgeGradeSex, age: number): Vo2maxBand => {
  const bands = VO2MAX_NORMS[sex];
  return bands.find((b) => age >= b.fromAge && age <= b.toAge) ?? (age < bands[0].fromAge ? bands[0] : bands[bands.length - 1]);
};

/**
 * Situation d'une VO2max parmi la population de son âge et de son sexe : sous le premier percentile des tables,
 * « parmi les 5 % les plus bas » (`below`) ; au-dessus du dernier, « parmi les 5 % les plus hauts » (`above`) ;
 * entre deux, le percentile interpolé linéairement entre leurs colonnes.
 */
export type Vo2maxStanding =
  | { kind: 'below'; percentile: number; band: Vo2maxBand }
  | { kind: 'above'; percentile: number; band: Vo2maxBand }
  | { kind: 'within'; percentile: number; band: Vo2maxBand };

export const vo2maxPercentile = (sex: AgeGradeSex, age: number, vo2: number): Vo2maxStanding => {
  const band = vo2maxBand(sex, age);
  const v = band.values;
  const first = VO2MAX_PERCENTILES[0];
  const last = VO2MAX_PERCENTILES[VO2MAX_PERCENTILES.length - 1];
  if (vo2 < v[0]) return { kind: 'below', percentile: first, band };
  if (vo2 > v[v.length - 1]) return { kind: 'above', percentile: last, band };
  for (let k = 1; k < v.length; k++) {
    if (vo2 <= v[k]) {
      const span = v[k] - v[k - 1];
      const t = span > 0 ? (vo2 - v[k - 1]) / span : 1;
      const percentile = VO2MAX_PERCENTILES[k - 1] + t * (VO2MAX_PERCENTILES[k] - VO2MAX_PERCENTILES[k - 1]);
      return { kind: 'within', percentile, band };
    }
  }
  return { kind: 'above', percentile: last, band };
};
