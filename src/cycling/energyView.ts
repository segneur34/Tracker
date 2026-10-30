import { roundTo } from '../core/basics';
import { J_PER_KCAL, formatDecimal } from '../core/units';
import { SURFACE_LABEL, type SurfaceCategory } from '../planning/surface';
import { DEFAULT_ENERGY_PARAMS, restingPowerWkg } from '../running/energy';
import { TOTAL_ENERGY_LABEL, type EnergyInputs, type EnergyViewData } from '../running/energyView';
import { BIKE_TYPES, computeCyclingEnergy, cyclingEnergyParams, formatCrr, type BikeType } from './energy';

/**
 * Mise en forme de l'énergie à vélo pour le panneau Énergie, sans rendu
 * (types communs dans `running/energyView.ts`).
 */

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
const uncomputedCyclingEnergy = (bikeType: BikeType, bikeWeightKg: number): EnergyViewData => ({
  power: [],
  powerUnit: 'W',
  cumulative: [],
  cumulativeUnit: 'kcal',
  stats: [
    { key: 'puissance', label: 'Puissance moyenne en mouvement', value: '—' },
    { key: 'travail', label: 'Travail mécanique', value: '—' },
    { key: 'effort', label: 'Énergie de pédalage', value: '—' },
    { key: 'total', label: TOTAL_ENERGY_LABEL, value: '—' },
  ],
  zones: [],
  warning: { code: 'sans-poids-velo' },
  note: `Pesanteur, roulement et air par air calme (vélo ${BIKE_TYPES[bikeType].noun} : CdA ${BIKE_TYPES[bikeType].cdaM2} m², ${bikeWeightKg} kg) : le calcul demande la masse du pratiquant.`,
});

/**
 * Vélo : modèle physique en valeurs absolues (`cycling/energy.ts`), sur la
 * masse du pratiquant et du vélo, et le roulement de ses pneus sur chaque
 * revêtement, une fois celui-ci connu. Sans le poids du pratiquant, rien
 * n'est calculé (`uncomputedCyclingEnergy`).
 */
export const cyclingEnergyView = ({ track, grades, gradeZones, activityMask, runner, age, bikeType, bikeWeightKg, surfaces }: EnergyInputs): EnergyViewData => {
  const riderKg = runner.weightKg;
  if (riderKg === null) return uncomputedCyclingEnergy(bikeType, bikeWeightKg);
  const params = { ...cyclingEnergyParams(bikeType, bikeWeightKg, riderKg), gradeZones };
  const restW = restingPowerWkg(runner, age, DEFAULT_ENERGY_PARAMS) * riderKg;
  const energy = computeCyclingEnergy(track, grades, activityMask, params, restW, surfaces.stretches?.map((s) => s.category));
  const kcal = (j: number) => String(Math.round(j / J_PER_KCAL));
  const kj = (j: number) => `${Math.round(j / 1000)} kJ`;
  const bike = BIKE_TYPES[bikeType];
  const nominal = `roulement moyen du vélo ${bike.noun} (${formatCrr(bike.crr)})`;
  return {
    power: energy.mechanicalPowerW,
    powerUnit: 'W',
    cumulative: energy.cumulativeTotalJ.map((j) => Math.round(j / J_PER_KCAL)),
    cumulativeUnit: 'kcal',
    stats: [
      {
        key: 'puissance',
        label: 'Puissance moyenne en mouvement',
        value: energy.movingTimeS > 0 ? `${Math.round(energy.mechanicalJ / energy.movingTimeS)} W` : '—',
        detail: energy.movingTimeS > 0 ? `${formatDecimal(energy.mechanicalJ / energy.movingTimeS / riderKg, 1)} W/kg` : undefined,
      },
      { key: 'travail', label: 'Travail mécanique', value: kj(energy.mechanicalJ) },
      { key: 'effort', label: 'Énergie de pédalage', value: `${kcal(energy.netJ)} kcal`, detail: kj(energy.netJ) },
      { key: 'total', label: TOTAL_ENERGY_LABEL, value: `${kcal(energy.totalJ)} kcal`, detail: kj(energy.totalJ) },
    ],
    zones: energy.zones.map((z) => ({
      zone: z.zone,
      energy: `${kcal(z.netJ)} kcal`,
      share: z.share,
      perKm: z.distanceM > 0 ? `${kcal((z.netJ / z.distanceM) * 1000)} kcal` : '—',
      power: z.timeS > 0 ? `${Math.round(z.mechanicalJ / z.timeS)} W` : '—',
      distanceM: z.distanceM,
    })),
    warning: surfaces.stretches
      ? null
      : surfaces.status === 'searching'
        ? { code: 'revetement-recherche', nominal }
        : surfaces.status === 'error'
          ? { code: 'revetement-introuvable', nominal }
          : null,
    note:
      `Pesanteur, roulement et air par air calme (vélo ${bike.noun} : CdA ${bike.cdaM2} m², ${bikeWeightKg} kg ; masse totale ${roundTo(params.totalMassKg, 1)} kg), transmission ${Math.round(params.drivetrainEfficiency * 100)} % ; rien en roue libre ni à l'arrêt.` +
      ` ${rollingNote(bikeType, energy.surfaceDistanceM, energy.movingDistanceM)}` +
      ` Énergie de pédalage : travail mécanique sur un rendement musculaire de ${Math.round(params.muscleEfficiency * 100)} %.` +
      ` Repos : ${Math.round(restW)} W, ${runner.heightCm !== null && runner.sex !== null && age !== null ? 'selon poids, taille, âge et sexe' : 'valeur moyenne (1 MET) faute de profil complet'}, sur toute la durée.`,
  };
};
