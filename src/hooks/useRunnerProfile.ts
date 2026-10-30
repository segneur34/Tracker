import { useCallback } from 'react';
import type { Activity } from '../core/activities';
import { isValidThresholds } from '../core/heartRate';
import { getSportProfile } from '../core/sportProfiles';
import { validProfileNumber } from '../library/profilePrompt';
import {
  EMPTY_RUNNER_PROFILE, RUNNER_NAME_MAX, runnerAge, runnerAvatar, runnerHeartRateZones,
  type HrSource, type RunnerAvatar, type RunnerNumberField, type RunnerProfile,
} from '../running/runnerProfile';
import { effectiveHrOffset } from './useSportSettings';
import { readStoredRecord, useStoredRecord } from './useStoredRecord';

/**
 * Profil du pratiquant, persistant (`tracker.runnerProfile`) : sa lecture et
 * ses écritures. Sa forme et ses règles pures sont dans `running/runnerProfile.ts`
 * et `library/profile.ts` (lot 72).
 */

type NumberField = RunnerNumberField;

const NAMESPACE = 'tracker.runnerProfile';
const KEY = 'me';

/** Profil du pratiquant, hors composant (statistiques du direct). */
export const readRunnerProfile = (): RunnerProfile => readStoredRecord(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

/** Bornes des zones cardiaques du pratiquant pour une activité, hors composant (chiffres du direct). */
export const readHeartRateZoneBounds = (activity: Activity): number[] | null =>
  runnerHeartRateZones(readRunnerProfile(), getSportProfile(activity.base).heartRate, effectiveHrOffset(activity))?.bounds ?? null;

export const useRunnerProfile = () => {
  const { value, update } = useStoredRecord<RunnerProfile>(NAMESPACE, KEY, EMPTY_RUNNER_PROFILE);

  /** Écrit un champ numérique, `null` pour l'effacer ; les valeurs hors plage sont ignorées. Une FC tapée est dite saisie. */
  const setNumber = useCallback(
    (field: NumberField, next: number | null) => {
      if (next !== null) {
        if (!validProfileNumber(field, next)) return;
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
      if (!validProfileNumber(field, bpm)) return;
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
