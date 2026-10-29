import { partitionPoint } from '../core/search';
import { segmentDistanceM } from '../core/sessionStats';
import { J_PER_KCAL } from '../core/units';
import type { TrackPoint } from '../core/types';
import { GRADE_ANALYSIS, type GradeProfile } from '../core/sportProfiles';
import { classifyGrade, gradeZones, type GradeZone, type GradeZoneKey } from './runningAnalytics';

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
 *
 * La marche a son propre modèle (`WalkingParams`, choisi par le réglage
 * « Dépense » de l'activité) : Pandolf (1977), corrigé en descente par
 * Santee (2001).
 */

/** Modèle de dépense d'une activité à pied : course (Minetti) ou marche (Pandolf). */
export type EnergyModel = 'course' | 'marche';

export const isEnergyModel = (value: unknown): value is EnergyModel => value === 'course' || value === 'marche';

/**
 * Marche : équation de Pandolf, Givoni et Goldman (1977), J Appl Physiol
 * 43(4):577-581, ramenée au kilo de corps, en W/kg :
 *   M/W = 1,5 + 2,0·(1 + r)·r² + η·(1 + r)·(1,5·V² + 0,35·V·G)
 * avec V en m/s, G la pente en % (positive en montée), r = L/W la charge
 * portée sur le poids du corps, η le facteur de terrain (1 : route, tapis).
 * En descente (G < 0), correction de Santee, Allison, Blanchard et Small
 * (2001), Aviat Space Environ Med 72(6):562-566, ôtée de M :
 *   CF = η·[ G·(W + L)·V / 3,5 − (W + L)·(G + 6)² / W + 25 − V² ]
 * (en W), elle aussi ramenée au kilo. Pandolf seul donne en descente un coût
 * qui chute sous celui de rester debout ; corrigé, le minimum est vers −10 %.
 */
export interface WalkingParams {
  /** Facteur de terrain η de Pandolf (1 : route). */
  terrainFactor: number;
  /** Coût de la station debout, premier terme de Pandolf, en W/kg : déduit, comme le repos l'est en course. */
  standingWkg: number;
  /** Poids du corps supposé dans la correction de Santee, faute de poids saisi, en kg. */
  referenceBodyKg: number;
  /** Pente, en fraction, au-delà de laquelle le modèle est borné. */
  maxGrade: number;
}

export interface EnergyParams {
  /** Modèle de dépense : course (Minetti, les champs ci-dessous) ou marche (`walking`). */
  model: EnergyModel;
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
  /** Pente et zones de pente du bilan par zone (`SportProfile.grade`). */
  gradeZones: GradeProfile;
  /** Modèle de la marche (`model` : 'marche'). */
  walking: WalkingParams;
  /** Poids du corps, en kg, pour la correction de descente de la marche ; `null` : non saisi. */
  bodyKg: number | null;
}

/**
 * 200 ml/kg/km à 20,9 J/ml font 4,18 J/kg/m, la règle classique de
 * 1 kcal/kg/km. Le k de l'air est un ordre de grandeur tiré de Pugh (1971) :
 * environ 4 % du coût à l'allure du marathon élite, 2 % à 3 m/s. Le rendement
 * est celui du vélo : 1,05 J/kg/m sur le plat, l'ordre des capteurs.
 */
export const DEFAULT_ENERGY_PARAMS: EnergyParams = {
  model: 'course',
  economyMlKgKm: 200,
  joulesPerMlO2: 20.9,
  airDragJs2M3Kg: 0.0065,
  maxGrade: 0.45,
  restingMlKgMin: 3.5,
  mechanicalEfficiency: 0.25,
  gradeZones: GRADE_ANALYSIS,
  walking: { terrainFactor: 1, standingWkg: 1.5, referenceBodyKg: 75, maxGrade: 0.25 },
  bodyKg: null,
};

/** Charge portée plausible (sac, affaires), en kg ; 0 : aucune. */
export const isValidCarriedLoad = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= 0 && value <= 50;

/** Paramètres pour l'économie de course du pratiquant, celle par défaut s'il ne l'a pas saisie. */
export const runningEnergyParams = (economyMlKgKm: number | null): EnergyParams => ({
  ...DEFAULT_ENERGY_PARAMS,
  economyMlKgKm: economyMlKgKm ?? DEFAULT_ENERGY_PARAMS.economyMlKgKm,
});

/**
 * Paramètres de la marche (Pandolf) ; `bodyKg` : poids du pratiquant, `null`
 * s'il n'est pas saisi. L'économie de course ne sert pas à la marche.
 */
export const walkingEnergyParams = (economyMlKgKm: number | null, bodyKg: number | null): EnergyParams => ({
  ...runningEnergyParams(economyMlKgKm),
  model: 'marche',
  bodyKg: bodyKg !== null && isFinite(bodyKg) && bodyKg > 0 ? bodyKg : null,
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
 * Puissance brute de la marche, en W/kg de corps (Pandolf, corrigé par
 * Santee en descente). `speedMs` en m/s, `grade` en fraction (bornée à
 * ±`maxGrade`, `NaN` compte comme plat), `loadRatio` la charge sur le poids
 * du corps, `bodyKg` le poids du corps (`referenceBodyKg` s'il manque).
 *
 * La correction de Santee ne s'annule pas à 0 % : juste sous le plat, la
 * marche coûte un peu plus que sur le plat (+0,19 W/kg à 1,4 m/s et 70 kg),
 * un petit saut de la formule publiée, gardé tel quel.
 */
export const walkingGrossWkg = (
  speedMs: number,
  grade: number,
  loadRatio: number,
  bodyKg: number | null,
  walking: WalkingParams
): number => {
  const v = Math.max(0, speedMs);
  const g = 100 * Math.max(-walking.maxGrade, Math.min(walking.maxGrade, isFinite(grade) ? grade : 0));
  const r = Math.max(0, loadRatio);
  const eta = walking.terrainFactor;
  const w = bodyKg !== null && bodyKg > 0 ? bodyKg : walking.referenceBodyKg;
  let wkg = walking.standingWkg + 2 * (1 + r) * r * r + eta * (1 + r) * (1.5 * v * v + 0.35 * v * g);
  if (g < 0) wkg -= eta * ((g * (1 + r) * v) / 3.5 - ((1 + r) * (g + 6) ** 2) / w + (25 - v * v) / w);
  return wkg;
};

/**
 * Coût net de la marche hors air, en J/kg/m : la puissance de Pandolf, station
 * debout déduite, sur la vitesse ; 0 à l'arrêt.
 */
export const walkingCostJkgM = (
  speedMs: number,
  grade: number,
  loadRatio: number,
  bodyKg: number | null,
  walking: WalkingParams
): number => {
  if (!(speedMs > 0)) return 0;
  return Math.max(0, walkingGrossWkg(speedMs, grade, loadRatio, bodyKg, walking) - walking.standingWkg) / speedMs;
};

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
    if (kcalPerDay > 0) return (kcalPerDay * J_PER_KCAL) / 86400 / weightKg;
  }
  return (params.restingMlKgMin * params.joulesPerMlO2) / 60;
};

export interface EnergyZone {
  zone: GradeZone;
  /** Énergie de course nette dans la zone, en J/kg. */
  netJkg: number;
  /** Travail mécanique dans la zone, en J/kg : d'où sa puissance moyenne, sur `timeS`. */
  mechanicalJkg: number;
  distanceM: number;
  /** Temps en mouvement dans la zone, en s. */
  timeS: number;
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
 *
 * `loadRatio` : charge portée (sac, affaires) sur le poids du corps. Le
 * déplacement coûte en proportion de la masse déplacée, corps et charge ; le
 * repos reste celui du corps. Les résultats restent par kilo de coureur.
 *
 * Marche (`params.model`) : le coût de Pandolf (`walkingCostJkgM`), qui
 * porte déjà la charge, à la place de Minetti ; l'air comme en course.
 */
export const computeEnergy = (
  track: TrackPoint[],
  grades: number[],
  activityMask: boolean[],
  params: EnergyParams,
  restWkg: number,
  loadRatio = 0
): EnergyResult => {
  const massRatio = 1 + Math.max(0, loadRatio);
  const n = track.length;
  const mechanicalPowerWkg = new Array<number>(n).fill(NaN);
  const cumulativeTotalJkg = new Array<number>(n).fill(0);
  const byZone: Record<GradeZoneKey, { netJkg: number; distanceM: number; timeS: number }> = {
    steepDown: { netJkg: 0, distanceM: 0, timeS: 0 },
    down: { netJkg: 0, distanceM: 0, timeS: 0 },
    flat: { netJkg: 0, distanceM: 0, timeS: 0 },
    up: { netJkg: 0, distanceM: 0, timeS: 0 },
    steepUp: { netJkg: 0, distanceM: 0, timeS: 0 },
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
      net = params.model === 'marche'
        ? (walkingCostJkgM(v, grade, loadRatio, params.bodyKg, params.walking) + params.airDragJs2M3Kg * v * v * massRatio) * d
        : (runningCostJkgM(grade, params) + params.airDragJs2M3Kg * v * v) * d * massRatio;
      mechanicalPowerWkg[i] = (net * params.mechanicalEfficiency) / dt;
      netJkg += net;
      movingTimeS += dt;
      movingDistanceM += d;
      const zone = byZone[classifyGrade(grade, params.gradeZones) ?? 'flat'];
      zone.netJkg += net;
      zone.distanceM += d;
      zone.timeS += dt;
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
    zones: gradeZones(params.gradeZones).map((zone) => ({
      zone,
      ...byZone[zone.key],
      mechanicalJkg: byZone[zone.key].netJkg * params.mechanicalEfficiency,
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
  const firstFrom = (t: number, lo: number, hi: number, strict: boolean): number =>
    partitionPoint(hi + 1, (mid) => time(mid) < t || (strict && time(mid) === t), lo);

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
