import { resistiveForceN, type CyclingEnergyParams } from '../cycling/energy';
import { routePoints, routeProfileRows, routeTotals, type PlannedRoute } from './route';

/**
 * Temps de parcours estimé d'un itinéraire, en course et à vélo, à partir
 * d'une vitesse sur le plat : celle du niveau choisi dans Réglages, ou une
 * vitesse saisie (« Personnalisé »).
 *
 * Course : règle du km-effort, répandue en trail. Chaque mètre de D+ compte
 * comme `climbFactor` mètres de plat (10 : 100 m de D+ font 1 km de plus) ;
 * la descente ne compte pas.
 *
 * Vélo, pente par pente le long du profil, avec le modèle de résistance de
 * l'énergie (`resistiveForceN`) :
 * - en montée, la vitesse où la puissance que tient un cycliste du niveau
 *   (en W/kg) équilibre pesanteur, roulement et air, sans dépasser celle du
 *   plat. La puissance qui tient la vitesse du plat, gardée en montée, y
 *   donnerait 3 km/h à 8 % : on appuie plus fort quand ça monte ;
 * - en descente, la vitesse en roue libre, jamais moins que celle du plat,
 *   plafonnée selon le type de vélo (freinage, virages).
 */

export type PaceLevel = 'debutant' | 'moyen' | 'bon' | 'expert' | 'perso';
export type PresetPaceLevel = Exclude<PaceLevel, 'perso'>;

export const PACE_LEVELS: PaceLevel[] = ['debutant', 'moyen', 'bon', 'expert', 'perso'];
export const PRESET_PACE_LEVELS: PresetPaceLevel[] = ['debutant', 'moyen', 'bon', 'expert'];

export const PACE_LEVEL_LABEL: Record<PaceLevel, string> = {
  debutant: 'Débutant',
  moyen: 'Moyen',
  bon: 'Bon',
  expert: 'Expert',
  perso: 'Personnalisé',
};

/** Niveau retenu sans réglage, et à la place d'un « Personnalisé » sans vitesse saisie. */
export const DEFAULT_PACE_LEVEL: PresetPaceLevel = 'moyen';

export const isPaceLevel = (value: unknown): value is PaceLevel =>
  typeof value === 'string' && (PACE_LEVELS as string[]).includes(value);

/** Familles qui ont un temps estimé. */
export type PlanningFamily = 'course' | 'velo';

const kmh = (v: number): number => v / 3.6;

/** Vitesse sur le plat de chaque niveau, en m/s. */
export const LEVEL_FLAT_SPEED_MS: Record<PlanningFamily, Record<PresetPaceLevel, number>> = {
  course: { debutant: kmh(8), moyen: kmh(10), bon: kmh(12), expert: kmh(14) },
  velo: { debutant: kmh(18), moyen: kmh(22), bon: kmh(26), expert: kmh(30) },
};

/**
 * Puissance tenue en montée à vélo, en W par kg de cycliste : de quoi monter
 * 8 % vers 6, 7,5, 10 et 13 km/h sur un vélo de route (450 à 1 050 m de
 * dénivelé à l'heure).
 */
export const LEVEL_CLIMB_POWER_WKG: Record<PresetPaceLevel, number> = {
  debutant: 1.5,
  moyen: 2,
  bon: 2.7,
  expert: 3.5,
};

/** Plage plausible d'une vitesse saisie, en m/s. */
export const CUSTOM_FLAT_SPEED_BOUNDS_MS: Record<PlanningFamily, [number, number]> = {
  course: [kmh(3), kmh(25)],
  velo: [kmh(5), kmh(60)],
};

export const isValidFlatSpeed = (family: PlanningFamily, value: unknown): value is number => {
  const [lo, hi] = CUSTOM_FLAT_SPEED_BOUNDS_MS[family];
  return typeof value === 'number' && isFinite(value) && value >= lo && value <= hi;
};

/**
 * Puissance de montée d'une vitesse du plat saisie, en W/kg : interpolée
 * entre les niveaux, bornée à ceux des extrêmes.
 */
export const climbPowerWkgForFlatSpeed = (flatSpeedMs: number): number => {
  const points = PRESET_PACE_LEVELS.map((l) => ({ v: LEVEL_FLAT_SPEED_MS.velo[l], p: LEVEL_CLIMB_POWER_WKG[l] }));
  if (flatSpeedMs <= points[0].v) return points[0].p;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (flatSpeedMs <= b.v) return a.p + ((b.p - a.p) * (flatSpeedMs - a.v)) / (b.v - a.v);
  }
  return points[points.length - 1].p;
};

/** Mètres de plat comptés pour un mètre de D+ en course : 100 m de D+ font 1 km. */
export const KM_EFFORT_CLIMB_FACTOR = 10;

export interface RunningDurationSettings {
  family: 'course';
  flatSpeedMs: number;
  climbFactor: number;
}

export interface CyclingDurationSettings {
  family: 'velo';
  flatSpeedMs: number;
  /** Puissance mécanique tenue en montée, en W. */
  climbPowerW: number;
  params: CyclingEnergyParams;
  /** Vitesse plafond en descente, en m/s. */
  maxSpeedMs: number;
}

export type DurationSettings = RunningDurationSettings | CyclingDurationSettings;

/** Temps de course en km-effort, en secondes ; un D+ inconnu compte pour zéro. */
export const runningDurationS = (
  totals: { distanceM: number; gainM: number | null },
  settings: { flatSpeedMs: number; climbFactor: number }
): number => (totals.distanceM + (totals.gainM ?? 0) * settings.climbFactor) / settings.flatSpeedMs;

/** Pas de la dichotomie : 2⁻⁴⁰ du plafond, bien en deçà du mm/s. */
const BISECTION_STEPS = 40;

/**
 * Vitesse, en m/s, à laquelle `powerW` (à la roue : avant la transmission)
 * équilibre les résistances sur la pente donnée (`NaN` compte comme plat),
 * plafonnée à `maxSpeedMs`. La puissance utile moins force × vitesse décroît
 * jusqu'à une seule racine positive, en montée comme en descente : une
 * dichotomie suffit. Avec 0 W, c'est la vitesse en roue libre.
 */
export const cyclingSpeedOnGradeMs = (
  grade: number,
  powerW: number,
  params: CyclingEnergyParams,
  maxSpeedMs: number
): number => {
  const useful = powerW * params.drivetrainEfficiency;
  const surplus = (v: number) => useful - resistiveForceN(v, grade, params) * v;
  if (surplus(maxSpeedMs) >= 0) return maxSpeedMs;
  let lo = 0;
  let hi = maxSpeedMs;
  for (let k = 0; k < BISECTION_STEPS; k++) {
    const mid = (lo + hi) / 2;
    if (surplus(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Vitesse estimée à vélo sur une pente (`NaN` : plat), en m/s, selon les règles de l'en-tête. */
export const cyclingRideSpeedMs = (grade: number, settings: Omit<CyclingDurationSettings, 'family'>): number => {
  const g = isFinite(grade) ? grade : 0;
  const { flatSpeedMs, climbPowerW, params, maxSpeedMs } = settings;
  if (g >= 0) return Math.min(flatSpeedMs, cyclingSpeedOnGradeMs(g, climbPowerW, params, flatSpeedMs));
  return Math.min(maxSpeedMs, Math.max(flatSpeedMs, cyclingSpeedOnGradeMs(g, 0, params, maxSpeedMs)));
};

/**
 * Temps à vélo le long d'un profil à pas régulier (`routeProfileRows`), en
 * secondes : chaque intervalle est parcouru à la vitesse de la pente de sa
 * ligne d'arrivée ; une pente manquante compte comme plate.
 */
export const cyclingDurationS = (
  rows: ReadonlyArray<{ distM: number; grade: number | null }>,
  settings: Omit<CyclingDurationSettings, 'family'>
): number => {
  let total = 0;
  for (let i = 1; i < rows.length; i++) {
    const d = rows[i].distM - rows[i - 1].distM;
    if (d > 0) total += d / cyclingRideSpeedMs(rows[i].grade ?? NaN, settings);
  }
  return total;
};

/**
 * Temps estimé d'un itinéraire, en secondes, ou `null` sans réglage (voile)
 * ou sans tracé. `minGainM` : écart qui confirme une montée, celui du terrain
 * de l'activité, pour que le D+ compté soit celui affiché (`routeTotals`).
 */
export const estimateRouteDurationS = (
  route: PlannedRoute,
  minGainM: number,
  settings: DurationSettings | null
): number | null => {
  if (!settings) return null;
  const points = routePoints(route);
  if (points.length < 2) return null;
  const seconds = settings.family === 'course'
    ? runningDurationS(routeTotals(route, minGainM), settings)
    : cyclingDurationS(routeProfileRows(points), settings);
  return seconds > 0 && isFinite(seconds) ? seconds : null;
};
