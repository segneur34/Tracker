/**
 * Fréquence cardiaque de repos de la population, par âge et par sexe (lot 230,
 * part « forme pour l'âge » de la note de niveau, `sportLevel.ts`).
 *
 * Source : Ostchega Y, Porter KS, Hughes J, Dillon CF, Nwankwo T, « Resting
 * Pulse Rate Reference Data for Children, Adolescents, and Adults: United
 * States, 1999-2008 », National Health Statistics Reports n° 41, NCHS, 2011
 * (https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf), tables 2 (hommes) et 3
 * (femmes), relevées à la source le 26/11/2026 : personnes sans maladie ni
 * médicament qui change la fréquence de repos, pouls assis compté 30 s après
 * environ 4 minutes de repos. Valeurs en bpm, recopiées telles qu'imprimées ;
 * une case vide du rapport reste vide (`null`), jamais remplie.
 *
 * Neutre (aucun sport) et pur.
 */

/** Sexe des tables : `h` hommes, `f` femmes. */
export type NormSex = 'h' | 'f';

/** Percentiles des colonnes des tables. */
export const RESTING_HR_PERCENTILES = [1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99] as const;

/** Une tranche d'âge des tables (bornes comprises, `toAge` infini pour la dernière) et la FC à chaque percentile, `null` si la case est vide. */
export interface RestingHrBand {
  fromAge: number;
  toAge: number;
  values: readonly (number | null)[];
}

export const RESTING_HR_NORMS: Record<NormSex, readonly RestingHrBand[]> = {
  h: [
    { fromAge: 0, toAge: 0, values: [84, 98, 102, 107, 115, 125, 137, 148, 155, 160, 171] },
    { fromAge: 1, toAge: 1, values: [null, 91, 95, 100, 107, 114, 122, 131, 137, 146, 156] },
    { fromAge: 2, toAge: 3, values: [75, 82, 85, 89, 96, 104, 112, 119, 124, 131, 139] },
    { fromAge: 4, toAge: 5, values: [69, 71, 74, 78, 84, 92, 100, 108, 112, 116, 120] },
    { fromAge: 6, toAge: 8, values: [59, 63, 66, 70, 76, 83, 92, 100, 105, 109, 114] },
    { fromAge: 9, toAge: 11, values: [56, 59, 61, 66, 70, 78, 86, 94, 97, 102, 110] },
    { fromAge: 12, toAge: 15, values: [52, 54, 57, 60, 66, 74, 83, 91, 97, 102, 108] },
    { fromAge: 16, toAge: 19, values: [46, 50, 52, 56, 61, 69, 78, 87, 92, 95, 104] },
    { fromAge: 20, toAge: 39, values: [47, 50, 52, 55, 61, 69, 76, 84, 89, 95, 101] },
    { fromAge: 40, toAge: 59, values: [46, 49, 52, 55, 61, 68, 77, 85, 90, 95, 104] },
    { fromAge: 60, toAge: 79, values: [45, 48, 50, 54, 60, 67, 75, 84, 91, 98, 102] },
    { fromAge: 80, toAge: Infinity, values: [null, 48, 51, 54, 61, 68, 78, 86, 94, 97, null] },
  ],
  f: [
    { fromAge: 0, toAge: 0, values: [96, 99, 104, 108, 118, 127, 137, 150, 156, 163, 174] },
    { fromAge: 1, toAge: 1, values: [82, 92, 95, 101, 110, 117, 125, 135, 139, 143, 158] },
    { fromAge: 2, toAge: 3, values: [78, 83, 88, 91, 98, 107, 114, 120, 125, 130, 137] },
    { fromAge: 4, toAge: 5, values: [70, 73, 76, 81, 87, 95, 104, 110, 117, 122, 132] },
    { fromAge: 6, toAge: 8, values: [61, 66, 69, 73, 79, 87, 94, 101, 106, 109, 117] },
    { fromAge: 9, toAge: 11, values: [58, 63, 66, 69, 76, 83, 91, 98, 103, 107, 113] },
    { fromAge: 12, toAge: 15, values: [54, 57, 60, 63, 70, 79, 87, 94, 99, 103, 110] },
    { fromAge: 16, toAge: 19, values: [50, 54, 58, 62, 69, 77, 85, 94, 99, 103, 108] },
    { fromAge: 20, toAge: 39, values: [52, 55, 57, 60, 66, 74, 82, 89, 95, 99, 104] },
    { fromAge: 40, toAge: 59, values: [51, 53, 56, 59, 64, 71, 79, 86, 92, 97, 101] },
    { fromAge: 60, toAge: 79, values: [52, 54, 56, 59, 64, 70, 78, 86, 92, 96, 102] },
    { fromAge: 80, toAge: Infinity, values: [null, 53, 56, 59, 64, 71, 77, 85, 93, 98, 100] },
  ],
};

/** Tranche d'un âge : sous la première, la première ; au-delà de la dernière, la dernière. */
export const restingHrBand = (sex: NormSex, age: number): RestingHrBand => {
  const bands = RESTING_HR_NORMS[sex];
  return bands.find((b) => age >= b.fromAge && age <= b.toAge) ?? (age < bands[0].fromAge ? bands[0] : bands[bands.length - 1]);
};

/**
 * Rang d'une FC de repos parmi la population de son âge et de son sexe : la
 * part, en %, des gens dont la FC est plus basse. Entre deux percentiles
 * publiés, interpolé linéairement entre leurs colonnes ; une case vide est
 * sautée (on interpole entre ses voisines publiées). Sous la plus petite valeur
 * publiée, « parmi les plus basses » (`below`) au premier percentile publié de
 * la tranche ; au-dessus de la plus grande, « parmi les plus hautes » (`above`)
 * au dernier : rien n'est extrapolé hors des tables. `offsetBpm` est ajouté à la
 * FC avant de la situer (écart entre la mesure et celle des tables).
 */
export type RestingHrStanding =
  | { kind: 'below'; percentile: number; band: RestingHrBand }
  | { kind: 'above'; percentile: number; band: RestingHrBand }
  | { kind: 'within'; percentile: number; band: RestingHrBand };

export const restingHrRank = (sex: NormSex, age: number, bpm: number, offsetBpm = 0): RestingHrStanding => {
  const band = restingHrBand(sex, age);
  const columns = RESTING_HR_PERCENTILES.flatMap((percentile, k) => {
    const value = band.values[k];
    return value === null || value === undefined ? [] : [{ percentile, value }];
  });
  const hr = bpm + offsetBpm;
  const first = columns[0];
  const last = columns[columns.length - 1];
  if (hr < first.value) return { kind: 'below', percentile: first.percentile, band };
  if (hr > last.value) return { kind: 'above', percentile: last.percentile, band };
  for (let k = 1; k < columns.length; k++) {
    const lo = columns[k - 1];
    const hi = columns[k];
    if (hr > hi.value) continue;
    // Deux colonnes égales : le milieu de leurs percentiles (aucune table publiée ne le fait, garde-fou).
    const t = hi.value > lo.value ? (hr - lo.value) / (hi.value - lo.value) : 1 / 2;
    return { kind: 'within', percentile: lo.percentile + t * (hi.percentile - lo.percentile), band };
  }
  return { kind: 'within', percentile: first.percentile, band };
};
