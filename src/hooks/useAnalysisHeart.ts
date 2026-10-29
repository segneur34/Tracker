import { useCallback, useMemo } from 'react';
import { heartRateZonePaths, type HeartRatePoint, type HeartRateZones } from '../core/heartRate';
import type { HeartRateProfile } from '../core/sportProfiles';
import { runnerHeartRateZones, useRunnerProfile } from './useRunnerProfile';
import { useSessionHeartRate, type SessionHeartRate } from './useSessionHeartRate';

/**
 * FC d'une analyse, la même dans les quatre modules : le pratiquant (`runner`,
 * son âge, `retainHr` pour garder une FC max lue dans la séance), la FC de la
 * session (`heart`) et ses zones, décalées de celui de l'activité (`hrZones`).
 */
export const useAnalysisHeart = (track: readonly HeartRatePoint[], params: HeartRateProfile, hrOffsetBpm: number) => {
  const { profile: runner, age, retainHr } = useRunnerProfile();
  const heart = useSessionHeartRate(track, params);
  const hrZones = useMemo(() => runnerHeartRateZones(runner, params, hrOffsetBpm), [runner, params, hrOffsetBpm]);
  return { runner, age, retainHr, heart, hrZones };
};

/** Surbrillance de l'onglet « cardio » : la zone montrée, par son numéro en chaîne. */
export interface CardioHighlight {
  shownIn: (panel: 'cardio') => string | null;
  show: (panel: 'cardio', key: string | null) => void;
}

/**
 * Zone cardiaque montrée sur la carte depuis l'onglet « cardio » : son numéro
 * (`selectedZone`), le choix d'une autre (`select`, `null` l'efface) et ses
 * passages à tracer (`paths`), tant que l'onglet est ouvert et la FC présente.
 */
export const useHeartRateZoneHighlight = (
  highlight: CardioHighlight,
  cardioOpen: boolean,
  heart: SessionHeartRate,
  hrZones: HeartRateZones | null,
  track: readonly (HeartRatePoint & { lat: number; lon: number })[],
  gapS: number
) => {
  const shown = highlight.shownIn('cardio');
  const selectedZone = shown === null ? null : Number(shown);
  const paths = useMemo(
    () => (selectedZone !== null && cardioOpen && heart.present && hrZones
      ? heartRateZonePaths(track, heart.smoothed, hrZones.bounds, selectedZone, gapS)
      : []),
    [selectedZone, cardioOpen, heart, hrZones, track, gapS]
  );
  const { show } = highlight;
  const select = useCallback((zone: number | null) => show('cardio', zone === null ? null : String(zone)), [show]);
  return { selectedZone, select, paths };
};
