import type { BaseSessionStats, TopSegment } from '../core/types';

/** Meilleur segment de vitesse. Forme identique au `TopSegment` générique. */
export type TopRun = TopSegment;

/**
 * Statistiques d'une session à voile : la base commune à tous les supports,
 * enrichie des éléments propres au vent et à la vitesse.
 */
export interface SessionStats extends BaseSessionStats {
  /** Part du temps passé au-dessus du seuil d'activité. Même valeur que `activeRatio`. */
  flightRatio: string;
  tops: {
    t2s: TopRun[];
    t5s: TopRun[];
    t10s: TopRun[];
    d100m: TopRun[];
    d500m: TopRun[];
    d1000m: TopRun[];
    d1NM: TopRun[];
  };
}
