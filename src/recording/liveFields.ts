import type { Treatment } from '../core/sportProfiles';
import {
  J_PER_KCAL, formatClock, formatDistance, formatShortDistance, formatSpeed, formatTimeOfDay, isInverseUnit, type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { LIVE_STATS_DEFAULTS, type LiveStats } from './liveStats';

/**
 * Chiffres en grand de l'enregistrement quand la carte est réduite, choisis
 * par activité dans Réglages : jusqu'à `MAX_LIVE_FIELDS`, parmi ceux qui ont
 * un sens pour son traitement (le fractionné à pied a ceux de la course).
 * Libellés et valeurs sont formatés ici, dans les unités de l'activité.
 */

export type LiveFieldKey =
  | 'speed' | 'average' | 'max' | 'recentDistanceSpeed' | 'lastDistance' | 'distance' | 'duration' | 'clock'
  | 'remaining' | 'remainingTime'
  | 'recentTopShort' | 'recentTopLong' | 'heading' | 'legAverage' | 'markDistance' | 'markBearing'
  | 'grade' | 'gain' | 'recentDistanceGain' | 'loss' | 'climbRate' | 'power' | 'effort';

const ALL: Treatment[] = ['voile', 'course', 'velo'];
const LAND: Treatment[] = ['course', 'velo'];

/** Traitements où chaque chiffre a un sens ; l'ordre est celui des menus de Réglages. */
const LIVE_FIELD_TREATMENTS: Record<LiveFieldKey, readonly Treatment[]> = {
  speed: ALL,
  average: ALL,
  max: ALL,
  recentDistanceSpeed: ALL,
  lastDistance: ALL,
  recentTopShort: ['voile'],
  recentTopLong: ['voile'],
  legAverage: ['voile'],
  heading: ['voile'],
  markDistance: ['voile'],
  markBearing: ['voile'],
  grade: LAND,
  gain: LAND,
  recentDistanceGain: LAND,
  loss: LAND,
  climbRate: LAND,
  power: LAND,
  effort: LAND,
  distance: ALL,
  duration: ALL,
  clock: ALL,
  remaining: ALL,
  remainingTime: ALL,
};

const LIVE_FIELD_KEYS = Object.keys(LIVE_FIELD_TREATMENTS) as LiveFieldKey[];

/** Chiffres proposés pour un traitement, dans l'ordre des menus. */
export const liveFieldsOfTreatment = (treatment: Treatment): LiveFieldKey[] =>
  LIVE_FIELD_KEYS.filter((key) => LIVE_FIELD_TREATMENTS[key].includes(treatment));

/** Nombre de lignes au plus. */
export const MAX_LIVE_FIELDS = 4;

/** Lignes à défaut de choix : en course, les 300 derniers mètres plutôt que la pointe de 2 s. */
export const DEFAULT_LIVE_FIELDS: Record<Treatment, LiveFieldKey[]> = {
  voile: ['speed', 'average', 'max'],
  course: ['speed', 'average', 'recentDistanceSpeed'],
  velo: ['speed', 'average', 'max'],
};

const isLiveFieldKey = (value: unknown): value is LiveFieldKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIVE_FIELD_TREATMENTS, value);

/**
 * Choix rangé, nettoyé : clés connues et permises pour le traitement, sans
 * doublon, `MAX_LIVE_FIELDS` au plus ; `null` s'il n'en reste aucune (le
 * défaut s'applique).
 */
export const sanitizeLiveFields = (value: unknown, treatment: Treatment): LiveFieldKey[] | null => {
  if (!Array.isArray(value)) return null;
  const kept: LiveFieldKey[] = [];
  for (const key of value) {
    if (isLiveFieldKey(key) && LIVE_FIELD_TREATMENTS[key].includes(treatment) && !kept.includes(key)) kept.push(key);
    if (kept.length === MAX_LIVE_FIELDS) break;
  }
  return kept.length > 0 ? kept : null;
};

export interface LiveFieldUnits {
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
}

const recentWindowLabel = `${Math.round(LIVE_STATS_DEFAULTS.recentWindowS / 60)} min`;
const [TOP_SHORT_S, TOP_LONG_S] = LIVE_STATS_DEFAULTS.topDurationsS;

/** Libellé d'un chiffre ; une allure (min/km) se dit « allure ». */
export const liveFieldLabel = (key: LiveFieldKey, { speedUnit, distanceUnit }: LiveFieldUnits): string => {
  const pace = isInverseUnit(speedUnit);
  switch (key) {
    case 'speed': return pace ? 'Allure' : 'Vitesse';
    case 'average': return pace ? 'Allure moyenne' : 'Moyenne';
    case 'max': return `${pace ? 'Meilleure' : 'Max'} (${LIVE_STATS_DEFAULTS.maxDurationS} s)`;
    case 'recentDistanceSpeed': return `${LIVE_STATS_DEFAULTS.recentDistanceM} derniers m`;
    case 'lastDistance': return distanceUnit === 'nm' ? 'Dernier mille' : 'Dernier km';
    case 'distance': return 'Distance';
    case 'duration': return 'Durée';
    case 'clock': return 'Heure';
    case 'remaining': return 'Restant';
    case 'remainingTime': return 'Temps restant';
    case 'recentTopShort': return `Top ${TOP_SHORT_S} s (${recentWindowLabel})`;
    case 'recentTopLong': return `Top ${TOP_LONG_S} s (${recentWindowLabel})`;
    case 'heading': return 'Cap';
    case 'legAverage': return 'Moyenne du bord';
    case 'markDistance': return 'Balise';
    case 'markBearing': return 'Cap balise';
    case 'grade': return 'Pente';
    case 'gain': return 'D+';
    case 'recentDistanceGain': return `D+ ${LIVE_STATS_DEFAULTS.recentDistanceM} derniers m`;
    case 'loss': return 'D−';
    case 'climbRate': return 'Vitesse ascensionnelle';
    case 'power': return `Puissance (${LIVE_STATS_DEFAULTS.powerWindowS} s)`;
    case 'effort': return 'Énergie';
  }
};

export interface LiveFieldContext extends LiveFieldUnits {
  stats: LiveStats;
  /** Durée de l'enregistrement, en millisecondes. */
  durationMs: number;
  /** Instant du dernier calcul, pour l'heure ; `null` avant le premier. */
  nowMs: number | null;
  /** Distance restante sur la trace suivie, en mètres ; `null` sans trace ou avant de l'avoir rejointe. */
  remainingM: number | null;
  /** Cap de la marche, en degrés ; `null` s'il n'est pas connu. */
  headingDeg: number | null;
  /** Distance et cap vers la balise visée d'un parcours de voile ; `null` sans guidage. */
  markDistanceM: number | null;
  markBearingDeg: number | null;
}

const NONE = '—';

const formatMeters = (m: number | null): string => (m === null ? NONE : `${Math.round(m)} m`);

/** Pente en pour cent, signée. */
const formatGrade = (grade: number | null): string => {
  if (grade === null) return NONE;
  const percent = Math.round(grade * 100);
  return percent > 0 ? `+${percent} %` : percent < 0 ? `−${-percent} %` : '0 %';
};

/** Valeur d'un chiffre, formatée dans les unités de l'activité ; « — » quand elle manque. */
export const liveFieldValue = (key: LiveFieldKey, ctx: LiveFieldContext): string => {
  const { stats, speedUnit, distanceUnit } = ctx;
  switch (key) {
    case 'speed': return formatSpeed(stats.currentSpeedMs, speedUnit);
    case 'average': return formatSpeed(stats.averageSpeedMs, speedUnit);
    case 'max': return formatSpeed(stats.maxSpeedMs, speedUnit);
    case 'recentDistanceSpeed': return formatSpeed(stats.recentDistanceSpeedMs, speedUnit);
    case 'lastDistance': return formatSpeed(stats.lastDistanceSpeedMs, speedUnit);
    case 'distance': return formatDistance(stats.distanceM, distanceUnit);
    case 'duration': return formatClock(ctx.durationMs);
    case 'clock': return ctx.nowMs === null ? NONE : formatTimeOfDay(ctx.nowMs).slice(0, 5);
    case 'remaining': return ctx.remainingM === null ? NONE : formatDistance(ctx.remainingM, distanceUnit);
    case 'remainingTime': {
      const speed = stats.averageSpeedMs;
      return ctx.remainingM === null || speed === null || speed <= 0 ? NONE : formatClock((ctx.remainingM / speed) * 1000);
    }
    case 'recentTopShort': return formatSpeed(stats.recentTopsMs[0] ?? null, speedUnit);
    case 'recentTopLong': return formatSpeed(stats.recentTopsMs[1] ?? null, speedUnit);
    case 'heading': return ctx.headingDeg === null ? NONE : `${Math.round(ctx.headingDeg) % 360}°`;
    case 'legAverage': return stats.legs.current ? formatSpeed(stats.legs.current.averageSpeedMs, speedUnit) : NONE;
    case 'markDistance': return ctx.markDistanceM === null ? NONE : formatShortDistance(ctx.markDistanceM, distanceUnit);
    case 'markBearing': return ctx.markBearingDeg === null ? NONE : `${Math.round(ctx.markBearingDeg) % 360}°`;
    case 'grade': return formatGrade(stats.currentGrade);
    case 'gain': return formatMeters(stats.elevationGainM);
    case 'recentDistanceGain': return formatMeters(stats.recentDistanceGainM);
    case 'loss': return formatMeters(stats.elevationLossM);
    case 'climbRate': return stats.climbRateMh === null ? NONE : `${Math.round(stats.climbRateMh)} m/h`;
    case 'power':
      if (stats.recentPowerW === null) return NONE;
      return stats.energyPerKg ? `${stats.recentPowerW.toFixed(1)} W/kg` : `${Math.round(stats.recentPowerW)} W`;
    case 'effort': {
      if (stats.effortJ === null) return NONE;
      const kcal = stats.effortJ / J_PER_KCAL;
      return stats.energyPerKg ? `${kcal.toFixed(1)} kcal/kg` : `${Math.round(kcal)} kcal`;
    }
  }
};
