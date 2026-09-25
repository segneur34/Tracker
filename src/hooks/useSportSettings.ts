import { useCallback, useMemo, useState } from 'react';
import {
  FAMILY_BASE, activitiesOfFamily, activityFamily, baseActivity, findActivity, newActivityId, readActivities, type Activity,
} from '../core/activities';
import { ELEVATION_PRESETS, getSportProfile, type ElevationProfile, type RecordingProfile, type SportFamily } from '../core/sportProfiles';
import { isValidSpeedRange } from '../core/speedGradient';
import type { SportType } from '../core/types';
import { DISTANCE_UNIT_LABEL, SPEED_UNIT_LABEL, type DistanceUnit, type SpeedUnit } from '../core/units';
import { jsonStore } from '../platform/storage';
import { DEFAULT_GRADE_RANGE, isValidGradeRange, type GradeRange } from '../running/runningAnalytics';

/** Taille du texte des tableaux et synthèses, en facteur d'échelle. */
export type TextScale = 'compact' | 'normal' | 'large';

export const TEXT_SCALE_FACTOR: Record<TextScale, number> = {
  compact: 0.85,
  normal: 1,
  large: 1.25,
};

export const TEXT_SCALE_LABEL: Record<TextScale, string> = {
  compact: 'Compact',
  normal: 'Normal',
  large: 'Grand',
};

export type TerrainType = keyof typeof ELEVATION_PRESETS;

export const TERRAIN_LABEL: Record<TerrainType, string> = {
  route: 'Route / chemin roulant',
  trail: 'Trail / montagne',
};

/** Unités d'affichage proposées selon la famille de support. */
export const SAILING_UNITS: SpeedUnit[] = ['kn', 'kmh', 'ms'];
export const RUNNING_UNITS: SpeedUnit[] = ['kmh', 'ms', 'minkm'];

/**
 * Réglages par activité (`core/activities.ts`) : unité, seuil d'activité,
 * taille du texte, terrain, couleurs de trace, pause automatique, rangés sous
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
  /** Surcharges du seuil d'activité, dans l'unité du profil du calcul. */
  thresholds?: ByActivity<number>;
  /** Terrain retenu pour le dénivelé. */
  terrains?: ByActivity<TerrainType>;
  /** Unité d'affichage des vitesses. */
  speedUnits?: ByActivity<SpeedUnit>;
  /** Unité d'affichage des distances ; absente : kilomètres. */
  distanceUnits?: ByActivity<DistanceUnit>;
  /** Taille du texte. */
  textScales?: ByActivity<TextScale>;
  /** Bornes du dégradé de couleur de la trace, en m/s. */
  speedRanges?: ByActivity<{ minMs: number; maxMs: number }>;
  /** Bornes de la couleur de pente de la courbe d'altitude, en fraction (course). */
  gradeRanges?: ByActivity<GradeRange>;
  /** Surcharge de la pause automatique à l'enregistrement. */
  autoPause?: ByActivity<{ speedMs: number; delayS: number }>;
  /** Durée de l'appui long sur le bouton rond qui met en pause, en millisecondes. */
  longPressMs?: number;
}

/** Appui long par défaut : 2 s, assez pour ne pas partir d'un geste involontaire. */
export const DEFAULT_LONG_PRESS_MS = 2000;

const isValidLongPress = (value: unknown): value is number =>
  typeof value === 'number' && isFinite(value) && value >= 300 && value <= 10_000;

export const isKnownTerrain = (value: unknown): value is TerrainType =>
  typeof value === 'string' && value in ELEVATION_PRESETS;

export const isKnownSpeedUnit = (value: unknown): value is SpeedUnit =>
  typeof value === 'string' && value in SPEED_UNIT_LABEL;

export const isKnownDistanceUnit = (value: unknown): value is DistanceUnit =>
  typeof value === 'string' && value in DISTANCE_UNIT_LABEL;

export const isKnownTextScale = (value: unknown): value is TextScale =>
  typeof value === 'string' && value in TEXT_SCALE_FACTOR;

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

/**
 * Réglage d'enregistrement effectif d'une activité : le profil de son calcul,
 * sauf surcharge de la pause automatique. Utilisable hors composant.
 */
export const effectiveRecordingProfile = (activity: Activity): RecordingProfile => {
  const profile = getSportProfile(activity.base);
  const override = readStoredSettings().autoPause?.[activity.id];
  return override ? { ...profile.recording, autoPauseSpeedMs: override.speedMs, autoPauseDelayS: override.delayS } : profile.recording;
};

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

/** Bornes de la couleur de pente d'une activité : celles de Réglages, sinon le défaut. Utilisable hors composant. */
export const effectiveGradeRange = (activity: Activity): GradeRange => {
  const range = readStoredSettings().gradeRanges?.[activity.id];
  return range && isValidGradeRange(range) ? range : DEFAULT_GRADE_RANGE;
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
  textScale: TextScale;
  terrain: TerrainType;
  speedRange: { minMs: number; maxMs: number } | null;
  /** Bornes de la couleur de pente, ou `null` pour le défaut. */
  gradeRange: GradeRange | null;
  /** Pause automatique effective à l'enregistrement (m/s, secondes). */
  autoPause: { speedMs: number; delayS: number };
  isAutoPauseOverridden: boolean;
}

/** Tables de réglages rangées par activité. */
const PER_ACTIVITY_KEYS = ['thresholds', 'terrains', 'speedUnits', 'distanceUnits', 'textScales', 'speedRanges', 'gradeRanges', 'autoPause'] as const;

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

  const view = useCallback(
    (activity: Activity): SportSettingsView => {
      const id = activity.id;
      const profile = getSportProfile(activity.base);
      const unit = stored.speedUnits?.[id];
      const distanceUnit = stored.distanceUnits?.[id];
      const threshold = stored.thresholds?.[id];
      const scale = stored.textScales?.[id];
      const terrain = stored.terrains?.[id];
      const range = stored.speedRanges?.[id];
      const grades = stored.gradeRanges?.[id];
      const autoPauseOverride = stored.autoPause?.[id];
      return {
        activity,
        speedUnit: isKnownSpeedUnit(unit) ? unit : profile.speedUnit,
        isSpeedUnitOverridden: isKnownSpeedUnit(unit),
        distanceUnit: isKnownDistanceUnit(distanceUnit) ? distanceUnit : 'km',
        isDistanceUnitOverridden: isKnownDistanceUnit(distanceUnit),
        activeThreshold: threshold ?? profile.defaultActiveThreshold,
        isThresholdOverridden: threshold !== undefined,
        textScale: isKnownTextScale(scale) ? scale : 'normal',
        terrain: isKnownTerrain(terrain) ? terrain : 'route',
        speedRange: range && isValidSpeedRange(range) ? range : null,
        gradeRange: grades && isValidGradeRange(grades) ? grades : null,
        autoPause: autoPauseOverride ?? { speedMs: profile.recording.autoPauseSpeedMs, delayS: profile.recording.autoPauseDelayS },
        isAutoPauseOverridden: autoPauseOverride !== undefined,
      };
    },
    [stored]
  );

  /** Écrit ou efface (`null`) un réglage d'une activité. */
  const setFor = useCallback(
    <F extends 'speedUnit' | 'distanceUnit' | 'activeThreshold' | 'textScale' | 'terrain' | 'speedRange' | 'gradeRange' | 'autoPause'>(
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
        case 'textScale':
          if (value !== null && !isKnownTextScale(value)) return;
          next.textScales = put(stored.textScales, value as TextScale | null);
          break;
        case 'terrain':
          if (value !== null && !isKnownTerrain(value)) return;
          next.terrains = put(stored.terrains, value as TerrainType | null);
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
      }
      persist(next);
    },
    [persist, stored]
  );

  /** Remet tous les réglages d'une activité au défaut de son calcul. */
  const resetActivity = useCallback((id: string) => persist(withoutOverrides(stored, id)), [persist, stored]);

  /** Ajoute une activité ; rend son identifiant, `null` si le nom est vide. */
  const addActivity = useCallback(
    (name: string, base: SportType, color: string): string | null => {
      const trimmed = name.trim();
      if (trimmed === '') return null;
      const id = newActivityId(trimmed, activities);
      persist({ ...stored, activities: [...activities, { id, name: trimmed, base, color }] });
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
    (id: string) => persist({ ...withoutOverrides(stored, id), activities: activities.filter((a) => a.id !== id) }),
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

  return {
    activities, view, setFor, resetActivity, addActivity, updateActivity, removeActivity, longPressMs, setLongPressMs,
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

  const storedTerrain = stored.terrains?.[id];
  const terrain: TerrainType = isKnownTerrain(storedTerrain) ? storedTerrain : 'route';
  const elevationProfile = ELEVATION_PRESETS[terrain];

  const setTerrain = useCallback(
    (next: TerrainType) => {
      if (!isKnownTerrain(next)) return;
      persist({ ...stored, terrains: { ...stored.terrains, [id]: next } });
    },
    [persist, id, stored]
  );

  // Lecture seule : unité et taille du texte se choisissent dans Réglages, par activité.
  const storedUnit = stored.speedUnits?.[id];
  const speedUnit: SpeedUnit = isKnownSpeedUnit(storedUnit) ? storedUnit : profile.speedUnit;
  const storedDistanceUnit = stored.distanceUnits?.[id];
  const distanceUnit: DistanceUnit = isKnownDistanceUnit(storedDistanceUnit) ? storedDistanceUnit : 'km';
  const storedScale = stored.textScales?.[id];
  const textScale: TextScale = isKnownTextScale(storedScale) ? storedScale : 'normal';

  // Lecture seule ici : les bornes de l'activité se règlent dans Réglages, celles
  // d'une trace dans sa fiche (brouillon du module).
  const storedRange = stored.speedRanges?.[id];
  const speedRange = storedRange && isValidSpeedRange(storedRange) ? storedRange : null;
  const storedGradeRange = stored.gradeRanges?.[id];
  const gradeRange: GradeRange = storedGradeRange && isValidGradeRange(storedGradeRange) ? storedGradeRange : DEFAULT_GRADE_RANGE;

  return {
    activity,
    activityOptions,
    setActivity,
    sport,
    profile,
    activeThreshold,
    isThresholdOverridden,
    terrain,
    setTerrain,
    elevationProfile,
    speedUnit,
    distanceUnit,
    textScale,
    /** Bornes du dégradé réglées pour l'activité dans Réglages, ou `null` pour le défaut du module. */
    speedRange,
    /** Bornes de la couleur de pente de la courbe d'altitude, réglées dans Réglages ou par défaut. */
    gradeRange,
  };
};
