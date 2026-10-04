import { useEffect, useRef, useState } from 'react';
import { getSportProfile } from '../core/sportProfiles';
import type { SportType } from '../core/types';
import type { LocationFix } from '../platform/location';
import {
  EMPTY_LIVE_STATS, LIVE_STATS_DEFAULTS, computeLiveStats, type LiveEnergySetup, type LiveStats,
} from '../recording/liveStats';
import { getLiveSegments } from './useRecorder';

/** Intervalle minimal entre deux recalculs, en temps réel : borne le coût d'une longue trace ou d'un rejeu accéléré. */
const LIVE_REFRESH_MS = 2000;

export interface LiveRecording {
  segments: LocationFix[][];
  stats: LiveStats;
  /** Instant du dernier calcul, en ms ; `null` avant le premier. */
  updatedMs: number | null;
}

const EMPTY: LiveRecording = { segments: [], stats: EMPTY_LIVE_STATS, updatedMs: null };

/**
 * Trace et statistiques de l'enregistrement en cours, recalculées au plus
 * toutes les `LIVE_REFRESH_MS`. Seule la page affichée les calcule :
 * l'enregistreur n'en porte pas le coût. `lastDistanceM` : longueur du
 * « dernier kilomètre » (ou mille), selon l'unité de distance de l'activité ;
 * `energy` : modèle de la puissance et de l'énergie (course, vélo), à
 * mémoriser par l'appelant.
 */
export const useLiveRecording = (
  sport: SportType | null,
  pointCount: number,
  { lastDistanceM = LIVE_STATS_DEFAULTS.lastDistanceM, energy }: { lastDistanceM?: number; energy?: LiveEnergySetup } = {}
): LiveRecording => {
  const [live, setLive] = useState<LiveRecording>(EMPTY);
  const lastRunMs = useRef(0);

  useEffect(() => {
    if (sport === null || pointCount === 0) return;
    const wait = Math.max(0, LIVE_REFRESH_MS - (Date.now() - lastRunMs.current));
    const id = setTimeout(() => {
      lastRunMs.current = Date.now();
      const segments = getLiveSegments();
      const stats = computeLiveStats(segments, getSportProfile(sport), { ...LIVE_STATS_DEFAULTS, lastDistanceM, energy });
      setLive({ segments, stats, updatedMs: lastRunMs.current });
    }, wait);
    return () => clearTimeout(id);
  }, [sport, pointCount, lastDistanceM, energy]);

  return sport === null || pointCount === 0 ? EMPTY : live;
};
