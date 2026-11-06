import { forEachCounted } from './heartRate';
import { activeDurationS, type HeartRateSessionPoint } from './heartRateSession';
import type { HeartRateProfile, HrEnergyProfile, KeytelCoefficients } from './sportProfiles';
import { J_PER_KCAL } from './units';

/**
 * Énergie dépensée estimée par la fréquence cardiaque (lot 96), en voile et en
 * surf, où la vitesse ne dit rien de l'effort : équation de Keytel (2005) sans
 * VO2max, à partir de la FC, du poids, de l'âge et du sexe. Un ordre de
 * grandeur (25 % d'écart et plus), jamais additionné à l'énergie mécanique de
 * la course et du vélo. Sorties en joules ; paramètres de `HrEnergyProfile`.
 *
 * Tout se mesure en temps (règle 2) : chaque intervalle compté de la FC
 * (`forEachCounted`, le « Temps mesuré » de l'onglet cardio) apporte le débit
 * moyen de ses deux bouts × sa durée ; un trou de plus de `gapS` n'est pas
 * compté. La FC est bornée au plafond (FC max, sinon base − âge + marge) ; sous
 * le plancher, le débit retombe au repos, et il n'est jamais plus bas.
 */

/** Ce qu'il faut savoir du pratiquant (`RunnerProfile`, âge à la date de la session). */
export interface HrEnergyAthlete {
  weightKg: number | null;
  age: number | null;
  /** `null` : moyenne des équations homme et femme. */
  sex: 'f' | 'm' | null;
  /** FC max saisie ; `null` : plafond tiré de l'âge. */
  hrMax: number | null;
}

export type HrEnergyEstimate =
  /** Poids ou âge manquant : pas de chiffre. */
  | { kind: 'profil-incomplet' }
  | {
    kind: 'estimation';
    /** Total brut, repos compris, en J : extrapolé à la session entière si `extrapolated`, sinon la part mesurée seule. */
    totalJ: number;
    /** Dont repos (1 MET) sur la même durée que le total, en J. */
    restJ: number;
    /** Temps couvert par la FC, en secondes. */
    measuredS: number;
    /** Durée de la session hors pauses, en secondes. */
    sessionS: number;
    /** `measuredS / sessionS`, de 0 à 1. */
    coverage: number;
    /** Couverture suffisante (`coverageForTotal`) : total porté à la session entière, au débit moyen mesuré. */
    extrapolated: boolean;
    /** Sexe inconnu : moyenne des deux équations. */
    sexAveraged: boolean;
    /** Temps mesuré sous le plancher, compté au repos, en secondes. */
    belowFloorS: number;
  };

/** Débit d'une équation de Keytel, en W. */
const keytelW = (c: KeytelCoefficients, bpm: number, weightKg: number, age: number): number =>
  ((c.intercept + c.hr * bpm + c.weight * weightKg + c.age * age) * 1000) / 60;

/** Plafond de la FC retenue : la FC max saisie, sinon base − âge + marge, en bpm. */
export const hrEnergyCeilingBpm = (hrMax: number | null, age: number, energy: HrEnergyProfile): number =>
  hrMax ?? energy.ageHrMax.baseBpm - age + energy.ageHrMax.marginBpm;

/**
 * Débit estimé à `bpm`, en W : le repos sous le plancher, Keytel à la FC
 * bornée au plafond au-dessus, jamais moins que le repos.
 */
export const hrEnergyPowerW = (
  bpm: number,
  athlete: { weightKg: number; age: number; sex: 'f' | 'm' | null; hrMax: number | null },
  energy: HrEnergyProfile
): number => {
  const { weightKg, age, sex } = athlete;
  const restW = energy.restWPerKg * weightKg;
  if (bpm < energy.floorBpm) return restW;
  const hr = Math.min(bpm, hrEnergyCeilingBpm(athlete.hrMax, age, energy));
  const w = sex === null
    ? (keytelW(energy.keytel.m, hr, weightKg, age) + keytelW(energy.keytel.f, hr, weightKg, age)) / 2
    : keytelW(energy.keytel[sex], hr, weightKg, age);
  return Math.max(w, restW);
};

/**
 * Énergie de la session. `smoothed` : la FC lissée point par point
 * (`smoothHeartRate`, `useSessionHeartRate`), pas relissée ici. `null` sous
 * `minCoverageS` de FC ; `profil-incomplet` sans poids ou sans âge.
 */
export const estimateHrEnergy = (
  points: readonly HeartRateSessionPoint[],
  smoothed: readonly (number | null)[],
  athlete: HrEnergyAthlete,
  heartRate: Pick<HeartRateProfile, 'gapS' | 'minCoverageS'>,
  energy: HrEnergyProfile
): HrEnergyEstimate | null => {
  let measuredS = 0;
  forEachCounted(points, smoothed, heartRate.gapS, (_, __, dtS) => (measuredS += dtS));
  if (measuredS < heartRate.minCoverageS || measuredS <= 0) return null;
  const { weightKg, age, sex, hrMax } = athlete;
  if (weightKg === null || !isFinite(weightKg) || weightKg <= 0 || age === null || !isFinite(age) || age <= 0) {
    return { kind: 'profil-incomplet' };
  }
  const who = { weightKg, age, sex, hrMax };
  let measuredJ = 0;
  let belowFloorS = 0;
  forEachCounted(points, smoothed, heartRate.gapS, (_, bpm, dtS, from) => {
    // Débit moyen des deux bouts : le trou court (jusqu'à `gapS`) est interpolé.
    const fromBpm = Math.round(smoothed[from] ?? bpm);
    measuredJ += ((hrEnergyPowerW(fromBpm, who, energy) + hrEnergyPowerW(bpm, who, energy)) / 2) * dtS;
    if (bpm < energy.floorBpm) belowFloorS += dtS;
  });
  // Un intervalle compté peut enjamber une reprise, que la durée hors pauses ne compte pas.
  const sessionS = Math.max(activeDurationS(points), measuredS);
  const coverage = measuredS / sessionS;
  const extrapolated = coverage >= energy.coverageForTotal;
  const coveredS = extrapolated ? sessionS : measuredS;
  return {
    kind: 'estimation',
    totalJ: extrapolated ? (measuredJ * sessionS) / measuredS : measuredJ,
    restJ: energy.restWPerKg * weightKg * coveredS,
    measuredS,
    sessionS,
    coverage,
    extrapolated,
    sexAveraged: sex === null,
    belowFloorS,
  };
};

/** Énergie à afficher, en kcal, arrondie à `stepKcal`. */
export const hrEnergyKcal = (j: number, stepKcal: number): number => Math.round(j / J_PER_KCAL / stepKcal) * stepKcal;
