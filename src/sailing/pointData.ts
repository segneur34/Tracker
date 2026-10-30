/**
 * Adaptateur de compatibilité : conserve l'API historique en nœuds,
 * au-dessus du noyau générique qui travaille en m/s.
 *
 * Les analyses voile (`src/sailing/*`) continuent de travailler sur
 * `PointData`, produit par `trackToPointData` depuis la trace du noyau.
 */
import { segmentDistanceM } from '../core/sessionStats';
import { msToKnots } from '../core/units';
import type { TrackPoint } from '../core/types';

export interface PointData {
  lat: number;
  lon: number;
  /** Horodatage en millisecondes, pour les fenêtres temporelles. */
  timeMs: number;
  /** Vitesse filtrée, en nœuds. */
  smoothedSpeed: number;
  bearing: number;
  /** Reprise après une pause de l'enregistrement : rien n'est parcouru sur ce pas (`TrackPoint.segmentStart`). */
  segmentStart?: true;
  /**
   * Distance du pas qui arrive à ce point, en mètres, par la règle du noyau
   * (`segmentDistanceM`, règle 6) : vitesse retenue × durée, 0 sur une reprise
   * de pause, bornée par la corde × 1,5 sur un trou de la trace. Absente sur
   * une trace synthétique posée à la main : les distances de la voile
   * retombent alors sur la vitesse lissée × durée.
   */
  stepDistanceM?: number;
}

/** Convertit le point `i` d'une trace du noyau vers la forme historique en nœuds. */
export const toPointData = (track: TrackPoint[], i: number): PointData => {
  const point = track[i];
  return {
    lat: point.lat,
    lon: point.lon,
    timeMs: point.timeMs,
    smoothedSpeed: msToKnots(point.smoothedSpeedMs),
    bearing: point.bearing,
    ...(point.segmentStart ? { segmentStart: true as const } : {}),
    stepDistanceM: segmentDistanceM(track, i),
  };
};

/** Vue en nœuds d'une trace déjà calculée par le noyau. */
export const trackToPointData = (track: TrackPoint[]): PointData[] => track.map((_, i) => toPointData(track, i));
