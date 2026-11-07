import { finiteOr, inRange } from '../core/basics';
import { isActivityIconId, type ActivityIconId } from '../core/activityIcons';
import { heartRateZones, isValidThresholds, isValidZoneBounds, type HeartRateZones } from '../core/heartRate';
import type { HeartRateProfile } from '../core/sportProfiles';

/**
 * Profil du pratiquant, pur (lot 72) : sa forme, ses champs relus avec
 * contrôle (fichier de réglages importé, ancien profil), son âge et ses zones
 * cardiaques. Le magasin et ses écritures restent dans `hooks/useRunnerProfile.ts`,
 * les règles du pop-up et de la racine dans `library/profile.ts`.
 */

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
  /** Racine du Profil (`library/rootGrowth.ts`) : objectif par semaine, en minutes ; `null` : `ROOT_GOAL.defaultMin`. */
  rootWeeklyGoalMin: number | null;
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
  rootWeeklyGoalMin: null,
};

/** Plages plausibles de chaque champ numérique. */
export type RunnerNumberField = Exclude<keyof RunnerProfile, 'name' | 'avatar' | 'sex' | 'hrZones' | 'hrThresholds' | 'hrMaxSource' | 'hrRestSource'>;

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

/** Plages plausibles des champs numériques du pratiquant (celle de l'objectif de la racine : `library/profile.ts`). */
export const RUNNER_BOUNDS: Record<Exclude<RunnerNumberField, 'rootWeeklyGoalMin'>, [number, number]> = {
  weightKg: [20, 300],
  heightCm: [100, 250],
  birthYear: [1900, 2100],
  hrMax: [100, 250],
  hrRest: [25, 120],
  economyMlKgKm: [120, 320],
};

/** Une FC saisie et dans sa plage (relue avec contrôle : fichier de réglages importé). */
const validHr = (field: 'hrMax' | 'hrRest', raw: unknown): boolean => {
  const [lo, hi] = RUNNER_BOUNDS[field];
  return inRange(raw, lo, hi);
};

/** Âge à la date du jour, si l'année de naissance est connue. */
export const runnerAge = (profile: RunnerProfile, nowMs = Date.now()): number | null =>
  profile.birthYear === null ? null : new Date(nowMs).getFullYear() - profile.birthYear;

/** Origine de la FC max ou de repos, `null` sans valeur ; relue avec contrôle (fichier de réglages importé, ancien profil : saisie). */
export const runnerHrSource = (profile: Partial<RunnerProfile>, field: 'hrMax' | 'hrRest'): HrSource | null => {
  if (!validHr(field, profile[field])) return null;
  const raw: unknown = profile[field === 'hrMax' ? 'hrMaxSource' : 'hrRestSource'];
  if (typeof raw === 'object' && raw !== null) {
    const { kind, atMs } = raw as Record<string, unknown>;
    if (kind === 'test' || kind === 'seance' || kind === 'saisie') {
      return { kind, atMs: finiteOr(atMs, null) };
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

/**
 * Profil relu champ par champ (fichier de réglages d'un autre appareil, lot
 * 143) : un champ d'une forme inattendue ou hors de sa plage (`RUNNER_BOUNDS`,
 * `rootGoal` pour l'objectif de la racine, `ROOT_GOAL` de `library/rootGrowth.ts`
 * passé par l'appelant) est remis à vide, jamais repris tel quel ; un champ
 * inconnu est écarté.
 */
export const sanitizeRunnerProfile = (raw: unknown, rootGoal: { min: number; max: number }): RunnerProfile => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_RUNNER_PROFILE };
  const p = raw as Partial<Record<keyof RunnerProfile, unknown>>;
  const bounded = (field: Exclude<RunnerNumberField, 'rootWeeklyGoalMin'>): number | null => {
    const [lo, hi] = RUNNER_BOUNDS[field];
    return inRange(p[field], lo, hi) ? p[field] : null;
  };
  const numbers = (value: unknown): number[] | null => (Array.isArray(value) ? value.slice() as number[] : null);
  const thresholds = numbers(p.hrThresholds);
  const zones = numbers(p.hrZones);
  const hrMax = bounded('hrMax');
  const hrRest = bounded('hrRest');
  const forSource = { hrMax, hrRest, hrMaxSource: p.hrMaxSource, hrRestSource: p.hrRestSource } as Partial<RunnerProfile>;
  return {
    name: runnerName({ name: p.name as string | null }),
    avatar: runnerAvatar({ avatar: p.avatar as RunnerAvatar | null }),
    weightKg: bounded('weightKg'),
    heightCm: bounded('heightCm'),
    birthYear: bounded('birthYear'),
    sex: p.sex === 'f' || p.sex === 'm' ? p.sex : null,
    hrMax,
    hrMaxSource: runnerHrSource(forSource, 'hrMax'),
    hrRest,
    hrRestSource: runnerHrSource(forSource, 'hrRest'),
    hrThresholds: isValidThresholds(thresholds) ? thresholds : null,
    hrZones: isValidZoneBounds(zones) ? zones : null,
    economyMlKgKm: bounded('economyMlKgKm'),
    rootWeeklyGoalMin: inRange(p.rootWeeklyGoalMin, rootGoal.min, rootGoal.max) ? p.rootWeeklyGoalMin : null,
  };
};

/**
 * Profil tel que rangé sur l'appareil, relu avec le contrôle de `sanitizeRunnerProfile`
 * (il peut venir du fichier de réglages d'un autre appareil) : seul le nom reste
 * tel que tapé, espaces de fin compris, pour la frappe en cours dans son champ.
 */
export const storedRunnerProfile = (raw: unknown, rootGoal: { min: number; max: number }): RunnerProfile => {
  const profile = sanitizeRunnerProfile(raw, rootGoal);
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === 'string' && profile.name !== null ? { ...profile, name: name.slice(0, RUNNER_NAME_MAX) } : profile;
};
