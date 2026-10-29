import { FAMILY_ACCENT } from '../core/activities';
import { roundTo } from '../core/basics';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GradeProfile } from '../core/sportProfiles';
import type { TrackPoint } from '../core/types';
import { J_PER_KCAL } from '../core/units';
import {
  BIKE_TYPES, computeCyclingEnergy, cyclingEnergyParams, formatCrr, type BikeType,
} from '../cycling/energy';
import type { RunnerProfile } from '../hooks/useRunnerProfile';
import type { SurfaceSearchStatus } from '../hooks/useSessionSurfaces';
import { SURFACE_LABEL, type SurfaceCategory, type SurfaceStretch } from '../planning/surface';
import {
  DEFAULT_ENERGY_PARAMS, computeEnergy, restingPowerWkg, runningEnergyParams, walkingEnergyParams, type EnergyModel,
} from '../running/energy';
import type { GradeZone } from '../running/runningAnalytics';

/**
 * Les familles terrestres, course à pied, vélo et fractionné, partagent un
 * module d'analyse (`LandModule`) : carte, synthèse, zones de pente, graphes
 * et réglages de session sont les mêmes. Ce qui change tient ici, en deux
 * parts :
 * - selon la famille, la page : titre, retour à la bibliothèque, couleur,
 *   identifiants mémorisés (`LAND_PAGES`) ;
 * - selon le traitement du calcul de l'activité, le modèle : énergie, ramenée
 *   à une forme d'affichage commune (`EnergyView`), revêtement demandé à
 *   l'ouverture, libellés (`LAND_TREATMENTS`). Le fractionné à pied a celui
 *   de la course, le fractionné vélo celui du vélo (§10, point 89).
 */

/** Familles analysées par `LandModule`. */
export type LandFamily = 'course' | 'velo' | 'fractionne';

/** Traitements terrestres. */
export type LandTreatment = 'course' | 'velo';

/** Libellé de la dépense totale, repos compris : celle que reprend l'onglet « général » à vélo. */
export const TOTAL_ENERGY_LABEL = 'Dépense totale, repos compris';

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
  /** Puissance mécanique moyenne en mouvement dans la zone, dans l'unité de puissance du modèle. */
  power: string;
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
  /** Seuils des zones de pente (`SportProfile.grade`). */
  gradeZones: GradeProfile;
  activityMask: boolean[];
  runner: RunnerProfile;
  age: number | null;
  bikeType: BikeType;
  /** Poids du vélo, bagages compris : celui de la session, sinon celui de l'activité. */
  bikeWeightKg: number;
  /** Charge portée en course, en kg : celle de la session, sinon celle de l'activité. */
  loadKg: number;
  /** Modèle de dépense à pied de l'activité (réglage « Dépense ») : course (Minetti) ou marche (Pandolf). */
  energyModel: EnergyModel;
  /** Revêtement des voies suivies : état de la recherche, et revêtement de chaque segment une fois connu. */
  surfaces: { status: SurfaceSearchStatus; stretches: SurfaceStretch[] | null };
}

/** Ce qui suit la famille : la page et ce qu'elle mémorise. */
export interface LandPageConfig {
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
}

/** Ce qui suit le traitement du calcul : le modèle et ses libellés. */
export interface LandTreatmentConfig {
  treatment: LandTreatment;
  /** Libellé de la couleur grise de la légende, sous la borne basse. */
  slowLabel: string;
  zonesTitle: string;
  energyLabel: string;
  /** Avertissement d'un fichier sans altitude, sous les chiffres d'énergie. */
  flatWarning: string;
  /**
   * Revêtement demandé dès l'ouverture de l'analyse, pour l'énergie (le
   * roulement à vélo) ; sinon à la première ouverture de l'onglet « surface ».
   */
  surfacesAtOpening: boolean;
  energy: (inputs: EnergyInputs) => EnergyView;
}

const warningPerKg = (
  <>Poids non renseigné : valeurs par kilo. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>
);

/**
 * Course : modèle par kilo (`running/energy.ts`), le poids ne multiplie qu'à
 * l'affichage ; sans lui, les valeurs restent par kilo et la charge portée,
 * rapportée au poids du corps, est ignorée. La marche (réglage « Dépense »)
 * prend Pandolf à la place de Minetti, le reste à l'identique.
 */
const runningEnergy = ({ track, grades, gradeZones, activityMask, runner, age, loadKg, energyModel }: EnergyInputs): EnergyView => {
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
    return mass === null ? value.toFixed(1) : String(Math.round(value));
  };
  const kj = (jkg: number) => Math.round((jkg * massFactor) / 1000);
  /** Puissance donnée en W/kg, écrite en W ; au dixième si elle reste par kilo. */
  const powerText = (wkg: number) => (mass === null ? wkg.toFixed(1) : String(Math.round(wkg * mass)));
  const cumulativeDecimals = mass === null ? 2 : 0;
  return {
    power: energy.mechanicalPowerWkg.map((p) => p * massFactor),
    powerUnit: `W${perKg}`,
    cumulative: energy.cumulativeTotalJkg.map((j) => parseFloat(((j * massFactor) / J_PER_KCAL).toFixed(cumulativeDecimals))),
    cumulativeUnit: `kcal${perKg}`,
    stats: [
      { label: `Énergie de ${effort}`, value: `${kcal(energy.netJkg)} kcal${perKg}`, detail: `${kj(energy.netJkg)} kJ${perKg}` },
      { label: TOTAL_ENERGY_LABEL, value: `${kcal(energy.totalJkg)} kcal${perKg}`, detail: `${kj(energy.totalJkg)} kJ${perKg}` },
      {
        label: 'Puissance moyenne en mouvement',
        value: energy.movingTimeS > 0 ? `${Math.round((energy.mechanicalJkg / energy.movingTimeS) * massFactor)} W${perKg}` : '—',
        detail: mass !== null && energy.movingTimeS > 0 ? `${(energy.mechanicalJkg / energy.movingTimeS).toFixed(1)} W/kg` : undefined,
      },
      {
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
    warning: mass === null
      ? (loadKg > 0 ? <>{warningPerKg} La charge portée ({loadKg} kg) n'est prise en compte qu'avec le poids.</> : warningPerKg)
      : null,
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

/**
 * Roulement de la sortie, dans la note du panneau : celui de chaque revêtement
 * parcouru, du plus long au plus court, et la part de la distance qu'ils
 * couvrent ; ailleurs, le roulement moyen du vélo.
 */
const rollingNote = (bikeType: BikeType, surfaceDistanceM: Partial<Record<SurfaceCategory, number>>, movingDistanceM: number): string => {
  const bike = BIKE_TYPES[bikeType];
  const nominal = `roulement moyen du vélo ${bike.noun}, ${formatCrr(bike.crr)}`;
  const known = (Object.entries(surfaceDistanceM) as [SurfaceCategory, number][])
    .filter(([category, m]) => m > 0 && bike.crrBySurface[category] !== undefined)
    .sort((a, b) => b[1] - a[1]);
  if (known.length === 0 || movingDistanceM <= 0) return `Revêtement inconnu : ${nominal}.`;
  const knownM = known.reduce((sum, [, m]) => sum + m, 0);
  const percent = Math.round((knownM / movingDistanceM) * 100);
  const list = known.map(([category]) => `${SURFACE_LABEL[category].toLowerCase()} ${formatCrr(bike.crrBySurface[category]!)}`).join(', ');
  return percent >= 100
    ? `Roulement selon le revêtement (OpenStreetMap) : ${list}.`
    : `Roulement selon le revêtement (OpenStreetMap) sur ${percent} % de la distance : ${list} ; ailleurs, ${nominal}.`;
};

/**
 * Vélo sans le poids du pratiquant : rien n'est calculé. Le modèle est en
 * valeurs absolues, et un poids supposé donnerait des chiffres inventés.
 */
const uncomputedCyclingEnergy = (bikeType: BikeType, bikeWeightKg: number): EnergyView => ({
  power: [],
  powerUnit: 'W',
  cumulative: [],
  cumulativeUnit: 'kcal',
  stats: ['Puissance moyenne en mouvement', 'Travail mécanique', 'Énergie de pédalage', TOTAL_ENERGY_LABEL]
    .map((label) => ({ label, value: '—' })),
  zones: [],
  warning: <>Poids non renseigné : énergie non calculée. Il se saisit dans <Link to="/parametres">Réglages</Link>, bloc Pratiquant.</>,
  note: `Pesanteur, roulement et air par air calme (vélo ${BIKE_TYPES[bikeType].noun} : CdA ${BIKE_TYPES[bikeType].cdaM2} m², ${bikeWeightKg} kg) : le calcul demande la masse du pratiquant.`,
});

/**
 * Vélo : modèle physique en valeurs absolues (`cycling/energy.ts`), sur la
 * masse du pratiquant et du vélo, et le roulement de ses pneus sur chaque
 * revêtement, une fois celui-ci connu. Sans le poids du pratiquant, rien
 * n'est calculé (`uncomputedCyclingEnergy`).
 */
const cyclingEnergy = ({ track, grades, gradeZones, activityMask, runner, age, bikeType, bikeWeightKg, surfaces }: EnergyInputs): EnergyView => {
  const riderKg = runner.weightKg;
  if (riderKg === null) return uncomputedCyclingEnergy(bikeType, bikeWeightKg);
  const params = { ...cyclingEnergyParams(bikeType, bikeWeightKg, riderKg), gradeZones };
  const restW = restingPowerWkg(runner, age, DEFAULT_ENERGY_PARAMS) * riderKg;
  const energy = computeCyclingEnergy(track, grades, activityMask, params, restW, surfaces.stretches?.map((s) => s.category));
  const kcal = (j: number) => String(Math.round(j / J_PER_KCAL));
  const kj = (j: number) => `${Math.round(j / 1000)} kJ`;
  const bike = BIKE_TYPES[bikeType];
  const nominal = `roulement moyen du vélo ${bike.noun} (${formatCrr(bike.crr)})`;
  const surfaceWarning = surfaces.stretches
    ? null
    : surfaces.status === 'searching'
      ? `Revêtement en cours de recherche (OpenStreetMap) : ${nominal} partout en attendant.`
      : surfaces.status === 'error'
        ? `Revêtement introuvable : ${nominal} partout. L'onglet surface permet de réessayer.`
        : null;
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
      { label: TOTAL_ENERGY_LABEL, value: `${kcal(energy.totalJ)} kcal`, detail: kj(energy.totalJ) },
    ],
    zones: energy.zones.map((z) => ({
      zone: z.zone,
      energy: `${kcal(z.netJ)} kcal`,
      share: z.share,
      perKm: z.distanceM > 0 ? `${kcal((z.netJ / z.distanceM) * 1000)} kcal` : '—',
      power: z.timeS > 0 ? `${Math.round(z.mechanicalJ / z.timeS)} W` : '—',
      distanceM: z.distanceM,
    })),
    warning: surfaceWarning,
    note:
      `Pesanteur, roulement et air par air calme (vélo ${bike.noun} : CdA ${bike.cdaM2} m², ${bikeWeightKg} kg ; masse totale ${roundTo(params.totalMassKg, 1)} kg), transmission ${Math.round(params.drivetrainEfficiency * 100)} % ; rien en roue libre ni à l'arrêt.` +
      ` ${rollingNote(bikeType, energy.surfaceDistanceM, energy.movingDistanceM)}` +
      ` Énergie de pédalage : travail mécanique sur un rendement musculaire de ${Math.round(params.muscleEfficiency * 100)} %.` +
      ` Repos : ${Math.round(restW)} W, ${runner.heightCm !== null && runner.sex !== null && age !== null ? 'selon poids, taille, âge et sexe' : 'valeur moyenne (1 MET) faute de profil complet'}, sur toute la durée.`,
  };
};

export const LAND_PAGES: Record<LandFamily, LandPageConfig> = {
  course: {
    family: 'course',
    title: 'Analyse à pied',
    backLabel: 'Sessions à pied',
    accent: FAMILY_ACCENT.course,
    storageId: 'running',
  },
  velo: {
    family: 'velo',
    title: 'Analyse vélo',
    backLabel: 'Sessions vélo',
    accent: FAMILY_ACCENT.velo,
    storageId: 'cycling',
  },
  fractionne: {
    family: 'fractionne',
    title: 'Analyse fractionné',
    backLabel: 'Entraînement',
    accent: FAMILY_ACCENT.fractionne,
    storageId: 'intervals',
  },
};

export const LAND_TREATMENTS: Record<LandTreatment, LandTreatmentConfig> = {
  course: {
    treatment: 'course',
    slowLabel: 'marche',
    zonesTitle: 'Allure par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la course est comptée comme plate.',
    surfacesAtOpening: false,
    energy: runningEnergy,
  },
  velo: {
    treatment: 'velo',
    slowLabel: 'arrêt',
    zonesTitle: 'Vitesse par zone de pente',
    energyLabel: 'Énergie',
    flatWarning: 'Sans altitude dans le fichier, la sortie est comptée comme plate.',
    surfacesAtOpening: true,
    energy: cyclingEnergy,
  },
};
