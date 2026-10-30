import { roundBearingDeg } from '../core/angles';
import { bandIndex } from '../core/basics';
import { sportTreatment, type SportFamily, type Treatment } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import {
  J_PER_KCAL, formatClock, formatDistance, formatShortDistance, formatSpeed, formatTimeOfDay, isInverseUnit, type DistanceUnit, type SpeedUnit, formatDecimal
} from '../core/units';
import { LIVE_STATS_DEFAULTS, type LiveStats, type LiveStatsOptions } from './liveStats';

/**
 * Chiffres en grand de l'enregistrement quand la carte est réduite, choisis
 * par activité dans Réglages : jusqu'à `MAX_LIVE_FIELDS`, parmi ceux qui ont
 * un sens pour son traitement (le fractionné à pied a ceux de la course).
 * Ceux de la notification de l'enregistrement viennent du même catalogue,
 * choisis à part, `MAX_NOTIFICATION_FIELDS` au plus, avec en plus ceux qui
 * ne vont qu'à elle (`NOTIFICATION_ONLY_FIELDS`). Libellés et valeurs sont
 * formatés ici, dans les unités de l'activité.
 */

export type LiveFieldKey =
  | 'speed' | 'average' | 'max' | 'recentDistanceSpeed' | 'lastDistance' | 'distance' | 'duration' | 'clock'
  | 'remaining' | 'remainingTime'
  | 'recentTopShort' | 'recentTopLong' | 'heading' | 'legAverage' | 'markDistance' | 'markBearing'
  | 'grade' | 'gain' | 'recentDistanceGain' | 'loss' | 'climbRate' | 'power' | 'effort' | 'heartRate' | 'averageHeartRate' | 'heartRateZone'
  | 'step';

const ALL: Treatment[] = ['voile', 'course', 'velo', 'surf'];
const LAND: Treatment[] = ['course', 'velo'];
/** Chiffres sans position : la FC, le temps et l'étape, seuls proposés à la muscu (lot I du 25/10). */
const WITH_MUSCU: Treatment[] = [...ALL, 'muscu'];

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
  markDistance: ['voile', 'surf'],
  markBearing: ['voile', 'surf'],
  grade: LAND,
  gain: LAND,
  recentDistanceGain: LAND,
  loss: LAND,
  climbRate: LAND,
  power: LAND,
  effort: LAND,
  heartRate: WITH_MUSCU,
  averageHeartRate: WITH_MUSCU,
  heartRateZone: WITH_MUSCU,
  distance: ALL,
  duration: WITH_MUSCU,
  clock: WITH_MUSCU,
  remaining: ALL,
  remainingTime: ALL,
  step: [...LAND, 'muscu'],
};

/**
 * Chiffres de la notification seulement, pas de la carte réduite : l'étape
 * (26/10), répétition du compteur ou palier d'un test, que la carte du
 * compteur ou du test montre déjà sur la page.
 */
const NOTIFICATION_ONLY_FIELDS: readonly LiveFieldKey[] = ['step'];

/** Où un chiffre se lit : la carte réduite de l'enregistrement, ou la notification. */
export type LiveFieldTarget = 'live' | 'notification';

/** Chiffres réservés à une famille (27/10) : l'étape n'est proposée qu'à l'Entraînement, à pied ou à vélo. */
const LIVE_FIELD_FAMILIES: Partial<Record<LiveFieldKey, readonly SportFamily[]>> = {
  step: ['fractionne'],
};

const allowedFor = (key: LiveFieldKey, treatment: Treatment, target: LiveFieldTarget, family?: SportFamily): boolean => {
  const families = LIVE_FIELD_FAMILIES[key];
  return LIVE_FIELD_TREATMENTS[key].includes(treatment)
    && (target === 'notification' || !NOTIFICATION_ONLY_FIELDS.includes(key))
    && (!families || (family !== undefined && families.includes(family)));
};

const LIVE_FIELD_KEYS = Object.keys(LIVE_FIELD_TREATMENTS) as LiveFieldKey[];

/** Chiffres proposés pour un traitement (et une famille, pour ceux qui en dépendent), dans l'ordre des menus. */
export const liveFieldsOfTreatment = (treatment: Treatment, target: LiveFieldTarget = 'live', family?: SportFamily): LiveFieldKey[] =>
  LIVE_FIELD_KEYS.filter((key) => allowedFor(key, treatment, target, family));

/** Nombre de lignes au plus. */
export const MAX_LIVE_FIELDS = 4;

/** Lignes à défaut de choix : en course, les 300 derniers mètres plutôt que la pointe de 2 s. */
export const DEFAULT_LIVE_FIELDS: Record<Treatment, LiveFieldKey[]> = {
  voile: ['speed', 'average', 'max'],
  course: ['speed', 'average', 'recentDistanceSpeed'],
  velo: ['speed', 'average', 'max'],
  surf: ['speed', 'max', 'duration'],
  muscu: ['heartRate', 'heartRateZone', 'averageHeartRate', 'duration'],
};

/**
 * Lignes propres à un calcul, avant celles de son traitement : en bateau
 * (21/10), vitesse, moyenne, distance et cap.
 */
const SPORT_LIVE_FIELDS: Partial<Record<SportType, LiveFieldKey[]>> = {
  bateau: ['speed', 'average', 'distance', 'heading'],
};

/** Lignes d'un calcul à défaut de choix : les siennes, sinon celles de son traitement. */
export const defaultLiveFieldsOf = (sport: SportType): LiveFieldKey[] =>
  SPORT_LIVE_FIELDS[sport] ?? DEFAULT_LIVE_FIELDS[sportTreatment(sport)];

/** Chiffres de la notification de l'enregistrement au plus : écran verrouillé, Android coupe la ligne au-delà de deux. */
export const MAX_NOTIFICATION_FIELDS = 2;

/** Chiffres de la notification à défaut de choix, les mêmes pour tous les traitements à positions. */
export const DEFAULT_NOTIFICATION_FIELDS: Record<Treatment, LiveFieldKey[]> = {
  voile: ['speed', 'distance'],
  course: ['speed', 'distance'],
  velo: ['speed', 'distance'],
  surf: ['speed', 'distance'],
  // L'étape du compteur et la FC : ni vitesse ni distance sans position.
  muscu: ['step', 'heartRate'],
};

/** Chiffres de la notification propres à un calcul, avant ceux de son traitement ; aucun pour l'instant. */
const SPORT_NOTIFICATION_FIELDS: Partial<Record<SportType, LiveFieldKey[]>> = {};

/** Chiffres de la notification d'un calcul à défaut de choix : les siens, sinon ceux de son traitement. */
export const defaultNotificationFieldsOf = (sport: SportType): LiveFieldKey[] =>
  SPORT_NOTIFICATION_FIELDS[sport] ?? DEFAULT_NOTIFICATION_FIELDS[sportTreatment(sport)];

const isLiveFieldKey = (value: unknown): value is LiveFieldKey =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(LIVE_FIELD_TREATMENTS, value);

/**
 * Choix rangé, nettoyé : clés connues et permises pour le traitement et la
 * cible, sans doublon, `max` au plus ; `null` s'il n'en reste aucune (le
 * défaut s'applique).
 */
export const sanitizeLiveFields = (
  value: unknown, treatment: Treatment, max = MAX_LIVE_FIELDS, target: LiveFieldTarget = 'live', family?: SportFamily,
): LiveFieldKey[] | null => {
  if (!Array.isArray(value)) return null;
  const kept: LiveFieldKey[] = [];
  for (const key of value) {
    if (kept.length === max) break;
    if (isLiveFieldKey(key) && allowedFor(key, treatment, target, family) && !kept.includes(key)) kept.push(key);
  }
  return kept.length > 0 ? kept : null;
};

export interface LiveFieldUnits {
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  /**
   * Options du calcul du direct dont les chiffres viennent (fenêtres, durées
   * des tops, distances) : les libellés les disent. Absentes : celles par
   * défaut (`LIVE_STATS_DEFAULTS`), comme dans Réglages.
   */
  options?: LiveStatsOptions;
}

/** « 5 min » : la fenêtre des chiffres récents du direct. */
export const recentWindowLabel = (options: LiveStatsOptions = LIVE_STATS_DEFAULTS): string =>
  `${Math.round(options.recentWindowS / 60)} min`;

/** Libellé d'un chiffre ; une allure (min/km) se dit « allure ». */
export const liveFieldLabel = (key: LiveFieldKey, { speedUnit, distanceUnit, options = LIVE_STATS_DEFAULTS }: LiveFieldUnits): string => {
  const pace = isInverseUnit(speedUnit);
  const [topShortS, topLongS] = options.topDurationsS;
  switch (key) {
    case 'speed': return pace ? 'Allure' : 'Vitesse';
    case 'average': return pace ? 'Allure moyenne' : 'Moyenne';
    case 'max': return `${pace ? 'Meilleure' : 'Max'} (${options.maxDurationS} s)`;
    case 'recentDistanceSpeed': return `${options.recentDistanceM} derniers m`;
    case 'lastDistance': return distanceUnit === 'nm' ? 'Dernier mille' : 'Dernier km';
    case 'distance': return 'Distance';
    case 'duration': return 'Durée';
    case 'clock': return 'Heure';
    case 'remaining': return 'Restant';
    case 'remainingTime': return 'Temps restant';
    case 'recentTopShort': return `Top ${topShortS} s (${recentWindowLabel(options)})`;
    case 'recentTopLong': return `Top ${topLongS} s (${recentWindowLabel(options)})`;
    case 'heading': return 'Cap';
    case 'legAverage': return 'Moyenne du bord';
    case 'markDistance': return 'Balise';
    case 'markBearing': return 'Cap balise';
    case 'grade': return 'Pente';
    case 'gain': return 'D+';
    case 'recentDistanceGain': return `D+ ${options.recentDistanceM} derniers m`;
    case 'loss': return 'D−';
    case 'climbRate': return 'Vitesse ascensionnelle';
    case 'power': return `Puissance (${options.powerWindowS} s)`;
    case 'effort': return 'Énergie';
    case 'heartRate': return 'Fréquence cardiaque';
    case 'averageHeartRate': return 'FC moyenne';
    case 'heartRateZone': return 'Zone cardiaque';
    case 'step': return 'Étape';
  }
};

/** Libellé court d'un chiffre, devant sa valeur sur la ligne repliée de la notification. */
export const liveFieldShortLabel = (key: LiveFieldKey, { speedUnit, distanceUnit, options = LIVE_STATS_DEFAULTS }: LiveFieldUnits): string => {
  const pace = isInverseUnit(speedUnit);
  const [topShortS, topLongS] = options.topDurationsS;
  switch (key) {
    case 'speed': return pace ? 'Allure' : 'Vit.';
    case 'average': return 'Moy.';
    case 'max': return pace ? 'Meill.' : 'Max';
    case 'recentDistanceSpeed': return `${options.recentDistanceM} m`;
    case 'lastDistance': return distanceUnit === 'nm' ? 'Dern. mille' : 'Dern. km';
    case 'distance': return 'Dist.';
    case 'duration': return 'Durée';
    case 'clock': return 'Heure';
    case 'remaining': return 'Reste';
    case 'remainingTime': return 'Temps rest.';
    case 'recentTopShort': return `Top ${topShortS} s`;
    case 'recentTopLong': return `Top ${topLongS} s`;
    case 'heading': return 'Cap';
    case 'legAverage': return 'Bord';
    case 'markDistance': return 'Balise';
    case 'markBearing': return 'Cap bal.';
    case 'grade': return 'Pente';
    case 'gain': return 'D+';
    case 'recentDistanceGain': return `D+ ${options.recentDistanceM} m`;
    case 'loss': return 'D−';
    case 'climbRate': return 'Asc.';
    case 'power': return 'Puiss.';
    case 'effort': return 'Énergie';
    case 'heartRate': return 'FC';
    case 'averageHeartRate': return 'FC moy.';
    case 'heartRateZone': return 'Zone';
    case 'step': return 'Étape';
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
  /** Fréquence de la ceinture cardio, en battements par minute ; `null` sans ceinture ou sans mesure. */
  heartRateBpm: number | null;
  /** Bornes basses des zones cardiaques 1 à 5 du pratiquant, en bpm ; `null` s'il n'en a pas. */
  heartRateZoneBounds: readonly number[] | null;
  /**
   * Étape de l'entraînement (26/10) : répétition du compteur sur le total de la
   * séance, ou palier d'un test, sans total ; absente ou `null` sans compteur
   * en marche ni rampe de test.
   */
  step?: { rep: number; of: number | null } | null;
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
    case 'speed': return formatSpeed(stats.currentSpeedMs, speedUnit, distanceUnit);
    case 'average': return formatSpeed(stats.averageSpeedMs, speedUnit, distanceUnit);
    case 'max': return formatSpeed(stats.maxSpeedMs, speedUnit, distanceUnit);
    case 'recentDistanceSpeed': return formatSpeed(stats.recentDistanceSpeedMs, speedUnit, distanceUnit);
    case 'lastDistance': return formatSpeed(stats.lastDistanceSpeedMs, speedUnit, distanceUnit);
    case 'distance': return formatDistance(stats.distanceM, distanceUnit);
    case 'duration': return formatClock(ctx.durationMs);
    case 'clock': return ctx.nowMs === null ? NONE : formatTimeOfDay(ctx.nowMs).slice(0, 5);
    case 'remaining': return ctx.remainingM === null ? NONE : formatDistance(ctx.remainingM, distanceUnit);
    case 'remainingTime': {
      const speed = stats.averageSpeedMs;
      return ctx.remainingM === null || speed === null || speed <= 0 ? NONE : formatClock((ctx.remainingM / speed) * 1000);
    }
    case 'recentTopShort': return formatSpeed(stats.recentTopsMs[0] ?? null, speedUnit, distanceUnit);
    case 'recentTopLong': return formatSpeed(stats.recentTopsMs[1] ?? null, speedUnit, distanceUnit);
    case 'heading': return ctx.headingDeg === null ? NONE : `${roundBearingDeg(ctx.headingDeg)}°`;
    case 'legAverage': return stats.legs.current ? formatSpeed(stats.legs.current.averageSpeedMs, speedUnit, distanceUnit) : NONE;
    case 'markDistance': return ctx.markDistanceM === null ? NONE : formatShortDistance(ctx.markDistanceM, distanceUnit);
    case 'markBearing': return ctx.markBearingDeg === null ? NONE : `${roundBearingDeg(ctx.markBearingDeg)}°`;
    case 'grade': return formatGrade(stats.currentGrade);
    case 'gain': return formatMeters(stats.elevationGainM);
    case 'recentDistanceGain': return formatMeters(stats.recentDistanceGainM);
    case 'loss': return formatMeters(stats.elevationLossM);
    case 'climbRate': return stats.climbRateMh === null ? NONE : `${Math.round(stats.climbRateMh)} m/h`;
    case 'power':
      if (stats.recentPowerW === null) return NONE;
      return stats.energyPerKg ? `${formatDecimal(stats.recentPowerW, 1)} W/kg` : `${Math.round(stats.recentPowerW)} W`;
    case 'effort': {
      if (stats.effortJ === null) return NONE;
      const kcal = stats.effortJ / J_PER_KCAL;
      return stats.energyPerKg ? `${formatDecimal(kcal, 1)} kcal/kg` : `${Math.round(kcal)} kcal`;
    }
    case 'heartRate': return ctx.heartRateBpm === null ? NONE : `${Math.round(ctx.heartRateBpm)} bpm`;
    case 'averageHeartRate': return stats.averageHeartRateBpm === null ? NONE : `${Math.round(stats.averageHeartRateBpm)} bpm`;
    case 'heartRateZone': {
      if (ctx.heartRateBpm === null || ctx.heartRateZoneBounds === null) return NONE;
      const bpm = Math.round(ctx.heartRateBpm);
      const zone = bandIndex(bpm, ctx.heartRateZoneBounds);
      return `${zone === 0 ? 'sous Z1' : `Z${zone}`} · ${bpm}`;
    }
    case 'step':
      if (!ctx.step) return NONE;
      return ctx.step.of === null ? String(ctx.step.rep) : `${ctx.step.rep}/${ctx.step.of}`;
  }
};
