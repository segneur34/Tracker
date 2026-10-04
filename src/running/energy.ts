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
 *
 * L'énergie est celle que dépense l'organisme ; la puissance affichée est
 * mécanique, cette dépense multipliée par un rendement, comme à vélo. Elle se
 * compare à celle d'un capteur de puissance de course (environ 1 W/kg par m/s
 * sur le plat), quatre fois moindre que la puissance dépensée.
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
  /** Rendement : puissance mécanique sur puissance de course nette (repos déduit). */
  mechanicalEfficiency: number;
}

/**
 * 200 ml/kg/km à 20,9 J/ml font 4,18 J/kg/m, la règle classique de
 * 1 kcal/kg/km. Le k de l'air est un ordre de grandeur tiré de Pugh (1971) :
 * environ 4 % du coût à l'allure du marathon élite, 2 % à 3 m/s. Le rendement
 * est celui du vélo : 1,05 J/kg/m sur le plat, l'ordre des capteurs.
 */
export const DEFAULT_ENERGY_PARAMS: EnergyParams = {
  economyMlKgKm: 200,
  joulesPerMlO2: 20.9,
  airDragJs2M3Kg: 0.0065,
  maxGrade: 0.45,
  restingMlKgMin: 3.5,
  mechanicalEfficiency: 0.25,
};

/** Paramètres pour l'économie de course du pratiquant, celle par défaut s'il ne l'a pas saisie. */
export const runningEnergyParams = (economyMlKgKm: number | null): EnergyParams => ({
  ...DEFAULT_ENERGY_PARAMS,
  economyMlKgKm: economyMlKgKm ?? DEFAULT_ENERGY_PARAMS.economyMlKgKm,
});

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
   * Puissance mécanique en chaque point (segment qui y mène), en W/kg ;
   * `NaN` à l'arrêt et au premier point.
   */
  mechanicalPowerWkg: number[];
  /** Énergie totale (course et repos) dépensée depuis le départ, en J/kg. */
  cumulativeTotalJkg: number[];
  /** Travail mécanique, en J/kg. */
  mechanicalJkg: number;
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
 * (coût de la pente + k·v²) × distance, et en travail mécanique ce coût
 * multiplié par le rendement ; le repos court sur toute la durée. Une pente
 * manquante compte comme plate, et son segment va dans la zone plate.
 */
export const computeEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: EnergyParams,
  restWkg: number
): EnergyResult => {
  const n = track.length;
  const mechanicalPowerWkg = new Array<number>(n).fill(NaN);
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
      mechanicalPowerWkg[i] = (net * params.mechanicalEfficiency) / dt;
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
    mechanicalPowerWkg,
    cumulativeTotalJkg,
    mechanicalJkg: netJkg * params.mechanicalEfficiency,
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
 *
 * La fenêtre reste centrée. Près du départ, de l'arrivée ou d'un arrêt plus
 * long qu'une demi-fenêtre, elle rétrécit des deux côtés à la fois. Tronquée
 * d'un seul côté, elle ne verrait que l'effort qui suit : sur une trace qui
 * part en côte, la courbe démarrerait à la moyenne de la montée entière, son
 * maximum, quand le premier point vaut deux fois moins.
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
  const m = moving.length;
  if (m === 0) return out;
  const time = (k: number) => track[moving[k]].timeMs;

  // Moyenne pondérée par la durée de chaque segment, pour qu'une cadence
  // irrégulière ne donne pas plus de poids aux points serrés. Cumuls
  // d'énergie et de temps : la moyenne de toute plage se lit en une soustraction.
  const energyCum = new Array<number>(m + 1).fill(0);
  const timeCum = new Array<number>(m + 1).fill(0);
  for (let k = 0; k < m; k++) {
    const i = moving[k];
    const dt = i > 0 ? (track[i].timeMs - track[i - 1].timeMs) / 1000 : 0;
    energyCum[k + 1] = energyCum[k] + powerWkg[i] * dt;
    timeCum[k + 1] = timeCum[k] + dt;
  }

  // Tronçons en mouvement, coupés par un arrêt plus long qu'une demi-fenêtre.
  const stretchStart = new Array<number>(m);
  const stretchEnd = new Array<number>(m);
  for (let k = 0; k < m; k++) {
    stretchStart[k] = k > 0 && time(k) - time(k - 1) <= halfMs ? stretchStart[k - 1] : k;
  }
  for (let k = m - 1; k >= 0; k--) {
    stretchEnd[k] = k < m - 1 && time(k + 1) - time(k) <= halfMs ? stretchEnd[k + 1] : k;
  }

  /**
   * Premier rang de [lo, hi] dont l'instant atteint `t` (`strict` : le
   * dépasse) ; hi + 1 s'il n'y en a pas.
   */
  const firstFrom = (t: number, lo: number, hi: number, strict: boolean): number => {
    let a = lo;
    let b = hi + 1;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (time(mid) < t || (strict && time(mid) === t)) a = mid + 1;
      else b = mid;
    }
    return a;
  };

  for (let k = 0; k < m; k++) {
    const t = time(k);
    const s = stretchStart[k];
    const e = stretchEnd[k];
    const half = Math.min(halfMs, t - time(s), time(e) - t);
    const lo = firstFrom(t - half, s, k, false);
    const hi = firstFrom(t + half, k, e, true) - 1;
    const span = timeCum[hi + 1] - timeCum[lo];
    out[moving[k]] = span > 0 ? (energyCum[hi + 1] - energyCum[lo]) / span : powerWkg[moving[k]];
  }
  return out;
};
