import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TrackPoint } from '../core/types';
import { J_PER_KCAL } from '../core/units';
import {
  BIKE_TYPES, REFERENCE_RIDER_KG, computeCyclingEnergy, cyclingEnergyParams, type BikeType,
} from '../cycling/energy';
import type { RunnerProfile } from '../hooks/useRunnerProfile';
import { DEFAULT_ENERGY_PARAMS, computeEnergy, restingPowerWkg, runningEnergyParams } from '../running/energy';
import type { GradeZone } from '../running/runningAnalytics';

/**
 * Les deux familles terrestres, course à pied et vélo, partagent un module
 * d'analyse (`LandModule`) : carte, synthèse, zones de pente, graphes et
 * réglages de session sont les mêmes. Ce qui change tient ici : titres,
 * couleur, identifiants mémorisés, et le modèle d'énergie, ramené à une
 * forme d'affichage commune (`EnergyView`).
 */

export type LandFamily = 'course' | 'velo';

/** Un chiffre du panneau Énergie : sa valeur, et en plus petit un complément. */
export interface EnergyStat {
  label: string;
  value: string;
  detail?: string;
}

/** Une ligne du tableau d'énergie par zone de pente, valeurs déjà formatées. */
export interface EnergyZoneRow {
  zone: GradeZone;
  energy: string;
  share: number;
  perKm: string;
  distanceM: number;
}

/** Ce que le panneau Énergie affiche, quel que soit le modèle. */
export interface EnergyView {
  /** Puissance en chaque point, dans `powerUnit`, `NaN` à l'arrêt ; lissée par le module. */
  power: number[];
  powerUnit: string;
  /** Énergie totale dépensée depuis le départ, dans `cumulativeUnit`. */
  cumulative: number[];
  cumulativeUnit: string;
  stats: EnergyStat[];
  zones: EnergyZoneRow[];
  /** Avertissement sur les données manquantes, au-dessus des chiffres. */
  warning: ReactNode | null;
  /** Rappel du modèle, sous le panneau. */
  note: string;
}

export interface EnergyInputs {
  track: TrackPoint[];
  grades: number[];
  activityMask: boolean[];
  runner: RunnerProfile;
  age: number | null;
  bikeType: BikeType;
  bikeWeightKg: number;
}

export interface LandModuleConfig {
  family: LandFamily;
  title: string;
  /** Lien de retour vers la bibliothèque. */
  backLabel: string;
  accent: string;
  /**
   * Préfixe des sections ouvertes et des tailles de panneaux mémorisées
   * (`ResizablePanel`) : ne pas le renommer, les tailles seraient perdues.
   */
  storageId: string;
  /** Libellé de la couleur grise de la légende, sous la borne basse. */
  slowLabel: string;
  zonesTitle: string;
  energyLabel: string;
  /** Avertissement d'un fichier sans altitude, sous les chiffres d'énergie. */
  flatWarning: string;
  energy: (inputs: EnergyInputs) => EnergyView;
}

const warningPerKg = (
  <>Poids non renseigné : valeurs par kilo. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>
);

/**
 * Course : modèle par kilo (`running/energy.ts`), le poids ne multiplie qu'à
 * l'affichage ; sans lui, les valeurs restent par kilo.
 */
const runningEnergy = ({ track, grades, activityMask, runner, age }: EnergyInputs): EnergyView => {
  const params = runningEnergyParams(runner.economyMlKgKm);
  const restWkg = restingPowerWkg(runner, age, params);
  const energy = computeEnergy(track, grades, activityMask, params, restWkg);
  const mass = runner.weightKg;
  const massFactor = mass ?? 1;
  const perKg = mass === null ? '/kg' : '';
  const kcal = (jkg: number) => {
    const value = (jkg * massFactor) / J_PER_KCAL;
    return mass === null ? value.toFixed(1) : String(Math.round(value));
  };
  const kj = (jkg: number) => Math.round((jkg * massFactor) / 1000);
  const cumulativeDecimals = mass === null ? 2 : 0;
  return {
    power: energy.mechanicalPowerWkg.map((p) => p * massFactor),
    powerUnit: `W${perKg}`,
    cumulative: energy.cumulativeTotalJkg.map((j) => parseFloat(((j * massFactor) / J_PER_KCAL).toFixed(cumulativeDecimals))),
    cumulativeUnit: `kcal${perKg}`,
    stats: [
      { label: 'Énergie de course', value: `${kcal(energy.netJkg)} kcal${perKg}`, detail: `${kj(energy.netJkg)} kJ${perKg}` },
      { label: 'Dépense totale, repos compris', value: `${kcal(energy.totalJkg)} kcal${perKg}`, detail: `${kj(energy.totalJkg)} kJ${perKg}` },
      {
        label: 'Puissance moyenne en mouvement',
        value: energy.movingTimeS > 0 ? `${Math.round((energy.mechanicalJkg / energy.movingTimeS) * massFactor)} W${perKg}` : '—',
        detail: mass !== null && energy.movingTimeS > 0 ? `${(energy.mechanicalJkg / energy.movingTimeS).toFixed(1)} W/kg` : undefined,
      },
      {
        label: 'Coût de course par km',
        value: energy.movingDistanceM > 0 ? `${kcal((energy.netJkg / energy.movingDistanceM) * 1000)} kcal${perKg}` : '—',
      },
    ],
    zones: energy.zones.map((z) => ({
      zone: z.zone,
      energy: `${kcal(z.netJkg)} kcal${perKg}`,
      share: z.share,
      perKm: z.distanceM > 0 ? `${kcal((z.netJkg / z.distanceM) * 1000)} kcal${perKg}` : '—',
      distanceM: z.distanceM,
    })),
    warning: mass === null ? warningPerKg : null,
    note:
      `Coût selon la pente de Minetti (2002), rapporté à l'économie de course (${params.economyMlKgKm} ml O₂/kg/km${runner.economyMlKgKm === null ? ', valeur par défaut' : ''}), plus la résistance de l'air par air calme ; rien à l'arrêt.` +
      ` Puissance : mécanique, l'énergie de course sur un rendement de ${Math.round(params.mechanicalEfficiency * 100)} %, comparable à celle d'un capteur de puissance de course ; une estimation, pas une mesure.` +
      ` Repos : ${Math.round(restWkg * massFactor * 10) / 10} W${perKg}, ${mass !== null && runner.heightCm !== null && runner.sex !== null && age !== null ? 'selon poids, taille, âge et sexe' : 'valeur moyenne (1 MET) faute de profil complet'}, sur toute la durée.`,
  };
};

/**
 * Vélo : modèle physique en valeurs absolues (`cycling/energy.ts`), sur la
 * masse du pratiquant (de référence s'il n'est pas renseigné) et du vélo.
 */
const cyclingEnergy = ({ track, grades, activityMask, runner, age, bikeType, bikeWeightKg }: EnergyInputs): EnergyView => {
  const riderKg = runner.weightKg ?? REFERENCE_RIDER_KG;
  const params = cyclingEnergyParams(bikeType, bikeWeightKg, riderKg);
  const restW = restingPowerWkg(runner, age, DEFAULT_ENERGY_PARAMS) * riderKg;
  const energy = computeCyclingEnergy(track, grades, activityMask, params, restW);
  const kcal = (j: number) => String(Math.round(j / J_PER_KCAL));
  const kj = (j: number) => `${Math.round(j / 1000)} kJ`;
  const bike = BIKE_TYPES[bikeType];
  return {
    power: energy.mechanicalPowerW,
    powerUnit: 'W',
    cumulative: energy.cumulativeTotalJ.map((j) => Math.round(j / J_PER_KCAL)),
    cumulativeUnit: 'kcal',
    stats: [
      {
        label: 'Puissance moyenne en mouvement',
        value: energy.movingTimeS > 0 ? `${Math.round(energy.mechanicalJ / energy.movingTimeS)} W` : '—',
        detail: energy.movingTimeS > 0 ? `${(energy.mechanicalJ / energy.movingTimeS / riderKg).toFixed(1)} W/kg` : undefined,
      },
      { label: 'Travail mécanique', value: kj(energy.mechanicalJ) },
      { label: 'Énergie de pédalage', value: `${kcal(energy.netJ)} kcal`, detail: kj(energy.netJ) },
      { label: 'Dépense totale, repos compris', value: `${kcal(energy.totalJ)} kcal`, detail: kj(energy.totalJ) },
    ],
    zones: energy.zones.map((z) => ({
      zone: z.zone,
      energy: `${kcal(z.netJ)} kcal`,
      share: z.share,
      perKm: z.distanceM > 0 ? `${kcal((z.netJ / z.distanceM) * 1000)} kcal` : '—',
      distanceM: z.distanceM,
    })),
    warning: runner.weightKg === null
      ? <>Poids non renseigné : calcul pour un cycliste de {REFERENCE_RIDER_KG} kg. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>
      : null,
    note:
      `Pesanteur, roulement et air par air calme (vélo ${bike.label.toLowerCase()} : Crr ${bike.crr}, CdA ${bike.cdaM2} m², ${bikeWeightKg} kg ; masse totale ${Math.round(params.totalMassKg * 10) / 10} kg), transmission ${Math.round(params.drivetrainEfficiency * 100)} % ; rien en roue libre ni à l'arrêt.` +
      ` Énergie de pédalage : travail mécanique sur un rendement musculaire de ${Math.round(params.muscleEfficiency * 100)} %.` +
      ` Repos : ${Math.round(restW)} W, ${runner.weightKg !== null && runner.heightCm !== null && runner.sex !== null && age !== null ? 'selon poids, taille, âge et sexe' : 'valeur moyenne (1 MET) faute de profil complet'}, sur toute la durée.`,
  };
};

export const LAND_MODULES: Record<LandFamily, LandModuleConfig> = {
  course: {
    family: 'course',
    title: 'Analyse course à pied',
    backLabel: 'Sessions course',
    accent: 'var(--course)',
    storageId: 'running',
    slowLabel: 'marche',
    zonesTitle: 'Allure par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la course est comptée comme plate.',
    energy: runningEnergy,
  },
  velo: {
    family: 'velo',
    title: 'Analyse vélo',
    backLabel: 'Sessions vélo',
    accent: 'var(--velo)',
    storageId: 'cycling',
    slowLabel: 'arrêt',
    zonesTitle: 'Vitesse par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la sortie est comptée comme plate.',
    energy: cyclingEnergy,
  },
};
