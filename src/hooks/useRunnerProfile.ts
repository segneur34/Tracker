import { useCallback } from 'react';
import { isActivityIconId, type ActivityIconId } from '../core/activityIcons';
import type { Activity } from '../core/activities';
import { heartRateZones, isValidThresholds, type HeartRateZones } from '../core/heartRate';
import { getSportProfile, type HeartRateProfile } from '../core/sportProfiles';
import { ROOT_DEFAULTS, type RootSettings } from '../library/rootGrowth';
import { effectiveHrOffset } from './useSportSettings';
import { readStoredRecord, useStoredRecord } from './useStoredRecord';

/**
 * Photo du Profil : un dessin d'activité, ou une image importée, recadrée au
 * carré et réduite (data URL JPEG, `readPickedImage`). Elle voyage avec le
 * profil dans le fichier de réglages.
 */
export type RunnerAvatar = { kind: 'dessin'; icon: ActivityIconId } | { kind: 'photo'; dataUrl: string };

/** Taille d'une photo importée, en pixels de côté. */
export const AVATAR_PHOTO_PX = 256;
/** Au-delà, une photo n'est pas reprise : elle n'a pas été réduite par l'application. */
const AVATAR_PHOTO_MAX_CHARS = 200_000;

/** D'où vient une FC max ou de repos : un test guidé, une séance (« La retenir » du cardio), ou la saisie ; `atMs` : le jour du test ou de la séance. */
export interface HrSource {
  kind: 'test' | 'seance' | 'saisie';
  atMs: number | null;
}

/**
 * Profil du coureur, persistant dans le navigateur. Ces caractéristiques
 * serviront aux estimations de coût énergétique et aux zones d'effort : la
 * dépense d'une montée dépend d'abord de la masse déplacée, les zones
 * cardiaques des fréquences de repos et maximale.
 */
export interface RunnerProfile {
  /** Nom ou pseudo, affiché en titre du Profil et au pied de l'image partagée. */
  name: string | null;
  /** Photo du Profil ; `null` : le dessin du sport préféré. */
  avatar: RunnerAvatar | null;
  /** Masse en kilogrammes. */
  weightKg: number | null;
  /** Taille en centimètres. */
  heightCm: number | null;
  /** Année de naissance. */
  birthYear: number | null;
  sex: 'f' | 'm' | null;
  /** Fréquence cardiaque maximale, en battements par minute. */
  hrMax: number | null;
  /** Son origine ; absente sur un profil d'avant le 25/10 : saisie. */
  hrMaxSource: HrSource | null;
  /** Fréquence cardiaque de repos, en battements par minute. */
  hrRest: number | null;
  hrRestSource: HrSource | null;
  /** Seuils S1 et S2 saisis à la main (test en laboratoire), à pied, en bpm ; `null` : calculés. */
  hrThresholds: number[] | null;
  /** Bornes des zones saisies avant les seuils (avant le 25/10), relues seulement pour en tirer S1 et S2 ; effacées à la saisie des seuils. */
  hrZones: number[] | null;
  /** Économie de course sur le plat, en ml d'O₂ par kg et par km (test en laboratoire). */
  economyMlKgKm: number | null;
  /** Racine du Profil (`library/rootGrowth.ts`) : minutes qui font tenir une période ; `null` : celles de `ROOT_DEFAULTS`. */
  rootGoalMin: number | null;
  /** Durée d'une période de la racine, en jours. */
  rootPeriodDays: number | null;
  /** Périodes tenues pour que la racine entoure tous les cadres. */
  rootGrowthPeriods: number | null;
  /** Périodes manquées pour qu'elle perde un tour complet. */
  rootLossPeriods: number | null;
}

export const EMPTY_RUNNER_PROFILE: RunnerProfile = {
  name: null,
  avatar: null,
  weightKg: null,
  heightCm: null,
  birthYear: null,
  sex: null,
  hrMax: null,
  hrMaxSource: null,
  hrRest: null,
  hrRestSource: null,
  hrThresholds: null,
  hrZones: null,
  economyMlKgKm: null,
  rootGoalMin: null,
  rootPeriodDays: null,
  rootGrowthPeriods: null,
  rootLossPeriods: null,
};

/** Plages plausibles de chaque champ numérique. */
export type RunnerNumberField = Exclude<keyof RunnerProfile, 'name' | 'avatar' | 'sex' | 'hrZones' | 'hrThresholds' | 'hrMaxSource' | 'hrRestSource'>;
type NumberField = RunnerNumberField;

/** Longueur maximale du nom ou pseudo. */
export const RUNNER_NAME_MAX = 40;

/** Nom ou pseudo à afficher, `null` s'il n'est pas saisi ; relu avec contrôle de type (fichier de réglages importé). */
export const runnerName = (profile: Pick<RunnerProfile, 'name'>): string | null => {
  const raw: unknown = profile.name;
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, RUNNER_NAME_MAX).trim();
  return name === '' ? null : name;
};

/** Photo du Profil, `null` sans choix ; relue avec contrôle de type (fichier de réglages importé, ancien profil). */
export const runnerAvatar = (profile: Partial<Pick<RunnerProfile, 'avatar'>>): RunnerAvatar | null => {
  const raw: unknown = profile.avatar;
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, icon, dataUrl } = raw as Record<string, unknown>;
  if (kind === 'dessin' && isActivityIconId(icon)) return { kind, icon };
  if (kind === 'photo' && typeof dataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)
    && dataUrl.length <= AVATAR_PHOTO_MAX_CHARS) return { kind, dataUrl };
  return null;
};

const BOUNDS: Record<NumberField, [number, number]> = {
  weightKg: [20, 300],
  heightCm: [100, 250],
  birthYear: [1900, 2100],
  hrMax: [100, 250],
  hrRest: [25, 120],
  economyMlKgKm: [120, 320],
  rootGoalMin: [1, 600],
  rootPeriodDays: [1, 28],
  rootGrowthPeriods: [1, 200],
  rootLossPeriods: [1, 400],
};

/**
 * Réglages de la racine du Profil, ceux de `ROOT_DEFAULTS` à défaut ; relus
 * avec contrôle (fichier de réglages importé) : une valeur hors plage est
 * ignorée, la durée d'une période et le tour se comptent en entiers.
 */
export const runnerRootSettings = (
  profile: Partial<Pick<RunnerProfile, 'rootGoalMin' | 'rootPeriodDays' | 'rootGrowthPeriods' | 'rootLossPeriods'>>
): RootSettings => {
  const read = (field: 'rootGoalMin' | 'rootPeriodDays' | 'rootGrowthPeriods' | 'rootLossPeriods', fallback: number): number => {
    const raw: unknown = profile[field];
    const [lo, hi] = BOUNDS[field];
    return typeof raw === 'number' && isFinite(raw) && raw >= lo && raw <= hi ? raw : fallback;
  };
  return {
    goalMin: read('rootGoalMin', ROOT_DEFAULTS.goalMin),
    periodDays: Math.round(read('rootPeriodDays', ROOT_DEFAULTS.periodDays)),
    growthPeriods: Math.round(read('rootGrowthPeriods', ROOT_DEFAULTS.growthPeriods)),
    lossPeriods: read('rootLossPeriods', ROOT_DEFAULTS.lossPeriods),
  };
};

/** Champs que le pop-up de l'accueil demande tant qu'ils manquent ; la FC max et la FC repos viennent des tests. */
export const PROFILE_PROMPT_FIELDS = ['name', 'birthYear', 'sex', 'weightKg', 'heightCm'] as const;
export type ProfilePromptField = (typeof PROFILE_PROMPT_FIELDS)[number];

/** Une valeur numérique saisie et dans sa plage (relue avec contrôle : fichier de réglages importé). */
const validNumber = (field: NumberField, raw: unknown): boolean => {
  const [lo, hi] = BOUNDS[field];
  return typeof raw === 'number' && isFinite(raw) && raw >= lo && raw <= hi;
};

/** Champs du pop-up qui manquent au profil, dans leur ordre ; vide : le profil est rempli. */
export const missingProfileFields = (profile: Partial<RunnerProfile>): ProfilePromptField[] =>
  PROFILE_PROMPT_FIELDS.filter((field) => {
    switch (field) {
      case 'name': return runnerName({ name: profile.name ?? null }) === null;
      case 'sex': return profile.sex !== 'f' && profile.sex !== 'm';
      default: return !validNumber(field, profile[field]);
    }
  });

/**
 * Le pop-up du profil s'ouvre-t-il sur l'accueil ? Dans l'application seulement,
 * une fois par lancement, tant qu'un champ manque, et jamais par-dessus la carte
 * de la mémoire ou celle des autorisations (il attend alors le lancement suivant).
 */
export const shouldPromptProfile = ({ native, missing, askedThisLaunch, otherCardShown }: {
  native: boolean;
  missing: readonly ProfilePromptField[];
  askedThisLaunch: boolean;
  otherCardShown: boolean;
}): boolean => native && missing.length > 0 && !askedThisLaunch && !otherCardShown;

/**
 * Ordre de l'accueil : la mémoire, puis les autorisations, puis le profil. Le pop-up
 * n'est posé qu'une fois les deux décidées (`permissionsShown` : `null` tant que les
 * autorisations ne sont pas lues) ; `otherCardShown` : l'une d'elles est à l'écran.
 */
export const profilePromptGate = ({ memoryNeedsAction, memoryReady, permissionsShown }: {
  memoryNeedsAction: boolean;
  memoryReady: boolean;
  permissionsShown: boolean | null;
}): { mount: boolean; otherCardShown: boolean } => ({
  mount: memoryNeedsAction || (memoryReady && permissionsShown !== null),
  otherCardShown: memoryNeedsAction || permissionsShown === true,
});

const NAMESPACE = 'tracker.runnerProfile';
const KEY = 'me';

/** Profil du pratiquant, hors composant (statistiques du direct). */
export const readRunnerProfile = (): RunnerProfile => readStoredRecord(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

/** Âge à la date du jour, si l'année de naissance est connue. */
export const runnerAge = (profile: RunnerProfile, nowMs = Date.now()): number | null =>
  profile.birthYear === null ? null : new Date(nowMs).getFullYear() - profile.birthYear;

/** Origine de la FC max ou de repos, `null` sans valeur ; relue avec contrôle (fichier de réglages importé, ancien profil : saisie). */
export const runnerHrSource = (profile: Partial<RunnerProfile>, field: 'hrMax' | 'hrRest'): HrSource | null => {
  if (!validNumber(field, profile[field])) return null;
  const raw: unknown = profile[field === 'hrMax' ? 'hrMaxSource' : 'hrRestSource'];
  if (typeof raw === 'object' && raw !== null) {
    const { kind, atMs } = raw as Record<string, unknown>;
    if (kind === 'test' || kind === 'seance' || kind === 'saisie') {
      return { kind, atMs: typeof atMs === 'number' && isFinite(atMs) ? atMs : null };
    }
  }
  return { kind: 'saisie', atMs: null };
};

/**
 * Seuils et zones cardiaques du pratiquant pour un calcul (`heartRate` : son
 * profil cardio) décalés de `offsetBpm` (`hrOffsetBpm` de l'activité) ; `null`
 * sans seuils saisis, FC max ni âge.
 */
export const runnerHeartRateZones = (profile: RunnerProfile, heartRate: HeartRateProfile, offsetBpm: number): HeartRateZones | null =>
  heartRateZones(profile, runnerAge(profile), heartRate.zoneModel, offsetBpm);

/** Bornes des zones cardiaques du pratiquant pour une activité, hors composant (chiffres du direct). */
export const readHeartRateZoneBounds = (activity: Activity): number[] | null =>
  runnerHeartRateZones(readRunnerProfile(), getSportProfile(activity.base).heartRate, effectiveHrOffset(activity))?.bounds ?? null;

export const useRunnerProfile = () => {
  const { value, update } = useStoredRecord<RunnerProfile>(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

  /** Écrit un champ numérique, `null` pour l'effacer ; les valeurs hors plage sont ignorées. Une FC tapée est dite saisie. */
  const setNumber = useCallback(
    (field: NumberField, next: number | null) => {
      if (next !== null) {
        const [lo, hi] = BOUNDS[field];
        if (!isFinite(next) || next < lo || next > hi) return;
      }
      const source: HrSource | null = next === null ? null : { kind: 'saisie', atMs: null };
      update({
        [field]: next,
        ...(field === 'hrMax' ? { hrMaxSource: source } : field === 'hrRest' ? { hrRestSource: source } : {}),
      } as Partial<RunnerProfile>);
    },
    [update]
  );

  /** Retient la FC max ou de repos d'un test ou d'une séance, avec son origine ; hors plage : ignorée. */
  const retainHr = useCallback(
    (field: 'hrMax' | 'hrRest', bpm: number, source: HrSource) => {
      if (!validNumber(field, bpm)) return;
      update(field === 'hrMax' ? { hrMax: Math.round(bpm), hrMaxSource: source } : { hrRest: Math.round(bpm), hrRestSource: source });
    },
    [update]
  );

  /** Nom ou pseudo tel que tapé (espaces compris, pour la frappe en cours), tronqué ; vide : effacé. */
  const setName = useCallback(
    (name: string) => update({ name: name.trim() === '' ? null : name.slice(0, RUNNER_NAME_MAX) }),
    [update]
  );

  const setSex = useCallback((sex: RunnerProfile['sex']) => update({ sex }), [update]);

  /** Photo du Profil, `null` pour revenir au dessin du sport préféré ; une valeur invalide est ignorée. */
  const setAvatar = useCallback(
    (avatar: RunnerAvatar | null) => {
      if (avatar !== null && runnerAvatar({ avatar }) === null) return;
      update({ avatar });
    },
    [update]
  );

  /** S1 et S2 saisis à la main, `null` pour revenir au calcul ; S2 sous S1 : ignorés. Les zones d'avant les seuils s'effacent. */
  const setThresholds = useCallback(
    (thresholds: number[] | null) => {
      if (thresholds !== null && !isValidThresholds(thresholds)) return;
      update({ hrThresholds: thresholds === null ? null : thresholds.map(Math.round), hrZones: null });
    },
    [update]
  );

  return { profile: value, setName, setAvatar, setNumber, retainHr, setSex, setThresholds, age: runnerAge(value) };
};
