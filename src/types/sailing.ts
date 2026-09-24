import type { BaseSessionStats, TopSegment } from '../core/types';

/**
 * Statistiques d'une session à voile : la base commune à tous les supports,
 * enrichie des meilleurs segments de vitesse.
 */
export interface SessionStats extends BaseSessionStats {
  tops: {
    t2s: TopSegment[];
    t5s: TopSegment[];
    t10s: TopSegment[];
    d100m: TopSegment[];
    d500m: TopSegment[];
    d1000m: TopSegment[];
    d1NM: TopSegment[];
  };
}
