import { useCallback } from 'react';
import { heartRateZones, isValidZoneBounds, type HeartRateZones } from '../core/heartRate';
import { getSportProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import { readStoredRecord, useStoredRecord } from './useStoredRecord';

/**
 * Profil du coureur, persistant dans le navigateur. Ces caractéristiques
 * serviront aux estimations de coût énergétique et aux zones d'effort : la
 * dépense d'une montée dépend d'abord de la masse déplacée, les zones
 * cardiaques des fréquences de repos et maximale.
 */
export interface RunnerProfile {
  /** Nom ou pseudo, affiché en titre du Profil et au pied de l'image partagée. */
  name: string | null;
  /** Masse en kilogrammes. */
  weightKg: number | null;
  /** Taille en centimètres. */
  heightCm: number | null;
  /** Année de naissance. */
  birthYear: number | null;
  sex: 'f' | 'm' | null;
  /** Fréquence cardiaque maximale, en battements par minute. */
  hrMax: number | null;
  /** Fréquence cardiaque de repos, en battements par minute. */
  hrRest: number | null;
  /** Bornes basses des zones cardiaques 1 à 5 saisies à la main, en bpm ; `null` : calculées. */
  hrZones: number[] | null;
  /** Économie de course sur le plat, en ml d'O₂ par kg et par km (test en laboratoire). */
  economyMlKgKm: number | null;
}

export const EMPTY_RUNNER_PROFILE: RunnerProfile = {
  name: null,
  weightKg: null,
  heightCm: null,
  birthYear: null,
  sex: null,
  hrMax: null,
  hrRest: null,
  hrZones: null,
  economyMlKgKm: null,
};

/** Plages plausibles de chaque champ numérique. */
export type RunnerNumberField = Exclude<keyof RunnerProfile, 'name' | 'sex' | 'hrZones'>;
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

const BOUNDS: Record<NumberField, [number, number]> = {
  weightKg: [20, 300],
  heightCm: [100, 250],
  birthYear: [1900, 2100],
  hrMax: [100, 250],
  hrRest: [25, 120],
  economyMlKgKm: [120, 320],
};

const NAMESPACE = 'tracker.runnerProfile';
const KEY = 'me';

/** Profil du pratiquant, hors composant (statistiques du direct). */
export const readRunnerProfile = (): RunnerProfile => readStoredRecord(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

/** Âge à la date du jour, si l'année de naissance est connue. */
export const runnerAge = (profile: RunnerProfile, nowMs = Date.now()): number | null =>
  profile.birthYear === null ? null : new Date(nowMs).getFullYear() - profile.birthYear;

/** Zones cardiaques du pratiquant (`fractions` : `HeartRateProfile.zoneFractions`) ; `null` sans FC max ni âge. */
export const runnerHeartRateZones = (profile: RunnerProfile, fractions: readonly number[]): HeartRateZones | null =>
  heartRateZones(profile, runnerAge(profile), fractions);

/** Bornes des zones cardiaques du pratiquant pour une activité, hors composant (chiffres du direct). */
export const readHeartRateZoneBounds = (base: SportType): number[] | null =>
  runnerHeartRateZones(readRunnerProfile(), getSportProfile(base).heartRate.zoneFractions)?.bounds ?? null;

export const useRunnerProfile = () => {
  const { value, update } = useStoredRecord<RunnerProfile>(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

  /** Écrit un champ numérique, `null` pour l'effacer ; les valeurs hors plage sont ignorées. */
  const setNumber = useCallback(
    (field: NumberField, next: number | null) => {
      if (next !== null) {
        const [lo, hi] = BOUNDS[field];
        if (!isFinite(next) || next < lo || next > hi) return;
      }
      update({ [field]: next } as Partial<RunnerProfile>);
    },
    [update]
  );

  /** Nom ou pseudo tel que tapé (espaces compris, pour la frappe en cours), tronqué ; vide : effacé. */
  const setName = useCallback(
    (name: string) => update({ name: name.trim() === '' ? null : name.slice(0, RUNNER_NAME_MAX) }),
    [update]
  );

  const setSex = useCallback((sex: RunnerProfile['sex']) => update({ sex }), [update]);

  /** Zones saisies à la main, `null` pour revenir au calcul ; des bornes non croissantes sont ignorées. */
  const setZones = useCallback(
    (bounds: number[] | null) => {
      if (bounds !== null && !isValidZoneBounds(bounds)) return;
      update({ hrZones: bounds === null ? null : bounds.map(Math.round) });
    },
    [update]
  );

  return { profile: value, setName, setNumber, setSex, setZones, age: runnerAge(value) };
};
