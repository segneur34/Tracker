import { segmentDistanceM } from '../core/sessionStats';
import type { TrackPoint } from '../core/types';
import { GRADE_ZONES, classifyGrade, type GradeZone, type GradeZoneKey } from './runningAnalytics';

/**
 * Dépense d'énergie de la course à pied, tout en unités SI et par kilo de
 * coureur : la masse ne multiplie qu'à l'affichage, pour qu'une trace sans
 * poids renseigné donne encore des valeurs par kilo.
 *
 * Coût de la pente : Minetti et al. (2002), mesuré sur tapis de -45 % à
 * +45 %. Sa courbe garde sa forme, mais la valeur du plat est remplacée par
 * l'économie du coureur. En course, le coût par mètre dépend à peine de la
 * vitesse : elle agit par la puissance (coût × vitesse) et par la résistance
 * de l'air, seul terme en v².
 */

export interface EnergyParams {
  /** Économie de course sur le plat, en ml d'O₂ par kg et par km. */
  economyMlKgKm: number;
  /** Énergie libérée par millilitre d'O₂ consommé, en J. */
  joulesPerMlO2: number;
  /** Coût de la résistance de l'air par air calme, k de k·v², en J·s²/m³/kg. */
  airDragJs2M3Kg: number;
  /** Pente, en fraction, au-delà de laquelle la courbe de Minetti est bornée (son domaine mesuré). */
  maxGrade: number;
  /** Métabolisme de repos à défaut de profil complet (1 MET), en ml d'O₂ par kg et par minute. */
  restingMlKgMin: number;
}

/**
 * 200 ml/kg/km à 20,9 J/ml font 4,18 J/kg/m, la règle classique de
 * 1 kcal/kg/km. Le k de l'air est un ordre de grandeur tiré de Pugh (1971) :
 * environ 4 % du coût à l'allure du marathon élite, 2 % à 3 m/s.
 */
export const DEFAULT_ENERGY_PARAMS: EnergyParams = {
  economyMlKgKm: 200,
  joulesPerMlO2: 20.9,
  airDragJs2M3Kg: 0.0065,
  maxGrade: 0.45,
  restingMlKgMin: 3.5,
};

/** Coût sur le plat du polynôme de Minetti, en J/kg/m. */
const MINETTI_FLAT_JKGM = 3.6;

/** Courbe de Minetti (2002), en J/kg/m, bornée à ±`maxGrade`. */
export const minettiCost = (grade: number, maxGrade = DEFAULT_ENERGY_PARAMS.maxGrade): number => {
  const i = Math.max(-maxGrade, Math.min(maxGrade, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + MINETTI_FLAT_JKGM;
};

/** Économie sur le plat en J/kg/m. */
export const flatCostJkgM = (params: EnergyParams): number =>
  (params.economyMlKgKm * params.joulesPerMlO2) / 1000;

/** Coût de course hors air, en J/kg/m, à la pente donnée (`NaN` compte comme plat). */
export const runningCostJkgM = (grade: number, params: EnergyParams): number =>
  (flatCostJkgM(params) * minettiCost(isFinite(grade) ? grade : 0, params.maxGrade)) / MINETTI_FLAT_JKGM;

/**
 * Métabolisme de repos, en W/kg. Mifflin-St Jeor quand poids, taille, âge et
 * sexe sont connus ; sinon 1 MET.
 */
export const restingPowerWkg = (
  runner: { weightKg: number | null; heightCm: number | null; sex: 'f' | 'm' | null },
  age: number | null,
  params: EnergyParams
): number => {
  const { weightKg, heightCm, sex } = runner;
  if (weightKg !== null && heightCm !== null && sex !== null && age !== null && age > 0) {
    const kcalPerDay = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'm' ? 5 : -161);
    if (kcalPerDay > 0) return (kcalPerDay * 4184) / 86400 / weightKg;
  }
  return (params.restingMlKgMin * params.joulesPerMlO2) / 60;
};

export interface EnergyZone {
  zone: GradeZone;
  /** Énergie de course nette dans la zone, en J/kg. */
  netJkg: number;
  distanceM: number;
  /** Part de l'énergie de course nette. */
  share: number;
}

export interface EnergyResult {
  /**
   * Puissance de course nette en chaque point (segment qui y mène), en W/kg ;
   * `NaN` à l'arrêt et au premier point.
   */
  netPowerWkg: number[];
  /** Énergie totale (course et repos) dépensée depuis le départ, en J/kg. */
  cumulativeTotalJkg: number[];
  /** Énergie de course nette, en J/kg. */
  netJkg: number;
  /** Métabolisme de repos sur toute la durée, pauses comprises, en J/kg. */
  restJkg: number;
  totalJkg: number;
  movingTimeS: number;
  movingDistanceM: number;
  zones: EnergyZone[];
}

/**
 * Énergie dépensée le long de la trace. Chaque segment en mouvement coûte
 * (coût de la pente + k·v²) × distance ; le repos court sur toute la durée.
 * Une pente manquante compte comme plate, et son segment va dans la zone plate.
 */
export const computeEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: EnergyParams,
  restWkg: number
): EnergyResult => {
  const n = track.length;
  const netPowerWkg = new Array<number>(n).fill(NaN);
  const cumulativeTotalJkg = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, { netJkg: number; distanceM: number }> = {
    steepDown: { netJkg: 0, distanceM: 0 },
    down: { netJkg: 0, distanceM: 0 },
    flat: { netJkg: 0, distanceM: 0 },
    up: { netJkg: 0, distanceM: 0 },
    steepUp: { netJkg: 0, distanceM: 0 },
  };
  let netJkg = 0;
  let restJkg = 0;
  let movingTimeS = 0;
  let movingDistanceM = 0;

  for (let i = 1; i < n; i++) {
    const dt = (track[i].timeMs - track[i - 1].timeMs) / 1000;
    if (dt <= 0) {
      cumulativeTotalJkg[i] = cumulativeTotalJkg[i - 1];
      continue;
    }
    const rest = restWkg * dt;
    restJkg += rest;
    let net = 0;
    if (activityMask[i]) {
      const d = segmentDistanceM(track, i);
      const v = track[i].speedMs;
      const grade = grades[i] ?? NaN;
      net = (runningCostJkgM(grade, params) + params.airDragJs2M3Kg * v * v) * d;
      netPowerWkg[i] = net / dt;
      netJkg += net;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade) ?? 'flat'];
      zone.netJkg += net;
      zone.distanceM += d;
    }
    cumulativeTotalJkg[i] = cumulativeTotalJkg[i - 1] + rest + net;
  }

  return {
    netPowerWkg,
    cumulativeTotalJkg,
    netJkg,
    restJkg,
    totalJkg: netJkg + restJkg,
    movingTimeS,
    movingDistanceM,
    zones: GRADE_ZONES.map((zone) => ({
      zone,
      ...byZone[zone.key],
      share: netJkg > 0 ? byZone[zone.key].netJkg / netJkg : 0,
    })),
  };
};

/**
 * Moyenne glissante sur `windowSeconds` de la puissance, sur les seuls points
 * en mouvement : une pause laisse un trou au lieu de tirer la courbe vers zéro.
 */
export const smoothMovingPower = (
  powerWkg: number[],
  track: TrackPoint[],
  windowSeconds: number
): number[] => {
  const out = new Array<number>(powerWkg.length).fill(NaN);
  const halfMs = (windowSeconds * 1000) / 2;
  const moving: number[] = [];
  for (let i = 0; i < powerWkg.length; i++) if (isFinite(powerWkg[i])) moving.push(i);

  // Moyenne pondérée par la durée de chaque segment, pour qu'une cadence
  // irrégulière ne donne pas plus de poids aux points serrés.
  let start = 0;
  let end = -1;
  let energy = 0;
  let time = 0;
  const dt = (i: number) => (track[i].timeMs - track[i - 1].timeMs) / 1000;
  for (let k = 0; k < moving.length; k++) {
    const t = track[moving[k]].timeMs;
    while (end + 1 < moving.length && track[moving[end + 1]].timeMs - t <= halfMs) {
      end++;
      energy += powerWkg[moving[end]] * dt(moving[end]);
      time += dt(moving[end]);
    }
    while (start < k && t - track[moving[start]].timeMs > halfMs) {
      energy -= powerWkg[moving[start]] * dt(moving[start]);
      time -= dt(moving[start]);
      start++;
    }
    out[moving[k]] = time > 0 ? energy / time : powerWkg[moving[k]];
  }
  return out;
};
