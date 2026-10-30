import {
  ACTIVITIES_VERSION, FAMILY_BASE, MARCHE_ACTIVITY, SURF_FOIL_ACTIVITY, activitiesOfFamily, activityFamily, activityTreatment, baseActivity, findActivity,
  readActivities, visibleFamilies, type Activity,
} from '../core/activities';
import { PRESET_BASES, presetOf } from './activityPresets';
import {
  LOOP_RETURN_RATIO_RANGE, SPORT_FAMILIES, TERRAIN_STEP_CHOICES_M, defaultActiveThresholdOf, getSportProfile, hasActiveThreshold, hasPositions,
  type RecordingProfile, type SportFamily, type Treatment,
} from '../core/sportProfiles';
import { sanitizeTabChoices, type TabChoices } from '../core/analysisTabs';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import type { SportType } from '../core/types';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL, type DistanceUnit, type SpeedUnit } from '../core/units';
import { finiteOr, inRange } from '../core/basics';
import type { BeepSound } from '../recording/beepSound';
import type { FitnessTestId, FitnessTestSettings } from '../recording/fitnessTest';
import type { IntervalPreset, IntervalWorkout } from '../recording/intervalTimer';
import {
  MAX_NOTIFICATION_FIELDS, defaultLiveFieldsOf, defaultNotificationFieldsOf, sanitizeLiveFields, type LiveFieldKey,
} from '../recording/liveFields';
import { MARK_GUIDE_DEFAULTS, sanitizeMarkGuide, type MarkGuideSettings } from '../recording/markGuide';
import { defaultJumpSettings, sanitizeJumpSettings, type JumpSettings } from '../recording/jumpSettings';
import { BIKE_TYPES, REFERENCE_RIDER_KG, cyclingEnergyParams, isBikeType, isValidBikeWeight, type BikeType } from '../cycling/energy';
import { isEnergyModel, isValidCarriedLoad, type EnergyModel } from '../running/energy';
import { DEFAULT_CYCLING_GRADE_RANGE } from '../cycling/cyclingConfig';
import type { GearGroup } from '../library/notes';
import {
  DEFAULT_PACE_LEVEL, KM_EFFORT_CLIMB_FACTOR, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, climbPowerWkgForFlatSpeed, isPaceLevel,
  isValidFlatSpeed, type DurationSettings, type PaceLevel, type PlanningFamily, type PresetPaceLevel,
} from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import { presetWayTypes, sanitizeWayTypes } from '../planning/wayTypes';
import { DEFAULT_GRADE_RANGE, isValidGradeRange, type GradeRange } from '../core/grade';
import { sanitizeGearGroups, sanitizeGearLabels } from './gear';

/**
 * Réglages d'une activité, purs (lot 72) : défauts tirés du pré-réglage et du
 * calcul, valeurs effectives (`resolve*`) lues sur un `StoredSettings` passé en
 * argument, vue de Réglages, « Par défaut », mise à jour des pré-réglages.
 * Le magasin (`tracker.sportSettings`), sa lecture et ses écritures restent
 * dans `hooks/useSportSettings.ts`.
 */

/** Unités d'affichage proposées selon le traitement du calcul. */
export const SAILING_UNITS: SpeedUnit[] = ['kn', 'kmh', 'ms'];
export const RUNNING_UNITS: SpeedUnit[] = ['kmh', 'ms', 'minkm'];
export const CYCLING_UNITS: SpeedUnit[] = ['kmh', 'ms'];
export const SURF_UNITS: SpeedUnit[] = ['kmh', 'kn', 'ms'];

export const TREATMENT_UNITS: Record<Treatment, SpeedUnit[]> = {
  voile: SAILING_UNITS,
  course: RUNNING_UNITS,
  velo: CYCLING_UNITS,
  surf: SURF_UNITS,
  // Muscu, sans position : sans objet, ni proposé dans Réglages.
  muscu: RUNNING_UNITS,
};

/**
 * Bornes de couleur d'une activité à défaut de réglage : celles de son pré-réglage
 * (`settings/activityPresets.ts`), sinon celles de son calcul (`SportProfile.speedRange`).
 */
export const defaultSpeedRangeOf = (activity: Activity): SpeedRangeMs =>
  presetOf(activity).speedRangeMs ?? getSportProfile(activity.base).speedRange;

/**
 * Voile : les couleurs suivent l'allure de chaque session tant que ni le
 * pré-réglage ni le calcul (bateau, `speedRangeFollowsPace`) n'en fixent ; le seuil de même.
 */
export const rangeFollowsPace = (activity: Activity): boolean =>
  getSportProfile(activity.base).speedRangeFollowsPace && presetOf(activity).speedRangeMs === undefined;

export const thresholdFollowsPace = (activity: Activity): boolean =>
  activityTreatment(activity) === 'voile' && presetOf(activity).threshold === undefined;

/** Bornes de la couleur de pente à défaut de réglage : celles du pré-réglage, sinon celles du traitement. */
export const defaultGradeRange = (activity: Activity): GradeRange =>
  presetOf(activity).gradeRange ?? (activityTreatment(activity) === 'velo' ? DEFAULT_CYCLING_GRADE_RANGE : DEFAULT_GRADE_RANGE);

/** Seuil d'activité à défaut de réglage, dans l'unité du profil : celui du pré-réglage (0 : aucun), sinon celui du calcul. */
export const defaultThresholdOf = (activity: Activity, foil: boolean): number =>
  presetOf(activity).threshold ?? defaultActiveThresholdOf(getSportProfile(activity.base), foil);

/** Unité de vitesse à défaut de réglage. */
export const defaultSpeedUnitOf = (activity: Activity): SpeedUnit =>
  presetOf(activity).speedUnit ?? getSportProfile(activity.base).speedUnit;

/** Pause automatique à défaut de réglage (m/s, secondes). */
export const defaultAutoPauseOf = (activity: Activity): { speedMs: number; delayS: number } => {
  const { recording } = getSportProfile(activity.base);
  return presetOf(activity).autoPause ?? { speedMs: recording.autoPauseSpeedMs, delayS: recording.autoPauseDelayS };
};

/** Chiffres du direct à défaut de réglage. */
export const defaultLiveFieldsFor = (activity: Activity): LiveFieldKey[] =>
  presetOf(activity).liveFields ?? defaultLiveFieldsOf(activity.base);

/** Chiffres de la notification à défaut de réglage. */
export const defaultNotificationFieldsFor = (activity: Activity): LiveFieldKey[] =>
  presetOf(activity).notificationFields ?? defaultNotificationFieldsOf(activity.base);

/** Bips d'approche des balises à défaut de réglage. */
export const defaultMarkGuideOf = (activity: Activity): MarkGuideSettings => presetOf(activity).markGuide ?? MARK_GUIDE_DEFAULTS;

/** Ceinture cardio à défaut de réglage. */
export const defaultHeartRateOf = (activity: Activity): boolean => presetOf(activity).heartRate ?? false;

/** Pas d'altitude du terrain à défaut de réglage, `null` en voile et en surf. */
export const defaultTerrainStepOf = (activity: Activity): number | null => {
  const profileStep = getSportProfile(activity.base).terrainElevationStepM;
  return profileStep === null ? null : presetOf(activity).terrainStepM ?? profileStep;
};

/** Onglets à défaut de réglage : ceux du pré-réglage, `null` : ceux du module. */
export const defaultTabsOf = (activity: Activity): TabChoices | null => sanitizeTabChoices(presetOf(activity).tabs);

/**
 * Réglages par activité (`core/activities.ts`) : unité, seuil d'activité,
 * terrain, couleurs de trace, pause automatique, rangés sous
 * l'identifiant de l'activité. Le calcul de base ne fournit que les défauts ;
 * la surcharge de l'utilisateur prime et survit au rechargement.
 *
 * Le seuil est volontairement modifiable : 8 nœuds ne vaut qu'en wingfoil, et
 * le réglage fin dépend du matériel et du pratiquant.
 */


/** Réglage rangé par identifiant d'activité. */
export type ByActivity<T> = Partial<Record<string, T>>;

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
  /** Version des pré-réglages (`PRESETS_VERSION`) des réglages écrits ; absente : 0. */
  presetsVersion?: number;
  /** Familles cachées dans Réglages (§10, point 100) : ni proposées, ni listées ; rien n'est effacé. */
  hiddenFamilies?: SportFamily[];
  /** Surcharges du seuil d'activité, dans l'unité du profil du calcul ; 0 : aucun seuil réglé, arrêts complets ôtés d'office. */
  thresholds?: ByActivity<number>;
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
  /** Chiffres en grand de l'enregistrement, carte réduite ; absents : ceux du calcul (`defaultLiveFieldsOf`). */
  liveFields?: ByActivity<LiveFieldKey[]>;
  /** Chiffres de la notification de l'enregistrement, écran verrouillé ; absents : ceux du calcul (`defaultNotificationFieldsOf`). */
  notificationFields?: ByActivity<LiveFieldKey[]>;
  /** Bips d'approche des balises (voile) : courbe et vibration ; absent : `MARK_GUIDE_DEFAULTS`. */
  markGuide?: ByActivity<MarkGuideSettings>;
  /** Support sur foil (voile, surf) ; absent : `foilDefault` du calcul, coché pour « Surf foil ». */
  foils?: ByActivity<boolean>;
  /** Pumping foil (surf, point 104 ; voile sur foil, lot 22) : capteurs proposés à l'enregistrement, pumping des vols dans l'analyse ; absent : non. */
  pumping?: ByActivity<boolean>;
  /** Sauts mesurés par les capteurs du téléphone (voile sauf bateau, course, vélo) ; absents : non mesurés. */
  jumps?: ByActivity<JumpSettings>;
  /** Ceinture cardio proposée à l'enregistrement (course, vélo, fractionné) ; absente : non. */
  heartRate?: ByActivity<boolean>;
  /** Cadence à pied mesurée par les capteurs du téléphone (course, marche, fractionné à pied) ; absente : oui (seul « non » est rangé). */
  cadence?: ByActivity<boolean>;
  /** Type de vélo (vélo), qui fixe roulement et traînée ; absent : `defaultBikeType`. */
  bikeTypes?: ByActivity<BikeType>;
  /** Poids du vélo en kg (vélo) ; absent : celui du type. */
  bikeWeights?: ByActivity<number>;
  /** Charge portée en kg, sac et affaires (course) ; absente : 0. */
  carriedLoads?: ByActivity<number>;
  /** Modèle de dépense à pied (course, marche) ; absent : `defaultEnergyModelOf`. */
  energyModels?: ByActivity<EnergyModel>;
  /** Décalage des seuils cardio S1 et S2 par rapport à la course, en bpm ; absent : `defaultHrOffsetOf`. */
  hrOffsets?: ByActivity<number>;
  /** Intitulés des deux champs de matériel des notes (hors voile) ; un texte vide : celui par défaut. */
  gearLabels?: ByActivity<[string, string]>;
  /**
   * Matériel enregistré de l'activité (fiche 18, lot 20) : groupes et pièces créés par l'utilisateur, choisis
   * dans l'onglet du matériel de l'analyse ; absent : option coupée ; liste vide : option cochée, rien de créé.
   */
  gearGroups?: ByActivity<GearGroup[]>;
  /**
   * Onglets des analyses montrés ou cachés à l'écart de leur défaut, par clé
   * d'onglet (`core/analysisTabs.ts`) ; absents : ceux du module, sans les génériques.
   */
  tabs?: ByActivity<Record<string, boolean>>;
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
  /** Durée de l'appui long sur « Arrêter » qui termine l'enregistrement, en millisecondes ; 0 : un simple appui. */
  stopHoldMs?: number;
  /** Séances du compteur gardées pour être reprises toutes faites (fractionné), communes aux activités. */
  intervalPresets?: IntervalPreset[];
  /** Dernière séance lancée au compteur, proposée la fois suivante (choix retenu). */
  lastIntervalWorkout?: IntervalWorkout;
  /** Séances du Timer (25/10), à part de celles du fractionné : hors de toute activité, sans GPS ni session. */
  timerPresets?: IntervalPreset[];
  /** Dernière séance lancée au Timer (choix retenu). */
  lastTimerWorkout?: IntervalWorkout;
  /** Son de tous les bips, plus ou moins grave (24/10) ; absent : `DEFAULT_BEEP_SOUND`. */
  beepSound?: BeepSound;
  /** Réglages des tests guidés (durée d'échauffement, pourcentage de la cible), communs aux activités ; absents : ceux du protocole. */
  fitnessTests?: Partial<Record<FitnessTestId, Partial<FitnessTestSettings>>>;
}

/** Appui long par défaut : 2 s, assez pour ne pas partir d'un geste involontaire. */
export const DEFAULT_LONG_PRESS_MS = 2000;
/** Appui long qui arrête l'enregistrement : 2 s, pour qu'un geste involontaire ne coupe pas la session. */
export const DEFAULT_STOP_HOLD_MS = 2000;

export const isValidLongPress = (value: unknown): value is number =>
  inRange(value, 300, 10_000);

/** Appui long pour arrêter : 0 (simple appui), ou de 0,5 à 10 s. */
export const isValidStopHold = (value: unknown): value is number =>
  value === 0 || inRange(value, 500, 10_000);

export const isTerrainStep = (value: unknown): value is number =>
  typeof value === 'number' && (TERRAIN_STEP_CHOICES_M as readonly number[]).includes(value);

/** Pas d'altitude du terrain : celui réglé, sinon son défaut ; `null` en voile. */
export const resolveTerrainStepM = (stored: StoredSettings, activity: Activity): number | null => {
  const fallback = defaultTerrainStepOf(activity);
  if (fallback === null) return null;
  const step = stored.terrainSteps?.[activity.id];
  return isTerrainStep(step) ? step : fallback;
};

/** Seuil fixé pour une activité, réglé ou pré-réglé ; `null` : le défaut du calcul (en voile, la suggestion selon l'allure). */
export const resolveThresholdOverride = (stored: StoredSettings, activity: Activity): number | null =>
  stored.thresholds?.[activity.id] ?? presetOf(activity).threshold ?? null;

/**
 * Bornes de couleur fixes d'une activité : celles réglées, sinon celles de son
 * pré-réglage ; `null` sans l'un ni l'autre (le défaut du module, en voile la
 * suggestion selon l'allure).
 */
export const resolveSpeedRange = (stored: StoredSettings, activity: Activity): SpeedRangeMs | null => {
  const range = stored.speedRanges?.[activity.id];
  return range && isValidSpeedRange(range) ? range : presetOf(activity).speedRangeMs ?? null;
};

/** Unité de vitesse d'une activité : celle réglée, sinon son défaut. */
export const resolveSpeedUnit = (stored: StoredSettings, activity: Activity): SpeedUnit => {
  const unit = stored.speedUnits?.[activity.id];
  return isKnownSpeedUnit(unit) ? unit : defaultSpeedUnitOf(activity);
};

/** Bornes de la couleur de pente : celles réglées, sinon leur défaut. */
export const resolveGradeRange = (stored: StoredSettings, activity: Activity): GradeRange => {
  const range = stored.gradeRanges?.[activity.id];
  return range && isValidGradeRange(range) ? range : defaultGradeRange(activity);
};

/** Rapport du retour de boucle admis, en fois l'aller. */
export const isValidLoopReturnRatio = (value: unknown): value is number =>
  inRange(value, LOOP_RETURN_RATIO_RANGE.min, LOOP_RETURN_RATIO_RANGE.max);

/** Décalage des seuils cardio admis, en bpm entiers. */
export const HR_OFFSET_RANGE = { min: -30, max: 30 };

export const isValidHrOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= HR_OFFSET_RANGE.min && value <= HR_OFFSET_RANGE.max;

/** Décalage des seuils cardio à défaut de réglage : le pré-réglage, sinon celui du calcul. */
export const defaultHrOffsetOf = (activity: Activity): number =>
  presetOf(activity).hrThresholdOffsetBpm ?? getSportProfile(activity.base).heartRate.thresholdOffsetBpm;

export const resolveHrOffset = (stored: StoredSettings, activity: Activity): number => {
  const offset = stored.hrOffsets?.[activity.id];
  return isValidHrOffset(offset) ? offset : defaultHrOffsetOf(activity);
};

/** Rapport du retour de boucle : celui réglé, sinon celui du profil ; `null` en voile. */
export const resolveLoopReturnRatio = (stored: StoredSettings, activity: Activity): number | null => {
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

/** Familles cachées, valeurs inconnues écartées. */
export const readHiddenFamilies = (stored: StoredSettings): SportFamily[] =>
  Array.isArray(stored.hiddenFamilies) ? stored.hiddenFamilies.filter(isKnownFamily) : [];

/** Réglages avec ces activités et ces familles cachées ; `null` s'il ne resterait aucune famille visible. */
export const withVisibility = (stored: StoredSettings, activities: Activity[], hiddenFamilies: SportFamily[]): StoredSettings | null =>
  visibleFamilies(activities, hiddenFamilies).length === 0
    ? null
    : { ...stored, activities, activitiesVersion: ACTIVITIES_VERSION, hiddenFamilies };

/**
 * Version des pré-réglages. 1 (21/10) : bateau (couleurs de 1 à 15 nœuds,
 * sans seuil d'activité, pause sous 0,2 km/h, chiffres du direct). 2 (21/10) :
 * wing, planche, à pied, vélo et fractionné (`settings/activityPresets.ts`).
 * 3 (28/10) : la Marche sans seuil d'activité.
 */
export const PRESETS_VERSION = 3;

/**
 * Réglages effacés une fois, à la mise à jour, pour que les pré-réglages
 * repris s'appliquent (choix de l'utilisateur, 21/10) : ces clés, pour toute
 * activité dont le calcul est listé, activité de base comprise, et pour les
 * activités de `ids`. Les réglages écrits ensuite portent `PRESETS_VERSION`
 * et restent.
 */
const PRESET_RESETS: { version: number; bases: SportType[]; ids?: string[]; keys: PerActivityKey[] }[] = [
  { version: 1, bases: ['bateau'], keys: ['speedRanges', 'autoPause', 'liveFields', 'notificationFields', 'thresholds'] },
  {
    version: 2,
    bases: PRESET_BASES,
    keys: [
      'thresholds', 'speedUnits', 'speedRanges', 'gradeRanges', 'autoPause', 'liveFields', 'notificationFields', 'markGuide', 'jumps',
      'heartRate', 'bikeTypes', 'bikeWeights', 'wayTypes', 'terrainSteps', 'tabs', 'paceLevels', 'customFlatSpeeds',
    ],
  },
  // Le seuil de 0,5 km/h de la Marche, rangé tel quel par d'anciens réglages ; celui de la Course reste.
  { version: 3, bases: [], ids: [MARCHE_ACTIVITY.id], keys: ['thresholds'] },
];

/**
 * Réglages d'une version de pré-réglages d'avant mis à jour (`PRESET_RESETS`) :
 * les réglages des calculs repris depuis sont effacés. Rend `stored` lui-même
 * s'il n'y a rien à effacer.
 */
export const resetStoredPresets = (stored: StoredSettings): StoredSettings => {
  const from = stored.presetsVersion ?? 0;
  if (from >= PRESETS_VERSION) return stored;
  const activities = readActivities(stored.activities);
  let next = stored;
  for (const { version, bases, ids: own = [], keys } of PRESET_RESETS) {
    if (version <= from) continue;
    const ids = new Set<string>([...bases, ...own, ...activities.filter((a) => bases.includes(a.base)).map((a) => a.id)]);
    for (const key of keys) {
      const map = next[key];
      if (!map || !Object.keys(map).some((id) => ids.has(id))) continue;
      const copy: Record<string, unknown> = { ...map };
      for (const id of ids) delete copy[id];
      next = { ...next, [key]: copy };
    }
  }
  return next;
};

/** Type de vélo d'une activité sans réglage : celui de son pré-réglage (Gravel, VTT), route sinon. */
export const defaultBikeType = (activity: Activity): BikeType => presetOf(activity).bikeType ?? 'route';

/** Type de vélo d'une activité : celui réglé, sinon son défaut. */
export const resolveBikeType = (stored: StoredSettings, activity: Activity): BikeType => {
  const type = stored.bikeTypes?.[activity.id];
  return isBikeType(type) ? type : defaultBikeType(activity);
};

/** Modèle de dépense d'une activité sans réglage : celui de son pré-réglage (la Marche), la course sinon. */
export const defaultEnergyModelOf = (activity: Activity): EnergyModel => presetOf(activity).energyModel ?? 'course';

/** Modèle de dépense d'une activité : celui réglé, sinon son défaut. */
export const resolveEnergyModel = (stored: StoredSettings, activity: Activity): EnergyModel => {
  const model = stored.energyModels?.[activity.id];
  return isEnergyModel(model) ? model : defaultEnergyModelOf(activity);
};

/**
 * Poids du vélo à défaut de réglage : celui du pré-réglage tant que le type
 * est celui du pré-réglage, sinon celui du type.
 */
export const defaultBikeKg = (activity: Activity, bikeType: BikeType): number => {
  const preset = presetOf(activity).bikeKg;
  return preset !== undefined && bikeType === defaultBikeType(activity) ? preset : BIKE_TYPES[bikeType].bikeKg;
};

/** Activités de l'utilisateur, hors composant (enregistrement, bibliothèque). */
/** Unité de distance d'une activité : celle choisie, sinon le kilomètre. */
export const resolveDistanceUnit = (stored: StoredSettings, activity: Activity): DistanceUnit => {
  const unit = stored.distanceUnits?.[activity.id];
  return isKnownDistanceUnit(unit) ? unit : 'km';
};

/** Poids du vélo d'une activité, en kg : celui réglé, sinon celui de son type. */
export const resolveBikeKg = (stored: StoredSettings, activity: Activity, bikeType: BikeType): number => {
  const weight = stored.bikeWeights?.[activity.id];
  return isValidBikeWeight(weight) ? weight : defaultBikeKg(activity, bikeType);
};

export const sanitizeNotificationFields = (value: unknown, activity: Activity): LiveFieldKey[] | null =>
  sanitizeLiveFields(value, activityTreatment(activity), MAX_NOTIFICATION_FIELDS, 'notification', activityFamily(activity));

/** Foil d'une activité sans réglage : coché pour « Surf foil » (point 97), sinon le défaut du calcul. */
export const defaultFoil = (activity: Activity): boolean =>
  activity.id === SURF_FOIL_ACTIVITY.id || getSportProfile(activity.base).foilDefault;

/** Foil d'une activité : celui réglé, sinon son défaut ; `null` hors voile et surf. */
export const resolveFoil = (stored: StoredSettings, activity: Activity): boolean | null => {
  const treatment = activityTreatment(activity);
  if (treatment !== 'voile' && treatment !== 'surf') return null;
  const foil = stored.foils?.[activity.id];
  return typeof foil === 'boolean' ? foil : defaultFoil(activity);
};

/** Pumping foil d'une activité : celui réglé, sinon non ; `null` si son calcul ne le mesure pas (bateau, à pied, à vélo). */
export const resolvePumping = (stored: StoredSettings, activity: Activity): boolean | null => {
  if (getSportProfile(activity.base).pump === null) return null;
  return stored.pumping?.[activity.id] === true;
};

/** Ceinture cardio d'une activité : celle réglée, sinon son défaut ; proposée dans tous les sports. */
export const resolveHeartRate = (stored: StoredSettings, activity: Activity): boolean => {
  const own = stored.heartRate?.[activity.id];
  return typeof own === 'boolean' ? own : defaultHeartRateOf(activity);
};

/** Cadence d'une activité : mesurée sauf si on l'a décochée ; `null` si son calcul ne la mesure pas (hors pied). */
export const resolveCadence = (stored: StoredSettings, activity: Activity): boolean | null => {
  if (getSportProfile(activity.base).cadence === null) return null;
  return stored.cadence?.[activity.id] !== false;
};

/** Sauts d'une activité : ceux réglés, sinon le défaut ; `null` si son calcul ne les mesure pas. */
export const resolveJumps = (stored: StoredSettings, activity: Activity): JumpSettings | null => {
  const profile = getSportProfile(activity.base).jumps;
  if (!profile) return null;
  return sanitizeJumpSettings(stored.jumps?.[activity.id], profile) ?? sanitizeJumpSettings(presetOf(activity).jumps, profile) ?? defaultJumpSettings(profile);
};

/** Réglage d'enregistrement d'une activité : le profil de son calcul, sauf surcharge de la pause automatique. */
export const resolveRecordingProfile = (stored: StoredSettings, activity: Activity): RecordingProfile => {
  const profile = getSportProfile(activity.base);
  const pause = stored.autoPause?.[activity.id] ?? defaultAutoPauseOf(activity);
  return { ...profile.recording, autoPauseSpeedMs: pause.speedMs, autoPauseDelayS: pause.delayS };
};

/** Chiffres en grand de l'enregistrement, carte réduite : ceux choisis, sinon ceux du calcul. */
export const resolveLiveFields = (stored: StoredSettings, activity: Activity): LiveFieldKey[] =>
  sanitizeLiveFields(stored.liveFields?.[activity.id], activityTreatment(activity)) ?? defaultLiveFieldsFor(activity);

/** Chiffres de la notification de l'enregistrement : ceux choisis, sinon ceux du calcul. */
export const resolveNotificationFields = (stored: StoredSettings, activity: Activity): LiveFieldKey[] =>
  sanitizeNotificationFields(stored.notificationFields?.[activity.id], activity) ?? defaultNotificationFieldsFor(activity);

/** Bips d'approche des balises : ceux réglés pour l'activité, sinon le défaut. */
export const resolveMarkGuide = (stored: StoredSettings, activity: Activity): MarkGuideSettings =>
  sanitizeMarkGuide(stored.markGuide?.[activity.id]) ?? defaultMarkGuideOf(activity);

/** Onglets choisis pour les analyses d'une activité, ceux du pré-réglage sinon ; `null` sans l'un ni l'autre. */
export const resolveTabChoices = (stored: StoredSettings, activity: Activity): TabChoices | null =>
  sanitizeTabChoices(stored.tabs?.[activity.id]) ?? defaultTabsOf(activity);

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
export const PLANNING_FAMILIES: SportFamily[] = ['voile', 'course', 'velo', 'surf'];

/**
 * Types de voie cochés d'office pour une activité : réglés, sinon ceux de son
 * pré-réglage tant que son type de vélo est celui du pré-réglage, sinon
 * proposés selon le type de vélo (`presetWayTypes`).
 */
export const resolveWayTypes = (stored: StoredSettings, activity: Activity): { wayTypes: WayType[]; overridden: boolean } => {
  const own = sanitizeWayTypes(stored.wayTypes?.[activity.id]);
  if (own) return { wayTypes: own, overridden: true };
  const bikeType = resolveBikeType(stored, activity);
  const preset = presetOf(activity).wayTypes;
  return {
    wayTypes: preset && bikeType === defaultBikeType(activity) ? preset : presetWayTypes(activityTreatment(activity), bikeType),
    overridden: false,
  };
};

/**
 * Niveau du temps estimé d'une activité sans réglage : celui de son
 * pré-réglage (« Personnalisé » à 5 km/h pour la Marche), le niveau par défaut sinon.
 */
export const defaultPaceOf = (activity: Activity): { level: PaceLevel; customFlatSpeedMs: number | null } =>
  presetOf(activity).pace ?? { level: DEFAULT_PACE_LEVEL, customFlatSpeedMs: null };

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

/** Niveau effectif d'une activité de course ou de vélo, `null` en voile. */
export const resolveActivityPace = (stored: StoredSettings, activity: Activity): { level: PaceLevel; flatSpeedMs: number } | null => {
  const family = planningFamily(activity);
  if (!family) return null;
  const fallback = defaultPaceOf(activity);
  return resolvePace(family, stored.paceLevels?.[activity.id] ?? fallback.level, stored.customFlatSpeeds?.[activity.id] ?? fallback.customFlatSpeedMs);
};

/**
 * Réglage du temps estimé d'un itinéraire pour une activité, `null` en
 * voile (`planning/duration.ts`). `riderKg` : poids du pratiquant, `null`
 * s'il n'est pas renseigné (cycliste de référence).
 */
export const durationSettingsOf = (stored: StoredSettings, activity: Activity, riderKg: number | null): DurationSettings | null => {
  const pace = resolveActivityPace(stored, activity);
  if (!pace) return null;
  if (planningFamily(activity) === 'course') {
    return { family: 'course', flatSpeedMs: pace.flatSpeedMs, climbFactor: KM_EFFORT_CLIMB_FACTOR };
  }
  const bikeType = resolveBikeType(stored, activity);
  const bikeKg = resolveBikeKg(stored, activity, bikeType);
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
  /** Seuil d'activité dans l'unité du profil ; 0 : aucun seuil réglé, arrêts complets ôtés d'office. */
  activeThreshold: number;
  isThresholdOverridden: boolean;
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
  /** Chiffres de la notification de l'enregistrement. */
  notificationFields: LiveFieldKey[];
  isNotificationFieldsOverridden: boolean;
  /** Bips d'approche des balises (voile). */
  markGuide: MarkGuideSettings;
  isMarkGuideOverridden: boolean;
  /** Support sur foil ; `null` hors voile et surf. */
  foil: boolean | null;
  isFoilOverridden: boolean;
  /** Pumping foil ; `null` si le calcul ne le mesure pas (bateau, à pied, à vélo). */
  pumping: boolean | null;
  /** Sauts mesurés par les capteurs ; `null` si le calcul ne les mesure pas (bateau, fractionné). */
  jumps: JumpSettings | null;
  /** Ceinture cardio proposée à l'enregistrement ; `null` en voile et en surf. */
  heartRate: boolean;
  /** Cadence mesurée à l'enregistrement ; `null` hors pied (course, marche, fractionné à pied). */
  cadence: boolean | null;
  isJumpsOverridden: boolean;
  /** Type de vélo (activités vélo seulement, `defaultBikeType` par défaut). */
  bikeType: BikeType;
  /** Poids du vélo en kg, ou `null` pour celui du type. */
  bikeWeight: number | null;
  /** Charge portée en kg (course), ou `null` sans réglage (0). */
  carriedLoad: number | null;
  /** Modèle de dépense à pied (course, marche), `defaultEnergyModelOf` par défaut. */
  energyModel: EnergyModel;
  isEnergyModelOverridden: boolean;
  /** Décalage des seuils cardio, en bpm. */
  hrOffset: number;
  isHrOffsetOverridden: boolean;
  /** Intitulés de matériel réglés (hors voile), un texte vide pour celui par défaut ; `null` sans réglage. */
  gearLabels: [string, string] | null;
  /** Matériel enregistré ; `null` : option coupée ; liste vide : option cochée, rien de créé. */
  gearGroups: GearGroup[] | null;
  /** Onglets des analyses montrés ou cachés à l'écart de ceux du module ; `null` sans choix ni pré-réglage. */
  tabs: TabChoices | null;
  isTabsOverridden: boolean;
  /** Ceinture cardio réglée à l'écart de son défaut. */
  isHeartRateOverridden: boolean;
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
export type PerActivityKey = (typeof PER_ACTIVITY_KEYS)[number];
export const PER_ACTIVITY_KEYS = [
  'thresholds', 'speedUnits', 'distanceUnits', 'speedRanges', 'gradeRanges', 'autoPause', 'bikeTypes', 'bikeWeights', 'carriedLoads', 'energyModels', 'hrOffsets', 'gearLabels', 'gearGroups',
  'tabs', 'paceLevels', 'customFlatSpeeds', 'liveFields', 'notificationFields', 'markGuide', 'wayTypes', 'terrainSteps', 'loopReturnRatios', 'foils', 'pumping', 'jumps',
  'heartRate', 'cadence',
] as const;

/**
 * Ce que « Par défaut » garde : le matériel enregistré, une liste de
 * l'utilisateur et non une surcharge d'un défaut ; la suppression de
 * l'activité l'efface.
 */
const KEPT_BY_RESET: readonly PerActivityKey[] = ['gearGroups'];

/** Réglages sans aucune surcharge rangée sous `id`, hors des clés de `keep`. */
export const withoutOverrides = (stored: StoredSettings, id: string, keep: readonly PerActivityKey[] = []): StoredSettings => {
  const next: StoredSettings = { ...stored };
  for (const key of PER_ACTIVITY_KEYS) {
    if (keep.includes(key)) continue;
    const map = stored[key];
    if (map && id in map) {
      const copy: Record<string, unknown> = { ...map };
      delete copy[id];
      (next as Record<string, unknown>)[key] = copy;
    }
  }
  return next;
};

/** « Par défaut » d'une activité : ses surcharges effacées, son matériel enregistré gardé. */
export const resetOverrides = (stored: StoredSettings, id: string): StoredSettings => withoutOverrides(stored, id, KEPT_BY_RESET);

/** Réglages d'une activité tels que Réglages les montre : valeurs effectives et ce qui est réglé. */
export const settingsView = (stored: StoredSettings, activity: Activity): SportSettingsView => {
  const id = activity.id;
  const profile = getSportProfile(activity.base);
  const unit = stored.speedUnits?.[id];
  const distanceUnit = stored.distanceUnits?.[id];
  const threshold = stored.thresholds?.[id];
  const range = stored.speedRanges?.[id];
  const grades = stored.gradeRanges?.[id];
  const autoPauseOverride = stored.autoPause?.[id];
  const bikeWeight = stored.bikeWeights?.[id];
  const carriedLoad = stored.carriedLoads?.[id];
  const paceLevel = stored.paceLevels?.[id];
  const customSpeed = stored.customFlatSpeeds?.[id];
  const liveFields = sanitizeLiveFields(stored.liveFields?.[id], activityTreatment(activity));
  const notificationFields = sanitizeNotificationFields(stored.notificationFields?.[id], activity);
  const markGuide = sanitizeMarkGuide(stored.markGuide?.[id]);
  const ways = resolveWayTypes(stored, activity);
  return {
    activity,
    speedUnit: resolveSpeedUnit(stored, activity),
    isSpeedUnitOverridden: isKnownSpeedUnit(unit) && unit !== defaultSpeedUnitOf(activity),
    distanceUnit: resolveDistanceUnit(stored, activity),
    isDistanceUnitOverridden: isKnownDistanceUnit(distanceUnit),
    activeThreshold: threshold ?? defaultThresholdOf(activity, resolveFoil(stored, activity) ?? false),
    isThresholdOverridden: threshold !== undefined,
    terrainStepM: resolveTerrainStepM(stored, activity),
    speedRange: range && isValidSpeedRange(range) ? range : null,
    gradeRange: grades && isValidGradeRange(grades) ? grades : null,
    autoPause: autoPauseOverride ?? defaultAutoPauseOf(activity),
    isAutoPauseOverridden: autoPauseOverride !== undefined,
    liveFields: liveFields ?? defaultLiveFieldsFor(activity),
    isLiveFieldsOverridden: liveFields !== null,
    notificationFields: notificationFields ?? defaultNotificationFieldsFor(activity),
    isNotificationFieldsOverridden: notificationFields !== null,
    markGuide: markGuide ?? defaultMarkGuideOf(activity),
    isMarkGuideOverridden: markGuide !== null,
    foil: resolveFoil(stored, activity),
    isFoilOverridden: typeof stored.foils?.[id] === 'boolean',
    pumping: resolvePumping(stored, activity),
    jumps: resolveJumps(stored, activity),
    heartRate: resolveHeartRate(stored, activity),
    isHeartRateOverridden: typeof stored.heartRate?.[id] === 'boolean' && stored.heartRate[id] !== defaultHeartRateOf(activity),
    cadence: resolveCadence(stored, activity),
    isJumpsOverridden: stored.jumps?.[id] !== undefined && profile.jumps !== null,
    bikeType: resolveBikeType(stored, activity),
    bikeWeight: isValidBikeWeight(bikeWeight) ? bikeWeight : null,
    carriedLoad: isValidCarriedLoad(carriedLoad) ? carriedLoad : null,
    energyModel: resolveEnergyModel(stored, activity),
    isEnergyModelOverridden: isEnergyModel(stored.energyModels?.[id]) && stored.energyModels[id] !== defaultEnergyModelOf(activity),
    hrOffset: resolveHrOffset(stored, activity),
    isHrOffsetOverridden: isValidHrOffset(stored.hrOffsets?.[id]),
    gearLabels: sanitizeGearLabels(stored.gearLabels?.[id]),
    gearGroups: sanitizeGearGroups(stored.gearGroups?.[id]),
    tabs: sanitizeTabChoices(stored.tabs?.[id]) ?? defaultTabsOf(activity),
    isTabsOverridden: sanitizeTabChoices(stored.tabs?.[id]) !== null,
    paceLevel: isPaceLevel(paceLevel) ? paceLevel : defaultPaceOf(activity).level,
    customFlatSpeedMs: finiteOr(customSpeed, defaultPaceOf(activity).customFlatSpeedMs),
    wayTypes: ways.wayTypes,
    isWayTypesOverridden: ways.overridden,
    loopReturnRatio: resolveLoopReturnRatio(stored, activity),
  };
};

/** Champ de `SportSettingsView` qui s'écrit depuis Réglages (`withSetting`). */
export type SettingField =
  | 'speedUnit' | 'distanceUnit' | 'activeThreshold' | 'terrainStepM' | 'speedRange' | 'gradeRange' | 'autoPause' | 'liveFields'
  | 'notificationFields' | 'markGuide' | 'foil' | 'pumping' | 'jumps' | 'heartRate' | 'cadence' | 'bikeType' | 'bikeWeight'
  | 'carriedLoad' | 'energyModel' | 'hrOffset' | 'gearLabels' | 'gearGroups' | 'tabs' | 'paceLevel' | 'customFlatSpeedMs'
  | 'wayTypes' | 'loopReturnRatio';

/**
 * Règle d'écriture d'un champ : la table où il se range, et la valeur rangée
 * pour la valeur demandée (`null` : effacer la surcharge ; `undefined` :
 * refusée, rien n'est écrit). `activity` est `null` pour un identifiant inconnu.
 */
interface SettingFieldRule {
  key: PerActivityKey;
  normalize: (value: unknown, activity: Activity | null, stored: StoredSettings) => unknown;
}

/** Valeur gardée telle quelle si `valid` l'admet ; `null` efface. */
const plain = (valid: (value: unknown) => boolean): SettingFieldRule['normalize'] =>
  (value) => (value === null ? null : valid(value) ? value : undefined);

/** Valeur nettoyée par `sanitize` (son `null` : refusée) ; `null` efface. */
const sanitized = (sanitize: (value: unknown) => unknown): SettingFieldRule['normalize'] =>
  (value) => (value === null ? null : sanitize(value) ?? undefined);

const isObjectValue = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Un booléen, ou `null` ; `undefined` pour toute autre valeur. */
const booleanOrNull = (value: unknown): boolean | null | undefined =>
  value === null || typeof value === 'boolean' ? value : undefined;

/**
 * Écriture de chaque réglage d'une activité (lot 72) : valider, ranger, ou
 * n'écrire que l'écart au défaut. Une seule table, d'où `withSetting` se déduit.
 */
export const SETTING_FIELDS: Record<SettingField, SettingFieldRule> = {
  speedUnit: { key: 'speedUnits', normalize: plain(isKnownSpeedUnit) },
  distanceUnit: { key: 'distanceUnits', normalize: plain(isKnownDistanceUnit) },
  activeThreshold: { key: 'thresholds', normalize: plain((v) => typeof v === 'number' && isFinite(v) && v >= 0) },
  terrainStepM: { key: 'terrainSteps', normalize: plain(isTerrainStep) },
  speedRange: { key: 'speedRanges', normalize: plain((v) => isObjectValue(v) && isValidSpeedRange(v)) },
  gradeRange: { key: 'gradeRanges', normalize: plain((v) => isObjectValue(v) && isValidGradeRange(v)) },
  autoPause: {
    key: 'autoPause',
    normalize: plain((v) => {
      const a = v as { speedMs: number; delayS: number };
      return isFinite(a.speedMs) && isFinite(a.delayS) && a.speedMs >= 0 && a.delayS >= 0;
    }),
  },
  liveFields: {
    key: 'liveFields',
    normalize: (v, activity) => (!activity ? undefined : v === null ? null : sanitizeLiveFields(v, activityTreatment(activity)) ?? undefined),
  },
  notificationFields: {
    key: 'notificationFields',
    normalize: (v, activity) => (!activity ? undefined : v === null ? null : sanitizeNotificationFields(v, activity) ?? undefined),
  },
  markGuide: { key: 'markGuide', normalize: sanitized(sanitizeMarkGuide) },
  foil: {
    key: 'foils',
    normalize: (v, activity, stored) => (!activity || resolveFoil(stored, activity) === null ? undefined : booleanOrNull(v)),
  },
  pumping: {
    key: 'pumping',
    // Seul « oui » est rangé.
    normalize: (v, activity, stored) => {
      if (!activity || resolvePumping(stored, activity) === null) return undefined;
      const on = booleanOrNull(v);
      return on === undefined ? undefined : on === true ? true : null;
    },
  },
  heartRate: {
    key: 'heartRate',
    // Seul l'écart à son défaut est rangé : décocher une ceinture pré-réglée range « non ».
    normalize: (v, activity) => {
      if (!activity) return undefined;
      const on = booleanOrNull(v);
      return on === undefined ? undefined : on === null || on === defaultHeartRateOf(activity) ? null : on;
    },
  },
  cadence: {
    key: 'cadence',
    // Seul « non » est rangé.
    normalize: (v, activity, stored) => {
      if (!activity || resolveCadence(stored, activity) === null) return undefined;
      const on = booleanOrNull(v);
      return on === undefined ? undefined : on === false ? false : null;
    },
  },
  jumps: {
    key: 'jumps',
    normalize: (v, activity) => {
      const profile = activity ? getSportProfile(activity.base).jumps : null;
      if (!profile) return undefined;
      return v === null ? null : sanitizeJumpSettings(v, profile) ?? undefined;
    },
  },
  bikeType: { key: 'bikeTypes', normalize: plain(isBikeType) },
  bikeWeight: { key: 'bikeWeights', normalize: plain(isValidBikeWeight) },
  // Aucune charge (0 kg), le défaut, n'est pas rangée.
  carriedLoad: {
    key: 'carriedLoads',
    normalize: (v) => (v === null ? null : !isValidCarriedLoad(v) ? undefined : v === 0 ? null : v),
  },
  energyModel: { key: 'energyModels', normalize: plain(isEnergyModel) },
  hrOffset: { key: 'hrOffsets', normalize: plain(isValidHrOffset) },
  // Deux intitulés vides : ceux par défaut, la surcharge est effacée.
  gearLabels: { key: 'gearLabels', normalize: (v) => (v === null ? null : Array.isArray(v) ? sanitizeGearLabels(v) : undefined) },
  gearGroups: { key: 'gearGroups', normalize: sanitized(sanitizeGearGroups) },
  tabs: {
    key: 'tabs',
    normalize: (v) => {
      if (v === null) return null;
      const choices = sanitizeTabChoices(v);
      return choices === null ? undefined : { ...choices };
    },
  },
  paceLevel: { key: 'paceLevels', normalize: plain(isPaceLevel) },
  customFlatSpeedMs: {
    key: 'customFlatSpeeds',
    normalize: (v, activity) => {
      if (v === null) return null;
      const family = activity ? planningFamily(activity) : null;
      return family && isValidFlatSpeed(family, v) ? v : undefined;
    },
  },
  wayTypes: { key: 'wayTypes', normalize: sanitized(sanitizeWayTypes) },
  loopReturnRatio: { key: 'loopReturnRatios', normalize: plain(isValidLoopReturnRatio) },
};

/**
 * Réglages avec ce champ de l'activité `id` écrit (ou effacé, `null`) ;
 * `null` si la valeur est refusée (`SETTING_FIELDS`) : rien à écrire.
 */
export const withSetting = <F extends SettingField>(
  stored: StoredSettings, id: string, field: F, value: SportSettingsView[F] | null
): StoredSettings | null => {
  const { key, normalize } = SETTING_FIELDS[field];
  const kept = normalize(value, findActivity(readActivities(stored.activities), id), stored);
  if (kept === undefined) return null;
  const map: Record<string, unknown> = { ...stored[key] };
  if (kept === null) delete map[id];
  else map[id] = kept;
  return { ...stored, [key]: map };
};

/**
 * Vrai si l'activité a un réglage que « Par défaut » effacerait : marque
 * « · modifié » de sa carte et menu « Par défaut » actif. Le matériel
 * enregistré (`gearGroups`) n'y compte pas : « Par défaut » le garde
 * (`KEPT_BY_RESET`), le bouton n'aurait rien à remettre.
 */
export const isActivityOverridden = (s: SportSettingsView): boolean => {
  const { activity } = s;
  const p = getSportProfile(activity.base);
  /** Seuil d'activité réglable : pas en bateau, ni sans position. */
  const withThreshold = hasActiveThreshold(p) && hasPositions(activity.base);
  const pace = defaultPaceOf(activity);
  return (
    s.isSpeedUnitOverridden || s.isDistanceUnitOverridden || (withThreshold && s.isThresholdOverridden) || s.isAutoPauseOverridden || s.speedRange !== null || s.gradeRange !== null ||
    s.isLiveFieldsOverridden || s.isNotificationFieldsOverridden || s.isMarkGuideOverridden || s.terrainStepM !== defaultTerrainStepOf(activity) || s.bikeType !== defaultBikeType(activity) || s.bikeWeight !== null || s.carriedLoad !== null || s.isEnergyModelOverridden || s.isHrOffsetOverridden || s.gearLabels !== null || s.isTabsOverridden ||
    s.paceLevel !== pace.level || s.customFlatSpeedMs !== pace.customFlatSpeedMs || s.isWayTypesOverridden ||
    s.loopReturnRatio !== p.loopReturnMaxRatio || s.isFoilOverridden || s.pumping === true || s.isJumpsOverridden || s.isHeartRateOverridden || s.cadence === false
  );
};

/**
 * Activité retenue par un module : celle mémorisée si elle est de sa famille
 * (une de la liste, ou l'activité de base d'un calcul, pour une session sans
 * activité), sinon la première de la famille, sinon l'activité de base du
 * calcul par défaut de la famille.
 */
export const moduleActivity = (stored: StoredSettings, activities: Activity[], family: SportFamily): Activity => {
  const remembered = stored.moduleActivity?.[family] ?? (family === 'voile' ? stored.sport : undefined);
  const found = findActivity(activities, remembered);
  if (found && activityFamily(found) === family && !found.hidden) return found;
  // Cachée : la première visible de la famille, sinon celle retenue tout de même (§10, point 100).
  const own = activitiesOfFamily(activities, family);
  return own.find((a) => !a.hidden) ?? (found && activityFamily(found) === family ? found : own[0]) ?? baseActivity(FAMILY_BASE[family]);
};
