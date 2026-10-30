import { roundTo } from '../core/basics';
import type { GradeZone } from '../core/grade';
import type { BikeType } from '../core/domainTypes';
import type { GradeProfile } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { J_PER_KCAL, formatDecimal } from '../core/units';
import type { SurfaceCategory } from '../planning/surface';
import { computeEnergy, restingPowerWkg, runningEnergyParams, walkingEnergyParams, type EnergyModel } from './energy';

/**
 * Mise en forme de l'énergie à pied pour le panneau Énergie des analyses
 * terrestres, sans rendu : chiffres formatés, tableau par zone, note du
 * modèle, et l'avertissement réduit à un code que le module met en phrase.
 * Les types sont communs au vélo (`cycling/energyView.ts`).
 */

/** Clé d'un chiffre du panneau Énergie : la dépense totale (`'total'`) est reprise par l'onglet « général » à vélo. */
export type EnergyStatKey = 'effort' | 'total' | 'puissance' | 'cout-km' | 'travail';

/** Un chiffre du panneau Énergie : sa valeur, et en plus petit un complément. */
export interface EnergyStat {
  key: EnergyStatKey;
  label: string;
  value: string;
  detail?: string;
}

/** Libellé de la dépense totale, repos compris. */
export const TOTAL_ENERGY_LABEL = 'Dépense totale, repos compris';

/** Une ligne du tableau d'énergie par zone de pente, valeurs déjà formatées. */
export interface EnergyZoneRow {
  zone: GradeZone;
  energy: string;
  share: number;
  perKm: string;
  /** Puissance mécanique moyenne en mouvement dans la zone, dans l'unité de puissance du modèle. */
  power: string;
  distanceM: number;
}

/**
 * Avertissement sur les données manquantes, rendu en phrase par le module :
 * - `sans-poids` : à pied, valeurs par kilo ; `sans-poids-charge` en plus, la charge ignorée ;
 * - `sans-poids-velo` : à vélo, rien n'est calculé ;
 * - `revetement-recherche`, `revetement-introuvable` : à vélo, le roulement moyen (`nominal`) partout.
 */
export type EnergyWarning =
  | { code: 'sans-poids' }
  | { code: 'sans-poids-charge'; loadKg: number }
  | { code: 'sans-poids-velo' }
  | { code: 'revetement-recherche'; nominal: string }
  | { code: 'revetement-introuvable'; nominal: string };

/** Ce que le panneau Énergie affiche, quel que soit le modèle, avant le rendu de l'avertissement. */
export interface EnergyViewData {
  /** Puissance en chaque point, dans `powerUnit`, `NaN` à l'arrêt ; lissée par le module. */
  power: number[];
  powerUnit: string;
  /** Énergie totale dépensée depuis le départ, dans `cumulativeUnit`. */
  cumulative: number[];
  cumulativeUnit: string;
  stats: EnergyStat[];
  zones: EnergyZoneRow[];
  warning: EnergyWarning | null;
  /** Rappel du modèle, sous le panneau. */
  note: string;
}

/** Ce que le calcul retient du pratiquant (`RunnerProfile`). */
export interface EnergyRunner {
  weightKg: number | null;
  heightCm: number | null;
  sex: 'f' | 'm' | null;
  economyMlKgKm: number | null;
}

export interface EnergyInputs {
  track: TrackPoint[];
  grades: number[];
  /** Seuils des zones de pente (`SportProfile.grade`). */
  gradeZones: GradeProfile;
  activityMask: boolean[];
  runner: EnergyRunner;
  age: number | null;
  bikeType: BikeType;
  /** Poids du vélo, bagages compris : celui de la session, sinon celui de l'activité. */
  bikeWeightKg: number;
  /** Charge portée en course, en kg : celle de la session, sinon celle de l'activité. */
  loadKg: number;
  /** Modèle de dépense à pied de l'activité (réglage « Dépense ») : course (Minetti) ou marche (Pandolf). */
  energyModel: EnergyModel;
  /** Revêtement des voies suivies : état de la recherche, et revêtement de chaque segment une fois connu. */
  surfaces: {
    status: 'idle' | 'searching' | 'error' | 'ready';
    stretches: ReadonlyArray<{ category: SurfaceCategory }> | null;
  };
}

/**
 * Course : modèle par kilo (`running/energy.ts`), le poids ne multiplie qu'à
 * l'affichage ; sans lui, les valeurs restent par kilo et la charge portée,
 * rapportée au poids du corps, est ignorée. La marche (réglage « Dépense »)
 * prend Pandolf à la place de Minetti, le reste à l'identique.
 */
export const runningEnergyView = ({ track, grades, gradeZones, activityMask, runner, age, loadKg, energyModel }: EnergyInputs): EnergyViewData => {
  const walking = energyModel === 'marche';
  const params = {
    ...(walking ? walkingEnergyParams(runner.economyMlKgKm, runner.weightKg) : runningEnergyParams(runner.economyMlKgKm)),
    gradeZones,
  };
  const effort = walking ? 'marche' : 'course';
  const restWkg = restingPowerWkg(runner, age, params);
  const mass = runner.weightKg;
  const load = mass !== null && loadKg > 0 ? loadKg : 0;
  const energy = computeEnergy(track, grades, activityMask, params, restWkg, mass !== null ? load / mass : 0);
  const massFactor = mass ?? 1;
  const perKg = mass === null ? '/kg' : '';
  const kcal = (jkg: number) => {
    const value = (jkg * massFactor) / J_PER_KCAL;
    return mass === null ? formatDecimal(value, 1) : String(Math.round(value));
  };
  const kj = (jkg: number) => Math.round((jkg * massFactor) / 1000);
  /** Puissance donnée en W/kg, écrite en W ; au dixième si elle reste par kilo. */
  const powerText = (wkg: number) => (mass === null ? formatDecimal(wkg, 1) : String(Math.round(wkg * mass)));
  const cumulativeDecimals = mass === null ? 2 : 0;
  return {
    power: energy.mechanicalPowerWkg.map((p) => p * massFactor),
    powerUnit: `W${perKg}`,
    cumulative: energy.cumulativeTotalJkg.map((j) => parseFloat(((j * massFactor) / J_PER_KCAL).toFixed(cumulativeDecimals))),
    cumulativeUnit: `kcal${perKg}`,
    stats: [
      { key: 'effort', label: `Énergie de ${effort}`, value: `${kcal(energy.netJkg)} kcal${perKg}`, detail: `${kj(energy.netJkg)} kJ${perKg}` },
      { key: 'total', label: TOTAL_ENERGY_LABEL, value: `${kcal(energy.totalJkg)} kcal${perKg}`, detail: `${kj(energy.totalJkg)} kJ${perKg}` },
      {
        key: 'puissance',
        label: 'Puissance moyenne en mouvement',
        value: energy.movingTimeS > 0 ? `${Math.round((energy.mechanicalJkg / energy.movingTimeS) * massFactor)} W${perKg}` : '—',
        detail: mass !== null && energy.movingTimeS > 0 ? `${formatDecimal(energy.mechanicalJkg / energy.movingTimeS, 1)} W/kg` : undefined,
      },
      {
        key: 'cout-km',
        label: `Coût de ${effort} par km`,
        value: energy.movingDistanceM > 0 ? `${kcal((energy.netJkg / energy.movingDistanceM) * 1000)} kcal${perKg}` : '—',
      },
    ],
    zones: energy.zones.map((z) => ({
      zone: z.zone,
      energy: `${kcal(z.netJkg)} kcal${perKg}`,
      share: z.share,
      perKm: z.distanceM > 0 ? `${kcal((z.netJkg / z.distanceM) * 1000)} kcal${perKg}` : '—',
      power: z.timeS > 0 ? `${powerText(z.mechanicalJkg / z.timeS)} W${perKg}` : '—',
      distanceM: z.distanceM,
    })),
    warning: mass === null ? (loadKg > 0 ? { code: 'sans-poids-charge', loadKg } : { code: 'sans-poids' }) : null,
    note:
      (walking
        ? `Coût de la marche selon Pandolf (1977), descentes corrigées par Santee (2001), pente bornée à ±${Math.round(params.walking.maxGrade * 100)} %` +
          (mass === null ? ` ; sans poids saisi, ${params.walking.referenceBodyKg} kg pour la correction de descente` : '') +
          `, plus la résistance de l'air par air calme ; rien à l'arrêt.`
        : `Coût selon la pente de Minetti (2002), rapporté à l'économie de course (${params.economyMlKgKm} ml O₂/kg/km${runner.economyMlKgKm === null ? ', valeur par défaut' : ''}), plus la résistance de l'air par air calme ; rien à l'arrêt.`) +
      (load > 0
        ? walking
          ? ` Charge portée : ${load} kg, dans l'équation de Pandolf (masse ${roundTo((mass ?? 0) + load, 1)} kg) ; le repos reste celui du corps.`
          : ` Charge portée : ${load} kg, déplacée avec le corps (masse ${roundTo((mass ?? 0) + load, 1)} kg) ; le repos reste celui du corps.`
        : '') +
      ` Puissance : mécanique, l'énergie de ${effort} sur un rendement de ${Math.round(params.mechanicalEfficiency * 100)} %, comparable à celle d'un capteur de puissance de course ; une estimation, pas une mesure.` +
      ` Repos : ${roundTo(restWkg * massFactor, 1)} W${perKg}, ${mass !== null && runner.heightCm !== null && runner.sex !== null && age !== null ? 'selon poids, taille, âge et sexe' : 'valeur moyenne (1 MET) faute de profil complet'}, sur toute la durée.`,
  };
};
