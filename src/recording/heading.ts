import { haversineDistance, initialBearing } from '../core/kinematics';
import type { LocationFix } from '../platform/location';

/**
 * Cap de la flèche de position sur la carte en direct : en mouvement, celui
 * de la marche (cap du GPS, sinon celui des derniers points) ; à l'arrêt, où
 * le cap du GPS n'est que du bruit, celui du téléphone (boussole), sinon le
 * dernier cap de marche. Degrés depuis le nord, sens horaire.
 */

export interface HeadingOptions {
  /** Vitesse au-dessus de laquelle on marche, en m/s. */
  movingSpeedMs: number;
  /** Écart minimal entre deux positions pour en tirer un cap, en mètres. */
  minStepM: number;
}

export const HEADING_DEFAULTS: HeadingOptions = {
  movingSpeedMs: 0.8,
  minStepM: 5,
};

export interface TravelHeading {
  /** Cap de la marche, ou le dernier connu ; `null` sans déplacement de `minStepM`. */
  headingDeg: number | null;
  moving: boolean;
}

/** Cap de la marche d'après les dernières positions, les plus récentes à la fin. */
export const travelHeading = (
  fixes: ReadonlyArray<LocationFix>,
  options: HeadingOptions = HEADING_DEFAULTS
): TravelHeading => {
  const last = fixes[fixes.length - 1];
  if (!last) return { headingDeg: null, moving: false };
  // Dernière position assez éloignée pour donner un cap ; la cadence peut être lâche (règle 10).
  let from: LocationFix | null = null;
  let stepM = 0;
  for (let i = fixes.length - 2; i >= 0; i--) {
    stepM = haversineDistance(fixes[i].lat, fixes[i].lon, last.lat, last.lon);
    if (stepM >= options.minStepM) {
      from = fixes[i];
      break;
    }
  }
  const trackHeading = from ? initialBearing(from.lat, from.lon, last.lat, last.lon) : null;
  const dtS = from ? (last.timeMs - from.timeMs) / 1000 : 0;
  const speedMs = last.speedMs ?? (from && dtS > 0 ? stepM / dtS : null);
  const moving = speedMs !== null && speedMs >= options.movingSpeedMs;
  const gpsHeading = last.bearingDeg !== undefined && isFinite(last.bearingDeg) ? last.bearingDeg : null;
  return { headingDeg: moving ? gpsHeading ?? trackHeading : trackHeading, moving };
};

/** Cap affiché : la marche en mouvement, la boussole à l'arrêt si elle répond. */
export const displayHeading = (travel: TravelHeading, compassDeg: number | null): number | null =>
  travel.moving ? travel.headingDeg : compassDeg ?? travel.headingDeg;
