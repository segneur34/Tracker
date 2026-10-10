import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ACTIVITIES_VERSION, FAMILY_BASE, GRAVEL_ACTIVITY, VTT_ACTIVITY, activitiesOfFamily, activityFamily, activityTreatment, baseActivity, findActivity,
  newActivityId, insertActivity, readActivities, upgradeActivities, type Activity,
} from '../core/activities';
import {
  ELEVATION_PRESETS, LOOP_RETURN_RATIO_RANGE, SPORT_FAMILIES, TERRAIN_STEP_CHOICES_M, getSportProfile, sportTreatment, type ElevationProfile,
  type RecordingProfile, type SportFamily, type Treatment,
} from '../core/sportProfiles';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import type { SportType } from '../core/types';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL, type DistanceUnit, type SpeedUnit } from '../core/units';
import { jsonStore } from '../platform/storage';
import {
  DEFAULT_INTERVAL_WORKOUT, MAX_INTERVAL_PRESETS, newPresetId, sameWorkout, sanitizePresets, sanitizeWorkout, workoutLabel,
  type IntervalPreset, type IntervalWorkout,
} from '../recording/intervalTimer';
import { DEFAULT_LIVE_FIELDS, sanitizeLiveFields, type LiveFieldKey } from '../recording/liveFields';
import { MARK_GUIDE_DEFAULTS, sanitizeMarkGuide, type MarkGuideSettings } from '../recording/markGuide';
import { defaultJumpSettings, sanitizeJumpSettings, type JumpSettings } from '../recording/jumpSettings';
import { BIKE_TYPES, REFERENCE_RIDER_KG, cyclingEnergyParams, isBikeType, type BikeType } from '../cycling/energy';
import { DEFAULT_CYCLING_GRADE_RANGE, DEFAULT_CYCLING_SPEED_RANGE_MS } from '../cycling/cyclingConfig';
import { DEFAULT_GRADE_RANGE, DEFAULT_SPEED_RANGE_MS, isValidGradeRange, type GradeRange } from '../running/runningAnalytics';
import { DEFAULT_SAILING_SPEED_RANGE_MS } from '../sailing/sailingConfig';
import {
  DEFAULT_PACE_LEVEL, KM_EFFORT_CLIMB_FACTOR, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, climbPowerWkgForFlatSpeed, isPaceLevel,
  isValidFlatSpeed, type DurationSettings, type PaceLevel, type PlanningFamily, type PresetPaceLevel,
} from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import { presetWayTypes, sanitizeWayTypes } from '../planning/route';

export type TerrainType = keyof typeof ELEVATION_PRESETS;

export const TERRAIN_LABEL: Record<TerrainType, string> = {
  route: 'Route / chemin roulant',
  trail: 'Trail / montagne',
};

/** Unités d'affichage proposées selon le traitement du calcul. */
export const SAILING_UNITS: SpeedUnit[] = ['kn', 'kmh', 'ms'];
export const RUNNING_UNITS: SpeedUnit[] = ['kmh', 'ms', 'minkm'];
export const CYCLING_UNITS: SpeedUnit[] = ['kmh', 'ms'];

export const TREATMENT_UNITS: Record<Treatment, SpeedUnit[]> = {
  voile: SAILING_UNITS,
  course: RUNNING_UNITS,
  velo: CYCLING_UNITS,
};

/** Bornes de couleur de la trace à défaut de réglage (en voile, avant toute suggestion tirée de la session). */
export const TREATMENT_SPEED_RANGE_MS: Record<Treatment, SpeedRangeMs> = {
  voile: DEFAULT_SAILING_SPEED_RANGE_MS,
  course: DEFAULT_SPEED_RANGE_MS,
  velo: DEFAULT_CYCLING_SPEED_RANGE_MS,
};

/** Bornes de la couleur de pente à défaut de réglage. */
export const defaultGradeRange = (sport: SportType): GradeRange =>
  sportTreatment(sport) === 'velo' ? DEFAULT_CYCLING_GRADE_RANGE : DEFAULT_GRADE_RANGE;

/**
 * Réglages par activité (`core/activities.ts`) : unité, seuil d'activité,
 * terrain, couleurs de trace, pause automatique, rangés sous
 * l'identifiant de l'activité. Le calcul de base ne fournit que les défauts ;
 * la surcharge de l'utilisateur prime et survit au rechargement.
 *
 * Le seuil est volontairement modifiable : 8 nœuds ne vaut qu'en wingfoil, et
 * le réglage fin dépend du matériel et du pratiquant.
 */

const STORAGE_KEY = 'tracker.sportSettings';

/** Réglage rangé par identifiant d'activité. */
type ByActivity<T> = Partial<Record<string, T>>;

export interface StoredSettings {
  /** Ancienne clé : le support choisi dans le module voile, lu faute de `moduleActivity.voile`. */
  sport?: string;
  /** Activité retenue par chaque module tant qu'aucune session ne l'impose. */
  moduleActivity?: Partial<Record<SportFamily, string>>;
  /** Dernière activité enregistrée, proposée au prochain enregistrement. */
  recordActivity?: string;
  /** Activités de l'utilisateur ; absentes : celles du premier lancement. */
  activities?: Activity[];
  /** Version de la liste des activités (`ACTIVITIES_VERSION`) ; absente : 1. */
  activitiesVersion?: number;
  /** Surcharges du seuil d'activité, dans l'unité du profil du calcul. */
  thresholds?: ByActivity<number>;
  /** Terrain retenu pour le dénivelé. */
  terrains?: ByActivity<TerrainType>;
  /** Pas des échantillons d'altitude du terrain (IGN), en mètres (course, vélo) ; absent : celui du profil. */
  terrainSteps?: ByActivity<number>;
  /** Unité d'affichage des vitesses. */
  speedUnits?: ByActivity<SpeedUnit>;
  /** Unité d'affichage des distances ; absente : kilomètres. */
  distanceUnits?: ByActivity<DistanceUnit>;
  /** Bornes du dégradé de couleur de la trace, en m/s. */
  speedRanges?: ByActivity<{ minMs: number; maxMs: number }>;
  /** Bornes de la couleur de pente de la courbe d'altitude, en fraction (course). */
  gradeRanges?: ByActivity<GradeRange>;
  /** Surcharge de la pause automatique à l'enregistrement. */
  autoPause?: ByActivity<{ speedMs: number; delayS: number }>;
  /** Chiffres en grand de l'enregistrement, carte réduite ; absents : ceux de la famille. */
  liveFields?: ByActivity<LiveFieldKey[]>;
  /** Bips d'approche des balises (voile) : courbe et vibration ; absent : `MARK_GUIDE_DEFAULTS`. */
  markGuide?: ByActivity<MarkGuideSettings>;
  /** Support sur foil (voile) ; absent : `foilDefault` du calcul. */
  foils?: ByActivity<boolean>;
  /** Sauts mesurés par les capteurs du téléphone (voile, sauf bateau) ; absents : non mesurés. */
  jumps?: ByActivity<JumpSettings>;
  /** Type de vélo (vélo), qui fixe roulement et traînée ; absent : `defaultBikeType`. */
  bikeTypes?: ByActivity<BikeType>;
  /** Poids du vélo en kg (vélo) ; absent : celui du type. */
  bikeWeights?: ByActivity<number>;
  /** Niveau qui donne la vitesse du temps estimé d'un itinéraire (course, vélo) ; absent : moyen. */
  paceLevels?: ByActivity<PaceLevel>;
  /** Vitesse sur le plat du niveau « Personnalisé », en m/s. */
  customFlatSpeeds?: ByActivity<number>;
  /** Types de voie cochés d'office en planification (course, vélo) ; absents : `presetWayTypes`. */
  wayTypes?: ByActivity<WayType[]>;
  /** Retour d'une boucle en planification : au plus tant de fois l'aller (course, vélo) ; absent : celui du profil. */
  loopReturnRatios?: ByActivity<number>;
  /** Durée de l'appui long sur le bouton rond qui met en pause, en millisecondes. */
  longPressMs?: number;
  /** Sport en accès direct dans la barre du bas, sur téléphone ; absent : voile. */
  navFamily?: SportFamily;
  /**
   * Case secondaire de la barre du bas, à droite du bouton rond : un sport, ou la planification
   * (`'planifier'`) ; absente ou égale au favori, le premier autre sport. Nom gardé d'avant la
   * planification, pour ne pas perdre le choix déjà fait.
   */
  navSecondFamily?: NavSecond;
  /** Durée de l'appui long sur le sport secondaire qui ouvre le menu pour en changer, en millisecondes. */
  navHoldMs?: number;
  /** Séances du compteur gardées pour être reprises toutes faites (fractionné), communes aux activités. */
  intervalPresets?: IntervalPreset[];
  /** Dernière séance lancée au compteur, proposée la fois suivante (choix retenu). */
  lastIntervalWorkout?: IntervalWorkout;
}

/** Appui long par défaut : 2 s, assez pour ne pas partir d'un geste involontaire. */
export const DEFAULT_LONG_PRESS_MS = 2000;
/** Appui long qui change le sport secondaire : 1 s, plus court, un geste involontaire n'y coûte rien. */
export const DEFAULT_NAV_HOLD_MS = 1000;

/** Poids de vélo plausible, en kg. */
export const isValidBikeWeight = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= 3 && value <= 60;

const isValidLongPress = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= 300 && value <= 10_000;

export const isKnownTerrain = (value: unknown): value is TerrainType =>
  typeof value === 'string' && value in ELEVATION_PRESETS;

export const isTerrainStep = (value: unknown): value is number =>
  typeof value === 'number' && (TERRAIN_STEP_CHOICES_M as readonly number[]).includes(value);

/** Pas d'altitude du terrain : celui réglé, sinon celui du profil ; `null` en voile. */
const resolveTerrainStepM = (stored: StoredSettings, activity: Activity): number | null => {
  const profileStep = getSportProfile(activity.base).terrainElevationStepM;
  if (profileStep === null) return null;
  const step = stored.terrainSteps?.[activity.id];
  return isTerrainStep(step) ? step : profileStep;
};

/** Rapport du retour de boucle admis, en fois l'aller. */
export const isValidLoopReturnRatio = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= LOOP_RETURN_RATIO_RANGE.min && value <= LOOP_RETURN_RATIO_RANGE.max;

/** Rapport du retour de boucle : celui réglé, sinon celui du profil ; `null` en voile. */
const resolveLoopReturnRatio = (stored: StoredSettings, activity: Activity): number | null => {
  const profileRatio = getSportProfile(activity.base).loopReturnMaxRatio;
  if (profileRatio === null) return null;
  const ratio = stored.loopReturnRatios?.[activity.id];
  return isValidLoopReturnRatio(ratio) ? ratio : profileRatio;
};

export const isKnownSpeedUnit = (value: unknown): value is SpeedUnit =>
  typeof value === 'string' && value in SPEED_UNIT_LABEL;

export const isKnownDistanceUnit = (value: unknown): value is DistanceUnit =>
  typeof value === 'string' && value in DISTANCE_UNIT_LABEL;


const isKnownFamily = (value: unknown): value is SportFamily =>
  typeof value === 'string' && (SPORT_FAMILIES as string[]).includes(value);

/** Sport en accès direct dans la barre du bas, par défaut la voile. */
const DEFAULT_NAV_FAMILY: SportFamily = 'voile';

const effectiveNavFamily = (stored: StoredSettings): SportFamily =>
  isKnownFamily(stored.navFamily) ? stored.navFamily : DEFAULT_NAV_FAMILY;

/** Case secondaire de la barre du bas : un sport, ou la planification des itinéraires. */
export type NavSecond = SportFamily | 'planifier';

const isNavSecond = (value: unknown): value is NavSecond => value === 'planifier' || isKnownFamily(value);

/** Case secondaire : celle choisie si elle n'est pas le favori, sinon le premier des autres sports. */
const effectiveNavSecond = (stored: StoredSettings): NavSecond => {
  const favorite = effectiveNavFamily(stored);
  if (isNavSecond(stored.navSecondFamily) && stored.navSecondFamily !== favorite) return stored.navSecondFamily;
  return SPORT_FAMILIES.find((f) => f !== favorite) ?? favorite;
};

/**
 * Réglages enregistrés, pour qui calcule hors d'un composant : les résumés de
 * la bibliothèque. L'ancienne allure imposée par support (`referenceSpeeds`)
 * est écartée : depuis le 24 septembre 2026, elle vit dans la fiche de chaque
 * session (§10, point 46), et la prochaine écriture la retire de l'appareil
 * et de `reglages.json`.
 */
export const readStoredSettings = (): StoredSettings => {
  const { referenceSpeeds: _abandoned, ...settings } =
    jsonStore.read<StoredSettings & { referenceSpeeds?: unknown }>(STORAGE_KEY) ?? {};
  return settings;
};

const writeStored = (settings: StoredSettings): void => jsonStore.write(STORAGE_KEY, settings);

/**
 * Met à jour, une fois, une liste d'activités d'une version d'avant
 * (`upgradeActivities`). À appeler au démarrage, une fois les réglages du
 * dossier mémoire repris, et avant que la bibliothèque ne guette les
 * changements de réglages : ce n'est pas un changement de l'utilisateur, et
 * la date des réglages de l'appareil ne bouge pas. Rend vrai si la liste a
 * été récrite : le fichier de réglages de l'appareil est alors à récrire, à
 * la même date (`settingsUpgraded`). Sans liste rangée, rien à faire : celle
 * du premier lancement est déjà à jour.
 */
export const upgradeStoredActivities = (): boolean => {
  const stored = readStoredSettings();
  if (stored.activities === undefined || (stored.activitiesVersion ?? 1) >= ACTIVITIES_VERSION) return false;
  writeStored({
    ...stored,
    activities: upgradeActivities(readActivities(stored.activities), stored.activitiesVersion ?? 1),
    activitiesVersion: ACTIVITIES_VERSION,
  });
  return true;
};

/** Type de vélo d'une activité sans réglage : celui de Gravel et de VTT pour elles, route sinon. */
export const defaultBikeType = (activityId: string): BikeType => {
  if (activityId === GRAVEL_ACTIVITY.id) return 'gravel';
  return activityId === VTT_ACTIVITY.id ? 'vtt' : 'route';
};

/** Activités de l'utilisateur, hors composant (enregistrement, bibliothèque). */
export const readStoredActivities = (): Activity[] => readActivities(readStoredSettings().activities);

/** Dernière activité enregistrée, si elle existe encore. */
export const lastRecordActivity = (): Activity | null => {
  const stored = readStoredSettings();
  return readActivities(stored.activities).find((a) => a.id === stored.recordActivity) ?? null;
};

export const rememberRecordActivity = (id: string): void => {
  const stored = readStoredSettings();
  if (stored.recordActivity !== id) writeStored({ ...stored, recordActivity: id });
};

/** Durée effective de l'appui long, lue à chaque appui. */
export const effectiveLongPressMs = (): number => {
  const value = readStoredSettings().longPressMs;
  return isValidLongPress(value) ? value : DEFAULT_LONG_PRESS_MS;
};

const readNavFamily = (): SportFamily => effectiveNavFamily(readStoredSettings());
const readNavSecond = (): NavSecond => effectiveNavSecond(readStoredSettings());

/**
 * Sport en accès direct de la barre du bas, suivi en direct : la barre se met
 * à jour dès que Réglages l'écrit, ou que `reglages.json` est repris du dossier.
 */
export const useNavFamily = (): SportFamily => useSyncExternalStore(jsonStore.subscribe, readNavFamily);

/** Case secondaire de la barre du bas, suivie en direct comme le favori. */
export const useNavSecond = (): NavSecond => useSyncExternalStore(jsonStore.subscribe, readNavSecond);

/** Retient la case secondaire choisie depuis la barre du bas (appui long). */
export const rememberNavSecond = (second: NavSecond): void => {
  const stored = readStoredSettings();
  if (isNavSecond(second) && stored.navSecondFamily !== second) writeStored({ ...stored, navSecondFamily: second });
};

/** Séances du compteur : celles gardées, et celle à proposer (la dernière lancée, sinon la séance par défaut). */
export interface IntervalSettings {
  presets: IntervalPreset[];
  last: IntervalWorkout;
}

/** Dernière lecture, rendue telle quelle tant que rien n'a changé : `useSyncExternalStore` compare les références. */
let intervalSettingsCache: { key: string; value: IntervalSettings } | null = null;

const readIntervalSettings = (): IntervalSettings => {
  const stored = readStoredSettings();
  const key = JSON.stringify([stored.intervalPresets ?? null, stored.lastIntervalWorkout ?? null]);
  if (intervalSettingsCache?.key !== key) {
    intervalSettingsCache = {
      key,
      value: {
        presets: sanitizePresets(stored.intervalPresets),
        last: sanitizeWorkout(stored.lastIntervalWorkout) ?? DEFAULT_INTERVAL_WORKOUT,
      },
    };
  }
  return intervalSettingsCache.value;
};

/** Séances du compteur, suivies en direct. */
export const useIntervalSettings = (): IntervalSettings => useSyncExternalStore(jsonStore.subscribe, readIntervalSettings);

/** Retient la séance lancée, proposée au prochain lancement. */
export const rememberIntervalWorkout = (workout: IntervalWorkout): void => {
  const stored = readStoredSettings();
  const last = sanitizeWorkout(stored.lastIntervalWorkout);
  if (!last || !sameWorkout(last, workout)) writeStored({ ...stored, lastIntervalWorkout: workout });
};

/** Garde une séance, sous le nom donné (vide : son libellé) ; sans effet au-delà de `MAX_INTERVAL_PRESETS`. */
export const saveIntervalPreset = (name: string, workout: IntervalWorkout): void => {
  const stored = readStoredSettings();
  const presets = sanitizePresets(stored.intervalPresets);
  const clean = sanitizeWorkout(workout);
  if (!clean || presets.length >= MAX_INTERVAL_PRESETS) return;
  const preset: IntervalPreset = { id: newPresetId(presets), name: name.trim() || workoutLabel(clean), workout: clean };
  writeStored({ ...stored, intervalPresets: [...presets, preset] });
};

/** Retire une séance gardée. */
export const removeIntervalPreset = (id: string): void => {
  const stored = readStoredSettings();
  writeStored({ ...stored, intervalPresets: sanitizePresets(stored.intervalPresets).filter((p) => p.id !== id) });
};

/** Durée effective de l'appui long qui change le sport secondaire, lue à chaque appui. */
export const effectiveNavHoldMs = (): number => {
  const value = readStoredSettings().navHoldMs;
  return isValidLongPress(value) ? value : DEFAULT_NAV_HOLD_MS;
};

/**
 * Réglage d'enregistrement effectif d'une activité : le profil de son calcul,
 * sauf surcharge de la pause automatique. Utilisable hors composant.
 */
export const effectiveRecordingProfile = (activity: Activity): RecordingProfile => {
  const profile = getSportProfile(activity.base);
  const override = readStoredSettings().autoPause?.[activity.id];
  return override ? { ...profile.recording, autoPauseSpeedMs: override.speedMs, autoPauseDelayS: override.delayS } : profile.recording;
};

/** Chiffres en grand de l'enregistrement, carte réduite : ceux choisis dans Réglages, sinon ceux du traitement. */
export const effectiveLiveFields = (activity: Activity): LiveFieldKey[] => {
  const treatment = activityTreatment(activity);
  return sanitizeLiveFields(readStoredSettings().liveFields?.[activity.id], treatment) ?? DEFAULT_LIVE_FIELDS[treatment];
};

/** Bips d'approche des balises d'un parcours : ceux réglés pour l'activité, sinon le défaut. */
export const effectiveMarkGuide = (activity: Activity): MarkGuideSettings =>
  sanitizeMarkGuide(readStoredSettings().markGuide?.[activity.id]) ?? MARK_GUIDE_DEFAULTS;

/** Foil d'une activité : celui réglé, sinon le défaut du calcul ; `null` hors voile. */
const resolveFoil = (stored: StoredSettings, activity: Activity): boolean | null => {
  if (activityTreatment(activity) !== 'voile') return null;
  const foil = stored.foils?.[activity.id];
  return typeof foil === 'boolean' ? foil : getSportProfile(activity.base).foilDefault;
};

/** Sauts d'une activité : ceux réglés, sinon le défaut ; `null` si son calcul ne les mesure pas. */
const resolveJumps = (stored: StoredSettings, activity: Activity): JumpSettings | null => {
  const profile = getSportProfile(activity.base).jumps;
  if (!profile) return null;
  return sanitizeJumpSettings(stored.jumps?.[activity.id], profile) ?? defaultJumpSettings(profile);
};

/** Support sur foil d'une activité de voile, `null` hors voile. Utilisable hors composant. */
export const effectiveFoil = (activity: Activity): boolean | null => resolveFoil(readStoredSettings(), activity);

/** Réglages des sauts d'une activité, `null` si son calcul ne les mesure pas. Utilisable hors composant. */
export const effectiveJumpSettings = (activity: Activity): JumpSettings | null => resolveJumps(readStoredSettings(), activity);

/**
 * Unité de vitesse effective d'une activité : celle choisie dans Réglages,
 * sinon celle du profil. Utilisable hors composant.
 */
export const effectiveSpeedUnit = (activity: Activity): SpeedUnit => {
  const unit = readStoredSettings().speedUnits?.[activity.id];
  return isKnownSpeedUnit(unit) ? unit : getSportProfile(activity.base).speedUnit;
};

/** Unité de distance effective d'une activité : celle choisie dans Réglages, sinon le kilomètre. */
export const effectiveDistanceUnit = (activity: Activity): DistanceUnit => {
  const unit = readStoredSettings().distanceUnits?.[activity.id];
  return isKnownDistanceUnit(unit) ? unit : 'km';
};

/** Réglage du dénivelé effectif d'une activité : celui du terrain choisi pour elle, route par défaut. Utilisable hors composant. */
export const effectiveElevationProfile = (activity: Activity): ElevationProfile => {
  const terrain = readStoredSettings().terrains?.[activity.id];
  return ELEVATION_PRESETS[isKnownTerrain(terrain) ? terrain : 'route'];
};

/** Pas des échantillons d'altitude du terrain d'une activité, `null` en voile. Utilisable hors composant. */
export const effectiveTerrainStepM = (activity: Activity): number | null => resolveTerrainStepM(readStoredSettings(), activity);

/** Retour de boucle d'une activité en planification, en fois l'aller ; `null` en voile. Utilisable hors composant. */
export const effectiveLoopReturnRatio = (activity: Activity): number | null => resolveLoopReturnRatio(readStoredSettings(), activity);

/** Bornes de la couleur de pente d'une activité : celles de Réglages, sinon le défaut. Utilisable hors composant. */
export const effectiveGradeRange = (activity: Activity): GradeRange => {
  const range = readStoredSettings().gradeRanges?.[activity.id];
  return range && isValidGradeRange(range) ? range : defaultGradeRange(activity.base);
};

/**
 * Famille d'une activité qui se planifie avec un temps estimé (course, vélo) ;
 * `null` en voile, qui planifie sans temps, et pour le fractionné, qui ne
 * planifie pas.
 */
export const planningFamily = (activity: Activity): PlanningFamily | null => {
  const family = activityFamily(activity);
  return family === 'course' || family === 'velo' ? family : null;
};

/** Familles proposées en planification. */
export const PLANNING_FAMILIES: SportFamily[] = ['voile', 'course', 'velo'];

/** Type et poids du vélo d'une activité : ceux de Réglages, sinon le type par défaut et son poids. Utilisable hors composant. */
export const effectiveBikeSetup = (activity: Activity): { bikeType: BikeType; bikeKg: number } => {
  const stored = readStoredSettings();
  const type = stored.bikeTypes?.[activity.id];
  const bikeType: BikeType = isBikeType(type) ? type : defaultBikeType(activity.id);
  const weight = stored.bikeWeights?.[activity.id];
  return { bikeType, bikeKg: isValidBikeWeight(weight) ? weight : BIKE_TYPES[bikeType].bikeKg };
};

/** Types de voie cochés d'office pour une activité, réglés ou proposés (`presetWayTypes`). */
const resolveWayTypes = (stored: StoredSettings, activity: Activity): { wayTypes: WayType[]; overridden: boolean } => {
  const own = sanitizeWayTypes(stored.wayTypes?.[activity.id]);
  if (own) return { wayTypes: own, overridden: true };
  const bikeType = stored.bikeTypes?.[activity.id];
  const terrain = stored.terrains?.[activity.id];
  return {
    wayTypes: presetWayTypes(
      activityTreatment(activity),
      isBikeType(bikeType) ? bikeType : defaultBikeType(activity.id),
      isKnownTerrain(terrain) ? terrain : 'route'
    ),
    overridden: false,
  };
};

/** Types de voie cochés d'office en planification ; aucun en voile. Utilisable hors composant. */
export const effectiveWayTypes = (activity: Activity): WayType[] => resolveWayTypes(readStoredSettings(), activity).wayTypes;

/**
 * Niveau effectif et vitesse sur le plat qui en découle, en m/s ; un
 * « Personnalisé » sans vitesse valable revient au niveau par défaut.
 */
export const resolvePace = (
  family: PlanningFamily,
  level: unknown,
  customSpeedMs: unknown
): { level: PaceLevel; flatSpeedMs: number } => {
  if (level === 'perso' && isValidFlatSpeed(family, customSpeedMs)) return { level, flatSpeedMs: customSpeedMs };
  const preset: PresetPaceLevel = isPaceLevel(level) && level !== 'perso' ? level : DEFAULT_PACE_LEVEL;
  return { level: preset, flatSpeedMs: LEVEL_FLAT_SPEED_MS[family][preset] };
};

/** Niveau effectif d'une activité de course ou de vélo, `null` en voile. Utilisable hors composant. */
export const effectivePace = (activity: Activity): { level: PaceLevel; flatSpeedMs: number } | null => {
  const family = planningFamily(activity);
  if (!family) return null;
  const stored = readStoredSettings();
  return resolvePace(family, stored.paceLevels?.[activity.id], stored.customFlatSpeeds?.[activity.id]);
};

/**
 * Réglage du temps estimé d'un itinéraire pour une activité, `null` en
 * voile (`planning/duration.ts`). `riderKg` : poids du pratiquant, `null`
 * s'il n'est pas renseigné (cycliste de référence).
 */
export const effectiveDurationSettings = (activity: Activity, riderKg: number | null): DurationSettings | null => {
  const pace = effectivePace(activity);
  if (!pace) return null;
  if (planningFamily(activity) === 'course') {
    return { family: 'course', flatSpeedMs: pace.flatSpeedMs, climbFactor: KM_EFFORT_CLIMB_FACTOR };
  }
  const { bikeType, bikeKg } = effectiveBikeSetup(activity);
  const rider = riderKg ?? REFERENCE_RIDER_KG;
  const climbWkg = pace.level === 'perso' ? climbPowerWkgForFlatSpeed(pace.flatSpeedMs) : LEVEL_CLIMB_POWER_WKG[pace.level];
  return {
    family: 'velo',
    flatSpeedMs: pace.flatSpeedMs,
    climbPowerW: climbWkg * rider,
    params: cyclingEnergyParams(bikeType, bikeKg, rider),
    maxSpeedMs: BIKE_TYPES[bikeType].maxDescentMs,
  };
};

/** Réglages d'une activité tels que la page Réglages les présente. */
export interface SportSettingsView {
  activity: Activity;
  speedUnit: SpeedUnit;
  isSpeedUnitOverridden: boolean;
  distanceUnit: DistanceUnit;
  isDistanceUnitOverridden: boolean;
  activeThreshold: number;
  isThresholdOverridden: boolean;
  terrain: TerrainType;
  /** Pas des échantillons d'altitude du terrain, en mètres ; `null` en voile. */
  terrainStepM: number | null;
  speedRange: { minMs: number; maxMs: number } | null;
  /** Bornes de la couleur de pente, ou `null` pour le défaut. */
  gradeRange: GradeRange | null;
  /** Pause automatique effective à l'enregistrement (m/s, secondes). */
  autoPause: { speedMs: number; delayS: number };
  isAutoPauseOverridden: boolean;
  /** Chiffres en grand de l'enregistrement, carte réduite. */
  liveFields: LiveFieldKey[];
  isLiveFieldsOverridden: boolean;
  /** Bips d'approche des balises (voile). */
  markGuide: MarkGuideSettings;
  isMarkGuideOverridden: boolean;
  /** Support sur foil ; `null` hors voile. */
  foil: boolean | null;
  isFoilOverridden: boolean;
  /** Sauts mesurés par les capteurs ; `null` si le calcul ne les mesure pas (bateau, hors voile). */
  jumps: JumpSettings | null;
  isJumpsOverridden: boolean;
  /** Type de vélo (activités vélo seulement, `defaultBikeType` par défaut). */
  bikeType: BikeType;
  /** Poids du vélo en kg, ou `null` pour celui du type. */
  bikeWeight: number | null;
  /** Niveau du temps estimé (course, vélo) ; moyen par défaut. */
  paceLevel: PaceLevel;
  /** Vitesse sur le plat saisie pour « Personnalisé », en m/s, ou `null`. */
  customFlatSpeedMs: number | null;
  /** Types de voie cochés d'office en planification (course, vélo) ; aucun en voile. */
  wayTypes: WayType[];
  isWayTypesOverridden: boolean;
  /** Retour de boucle en planification, en fois l'aller ; `null` en voile. */
  loopReturnRatio: number | null;
}

/** Tables de réglages rangées par activité. */
const PER_ACTIVITY_KEYS = [
  'thresholds', 'terrains', 'speedUnits', 'distanceUnits', 'speedRanges', 'gradeRanges', 'autoPause', 'bikeTypes', 'bikeWeights',
  'paceLevels', 'customFlatSpeeds', 'liveFields', 'markGuide', 'wayTypes', 'terrainSteps', 'loopReturnRatios', 'foils', 'jumps',
] as const;

/** Réglages sans aucune surcharge rangée sous `id`. */
const withoutOverrides = (stored: StoredSettings, id: string): StoredSettings => {
  const next: StoredSettings = { ...stored };
  for (const key of PER_ACTIVITY_KEYS) {
    const map = stored[key];
    if (map && id in map) {
      const copy: Record<string, unknown> = { ...map };
      delete copy[id];
      (next as Record<string, unknown>)[key] = copy;
    }
  }
  return next;
};

/**
 * Accès à toutes les activités à la fois, pour la page Réglages : leurs
 * réglages, et la liste elle-même (ajouter, renommer, supprimer). Chaque
 * modification est écrite immédiatement ; les modules la lisent à leur
 * prochain affichage.
 */
export const useAllSportSettings = () => {
  const [stored, setStored] = useState<StoredSettings>(readStoredSettings);
  const activities = useMemo(() => readActivities(stored.activities), [stored.activities]);

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    writeStored(next);
  }, []);

  // Écrits d'ailleurs pendant que la page est ouverte (sport secondaire choisi depuis la barre du bas,
  // `reglages.json` repris du dossier) : relus, pour que le prochain changement ne les écrase pas.
  useEffect(() => jsonStore.subscribe((key) => {
    if (key === STORAGE_KEY) setStored(readStoredSettings());
  }), []);

  const view = useCallback(
    (activity: Activity): SportSettingsView => {
      const id = activity.id;
      const profile = getSportProfile(activity.base);
      const unit = stored.speedUnits?.[id];
      const distanceUnit = stored.distanceUnits?.[id];
      const threshold = stored.thresholds?.[id];
      const terrain = stored.terrains?.[id];
      const range = stored.speedRanges?.[id];
      const grades = stored.gradeRanges?.[id];
      const autoPauseOverride = stored.autoPause?.[id];
      const bikeType = stored.bikeTypes?.[id];
      const bikeWeight = stored.bikeWeights?.[id];
      const paceLevel = stored.paceLevels?.[id];
      const customSpeed = stored.customFlatSpeeds?.[id];
      const liveFields = sanitizeLiveFields(stored.liveFields?.[id], activityTreatment(activity));
      const markGuide = sanitizeMarkGuide(stored.markGuide?.[id]);
      const ways = resolveWayTypes(stored, activity);
      return {
        activity,
        speedUnit: isKnownSpeedUnit(unit) ? unit : profile.speedUnit,
        isSpeedUnitOverridden: isKnownSpeedUnit(unit),
        distanceUnit: isKnownDistanceUnit(distanceUnit) ? distanceUnit : 'km',
        isDistanceUnitOverridden: isKnownDistanceUnit(distanceUnit),
        activeThreshold: threshold ?? profile.defaultActiveThreshold,
        isThresholdOverridden: threshold !== undefined,
        terrain: isKnownTerrain(terrain) ? terrain : 'route',
        terrainStepM: resolveTerrainStepM(stored, activity),
        speedRange: range && isValidSpeedRange(range) ? range : null,
        gradeRange: grades && isValidGradeRange(grades) ? grades : null,
        autoPause: autoPauseOverride ?? { speedMs: profile.recording.autoPauseSpeedMs, delayS: profile.recording.autoPauseDelayS },
        isAutoPauseOverridden: autoPauseOverride !== undefined,
        liveFields: liveFields ?? DEFAULT_LIVE_FIELDS[activityTreatment(activity)],
        isLiveFieldsOverridden: liveFields !== null,
        markGuide: markGuide ?? MARK_GUIDE_DEFAULTS,
        isMarkGuideOverridden: markGuide !== null,
        foil: resolveFoil(stored, activity),
        isFoilOverridden: typeof stored.foils?.[id] === 'boolean',
        jumps: resolveJumps(stored, activity),
        isJumpsOverridden: stored.jumps?.[id] !== undefined && profile.jumps !== null,
        bikeType: isBikeType(bikeType) ? bikeType : defaultBikeType(id),
        bikeWeight: isValidBikeWeight(bikeWeight) ? bikeWeight : null,
        paceLevel: isPaceLevel(paceLevel) ? paceLevel : DEFAULT_PACE_LEVEL,
        customFlatSpeedMs: typeof customSpeed === 'number' && isFinite(customSpeed) ? customSpeed : null,
        wayTypes: ways.wayTypes,
        isWayTypesOverridden: ways.overridden,
        loopReturnRatio: resolveLoopReturnRatio(stored, activity),
      };
    },
    [stored]
  );

  /** Écrit ou efface (`null`) un réglage d'une activité. */
  const setFor = useCallback(
    <F extends 'speedUnit' | 'distanceUnit' | 'activeThreshold' | 'terrain' | 'terrainStepM' | 'speedRange' | 'gradeRange' | 'autoPause' | 'liveFields' | 'markGuide' | 'foil' | 'jumps' | 'bikeType' | 'bikeWeight' | 'paceLevel' | 'customFlatSpeedMs' | 'wayTypes' | 'loopReturnRatio'>(
      id: string,
      field: F,
      value: SportSettingsView[F] | null
    ) => {
      const next: StoredSettings = { ...stored };
      const put = <T,>(map: ByActivity<T> | undefined, v: T | null): ByActivity<T> => {
        const copy = { ...map };
        if (v === null) delete copy[id];
        else copy[id] = v;
        return copy;
      };
      switch (field) {
        case 'speedUnit':
          if (value !== null && !isKnownSpeedUnit(value)) return;
          next.speedUnits = put(stored.speedUnits, value as SpeedUnit | null);
          break;
        case 'distanceUnit':
          if (value !== null && !isKnownDistanceUnit(value)) return;
          next.distanceUnits = put(stored.distanceUnits, value as DistanceUnit | null);
          break;
        case 'activeThreshold':
          if (value !== null && (typeof value !== 'number' || !isFinite(value) || value < 0)) return;
          next.thresholds = put(stored.thresholds, value as number | null);
          break;
        case 'terrain':
          if (value !== null && !isKnownTerrain(value)) return;
          next.terrains = put(stored.terrains, value as TerrainType | null);
          break;
        case 'terrainStepM':
          if (value !== null && !isTerrainStep(value)) return;
          next.terrainSteps = put(stored.terrainSteps, value as number | null);
          break;
        case 'speedRange': {
          const r = value as { minMs: number; maxMs: number } | null;
          if (r !== null && !isValidSpeedRange(r)) return;
          next.speedRanges = put(stored.speedRanges, r);
          break;
        }
        case 'gradeRange': {
          const g = value as GradeRange | null;
          if (g !== null && !isValidGradeRange(g)) return;
          next.gradeRanges = put(stored.gradeRanges, g);
          break;
        }
        case 'autoPause': {
          const a = value as { speedMs: number; delayS: number } | null;
          if (a !== null && !(isFinite(a.speedMs) && isFinite(a.delayS) && a.speedMs >= 0 && a.delayS >= 0)) return;
          next.autoPause = put(stored.autoPause, a);
          break;
        }
        case 'liveFields': {
          const activity = findActivity(activities, id);
          if (!activity) return;
          const fields = value === null ? null : sanitizeLiveFields(value, activityTreatment(activity));
          if (value !== null && fields === null) return;
          next.liveFields = put(stored.liveFields, fields);
          break;
        }
        case 'markGuide': {
          const guide = value === null ? null : sanitizeMarkGuide(value);
          if (value !== null && guide === null) return;
          next.markGuide = put(stored.markGuide, guide);
          break;
        }
        case 'foil': {
          const activity = findActivity(activities, id);
          if (!activity || activityTreatment(activity) !== 'voile') return;
          if (value !== null && typeof value !== 'boolean') return;
          next.foils = put(stored.foils, value as boolean | null);
          break;
        }
        case 'jumps': {
          const activity = findActivity(activities, id);
          const profile = activity ? getSportProfile(activity.base).jumps : null;
          if (!profile) return;
          const jumps = value === null ? null : sanitizeJumpSettings(value, profile);
          if (value !== null && jumps === null) return;
          next.jumps = put(stored.jumps, jumps);
          break;
        }
        case 'bikeType':
          if (value !== null && !isBikeType(value)) return;
          next.bikeTypes = put(stored.bikeTypes, value as BikeType | null);
          break;
        case 'bikeWeight':
          if (value !== null && !isValidBikeWeight(value)) return;
          next.bikeWeights = put(stored.bikeWeights, value as number | null);
          break;
        case 'paceLevel':
          if (value !== null && !isPaceLevel(value)) return;
          next.paceLevels = put(stored.paceLevels, value as PaceLevel | null);
          break;
        case 'customFlatSpeedMs': {
          const activity = findActivity(activities, id);
          const family = activity ? planningFamily(activity) : null;
          if (value !== null && (!family || !isValidFlatSpeed(family, value))) return;
          next.customFlatSpeeds = put(stored.customFlatSpeeds, value as number | null);
          break;
        }
        case 'wayTypes': {
          const ways = value === null ? null : sanitizeWayTypes(value);
          if (value !== null && ways === null) return;
          next.wayTypes = put(stored.wayTypes, ways);
          break;
        }
        case 'loopReturnRatio':
          if (value !== null && !isValidLoopReturnRatio(value)) return;
          next.loopReturnRatios = put(stored.loopReturnRatios, value as number | null);
          break;
      }
      persist(next);
    },
    [activities, persist, stored]
  );

  /** Remet tous les réglages d'une activité au défaut de son calcul. */
  const resetActivity = useCallback((id: string) => persist(withoutOverrides(stored, id)), [persist, stored]);

  /** Ajoute une activité, rangée avec sa famille ; rend son identifiant, `null` si le nom est vide. */
  const addActivity = useCallback(
    (name: string, base: SportType, color: string): string | null => {
      const trimmed = name.trim();
      if (trimmed === '') return null;
      const id = newActivityId(trimmed, activities);
      persist({ ...stored, activities: insertActivity(activities, { id, name: trimmed, base, color }), activitiesVersion: ACTIVITIES_VERSION });
      return id;
    },
    [activities, persist, stored]
  );

  /** Renomme ou recolore une activité ; un nom vide est ignoré. */
  const updateActivity = useCallback(
    (id: string, patch: { name?: string; color?: string }) => {
      const name = patch.name?.trim();
      persist({
        ...stored,
        activitiesVersion: ACTIVITIES_VERSION,
        activities: activities.map((a) =>
          a.id === id ? { ...a, ...(name ? { name } : {}), ...(patch.color ? { color: patch.color } : {}) } : a
        ),
      });
    },
    [activities, persist, stored]
  );

  /**
   * Supprime une activité et ses réglages. Ses sessions restent, sous le nom
   * de leur calcul (`sessionActivity`).
   */
  const removeActivity = useCallback(
    (id: string) => persist({ ...withoutOverrides(stored, id), activities: activities.filter((a) => a.id !== id), activitiesVersion: ACTIVITIES_VERSION }),
    [activities, persist, stored]
  );

  const longPressMs = isValidLongPress(stored.longPressMs) ? stored.longPressMs : DEFAULT_LONG_PRESS_MS;
  /** Durée de l'appui long, en millisecondes ; `null` revient au défaut. */
  const setLongPressMs = useCallback(
    (value: number | null) => {
      if (value !== null && !isValidLongPress(value)) return;
      const next: StoredSettings = { ...stored };
      if (value === null) delete next.longPressMs;
      else next.longPressMs = value;
      persist(next);
    },
    [persist, stored]
  );

  const navFamily = effectiveNavFamily(stored);
  const setNavFamily = useCallback(
    (family: SportFamily) => {
      if (!isKnownFamily(family)) return;
      persist({ ...stored, navFamily: family });
    },
    [persist, stored]
  );

  const navSecond = effectiveNavSecond(stored);
  const setNavSecond = useCallback(
    (second: NavSecond) => {
      if (!isNavSecond(second)) return;
      persist({ ...stored, navSecondFamily: second });
    },
    [persist, stored]
  );

  const navHoldMs = isValidLongPress(stored.navHoldMs) ? stored.navHoldMs : DEFAULT_NAV_HOLD_MS;
  /** Durée de l'appui long qui change le sport secondaire, en millisecondes ; `null` revient au défaut. */
  const setNavHoldMs = useCallback(
    (value: number | null) => {
      if (value !== null && !isValidLongPress(value)) return;
      const next: StoredSettings = { ...stored };
      if (value === null) delete next.navHoldMs;
      else next.navHoldMs = value;
      persist(next);
    },
    [persist, stored]
  );

  return {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
    navFamily, setNavFamily, navSecond, setNavSecond, navHoldMs, setNavHoldMs,
  };
};

/**
 * Activité retenue par un module : celle mémorisée si elle est de sa famille
 * (une de la liste, ou l'activité de base d'un calcul, pour une session sans
 * activité), sinon la première de la famille, sinon l'activité de base du
 * calcul par défaut de la famille.
 */
const moduleActivity = (stored: StoredSettings, activities: Activity[], family: SportFamily): Activity => {
  const remembered = stored.moduleActivity?.[family] ?? (family === 'voile' ? stored.sport : undefined);
  const found = findActivity(activities, remembered);
  if (found && activityFamily(found) === family) return found;
  return activitiesOfFamily(activities, family)[0] ?? baseActivity(FAMILY_BASE[family]);
};

/**
 * Réglages d'un module d'analyse : son activité courante, le profil de son
 * calcul et les réglages rangés sous elle. Un module ne reprend que les
 * activités de sa famille : la course n'hérite pas du seuil de vol du
 * wingfoil (règle 9).
 */
export const useSportSettings = (family: SportFamily) => {
  const [stored, setStored] = useState<StoredSettings>(readStoredSettings);
  const activities = useMemo(() => readActivities(stored.activities), [stored.activities]);
  const activity = useMemo(() => moduleActivity(stored, activities, family), [stored, activities, family]);
  const sport = activity.base;
  const profile = useMemo(() => getSportProfile(sport), [sport]);
  const id = activity.id;

  /** Activités proposées par le module : celles de la famille, plus l'activité courante si c'en est une de base. */
  const activityOptions = useMemo(() => {
    const own = activitiesOfFamily(activities, family);
    return own.some((a) => a.id === id) ? own : [...own, activity];
  }, [activities, family, activity, id]);

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    writeStored(next);
  }, []);

  /** Change l'activité du module ; un identifiant d'une autre famille est ignoré. */
  const setActivity = useCallback(
    (nextId: string) => {
      const next = findActivity(activities, nextId);
      if (!next || activityFamily(next) !== family) return;
      persist({ ...stored, moduleActivity: { ...stored.moduleActivity, [family]: next.id } });
    },
    [persist, stored, activities, family]
  );

  const activeThreshold = stored.thresholds?.[id] ?? profile.defaultActiveThreshold;
  const isThresholdOverridden = stored.thresholds?.[id] !== undefined;

  // Lecture seule : le terrain de l'activité se règle dans Réglages, celui
  // d'une session dans sa fiche (brouillon du module).
  const storedTerrain = stored.terrains?.[id];
  const terrain: TerrainType = isKnownTerrain(storedTerrain) ? storedTerrain : 'route';
  /** Pas des échantillons d'altitude du terrain, réglé dans Réglages ; `null` en voile. */
  const terrainStepM = resolveTerrainStepM(stored, activity);

  // Lecture seule : les unités se choisissent dans Réglages, par activité.
  const storedUnit = stored.speedUnits?.[id];
  const speedUnit: SpeedUnit = isKnownSpeedUnit(storedUnit) ? storedUnit : profile.speedUnit;
  const storedDistanceUnit = stored.distanceUnits?.[id];
  const distanceUnit: DistanceUnit = isKnownDistanceUnit(storedDistanceUnit) ? storedDistanceUnit : 'km';

  // Lecture seule ici : les bornes de l'activité se règlent dans Réglages, celles
  // d'une trace dans sa fiche (brouillon du module).
  const storedRange = stored.speedRanges?.[id];
  const speedRange = storedRange && isValidSpeedRange(storedRange) ? storedRange : null;
  const storedGradeRange = stored.gradeRanges?.[id];
  const gradeRange: GradeRange = storedGradeRange && isValidGradeRange(storedGradeRange) ? storedGradeRange : defaultGradeRange(sport);

  // Vélo : type et poids, réglés dans Réglages.
  const storedBikeType = stored.bikeTypes?.[id];
  const bikeType: BikeType = isBikeType(storedBikeType) ? storedBikeType : defaultBikeType(id);
  const storedBikeWeight = stored.bikeWeights?.[id];
  const bikeWeightKg = isValidBikeWeight(storedBikeWeight) ? storedBikeWeight : BIKE_TYPES[bikeType].bikeKg;

  /** Support sur foil de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
  const foil = resolveFoil(stored, activity) ?? false;

  return {
    activity,
    activityOptions,
    setActivity,
    sport,
    profile,
    activeThreshold,
    isThresholdOverridden,
    /** Terrain du dénivelé de l'activité ; une session peut avoir le sien. */
    terrain,
    terrainStepM,
    speedUnit,
    distanceUnit,
    /** Bornes du dégradé réglées pour l'activité dans Réglages, ou `null` pour le défaut du module. */
    speedRange,
    /** Bornes de la couleur de pente de la courbe d'altitude, réglées dans Réglages ou par défaut. */
    gradeRange,
    /** Bornes du dégradé à défaut de réglage, propres au traitement du calcul. */
    defaultSpeedRange: TREATMENT_SPEED_RANGE_MS[sportTreatment(sport)],
    bikeType,
    /** Poids du vélo effectif, en kg (celui du type à défaut de réglage). */
    bikeWeightKg,
    isBikeWeightOverridden: isValidBikeWeight(storedBikeWeight),
    foil,
  };
};
