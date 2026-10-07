import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import type { SurfaceCategory } from '../planning/surface';
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
 *
 * Le roulement dépend des pneus et du sol : chaque type de vélo a un Crr par
 * revêtement (`crrBySurface`), pris segment par segment quand le revêtement
 * de la trace est connu ; ailleurs, son Crr moyen (`crr`).
 */

/** Type de vélo, c'est-à-dire surtout ses pneus : il fixe le roulement, la traînée et le poids du vélo par défaut. */
export type BikeType = 'route' | 'gravel' | 'vtt' | 'ville';

export interface BikeSpec {
  label: string;
  /** Nom dans une phrase, en minuscules sauf un sigle. */
  noun: string;
  /**
   * Coefficient de résistance au roulement moyen, sur le terrain habituel du
   * vélo : celui d'un revêtement inconnu, de l'enregistrement en direct et du
   * temps estimé des itinéraires.
   */
  crr: number;
  /** Coefficient de roulement par revêtement ; un revêtement absent (« autre », « inconnu ») prend `crr`. */
  crrBySurface: Partial<Record<SurfaceCategory, number>>;
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
 *
 * Roulement par revêtement : le pneu fin roule le mieux sur l'asphalte et
 * perd le plus quand le sol se dégrade (pavés, terre, herbe, sable) ; le pneu
 * large ou à crampons perd moins. Ordres de grandeur, à confirmer à l'usage.
 */
export const BIKE_TYPES: Record<BikeType, BikeSpec> = {
  route: {
    label: 'Route', noun: 'route', crr: 0.004, cdaM2: 0.32, bikeKg: 8.5, maxDescentMs: 55 / 3.6,
    crrBySurface: {
      asphalte: 0.004, pierresPlates: 0.006, paves: 0.012, gravillon: 0.01, nonPave: 0.014, terre: 0.016, herbe: 0.03, sable: 0.06, alpin: 0.03,
    },
  },
  gravel: {
    label: 'Gravel', noun: 'gravel', crr: 0.008, cdaM2: 0.45, bikeKg: 12, maxDescentMs: 35 / 3.6,
    crrBySurface: {
      asphalte: 0.005, pierresPlates: 0.006, paves: 0.009, gravillon: 0.008, nonPave: 0.01, terre: 0.012, herbe: 0.02, sable: 0.04, alpin: 0.02,
    },
  },
  vtt: {
    label: 'VTT', noun: 'VTT', crr: 0.012, cdaM2: 0.5, bikeKg: 13, maxDescentMs: 30 / 3.6,
    crrBySurface: {
      asphalte: 0.008, pierresPlates: 0.009, paves: 0.01, gravillon: 0.01, nonPave: 0.011, terre: 0.012, herbe: 0.018, sable: 0.03, alpin: 0.016,
    },
  },
  ville: {
    label: 'Ville', noun: 'ville', crr: 0.007, cdaM2: 0.55, bikeKg: 16, maxDescentMs: 30 / 3.6,
    crrBySurface: {
      asphalte: 0.006, pierresPlates: 0.007, paves: 0.011, gravillon: 0.01, nonPave: 0.013, terre: 0.015, herbe: 0.025, sable: 0.05, alpin: 0.025,
    },
  },
};

/** Coefficient de roulement tel qu'il s'affiche : « 0,005 ». */
export const formatCrr = (crr: number): string => crr.toLocaleString('fr-FR', { maximumFractionDigits: 4 });

export const isBikeType = (value: unknown): value is BikeType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(BIKE_TYPES, value);

/** Masse du cycliste retenue quand son poids n'est pas renseigné, en kg. */
export const REFERENCE_RIDER_KG = 75;

export interface CyclingEnergyParams {
  /** Roulement moyen, celui d'un revêtement inconnu. */
  crr: number;
  /** Roulement par revêtement, quand celui de la trace est connu ; absent : `crr` partout. */
  crrBySurface?: Partial<Record<SurfaceCategory, number>>;
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
  crrBySurface: BIKE_TYPES[bike].crrBySurface,
  cdaM2: BIKE_TYPES[bike].cdaM2,
  totalMassKg: riderKg + bikeKg,
});

/** Roulement sur un revêtement : celui du tableau, sinon (revêtement inconnu, absent du tableau) le roulement moyen. */
export const rollingCoefficient = (params: CyclingEnergyParams, surface?: SurfaceCategory | null): number =>
  (surface ? params.crrBySurface?.[surface] : undefined) ?? params.crr;

/**
 * Force résistante, en N, à la vitesse et à la pente données (`NaN` compte
 * comme plat), avec le roulement `crr` (le moyen par défaut). Négative dans
 * une descente assez raide : la pente pousse.
 */
export const resistiveForceN = (speedMs: number, grade: number, params: CyclingEnergyParams, crr = params.crr): number => {
  const theta = Math.atan(isFinite(grade) ? grade : 0);
  const gravityAndRolling = params.totalMassKg * params.gravityMs2 * (crr * Math.cos(theta) + Math.sin(theta));
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
  /**
   * Distance en mouvement par revêtement, en m, quand le revêtement est donné
   * (vide sinon) : ceux du tableau ont pris leur roulement, les autres le moyen.
   */
  surfaceDistanceM: Partial<Record<SurfaceCategory, number>>;
  zones: CyclingEnergyZone[];
}

/**
 * Énergie dépensée le long de la trace. Chaque segment en mouvement coûte
 * max(0, force × distance) / rendement de transmission en travail mécanique,
 * et ce travail divisé par le rendement musculaire pour l'organisme ; le
 * repos (`restW`, en W) court sur toute la durée. Une pente manquante compte
 * comme plate, et son segment va dans la zone plate.
 *
 * `surfaces`, quand le revêtement est connu : celui de chaque segment, rangé
 * comme `trackSurfaceStretches` (`surfaces[i - 1]` pour le segment `i - 1 → i`).
 * Chaque segment prend alors le roulement de son revêtement (`rollingCoefficient`).
 */
export const computeCyclingEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: CyclingEnergyParams,
  restW: number,
  surfaces?: ReadonlyArray<SurfaceCategory>
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
  const surfaceDistanceM: Partial<Record<SurfaceCategory, number>> = {};

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
      const surface = surfaces?.[i - 1];
      const crr = rollingCoefficient(params, surface);
      const work = Math.max(0, resistiveForceN(track[i].speedMs, grade, params, crr) * d) / params.drivetrainEfficiency;
      if (surface) surfaceDistanceM[surface] = (surfaceDistanceM[surface] ?? 0) + d;
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
    surfaceDistanceM,
    zones: GRADE_ZONES.map((zone) => ({
      zone,
      ...byZone[zone.key],
      share: netJ > 0 ? byZone[zone.key].netJ / netJ : 0,
    })),
  };
};
