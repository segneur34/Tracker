import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import { GRADE_ZONES, classifyGrade, type GradeZone, type GradeZoneKey } from '../running/runningAnalytics';

/**
 * Dépense d'énergie à vélo, tout en unités SI. Contrairement à la course, la
 * masse ne se met pas en facteur : la pesanteur et le roulement en dépendent,
 * l'air non. Les valeurs sont donc absolues (W, J), pour la masse totale
 * pratiquant + vélo donnée.
 *
 * Modèle classique (Martin et al., 1998) : la force à vaincre est la
 * pesanteur et le roulement, m·g·(Crr·cos θ + sin θ), plus l'air,
 * ½·ρ·CdA·v², par air calme. Le travail mécanique est cette force sur la
 * distance, divisé par le rendement de la transmission ; il est borné à 0 :
 * en descente, la roue libre ne rend rien et le freinage ne coûte rien. La
 * variation d'énergie cinétique est ignorée : dérivée deux fois du GPS, elle
 * n'apporterait que du bruit, et elle s'annule sur une sortie entière.
 *
 * Le coût pour l'organisme est le travail mécanique divisé par le rendement
 * musculaire net (repos déduit, autour de 25 %) ; le repos s'ajoute sur toute
 * la durée, comme en course.
 */

/** Type de vélo : il fixe le roulement, la traînée et le poids du vélo par défaut. */
export type BikeType = 'route' | 'gravel' | 'vtt' | 'ville';

export interface BikeSpec {
  label: string;
  /** Nom dans une phrase, en minuscules sauf un sigle. */
  noun: string;
  /** Coefficient de résistance au roulement. */
  crr: number;
  /** Surface de traînée (coefficient × surface frontale), en m². */
  cdaM2: number;
  /** Poids du vélo par défaut, en kg. */
  bikeKg: number;
  /** Vitesse plafond en descente pour l'estimation d'un temps de parcours, en m/s (freinage, virages, revêtement). */
  maxDescentMs: number;
}

/**
 * Ordres de grandeur publiés : pneus de route gonflés sur bon revêtement et
 * position mains en bas des cocottes ; pneus larges sur chemin et position
 * plus droite ; VTT, pneus à crampons, buste plus droit encore, descentes
 * plus lentes sur sentier ; vélo de ville, pneus épais et buste redressé.
 */
export const BIKE_TYPES: Record<BikeType, BikeSpec> = {
  route: { label: 'Route', noun: 'route', crr: 0.004, cdaM2: 0.32, bikeKg: 8.5, maxDescentMs: 55 / 3.6 },
  gravel: { label: 'Gravel', noun: 'gravel', crr: 0.008, cdaM2: 0.45, bikeKg: 12, maxDescentMs: 35 / 3.6 },
  vtt: { label: 'VTT', noun: 'VTT', crr: 0.012, cdaM2: 0.5, bikeKg: 13, maxDescentMs: 30 / 3.6 },
  ville: { label: 'Ville', noun: 'ville', crr: 0.007, cdaM2: 0.55, bikeKg: 16, maxDescentMs: 30 / 3.6 },
};

export const isBikeType = (value: unknown): value is BikeType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(BIKE_TYPES, value);

/** Masse du cycliste retenue quand son poids n'est pas renseigné, en kg. */
export const REFERENCE_RIDER_KG = 75;

export interface CyclingEnergyParams {
  crr: number;
  cdaM2: number;
  /** Masse totale pratiquant + vélo, en kg. */
  totalMassKg: number;
  /** Masse volumique de l'air, en kg/m³. */
  airDensityKgM3: number;
  /** Rendement de la transmission (chaîne, roulements). */
  drivetrainEfficiency: number;
  /** Rendement musculaire net : travail mécanique sur énergie dépensée, repos déduit. */
  muscleEfficiency: number;
  /** Pesanteur, en m/s². */
  gravityMs2: number;
}

/** Air à 15 °C au niveau de la mer ; transmission propre ; rendement net usuel. */
export const DEFAULT_CYCLING_PARAMS: Omit<CyclingEnergyParams, 'crr' | 'cdaM2' | 'totalMassKg'> = {
  airDensityKgM3: 1.225,
  drivetrainEfficiency: 0.97,
  muscleEfficiency: 0.25,
  gravityMs2: 9.81,
};

/** Réglage complet pour un type de vélo, une masse de vélo et une masse de cycliste. */
export const cyclingEnergyParams = (bike: BikeType, bikeKg: number, riderKg: number): CyclingEnergyParams => ({
  ...DEFAULT_CYCLING_PARAMS,
  crr: BIKE_TYPES[bike].crr,
  cdaM2: BIKE_TYPES[bike].cdaM2,
  totalMassKg: riderKg + bikeKg,
});

/**
 * Force résistante, en N, à la vitesse et à la pente données (`NaN` compte
 * comme plat). Négative dans une descente assez raide : la pente pousse.
 */
export const resistiveForceN = (speedMs: number, grade: number, params: CyclingEnergyParams): number => {
  const theta = Math.atan(isFinite(grade) ? grade : 0);
  const gravityAndRolling = params.totalMassKg * params.gravityMs2 * (params.crr * Math.cos(theta) + Math.sin(theta));
  const air = 0.5 * params.airDensityKgM3 * params.cdaM2 * speedMs * speedMs;
  return gravityAndRolling + air;
};

export interface CyclingEnergyZone {
  zone: GradeZone;
  /** Travail mécanique dans la zone, en J. */
  mechanicalJ: number;
  /** Énergie de pédalage nette dans la zone, en J. */
  netJ: number;
  distanceM: number;
  /** Temps en mouvement dans la zone, en s : d'où sa puissance moyenne. */
  timeS: number;
  /** Part de l'énergie de pédalage nette. */
  share: number;
}

export interface CyclingEnergyResult {
  /** Puissance mécanique en chaque point (segment qui y mène), en W ; `NaN` à l'arrêt et au premier point. */
  mechanicalPowerW: number[];
  /** Énergie totale (pédalage et repos) dépensée depuis le départ, en J. */
  cumulativeTotalJ: number[];
  /** Travail mécanique, en J. */
  mechanicalJ: number;
  /** Énergie de pédalage nette, en J. */
  netJ: number;
  /** Métabolisme de repos sur toute la durée, pauses comprises, en J. */
  restJ: number;
  totalJ: number;
  movingTimeS: number;
  movingDistanceM: number;
  zones: CyclingEnergyZone[];
}

/**
 * Énergie dépensée le long de la trace. Chaque segment en mouvement coûte
 * max(0, force × distance) / rendement de transmission en travail mécanique,
 * et ce travail divisé par le rendement musculaire pour l'organisme ; le
 * repos (`restW`, en W) court sur toute la durée. Une pente manquante compte
 * comme plate, et son segment va dans la zone plate.
 */
export const computeCyclingEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: CyclingEnergyParams,
  restW: number
): CyclingEnergyResult => {
  const n = track.length;
  const mechanicalPowerW = new Array<number>(n).fill(NaN);
  const cumulativeTotalJ = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, { mechanicalJ: number; netJ: number; distanceM: number; timeS: number }> = {
    steepDown: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    down: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    flat: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    up: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
    steepUp: { mechanicalJ: 0, netJ: 0, distanceM: 0, timeS: 0 },
  };
  let mechanicalJ = 0;
  let netJ = 0;
  let restJ = 0;
  let movingTimeS = 0;
  let movingDistanceM = 0;

  for (let i = 1; i < n; i++) {
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt <= 0) {
      cumulativeTotalJ[i] = cumulativeTotalJ[i - 1];
      continue;
    }
    const rest = restW * dt;
    restJ += rest;
    let net = 0;
    if (activityMask[i]) {
      const d = segmentDistanceM(track, i);
      const grade = grades[i] ?? NaN;
      const work = Math.max(0, resistiveForceN(track[i].speedMs, grade, params) * d) / params.drivetrainEfficiency;
      net = work / params.muscleEfficiency;
      mechanicalPowerW[i] = work / dt;
      mechanicalJ += work;
      netJ += net;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade) ?? 'flat'];
      zone.mechanicalJ += work;
      zone.netJ += net;
      zone.distanceM += d;
      zone.timeS += dt;
    }
    cumulativeTotalJ[i] = cumulativeTotalJ[i - 1] + rest + net;
  }

  return {
    mechanicalPowerW,
    cumulativeTotalJ,
    mechanicalJ,
    netJ,
    restJ,
    totalJ: netJ + restJ,
    movingTimeS,
    movingDistanceM,
    zones: GRADE_ZONES.map((zone) => ({
      zone,
      ...byZone[zone.key],
      share: netJ > 0 ? byZone[zone.key].netJ / netJ : 0,
    })),
  };
};
