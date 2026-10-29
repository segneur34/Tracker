import type { SailingTopKey } from '../core/sportProfiles';
import type { BaseSessionStats, TopSegment } from '../core/types';

/**
 * Statistiques d'une session à voile : la base commune à tous les supports,
 * enrichie des meilleurs segments de vitesse.
 */
export interface SessionStats extends BaseSessionStats {
  /** Par cible de `SAILING_TOP_TARGETS`, dans leur ordre. */
  tops: Record<SailingTopKey, TopSegment[]>;
}
