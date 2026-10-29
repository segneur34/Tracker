import type { SpeedRangeMs } from './speedGradient';
import { DEFAULT_RECORDING } from './sportProfiles';
import type { SportType } from './types';
import { kmhToMs, knotsToMs, type SpeedUnit } from './units';
import type { BikeType } from '../cycling/energy';
import type { PaceLevel } from '../planning/duration';
import type { WayType } from '../planning/brouterProfile';
import type { IntervalPreset } from '../recording/intervalTimer';
import type { JumpSettings } from '../recording/jumpSettings';
import type { LiveFieldKey } from '../recording/liveFields';
import type { MarkGuideSettings } from '../recording/markGuide';
import type { EnergyModel } from '../running/energy';
import type { GradeRange } from '../running/runningAnalytics';

/**
 * Pré-réglages des activités (21/10) : ce que Réglages montre comme « défaut »
 * tant que l'utilisateur n'a rien changé, repris du téléphone de l'utilisateur
 * (sa référence en cas de doute). Un champ absent garde le défaut du calcul
 * (`sportProfiles.ts`) ; une surcharge de Réglages prime toujours.
 */
export interface ActivityPreset {
  /** Seuil d'activité, dans l'unité du profil du calcul (nœuds en voile, km/h ailleurs) ; 0 : aucun seuil réglé, arrêts complets ôtés d'office (`stillThreshold`). */
  threshold?: number;
  speedUnit?: SpeedUnit;
  /** Bornes de couleur de la trace, fixes : en voile, elles remplacent la suggestion tirée de l'allure. */
  speedRangeMs?: SpeedRangeMs;
  gradeRange?: GradeRange;
  autoPause?: { speedMs: number; delayS: number };
  liveFields?: LiveFieldKey[];
  notificationFields?: LiveFieldKey[];
  markGuide?: MarkGuideSettings;
  jumps?: JumpSettings;
  heartRate?: boolean;
  bikeType?: BikeType;
  bikeKg?: number;
  wayTypes?: WayType[];
  terrainStepM?: number;
  /** Onglets des analyses montrés ou cachés à l'écart de ceux du module. */
  tabs?: Record<string, boolean>;
  /** Temps estimé des itinéraires : niveau, et vitesse sur le plat du niveau « Personnalisé », en m/s. */
  pace?: { level: PaceLevel; customFlatSpeedMs: number | null };
  /** Décalage des seuils cardio par rapport à la course, en bpm. */
  hrThresholdOffsetBpm?: number;
  /** Modèle de dépense à pied (réglage « Dépense ») ; absent : course. */
  energyModel?: EnergyModel;
}

/**
 * Notification de l'Entraînement (26/10) : l'étape (répétition du compteur,
 * palier d'un test) d'office, avec la FC (Q9, 28/10), dans la limite des deux chiffres.
 */
const TRAINING_NOTIFICATION: LiveFieldKey[] = ['step', 'heartRate'];

/** Pause automatique à la vitesse du calcul (`DEFAULT_RECORDING`), au bout de ce temps. */
const pauseAfter = (delayS: number) => ({ speedMs: DEFAULT_RECORDING.autoPauseSpeedMs, delayS });

/** Fractionné et tests à pied : les mêmes réglages. */
const RUN_TRAINING: ActivityPreset = {
  threshold: 0,
  speedUnit: 'kmh',
  speedRangeMs: { minMs: kmhToMs(4), maxMs: kmhToMs(20) },
  gradeRange: { min: 0, max: 0.1 },
  liveFields: ['speed', 'average', 'heartRate', 'heartRateZone'],
  notificationFields: TRAINING_NOTIFICATION,
  heartRate: true,
};

/** Wingfoil, que la planche reprend : 8 nœuds partout (seuil et bas de la couleur), sans suggestion selon l'allure. */
const WING: ActivityPreset = {
  threshold: 8,
  speedRangeMs: { minMs: knotsToMs(8), maxMs: knotsToMs(24) },
  autoPause: { speedMs: kmhToMs(1.5), delayS: 60 },
  liveFields: ['speed', 'average', 'recentTopShort', 'distance'],
  markGuide: {
    curve: [{ distanceM: 5, intervalMs: 100 }, { distanceM: 25, intervalMs: 530 }, { distanceM: 34, intervalMs: 950 }],
    vibrate: true,
  },
  jumps: { enabled: true, placement: 'poitrine', minHeightM: 0.5 },
};

/** Par calcul : toute activité faite sur lui, créée par l'utilisateur comprise. */
const BASE_PRESETS: Partial<Record<SportType, ActivityPreset>> = {
  wingfoil: WING,
  windsurf: WING,
  running: {
    threshold: 0,
    speedUnit: 'kmh',
    speedRangeMs: { minMs: kmhToMs(1), maxMs: kmhToMs(13) },
    gradeRange: { min: 0, max: 0.17 },
    autoPause: { speedMs: kmhToMs(0.5), delayS: 20 },
    liveFields: ['speed', 'average', 'gain', 'remaining'],
    heartRate: true,
    wayTypes: ['sentier', 'piste'],
    terrainStepM: 5,
    tabs: { sauts: false },
  },
  cycling: {
    threshold: 0,
    speedRangeMs: { minMs: kmhToMs(8), maxMs: kmhToMs(45) },
    gradeRange: { min: 0, max: 0.1 },
    autoPause: pauseAfter(30),
    liveFields: ['speed', 'average', 'remainingTime', 'distance'],
    heartRate: true,
    bikeKg: 12,
    wayTypes: ['route', 'grandeRoute'],
  },
  'run-intervals': RUN_TRAINING,
  'run-test': RUN_TRAINING,
  'bike-intervals': {
    threshold: 0,
    speedRangeMs: { minMs: kmhToMs(10), maxMs: kmhToMs(30) },
    gradeRange: { min: 0, max: 0.1 },
    liveFields: ['speed', 'average', 'heartRate', 'heartRateZone'],
    notificationFields: TRAINING_NOTIFICATION,
  },
  // Muscu (lot I du 25/10) : la ceinture d'office (obligatoire), la FC et la durée en direct,
  // l'étape du compteur et la FC dans la notification (ni vitesse ni distance sans position).
  muscu: {
    liveFields: ['heartRate', 'heartRateZone', 'averageHeartRate', 'duration'],
    notificationFields: ['step', 'heartRate'],
    heartRate: true,
  },
};

/** Par activité de départ (`core/activities.ts`) : remplace en entier celui de son calcul. */
const ACTIVITY_PRESETS: Partial<Record<string, ActivityPreset>> = {
  'a-marche': {
    // Aucun seuil (28/10) : le plancher d'arrêt ôte déjà les arrêts complets, comme en course.
    threshold: 0,
    speedUnit: 'kmh',
    speedRangeMs: { minMs: kmhToMs(1), maxMs: kmhToMs(8) },
    gradeRange: { min: 0, max: 0.2 },
    autoPause: { speedMs: kmhToMs(0.5), delayS: 20 },
    liveFields: ['speed', 'average', 'recentDistanceSpeed', 'heartRate'],
    notificationFields: ['speed', 'heartRate'],
    wayTypes: ['sentier', 'piste'],
    terrainStepM: 5,
    pace: { level: 'perso', customFlatSpeedMs: kmhToMs(5) },
    // Pas de phase de vol, moins de muscles à la fois que la course (Gemini, 25/10).
    hrThresholdOffsetBpm: -4,
    // Pandolf, pas Minetti (28/10).
    energyModel: 'marche',
  },
  'a-gravel': {
    threshold: 0,
    speedRangeMs: { minMs: kmhToMs(5), maxMs: kmhToMs(40) },
    autoPause: pauseAfter(20),
    liveFields: ['speed', 'average', 'remaining', 'distance'],
    bikeType: 'gravel',
    bikeKg: 13,
    wayTypes: ['piste', 'route', 'grandeRoute'],
    terrainStepM: 5,
  },
  'a-vtt': {
    threshold: 0,
    autoPause: pauseAfter(20),
    liveFields: ['speed', 'average', 'gain', 'remaining'],
    bikeType: 'vtt',
    terrainStepM: 5,
    tabs: { tops: false },
  },
};

const NO_PRESET: ActivityPreset = {};

/** Pré-réglage d'une activité : le sien si c'est une activité de départ qui en a un, sinon celui de son calcul. */
export const presetOf = (activity: { id: string; base: SportType }): ActivityPreset =>
  ACTIVITY_PRESETS[activity.id] ?? BASE_PRESETS[activity.base] ?? NO_PRESET;

/** Calculs dont les activités ont un pré-réglage (effacement une fois à la mise à jour, `PRESET_RESETS`). */
export const PRESET_BASES = Object.keys(BASE_PRESETS) as SportType[];

/** Séances du compteur gardées au départ, communes aux activités. */
export const DEFAULT_INTERVAL_PRESETS: IntervalPreset[] = [
  { id: 's1', name: '20 × 10-10', workout: { reps: 20, workS: 10, restS: 10 } },
  { id: 's2', name: '20 × 20-20', workout: { reps: 20, workS: 20, restS: 20 } },
  { id: 's3', name: '20 × 30-30', workout: { reps: 20, workS: 30, restS: 30 } },
];
