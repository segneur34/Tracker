import { useCallback } from 'react';
import { useStoredRecord } from './useStoredRecord';

/**
 * Profil du coureur, persistant dans le navigateur. Ces caractéristiques
 * serviront aux estimations de coût énergétique et aux zones d'effort : la
 * dépense d'une montée dépend d'abord de la masse déplacée, les zones
 * cardiaques des fréquences de repos et maximale.
 */
export interface RunnerProfile {
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
}

export const EMPTY_RUNNER_PROFILE: RunnerProfile = {
  weightKg: null,
  heightCm: null,
  birthYear: null,
  sex: null,
  hrMax: null,
  hrRest: null,
};

/** Plages plausibles de chaque champ numérique. */
const BOUNDS: Record<Exclude<keyof RunnerProfile, 'sex'>, [number, number]> = {
  weightKg: [20, 300],
  heightCm: [100, 250],
  birthYear: [1900, 2100],
  hrMax: [100, 250],
  hrRest: [25, 120],
};

export const useRunnerProfile = () => {
  const { value, update } = useStoredRecord<RunnerProfile>('tracker.runnerProfile', 'me', EMPTY_RUNNER_PROFILE);

  /** Écrit un champ numérique, `null` pour l'effacer ; les valeurs hors plage sont ignorées. */
  const setNumber = useCallback(
    (field: Exclude<keyof RunnerProfile, 'sex'>, next: number | null) => {
      if (next !== null) {
        const [lo, hi] = BOUNDS[field];
        if (!isFinite(next) || next < lo || next > hi) return;
      }
      update({ [field]: next } as Partial<RunnerProfile>);
    },
    [update]
  );

  const setSex = useCallback((sex: RunnerProfile['sex']) => update({ sex }), [update]);

  /** Âge à la date du jour, si l'année de naissance est connue. */
  const age = value.birthYear === null ? null : new Date().getFullYear() - value.birthYear;

  return { profile: value, setNumber, setSex, age };
};
