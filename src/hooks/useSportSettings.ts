import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ACTIVITIES_VERSION, FAMILY_BASE, MARCHE_ACTIVITY, SURF_FOIL_ACTIVITY, activitiesOfFamily, activityFamily, activityTreatment, baseActivity, findActivity,
  isActivityShown, newActivityId, insertActivity, readActivities, upgradeActivities, visibleActivities, visibleFamilies, withHidden, type Activity,
} from '../core/activities';
import type { ActivityIconId } from '../core/activityIcons';
import { DEFAULT_INTERVAL_PRESETS, PRESET_BASES, presetOf } from '../core/activityPresets';
import {
  LOOP_RETURN_RATIO_RANGE, SPORT_FAMILIES, TERRAIN_STEP_CHOICES_M, defaultActiveThresholdOf, getSportProfile,
  type RecordingProfile, type SportFamily, type Treatment,
} from '../core/sportProfiles';
import { sanitizeTabChoices, type TabChoices } from '../core/analysisTabs';
import { isValidSpeedRange, type SpeedRangeMs } from '../core/speedGradient';
import type { SportType } from '../core/types';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL, type DistanceUnit, type SpeedUnit } from '../core/units';
import { newId } from '../core/basics';
import { jsonStore } from '../platform/storage';
import { setBeepPitch } from '../platform/beeper';
import { DEFAULT_BEEP_SOUND, beepSoundHz, isBeepSound, type BeepSound } from '../recording/beepSound';
import { FITNESS_TESTS, sanitizeFitnessTestSettings, type FitnessTestId, type FitnessTestSettings } from '../recording/fitnessTest';
import {
  DEFAULT_INTERVAL_WORKOUT, DEFAULT_TIMER_WORKOUT, addPreset, replacePreset, sameWorkout, sanitizePresets, sanitizeWorkout, withoutPreset,
  type IntervalPreset, type IntervalWorkout, type WorkoutKind,
} from '../recording/intervalTimer';
import {
  MAX_NOTIFICATION_FIELDS, defaultLiveFieldsOf, defaultNotificationFieldsOf, sanitizeLiveFields, type LiveFieldKey,
} from '../recording/liveFields';
import { MARK_GUIDE_DEFAULTS, sanitizeMarkGuide, type MarkGuideSettings } from '../recording/markGuide';
import { defaultJumpSettings, sanitizeJumpSettings, type JumpSettings } from '../recording/jumpSettings';
import { BIKE_TYPES, REFERENCE_RIDER_KG, cyclingEnergyParams, isBikeType, isValidBikeWeight, type BikeType } from '../cycling/energy';
import { isEnergyModel, isValidCarriedLoad, type EnergyModel } from '../running/energy';
import { DEFAULT_CYCLING_GRADE_RANGE, DEFAULT_CYCLING_SPEED_RANGE_MS } from '../cycling/cyclingConfig';
import { DEFAULT_GRADE_RANGE, DEFAULT_SPEED_RANGE_MS, isValidGradeRange, type GradeRange } from '../running/runningAnalytics';
import { DEFAULT_SAILING_SPEED_RANGE_MS } from '../sailing/sailingConfig';
import { DEFAULT_SURF_SPEED_RANGE_MS } from '../surfing/surfConfig';
import type { GearGroup, GearItem } from '../sailing/sessionNotes';

export type { GearGroup, GearItem };
import {
  DEFAULT_PACE_LEVEL, KM_EFFORT_CLIMB_FACTOR, LEVEL_CLIMB_POWER_WKG, LEVEL_FLAT_SPEED_MS, climbPowerWkgForFlatSpeed, isPaceLevel,
  isValidFlatSpeed, type DurationSettings, type PaceLevel, type PlanningFamily, type PresetPaceLevel,
} from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import { presetWayTypes, sanitizeWayTypes } from '../planning/route';

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

/** Bornes de couleur de la trace à défaut de réglage (en voile, avant toute suggestion tirée de la session). */
export const TREATMENT_SPEED_RANGE_MS: Record<Treatment, SpeedRangeMs> = {
  voile: DEFAULT_SAILING_SPEED_RANGE_MS,
  course: DEFAULT_SPEED_RANGE_MS,
  velo: DEFAULT_CYCLING_SPEED_RANGE_MS,
  surf: DEFAULT_SURF_SPEED_RANGE_MS,
  // Muscu, sans trace : sans objet.
  muscu: DEFAULT_SPEED_RANGE_MS,
};

/**
 * Bornes de couleur d'une activité à défaut de réglage : celles de son pré-réglage
 * (`core/activityPresets.ts`), sinon celles de son calcul s'il en a de fixes (bateau),
 * sinon celles du traitement.
 */
export const defaultSpeedRangeOf = (activity: Activity): SpeedRangeMs =>
  presetOf(activity).speedRangeMs ?? getSportProfile(activity.base).speedRange ?? TREATMENT_SPEED_RANGE_MS[activityTreatment(activity)];

/**
 * Voile : les couleurs suivent l'allure de chaque session tant que ni le
 * pré-réglage ni le calcul (bateau) n'en fixent ; le seuil de même.
 */
export const rangeFollowsPace = (activity: Activity): boolean =>
  activityTreatment(activity) === 'voile' && presetOf(activity).speedRangeMs === undefined && getSportProfile(activity.base).speedRange === null;

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
const defaultTabsOf = (activity: Activity): TabChoices | null => sanitizeTabChoices(presetOf(activity).tabs);

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

const isValidLongPress = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= 300 && value <= 10_000;

/** Appui long pour arrêter : 0 (simple appui), ou de 0,5 à 10 s. */
const isValidStopHold = (value: unknown): value is number =>
  value === 0 || (typeof value === 'number' && isFinite(value) && value >= 500 && value <= 10_000);

export const isTerrainStep = (value: unknown): value is number =>
  typeof value === 'number' && (TERRAIN_STEP_CHOICES_M as readonly number[]).includes(value);

/** Pas d'altitude du terrain : celui réglé, sinon son défaut ; `null` en voile. */
const resolveTerrainStepM = (stored: StoredSettings, activity: Activity): number | null => {
  const fallback = defaultTerrainStepOf(activity);
  if (fallback === null) return null;
  const step = stored.terrainSteps?.[activity.id];
  return isTerrainStep(step) ? step : fallback;
};

/** Seuil fixé pour une activité, réglé ou pré-réglé ; `null` : le défaut du calcul (en voile, la suggestion selon l'allure). */
const resolveThresholdOverride = (stored: StoredSettings, activity: Activity): number | null =>
  stored.thresholds?.[activity.id] ?? presetOf(activity).threshold ?? null;

/** Seuil fixé pour une activité, hors composant (résumés de la bibliothèque) ; `undefined` sans réglage ni pré-réglage. */
export const effectiveThresholdOverride = (activity: Activity): number | undefined =>
  resolveThresholdOverride(readStoredSettings(), activity) ?? undefined;

/**
 * Bornes de couleur fixes d'une activité : celles réglées, sinon celles de son
 * pré-réglage ; `null` sans l'un ni l'autre (le défaut du module, en voile la
 * suggestion selon l'allure).
 */
const resolveSpeedRange = (stored: StoredSettings, activity: Activity): SpeedRangeMs | null => {
  const range = stored.speedRanges?.[activity.id];
  return range && isValidSpeedRange(range) ? range : presetOf(activity).speedRangeMs ?? null;
};

/** Bornes de couleur fixes d'une activité, hors composant (vignettes). */
export const activitySpeedRange = (activity: Activity): SpeedRangeMs | null => resolveSpeedRange(readStoredSettings(), activity);

/** Unité de vitesse d'une activité : celle réglée, sinon son défaut. */
const resolveSpeedUnit = (stored: StoredSettings, activity: Activity): SpeedUnit => {
  const unit = stored.speedUnits?.[activity.id];
  return isKnownSpeedUnit(unit) ? unit : defaultSpeedUnitOf(activity);
};

/** Bornes de la couleur de pente : celles réglées, sinon leur défaut. */
const resolveGradeRange = (stored: StoredSettings, activity: Activity): GradeRange => {
  const range = stored.gradeRanges?.[activity.id];
  return range && isValidGradeRange(range) ? range : defaultGradeRange(activity);
};

/** Intitulés des champs de matériel des notes à défaut de réglage. */
export const DEFAULT_GEAR_LABELS: [string, string] = ['Matériel 1', 'Matériel 2'];
export const MAX_GEAR_LABEL_LENGTH = 30;

/** Intitulés de matériel rognés et tronqués ; `null` s'ils sont mal formés ou tous deux vides (intitulés par défaut). */
export const sanitizeGearLabels = (value: unknown): [string, string] | null => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((v) => typeof v === 'string')) return null;
  const labels = value.map((v: string) => v.trim().slice(0, MAX_GEAR_LABEL_LENGTH)) as [string, string];
  return labels[0] === '' && labels[1] === '' ? null : labels;
};

/** Intitulés effectifs : ceux réglés, chacun remplacé par le défaut s'il est vide. */
const resolveGearLabels = (stored: StoredSettings, id: string): [string, string] => {
  const own = sanitizeGearLabels(stored.gearLabels?.[id]);
  return [own?.[0] || DEFAULT_GEAR_LABELS[0], own?.[1] || DEFAULT_GEAR_LABELS[1]];
};

/** Nom d'un groupe ou d'une pièce : rogné, tronqué ; vide s'il n'est pas un texte. */
export const cleanGearName = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, MAX_GEAR_LABEL_LENGTH) : '';

/** Même nom, aux espaces et à la casse près. */
export const sameGearName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('fr') === b.trim().toLocaleLowerCase('fr');

/**
 * Matériel enregistré relu : noms rognés et tronqués, groupes et pièces sans
 * identifiant ou sans nom écartés, identifiants en double écartés, ceux qui
 * restent gardés tels quels ; `null` s'il n'est pas une liste (option coupée).
 * Une liste vide est gardée : l'option est cochée, rien n'est encore créé.
 */
export const sanitizeGearGroups = (value: unknown): GearGroup[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const fresh = (id: unknown): id is string => {
    if (typeof id !== 'string' || id === '' || seen.has(id)) return false;
    seen.add(id);
    return true;
  };
  return value.flatMap((group): GearGroup[] => {
    if (typeof group !== 'object' || group === null) return [];
    const { id, name, items } = group as { id?: unknown; name?: unknown; items?: unknown };
    const groupName = cleanGearName(name);
    if (groupName === '' || !fresh(id)) return [];
    const kept = (Array.isArray(items) ? items : []).flatMap((item): GearItem[] => {
      if (typeof item !== 'object' || item === null) return [];
      const itemName = cleanGearName((item as { name?: unknown }).name);
      const itemId = (item as { id?: unknown }).id;
      return itemName !== '' && fresh(itemId) ? [{ id: itemId, name: itemName }] : [];
    });
    return [{ id, name: groupName, items: kept }];
  });
};

/**
 * Liste avec une pièce de plus dans un groupe ; une pièce du même nom déjà
 * dans le groupe est reprise plutôt que doublée. `null` si le nom est vide ou
 * le groupe introuvable.
 */
export const withGearItem = (
  groups: readonly GearGroup[], groupId: string, name: string, id: string = newId()
): { groups: GearGroup[]; item: GearItem } | null => {
  const clean = cleanGearName(name);
  const group = groups.find((g) => g.id === groupId);
  if (clean === '' || !group) return null;
  const existing = group.items.find((item) => sameGearName(item.name, clean));
  if (existing) return { groups: [...groups], item: existing };
  const item = { id, name: clean };
  return { groups: groups.map((g) => (g.id === groupId ? { ...g, items: [...g.items, item] } : g)), item };
};

/** Matériel enregistré en vigueur : `null` si l'option est coupée ou qu'aucun groupe n'est créé (champs de texte d'avant). */
export const resolveGearGroups = (stored: StoredSettings, id: string): GearGroup[] | null => {
  const groups = sanitizeGearGroups(stored.gearGroups?.[id]);
  return groups && groups.length > 0 ? groups : null;
};

const readGearGroupsMap = (): StoredSettings['gearGroups'] => readStoredSettings().gearGroups;

/**
 * Matériel enregistré d'une activité, suivi en direct (Statistiques) ; `null`
 * sans activité, option coupée ou sans groupe. Le magasin rend la même table
 * tant que les réglages ne changent pas : la valeur ne bouge pas d'un rendu à l'autre.
 */
export const useGearGroups = (activity: Activity | null): GearGroup[] | null => {
  const map = useSyncExternalStore(jsonStore.subscribe, readGearGroupsMap);
  const id = activity?.id ?? null;
  return useMemo(() => (id === null ? null : resolveGearGroups({ gearGroups: map }, id)), [map, id]);
};

/**
 * Ajoute une pièce au matériel enregistré d'une activité, tout de suite, hors
 * du brouillon de la session (« Ajouter à la liste » de l'analyse) ; le module
 * suit par `jsonStore.subscribe`. Rend la pièce, `null` si rien n'est ajouté.
 */
export const addGearItem = (activityId: string, groupId: string, name: string): GearItem | null => {
  const stored = readStoredSettings();
  const next = withGearItem(sanitizeGearGroups(stored.gearGroups?.[activityId]) ?? [], groupId, name);
  if (!next) return null;
  writeStored({ ...stored, gearGroups: { ...stored.gearGroups, [activityId]: next.groups } });
  return next.item;
};

/** Rapport du retour de boucle admis, en fois l'aller. */
export const isValidLoopReturnRatio = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= LOOP_RETURN_RATIO_RANGE.min && value <= LOOP_RETURN_RATIO_RANGE.max;

/** Décalage des seuils cardio admis, en bpm entiers. */
export const HR_OFFSET_RANGE = { min: -30, max: 30 };

export const isValidHrOffset = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= HR_OFFSET_RANGE.min && value <= HR_OFFSET_RANGE.max;

/** Décalage des seuils cardio à défaut de réglage : le pré-réglage, sinon celui du calcul. */
export const defaultHrOffsetOf = (activity: Activity): number =>
  presetOf(activity).hrThresholdOffsetBpm ?? getSportProfile(activity.base).heartRate.thresholdOffsetBpm;

const resolveHrOffset = (stored: StoredSettings, activity: Activity): number => {
  const offset = stored.hrOffsets?.[activity.id];
  return isValidHrOffset(offset) ? offset : defaultHrOffsetOf(activity);
};

/** Décalage des seuils cardio d'une activité, hors composant (direct, test guidé). */
export const effectiveHrOffset = (activity: Activity): number => resolveHrOffset(readStoredSettings(), activity);

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

/** Familles cachées, valeurs inconnues écartées. */
const readHiddenFamilies = (stored: StoredSettings): SportFamily[] =>
  Array.isArray(stored.hiddenFamilies) ? stored.hiddenFamilies.filter(isKnownFamily) : [];

/** Réglages avec ces activités et ces familles cachées ; `null` s'il ne resterait aucune famille visible. */
const withVisibility = (stored: StoredSettings, activities: Activity[], hiddenFamilies: SportFamily[]): StoredSettings | null =>
  visibleFamilies(activities, hiddenFamilies).length === 0
    ? null
    : { ...stored, activities, activitiesVersion: ACTIVITIES_VERSION, hiddenFamilies };

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

/**
 * Version des pré-réglages. 1 (21/10) : bateau (couleurs de 1 à 15 nœuds,
 * sans seuil d'activité, pause sous 0,2 km/h, chiffres du direct). 2 (21/10) :
 * wing, planche, à pied, vélo et fractionné (`core/activityPresets.ts`).
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

/** Toute écriture porte la version des pré-réglages : ce qu'elle contient est choisi avec eux. */
const writeStored = (settings: StoredSettings): void =>
  jsonStore.write(STORAGE_KEY, { ...settings, presetsVersion: PRESETS_VERSION });

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
  // Version des pré-réglages laissée telle quelle : `upgradeStoredPresets`, qui suit, a encore à effacer.
  jsonStore.write(STORAGE_KEY, {
    ...stored,
    activities: upgradeActivities(readActivities(stored.activities), stored.activitiesVersion ?? 1),
    activitiesVersion: ACTIVITIES_VERSION,
  });
  return true;
};

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

/**
 * Efface, une fois, les réglages des calculs dont les pré-réglages ont été
 * repris (`resetStoredPresets`). À appeler au démarrage, comme
 * `upgradeStoredActivities` ; rend vrai si les réglages ont été récrits.
 */
export const upgradeStoredPresets = (): boolean => {
  const stored = readStoredSettings();
  const next = resetStoredPresets(stored);
  if (next === stored) return false;
  writeStored(next);
  return true;
};

/** Type de vélo d'une activité sans réglage : celui de son pré-réglage (Gravel, VTT), route sinon. */
export const defaultBikeType = (activity: Activity): BikeType => presetOf(activity).bikeType ?? 'route';

/** Type de vélo d'une activité : celui réglé, sinon son défaut. */
const resolveBikeType = (stored: StoredSettings, activity: Activity): BikeType => {
  const type = stored.bikeTypes?.[activity.id];
  return isBikeType(type) ? type : defaultBikeType(activity);
};

/** Modèle de dépense d'une activité sans réglage : celui de son pré-réglage (la Marche), la course sinon. */
export const defaultEnergyModelOf = (activity: Activity): EnergyModel => presetOf(activity).energyModel ?? 'course';

/** Modèle de dépense d'une activité : celui réglé, sinon son défaut. */
const resolveEnergyModel = (stored: StoredSettings, activity: Activity): EnergyModel => {
  const model = stored.energyModels?.[activity.id];
  return isEnergyModel(model) ? model : defaultEnergyModelOf(activity);
};

/** Modèle de dépense d'une activité, réglé ou par défaut. Utilisable hors composant (direct). */
export const effectiveEnergyModel = (activity: Activity): EnergyModel => resolveEnergyModel(readStoredSettings(), activity);

/**
 * Poids du vélo à défaut de réglage : celui du pré-réglage tant que le type
 * est celui du pré-réglage, sinon celui du type.
 */
export const defaultBikeKg = (activity: Activity, bikeType: BikeType): number => {
  const preset = presetOf(activity).bikeKg;
  return preset !== undefined && bikeType === defaultBikeType(activity) ? preset : BIKE_TYPES[bikeType].bikeKg;
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

let appliedBeepHz: number | null = null;

/** Donne aux bips la hauteur du son choisi, s'il a changé depuis la dernière fois. */
const applyBeepSound = (): void => {
  const hz = beepSoundHz(readStoredSettings().beepSound);
  if (hz === appliedBeepHz) return;
  appliedBeepHz = hz;
  setBeepPitch(hz).catch(() => {
    appliedBeepHz = null;
  });
};

/**
 * Son des bips, branché une fois au démarrage : appliqué tout de suite, puis
 * à chaque changement des réglages (Réglages, réglages repris d'un autre appareil).
 */
export const startBeepSound = (): void => {
  applyBeepSound();
  jsonStore.subscribe((key) => {
    if (key === STORAGE_KEY) applyBeepSound();
  });
};

/** Durée effective de l'appui long, lue à chaque appui. */
export const effectiveLongPressMs = (): number => {
  const value = readStoredSettings().longPressMs;
  return isValidLongPress(value) ? value : DEFAULT_LONG_PRESS_MS;
};

/** Durée effective de l'appui long qui arrête l'enregistrement, lue à chaque appui ; 0 : un simple appui. */
export const effectiveStopHoldMs = (): number => {
  const value = readStoredSettings().stopHoldMs;
  return isValidStopHold(value) ? value : DEFAULT_STOP_HOLD_MS;
};

/** Ce qui est visible (§10, point 100) : la liste complète, les familles cachées, et de quoi filtrer. */
export interface Visibility {
  /** Toutes les activités, cachées comprises : elles nomment les sessions (`sessionActivity`). */
  activities: Activity[];
  hiddenFamilies: SportFamily[];
  /** Familles visibles, dans l'ordre de `SPORT_FAMILIES`. */
  families: SportFamily[];
  /** Activité visible : ni cachée, ni dans une famille cachée ; une activité de base suit sa famille. */
  isShown: (activity: Activity) => boolean;
  /** Activités visibles, d'une famille ou de toutes. */
  shownActivities: (family?: SportFamily) => Activity[];
}

/** Dernière lecture, rendue telle quelle tant que rien n'a changé. */
let visibilityCache: { activities: unknown; hiddenFamilies: unknown; key: string; value: Visibility } | null = null;

/** Ce qui est visible, hors composant. */
export const readVisibility = (): Visibility => {
  const stored = readStoredSettings();
  // Le magasin rend le même objet tant que le texte des réglages ne change pas : les mêmes références suffisent.
  // Sinon (un autre réglage écrit), le texte des activités et des familles cachées dit si elles ont changé.
  if (visibilityCache && visibilityCache.activities === stored.activities && visibilityCache.hiddenFamilies === stored.hiddenFamilies) {
    return visibilityCache.value;
  }
  const key = JSON.stringify([stored.activities ?? null, stored.hiddenFamilies ?? null]);
  if (visibilityCache?.key === key) {
    visibilityCache = { ...visibilityCache, activities: stored.activities, hiddenFamilies: stored.hiddenFamilies };
  } else {
    const activities = readActivities(stored.activities);
    const hiddenFamilies = readHiddenFamilies(stored);
    visibilityCache = {
      activities: stored.activities,
      hiddenFamilies: stored.hiddenFamilies,
      key,
      value: {
        activities,
        hiddenFamilies,
        families: visibleFamilies(activities, hiddenFamilies),
        isShown: (a) => isActivityShown(a, activities, hiddenFamilies),
        shownActivities: (family) => visibleActivities(activities, hiddenFamilies, family),
      },
    };
  }
  return visibilityCache.value;
};

/** Ce qui est visible, suivi en direct : la barre change dès que Réglages cache ou ré-affiche. */
export const useVisibility = (): Visibility => useSyncExternalStore(jsonStore.subscribe, readVisibility);

/** Séances du compteur : celles gardées, et celle à proposer (la dernière lancée, sinon la séance par défaut). */
export interface IntervalSettings {
  presets: IntervalPreset[];
  last: IntervalWorkout;
}

/** Où chaque genre range ses séances : sa liste, sa dernière lancée, et ce qu'il a avant tout choix. */
const WORKOUT_STORE = {
  fractionne: { presets: 'intervalPresets', last: 'lastIntervalWorkout', defaults: DEFAULT_INTERVAL_PRESETS, defaultLast: DEFAULT_INTERVAL_WORKOUT },
  timer: { presets: 'timerPresets', last: 'lastTimerWorkout', defaults: [] as IntervalPreset[], defaultLast: DEFAULT_TIMER_WORKOUT },
} as const satisfies Record<WorkoutKind, {
  presets: keyof StoredSettings; last: keyof StoredSettings; defaults: IntervalPreset[]; defaultLast: IntervalWorkout;
}>;

const storedPresets = (stored: StoredSettings, kind: WorkoutKind): IntervalPreset[] =>
  sanitizePresets(stored[WORKOUT_STORE[kind].presets] ?? WORKOUT_STORE[kind].defaults);

const writePresets = (kind: WorkoutKind, change: (presets: IntervalPreset[]) => IntervalPreset[]): void => {
  const stored = readStoredSettings();
  const presets = storedPresets(stored, kind);
  const next = change(presets);
  if (next !== presets) writeStored({ ...stored, [WORKOUT_STORE[kind].presets]: next });
};

/** Dernière lecture de chaque genre, rendue telle quelle tant que rien n'a changé : `useSyncExternalStore` compare les références. */
const intervalSettingsCache: Partial<Record<WorkoutKind, { key: string; value: IntervalSettings }>> = {};

const readIntervalSettings = (kind: WorkoutKind): IntervalSettings => {
  const stored = readStoredSettings();
  const { presets, last } = WORKOUT_STORE[kind];
  const key = JSON.stringify([stored[presets] ?? null, stored[last] ?? null]);
  const cached = intervalSettingsCache[kind];
  if (cached?.key === key) return cached.value;
  const value = { presets: storedPresets(stored, kind), last: sanitizeWorkout(stored[last]) ?? WORKOUT_STORE[kind].defaultLast };
  intervalSettingsCache[kind] = { key, value };
  return value;
};

const readFractionneSettings = () => readIntervalSettings('fractionne');
const readTimerSettings = () => readIntervalSettings('timer');

/** Séances du compteur d'un genre (Fractionné ou Timer), suivies en direct. */
export const useIntervalSettings = (kind: WorkoutKind): IntervalSettings =>
  useSyncExternalStore(jsonStore.subscribe, kind === 'timer' ? readTimerSettings : readFractionneSettings);

/** Retient la séance lancée, proposée au prochain lancement de son genre. */
export const rememberIntervalWorkout = (kind: WorkoutKind, workout: IntervalWorkout): void => {
  const stored = readStoredSettings();
  const field = WORKOUT_STORE[kind].last;
  const last = sanitizeWorkout(stored[field]);
  if (!last || !sameWorkout(last, workout)) writeStored({ ...stored, [field]: workout });
};

/** Garde une séance, sous le nom donné (vide : son libellé) ; sans effet au-delà de `MAX_INTERVAL_PRESETS`. */
export const saveIntervalPreset = (kind: WorkoutKind, name: string, workout: IntervalWorkout): void =>
  writePresets(kind, (presets) => addPreset(presets, name, workout));

/** Modifie une séance gardée : son nom (vide : son libellé) et ses blocs ; sans effet si elle n'existe plus ou n'est pas valable. */
export const updateIntervalPreset = (kind: WorkoutKind, id: string, name: string, workout: IntervalWorkout): void =>
  writePresets(kind, (presets) => replacePreset(presets, id, name, workout));

/** Retire une séance gardée. */
export const removeIntervalPreset = (kind: WorkoutKind, id: string): void => writePresets(kind, (presets) => withoutPreset(presets, id));

/** Réglages des tests, rendus tels quels tant que rien n'a changé (`useSyncExternalStore` compare les références). */
let fitnessTestCache: { key: string; value: Record<FitnessTestId, FitnessTestSettings> } | null = null;

const readAllFitnessTestSettings = (): Record<FitnessTestId, FitnessTestSettings> => {
  const stored = readStoredSettings().fitnessTests ?? null;
  const key = JSON.stringify(stored);
  if (fitnessTestCache?.key !== key) {
    fitnessTestCache = {
      key,
      value: { 'fc-max': sanitizeFitnessTestSettings(stored?.['fc-max'], FITNESS_TESTS['fc-max']) },
    };
  }
  return fitnessTestCache.value;
};

/** Réglages d'un test, hors composant (guidage du direct). */
export const readFitnessTestSettings = (id: FitnessTestId): FitnessTestSettings => readAllFitnessTestSettings()[id];

/** Réglages d'un test, suivis en direct. */
export const useFitnessTestSettings = (id: FitnessTestId): FitnessTestSettings =>
  useSyncExternalStore(jsonStore.subscribe, () => readAllFitnessTestSettings()[id]);

/** Change les réglages d'un test ; une valeur égale à celle du protocole n'est pas écrite. */
export const saveFitnessTestSettings = (id: FitnessTestId, patch: Partial<FitnessTestSettings>): void => {
  const stored = readStoredSettings();
  const protocol = FITNESS_TESTS[id];
  const next = sanitizeFitnessTestSettings({ ...readFitnessTestSettings(id), ...patch }, protocol);
  const own: Partial<FitnessTestSettings> = {};
  if (next.warmupS !== protocol.warmupS) own.warmupS = next.warmupS;
  const tests = { ...stored.fitnessTests };
  if (Object.keys(own).length > 0) tests[id] = own;
  else delete tests[id];
  writeStored({ ...stored, fitnessTests: tests });
};

/**
 * Réglage d'enregistrement effectif d'une activité : le profil de son calcul,
 * sauf surcharge de la pause automatique. Utilisable hors composant.
 */
export const effectiveRecordingProfile = (activity: Activity): RecordingProfile => {
  const profile = getSportProfile(activity.base);
  const pause = readStoredSettings().autoPause?.[activity.id] ?? defaultAutoPauseOf(activity);
  return { ...profile.recording, autoPauseSpeedMs: pause.speedMs, autoPauseDelayS: pause.delayS };
};

/** Chiffres en grand de l'enregistrement, carte réduite : ceux choisis dans Réglages, sinon ceux du calcul. */
export const effectiveLiveFields = (activity: Activity): LiveFieldKey[] =>
  sanitizeLiveFields(readStoredSettings().liveFields?.[activity.id], activityTreatment(activity)) ?? defaultLiveFieldsFor(activity);

/** Chiffres de la notification de l'enregistrement : ceux choisis dans Réglages, sinon ceux du calcul. */
export const effectiveNotificationFields = (activity: Activity): LiveFieldKey[] =>
  sanitizeLiveFields(readStoredSettings().notificationFields?.[activity.id], activityTreatment(activity), MAX_NOTIFICATION_FIELDS, 'notification', activityFamily(activity))
    ?? defaultNotificationFieldsFor(activity);

/** Bips d'approche des balises d'un parcours : ceux réglés pour l'activité, sinon le défaut. */
export const effectiveMarkGuide = (activity: Activity): MarkGuideSettings =>
  sanitizeMarkGuide(readStoredSettings().markGuide?.[activity.id]) ?? defaultMarkGuideOf(activity);

/** Foil d'une activité sans réglage : coché pour « Surf foil » (point 97), sinon le défaut du calcul. */
export const defaultFoil = (activity: Activity): boolean =>
  activity.id === SURF_FOIL_ACTIVITY.id || getSportProfile(activity.base).foilDefault;

/** Foil d'une activité : celui réglé, sinon son défaut ; `null` hors voile et surf. */
const resolveFoil = (stored: StoredSettings, activity: Activity): boolean | null => {
  const treatment = activityTreatment(activity);
  if (treatment !== 'voile' && treatment !== 'surf') return null;
  const foil = stored.foils?.[activity.id];
  return typeof foil === 'boolean' ? foil : defaultFoil(activity);
};

/** Pumping foil d'une activité : celui réglé, sinon non ; `null` si son calcul ne le mesure pas (bateau, à pied, à vélo). */
const resolvePumping = (stored: StoredSettings, activity: Activity): boolean | null => {
  if (getSportProfile(activity.base).pump === null) return null;
  return stored.pumping?.[activity.id] === true;
};

/** Ceinture cardio d'une activité : celle réglée, sinon son défaut ; proposée dans tous les sports. */
const resolveHeartRate = (stored: StoredSettings, activity: Activity): boolean => {
  const own = stored.heartRate?.[activity.id];
  return typeof own === 'boolean' ? own : defaultHeartRateOf(activity);
};

/** Cadence d'une activité : mesurée sauf si on l'a décochée ; `null` si son calcul ne la mesure pas (hors pied). */
const resolveCadence = (stored: StoredSettings, activity: Activity): boolean | null => {
  if (getSportProfile(activity.base).cadence === null) return null;
  return stored.cadence?.[activity.id] !== false;
};

/** Sauts d'une activité : ceux réglés, sinon le défaut ; `null` si son calcul ne les mesure pas. */
const resolveJumps = (stored: StoredSettings, activity: Activity): JumpSettings | null => {
  const profile = getSportProfile(activity.base).jumps;
  if (!profile) return null;
  return sanitizeJumpSettings(stored.jumps?.[activity.id], profile) ?? sanitizeJumpSettings(presetOf(activity).jumps, profile) ?? defaultJumpSettings(profile);
};

/** Support sur foil d'une activité de voile ou de surf, `null` ailleurs. Utilisable hors composant. */
export const effectiveFoil = (activity: Activity): boolean | null => resolveFoil(readStoredSettings(), activity);

/** Pumping foil d'une activité de surf ou de voile (bateau excepté), `null` ailleurs. Utilisable hors composant. */
export const effectivePumping = (activity: Activity): boolean | null => resolvePumping(readStoredSettings(), activity);

/** Ceinture cardio d'une activité. Utilisable hors composant. */
export const effectiveHeartRate = (activity: Activity): boolean => resolveHeartRate(readStoredSettings(), activity);

/** Cadence d'une activité à pied, `null` ailleurs. Utilisable hors composant. */
export const effectiveCadence = (activity: Activity): boolean | null => resolveCadence(readStoredSettings(), activity);

/** Réglages des sauts d'une activité, `null` si son calcul ne les mesure pas. Utilisable hors composant. */
export const effectiveJumpSettings = (activity: Activity): JumpSettings | null => resolveJumps(readStoredSettings(), activity);

/** Onglets choisis pour les analyses d'une activité, `null` sans choix. Utilisable hors composant. */
export const effectiveTabChoices = (activity: Activity): TabChoices | null =>
  sanitizeTabChoices(readStoredSettings().tabs?.[activity.id]) ?? defaultTabsOf(activity);

/**
 * Unité de vitesse effective d'une activité : celle choisie dans Réglages,
 * sinon celle du profil. Utilisable hors composant.
 */
export const effectiveSpeedUnit = (activity: Activity): SpeedUnit => resolveSpeedUnit(readStoredSettings(), activity);

/** Unité de distance effective d'une activité : celle choisie dans Réglages, sinon le kilomètre. */
export const effectiveDistanceUnit = (activity: Activity): DistanceUnit => {
  const unit = readStoredSettings().distanceUnits?.[activity.id];
  return isKnownDistanceUnit(unit) ? unit : 'km';
};

/** Retour de boucle d'une activité en planification, en fois l'aller ; `null` en voile. Utilisable hors composant. */
export const effectiveLoopReturnRatio = (activity: Activity): number | null => resolveLoopReturnRatio(readStoredSettings(), activity);

/** Bornes de la couleur de pente d'une activité : celles de Réglages, sinon le défaut. Utilisable hors composant. */
export const effectiveGradeRange = (activity: Activity): GradeRange => resolveGradeRange(readStoredSettings(), activity);

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

/** Type et poids du vélo d'une activité : ceux de Réglages, sinon le type par défaut et son poids. Utilisable hors composant. */
export const effectiveBikeSetup = (activity: Activity): { bikeType: BikeType; bikeKg: number } => {
  const stored = readStoredSettings();
  const bikeType = resolveBikeType(stored, activity);
  const weight = stored.bikeWeights?.[activity.id];
  return { bikeType, bikeKg: isValidBikeWeight(weight) ? weight : defaultBikeKg(activity, bikeType) };
};

/**
 * Types de voie cochés d'office pour une activité : réglés, sinon ceux de son
 * pré-réglage tant que son type de vélo est celui du pré-réglage, sinon
 * proposés selon le type de vélo (`presetWayTypes`).
 */
const resolveWayTypes = (stored: StoredSettings, activity: Activity): { wayTypes: WayType[]; overridden: boolean } => {
  const own = sanitizeWayTypes(stored.wayTypes?.[activity.id]);
  if (own) return { wayTypes: own, overridden: true };
  const bikeType = resolveBikeType(stored, activity);
  const preset = presetOf(activity).wayTypes;
  return {
    wayTypes: preset && bikeType === defaultBikeType(activity) ? preset : presetWayTypes(activityTreatment(activity), bikeType),
    overridden: false,
  };
};

/** Types de voie cochés d'office en planification ; aucun en voile. Utilisable hors composant. */
export const effectiveWayTypes = (activity: Activity): WayType[] => resolveWayTypes(readStoredSettings(), activity).wayTypes;

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

/** Niveau effectif d'une activité de course ou de vélo, `null` en voile. Utilisable hors composant. */
export const effectivePace = (activity: Activity): { level: PaceLevel; flatSpeedMs: number } | null => {
  const family = planningFamily(activity);
  if (!family) return null;
  const stored = readStoredSettings();
  const fallback = defaultPaceOf(activity);
  return resolvePace(family, stored.paceLevels?.[activity.id] ?? fallback.level, stored.customFlatSpeeds?.[activity.id] ?? fallback.customFlatSpeedMs);
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
type PerActivityKey = (typeof PER_ACTIVITY_KEYS)[number];
const PER_ACTIVITY_KEYS = [
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
const withoutOverrides = (stored: StoredSettings, id: string, keep: readonly PerActivityKey[] = []): StoredSettings => {
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

  // Écrits d'ailleurs pendant que la page est ouverte (compteur du fractionné,
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
      const range = stored.speedRanges?.[id];
      const grades = stored.gradeRanges?.[id];
      const autoPauseOverride = stored.autoPause?.[id];
      const bikeWeight = stored.bikeWeights?.[id];
      const carriedLoad = stored.carriedLoads?.[id];
      const paceLevel = stored.paceLevels?.[id];
      const customSpeed = stored.customFlatSpeeds?.[id];
      const liveFields = sanitizeLiveFields(stored.liveFields?.[id], activityTreatment(activity));
      const notificationFields = sanitizeLiveFields(stored.notificationFields?.[id], activityTreatment(activity), MAX_NOTIFICATION_FIELDS, 'notification', activityFamily(activity));
      const markGuide = sanitizeMarkGuide(stored.markGuide?.[id]);
      const ways = resolveWayTypes(stored, activity);
      return {
        activity,
        speedUnit: resolveSpeedUnit(stored, activity),
        isSpeedUnitOverridden: isKnownSpeedUnit(unit) && unit !== defaultSpeedUnitOf(activity),
        distanceUnit: isKnownDistanceUnit(distanceUnit) ? distanceUnit : 'km',
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
        customFlatSpeedMs: typeof customSpeed === 'number' && isFinite(customSpeed) ? customSpeed : defaultPaceOf(activity).customFlatSpeedMs,
        wayTypes: ways.wayTypes,
        isWayTypesOverridden: ways.overridden,
        loopReturnRatio: resolveLoopReturnRatio(stored, activity),
      };
    },
    [stored]
  );

  /** Écrit ou efface (`null`) un réglage d'une activité. */
  const setFor = useCallback(
    <F extends 'speedUnit' | 'distanceUnit' | 'activeThreshold' | 'terrainStepM' | 'speedRange' | 'gradeRange' | 'autoPause' | 'liveFields' | 'notificationFields' | 'markGuide' | 'foil' | 'pumping' | 'jumps' | 'heartRate' | 'cadence' | 'bikeType' | 'bikeWeight' | 'carriedLoad' | 'energyModel' | 'hrOffset' | 'gearLabels' | 'gearGroups' | 'tabs' | 'paceLevel' | 'customFlatSpeedMs' | 'wayTypes' | 'loopReturnRatio'>(
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
        case 'notificationFields': {
          const activity = findActivity(activities, id);
          if (!activity) return;
          const fields = value === null ? null : sanitizeLiveFields(value, activityTreatment(activity), MAX_NOTIFICATION_FIELDS, 'notification', activityFamily(activity));
          if (value !== null && fields === null) return;
          next.notificationFields = put(stored.notificationFields, fields);
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
          if (!activity || resolveFoil(stored, activity) === null) return;
          if (value !== null && typeof value !== 'boolean') return;
          next.foils = put(stored.foils, value as boolean | null);
          break;
        }
        case 'pumping': {
          const activity = findActivity(activities, id);
          if (!activity || resolvePumping(stored, activity) === null) return;
          if (value !== null && typeof value !== 'boolean') return;
          next.pumping = put(stored.pumping, value === true ? true : null);
          break;
        }
        case 'heartRate': {
          const activity = findActivity(activities, id);
          if (!activity) return;
          if (value !== null && typeof value !== 'boolean') return;
          // Seul l'écart à son défaut est rangé : décocher une ceinture pré-réglée range « non ».
          next.heartRate = put(stored.heartRate, value === null || value === defaultHeartRateOf(activity) ? null : value as boolean);
          break;
        }
        case 'cadence': {
          const activity = findActivity(activities, id);
          if (!activity || resolveCadence(stored, activity) === null) return;
          if (value !== null && typeof value !== 'boolean') return;
          next.cadence = put(stored.cadence, value === false ? false : null);
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
        case 'carriedLoad':
          if (value !== null && !isValidCarriedLoad(value)) return;
          next.carriedLoads = put(stored.carriedLoads, value === 0 ? null : value as number | null);
          break;
        case 'energyModel':
          if (value !== null && !isEnergyModel(value)) return;
          next.energyModels = put(stored.energyModels, value as EnergyModel | null);
          break;
        case 'hrOffset':
          if (value !== null && !isValidHrOffset(value)) return;
          next.hrOffsets = put(stored.hrOffsets, value as number | null);
          break;
        case 'gearLabels': {
          const labels = value === null ? null : sanitizeGearLabels(value);
          if (value !== null && !Array.isArray(value)) return;
          next.gearLabels = put(stored.gearLabels, labels);
          break;
        }
        case 'gearGroups': {
          const groups = value === null ? null : sanitizeGearGroups(value);
          if (value !== null && groups === null) return;
          next.gearGroups = put(stored.gearGroups, groups);
          break;
        }
        case 'tabs': {
          const choices = value === null ? null : sanitizeTabChoices(value);
          if (value !== null && choices === null) return;
          next.tabs = put(stored.tabs, choices === null ? null : { ...choices });
          break;
        }
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

  /** Remet tous les réglages d'une activité au défaut de son calcul ; le matériel enregistré reste. */
  const resetActivity = useCallback((id: string) => persist(resetOverrides(stored, id)), [persist, stored]);

  /** Ajoute une activité, rangée avec sa famille ; rend son identifiant, `null` si le nom est vide. */
  const addActivity = useCallback(
    (name: string, base: SportType, color: string, icon?: ActivityIconId): string | null => {
      const trimmed = name.trim();
      if (trimmed === '') return null;
      const id = newActivityId(trimmed, activities);
      const activity: Activity = { id, name: trimmed, base, color, ...(icon ? { icon } : {}) };
      persist({ ...stored, activities: insertActivity(activities, activity), activitiesVersion: ACTIVITIES_VERSION });
      return id;
    },
    [activities, persist, stored]
  );

  /** Renomme, recolore ou change l'icône d'une activité ; un nom vide est ignoré. */
  const updateActivity = useCallback(
    (id: string, patch: { name?: string; color?: string; icon?: ActivityIconId }) => {
      const name = patch.name?.trim();
      persist({
        ...stored,
        activitiesVersion: ACTIVITIES_VERSION,
        activities: activities.map((a) =>
          a.id === id
            ? { ...a, ...(name ? { name } : {}), ...(patch.color ? { color: patch.color } : {}), ...(patch.icon ? { icon: patch.icon } : {}) }
            : a
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

  /**
   * Cache ou ré-affiche une activité (§10, point 100) ; rien n'est effacé.
   * Ré-afficher une activité d'une famille cachée ré-affiche la famille.
   * Cacher la dernière activité visible de la dernière famille visible est refusé.
   */
  const setActivityHidden = useCallback(
    (id: string, hidden: boolean) => {
      const hiddenFamilies = readHiddenFamilies(stored);
      const target = activities.find((a) => a.id === id);
      if (!target) return;
      const nextActivities = activities.map((a) => (a.id === id ? withHidden(a, hidden) : a));
      const family = activityFamily(target);
      const next = withVisibility(stored, nextActivities, hidden ? hiddenFamilies : hiddenFamilies.filter((f) => f !== family));
      if (next) persist(next);
    },
    [activities, persist, stored]
  );

  /**
   * Cache ou ré-affiche une famille. Ré-afficher une famille dont toutes les
   * activités sont cachées les ré-affiche toutes ; sinon chacune garde son
   * choix. Cacher la dernière famille visible est refusé.
   */
  const setFamilyHidden = useCallback(
    (family: SportFamily, hidden: boolean) => {
      const hiddenFamilies = readHiddenFamilies(stored);
      if (hidden) {
        const next = withVisibility(stored, activities, hiddenFamilies.includes(family) ? hiddenFamilies : [...hiddenFamilies, family]);
        if (next) persist(next);
        return;
      }
      const own = activitiesOfFamily(activities, family);
      const allHidden = own.length > 0 && own.every((a) => a.hidden);
      const nextActivities = allHidden ? activities.map((a) => (activityFamily(a) === family ? withHidden(a, false) : a)) : activities;
      const next = withVisibility(stored, nextActivities, hiddenFamilies.filter((f) => f !== family));
      if (next) persist(next);
    },
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

  const stopHoldMs = isValidStopHold(stored.stopHoldMs) ? stored.stopHoldMs : DEFAULT_STOP_HOLD_MS;
  /** Durée de l'appui long qui arrête l'enregistrement, en millisecondes (0 : simple appui) ; `null` revient au défaut. */
  const setStopHoldMs = useCallback(
    (value: number | null) => {
      if (value !== null && !isValidStopHold(value)) return;
      const next: StoredSettings = { ...stored };
      if (value === null) delete next.stopHoldMs;
      else next.stopHoldMs = value;
      persist(next);
    },
    [persist, stored]
  );

  const beepSound = isBeepSound(stored.beepSound) ? stored.beepSound : DEFAULT_BEEP_SOUND;
  /**
   * Son de tous les bips ; le choix est toujours écrit (26/10), pour qu'un
   * changement du défaut ne touche pas un son choisi.
   */
  const setBeepSound = useCallback(
    (value: BeepSound) => {
      persist({ ...stored, beepSound: value });
    },
    [persist, stored]
  );

  return {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
    stopHoldMs, setStopHoldMs, beepSound, setBeepSound, hiddenFamilies: readHiddenFamilies(stored), setActivityHidden, setFamilyHidden,
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
  if (found && activityFamily(found) === family && !found.hidden) return found;
  // Cachée : la première visible de la famille, sinon celle retenue tout de même (§10, point 100).
  const own = activitiesOfFamily(activities, family);
  return own.find((a) => !a.hidden) ?? (found && activityFamily(found) === family ? found : own[0]) ?? baseActivity(FAMILY_BASE[family]);
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

  /** Activités proposées par le module : les visibles de la famille, plus l'activité courante (de base, ou cachée). */
  const activityOptions = useMemo(() => {
    const own = activitiesOfFamily(activities, family).filter((a) => !a.hidden || a.id === id);
    return own.some((a) => a.id === id) ? own : [...own, activity];
  }, [activities, family, activity, id]);

  const persist = useCallback((next: StoredSettings) => {
    setStored(next);
    writeStored(next);
  }, []);

  // Écrits d'ailleurs pendant que le module est ouvert (Réglages, réglages repris du dossier) : suivis,
  // pour afficher les réglages du moment et ne pas les défaire au prochain changement (E-B6).
  useEffect(() => jsonStore.subscribe((key) => {
    if (key === STORAGE_KEY) setStored(readStoredSettings());
  }), []);

  /** Change l'activité du module ; un identifiant d'une autre famille est ignoré. */
  const setActivity = useCallback(
    (nextId: string) => {
      const next = findActivity(activities, nextId);
      if (!next || activityFamily(next) !== family) return;
      // Relus à l'instant : une écriture d'ailleurs, faite depuis le dernier rendu, est gardée.
      const current = readStoredSettings();
      persist({ ...current, moduleActivity: { ...current.moduleActivity, [family]: next.id } });
    },
    [persist, activities, family]
  );

  /** Support sur foil de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
  const foil = resolveFoil(stored, activity) ?? false;
  /** Pumping foil de l'activité, réglé dans Réglages ; une session peut avoir le sien. */
  const pumping = resolvePumping(stored, activity) ?? false;

  /**
   * Seuil réglé ou pré-réglé pour l'activité (0 : aucun seuil réglé, arrêts complets ôtés d'office),
   * `null` sans l'un ni l'autre : en voile, la suggestion selon l'allure ; en surf, le défaut dépend du
   * foil de la session.
   */
  const thresholdOverride = resolveThresholdOverride(stored, activity);
  const activeThreshold = thresholdOverride ?? defaultActiveThresholdOf(profile, foil);
  const isThresholdOverridden = thresholdOverride !== null;

  /** Pas des échantillons d'altitude du terrain, réglé dans Réglages ; `null` en voile. */
  const terrainStepM = resolveTerrainStepM(stored, activity);

  // Lecture seule : les unités se choisissent dans Réglages, par activité.
  const speedUnit = resolveSpeedUnit(stored, activity);
  const storedDistanceUnit = stored.distanceUnits?.[id];
  const distanceUnit: DistanceUnit = isKnownDistanceUnit(storedDistanceUnit) ? storedDistanceUnit : 'km';

  // Lecture seule ici : les bornes de l'activité se règlent dans Réglages, celles
  // d'une trace dans sa fiche (brouillon du module).
  const speedRange = resolveSpeedRange(stored, activity);
  const gradeRange = resolveGradeRange(stored, activity);

  // Vélo : type et poids, réglés dans Réglages.
  const bikeType = resolveBikeType(stored, activity);
  const storedBikeWeight = stored.bikeWeights?.[id];
  const bikeWeightKg = isValidBikeWeight(storedBikeWeight) ? storedBikeWeight : defaultBikeKg(activity, bikeType);
  // Course : charge portée, réglée dans Réglages.
  const storedLoad = stored.carriedLoads?.[id];
  const carriedLoadKg = isValidCarriedLoad(storedLoad) ? storedLoad : 0;
  // À pied : modèle de dépense, réglé dans Réglages.
  const energyModel = resolveEnergyModel(stored, activity);
  const gearLabels = useMemo(() => resolveGearLabels(stored, id), [stored, id]);
  const gearGroups = useMemo(() => resolveGearGroups(stored, id), [stored, id]);
  // Cardio : décalage des seuils S1 et S2, réglé dans Réglages.
  const hrOffsetBpm = resolveHrOffset(stored, activity);

  return {
    activity,
    activityOptions,
    setActivity,
    sport,
    profile,
    activeThreshold,
    thresholdOverride,
    isThresholdOverridden,
    terrainStepM,
    speedUnit,
    distanceUnit,
    /** Bornes du dégradé réglées pour l'activité dans Réglages ou pré-réglées, ou `null` pour le défaut du module. */
    speedRange,
    /** Bornes de la couleur de pente de la courbe d'altitude, réglées dans Réglages ou par défaut. */
    gradeRange,
    /** Bornes du dégradé à défaut de réglage, propres au traitement du calcul. */
    defaultSpeedRange: defaultSpeedRangeOf(activity),
    bikeType,
    /** Poids du vélo effectif, en kg (celui du type à défaut de réglage). */
    bikeWeightKg,
    isBikeWeightOverridden: isValidBikeWeight(storedBikeWeight),
    /** Charge portée de l'activité, en kg (0 sans réglage) ; une session peut avoir la sienne. */
    carriedLoadKg,
    /** Modèle de dépense à pied de l'activité : course (Minetti) ou marche (Pandolf). */
    energyModel,
    /** Intitulés des deux champs de matériel des notes (hors voile), réglés dans Réglages ou par défaut. */
    gearLabels,
    /** Matériel enregistré de l'activité, choisi par groupe dans l'onglet du matériel ; `null` : option coupée ou aucun groupe. */
    gearGroups,
    /** Décalage des seuils cardio de l'activité, en bpm. */
    hrOffsetBpm,
    foil,
    pumping,
  };
};
