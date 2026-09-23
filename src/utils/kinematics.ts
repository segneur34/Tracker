/**
 * Adaptateur de compatibilité : conserve l'API historique en nœuds,
 * au-dessus du noyau générique qui travaille en m/s.
 *
 * Les analyses voile (`src/sailing/*`) continuent de travailler sur
 * `PointData`, produit par `trackToPointData` depuis la trace du noyau.
 */
import { msToKnots } from '../core/units';
import type { TrackPoint } from '../core/types';

export interface PointData {
  lat: number;
  lon: number;
  time: string | Date;
  /** Horodatage en millisecondes, pour les fenêtres temporelles. */
  timeMs: number;
  /** Vitesse retenue, en nœuds. */
  speed: number;
  /** Vitesse filtrée, en nœuds. */
  smoothedSpeed: number;
  bearing: number;
}

/** Convertit un point du noyau vers la forme historique en nœuds. */
export const toPointData = (point: TrackPoint): PointData => ({
  lat: point.lat,
  lon: point.lon,
  time: point.time,
  timeMs: point.timeMs,
  speed: msToKnots(point.speedMs),
  smoothedSpeed: msToKnots(point.smoothedSpeedMs),
  bearing: point.bearing,
});

/** Vue en nœuds d'une trace déjà calculée par le noyau. */
export const trackToPointData = (track: TrackPoint[]): PointData[] => track.map(toPointData);
