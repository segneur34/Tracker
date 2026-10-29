/**
 * Lignes des graphes de « graphiques » et « zones de pente », à pied et à
 * vélo : la plage zoomée de la trace, au plus `CHART_MAX_POINTS` lignes, en
 * unités affichées (sortie du noyau, `core/units`).
 */
import { toFixedNumber } from './basics';
import { sampledIndices, visibleIndexRange } from './chartZoom';
import type { XRange } from './chartZoom';
import { CHART_MAX_POINTS } from './displayConfig';
import { CHART_PACE_MIN_SPEED_MS, toDisplaySpeed, type DistanceUnit, type SpeedUnit } from './units';

/** Une ligne des graphes : `index` renvoie au point de trace d'origine. */
export interface TrackChartRow {
  index: number;
  /** Distance parcourue, dans l'unité de l'activité. */
  dist: number;
  speed: number | null;
  speedMs: number;
  altitude: number | null;
  /** Pente locale en fraction, `null` là où elle manque. */
  grade: number | null;
  /** FC lissée, `null` là où elle manque. */
  hr: number | null;
  /** Cadence à pied lissée, en pas par minute, `null` là où elle manque. */
  cadence: number | null;
}

/** Ce que lisent les lignes, un tableau par point de trace. */
export interface TrackChartRowsInput {
  /** Nombre de points de la trace. */
  pointCount: number;
  /** Distance de chaque point, dans l'unité de l'activité : l'axe du zoom. */
  dist: ArrayLike<number>;
  /** Plage zoomée, ou `null` : toute la trace. */
  view: XRange | null;
  /** Vitesse des graphes (lissée), en m/s. */
  speedMs: ArrayLike<number>;
  /** Altitude lissée, en m, `NaN` là où elle manque. */
  altitude: ArrayLike<number>;
  /** La session a une altitude : sinon, aucune ligne n'en porte. */
  hasElevation: boolean;
  /** Pente locale en fraction, `NaN` là où elle manque. */
  grades: ArrayLike<number>;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  /** Unité d'allure (min/km) : un arrêt laisse un trou plutôt qu'une valeur absurde. */
  inverse: boolean;
  /** FC lissée, `null` ou absente là où elle manque. */
  heartRate: ReadonlyArray<number | null | undefined>;
  /** Cadence lissée, `null` là où elle manque ; `null` sans cadence dans la session. */
  cadence: ReadonlyArray<number | null> | null;
}

/**
 * Séries des graphes sur la plage visible, au plus `CHART_MAX_POINTS` :
 * distance et vitesse dans l'unité choisie, altitude lissée. Zoomer montre
 * plus de détail.
 */
export const trackChartRows = ({
  pointCount, dist, view, speedMs, altitude: altitudes, hasElevation, grades, speedUnit, distanceUnit, inverse, heartRate, cadence,
}: TrackChartRowsInput): TrackChartRow[] => {
  if (pointCount === 0) return [];
  const [first, last] = visibleIndexRange(dist, view);
  return sampledIndices(first, last, CHART_MAX_POINTS, speedMs).map((i): TrackChartRow => {
    const altitude = altitudes[i];
    const ms = speedMs[i];
    // En min/km, l'arrêt tend vers l'infini : on laisse un trou plutôt qu'une valeur absurde.
    const speed = inverse && ms < CHART_PACE_MIN_SPEED_MS ? null : toFixedNumber(toDisplaySpeed(ms, speedUnit, distanceUnit), 2);
    return {
      index: i,
      dist: toFixedNumber(dist[i], 3),
      speed,
      speedMs: ms,
      altitude: hasElevation && isFinite(altitude) ? Math.round(altitude) : null,
      grade: isFinite(grades[i]) ? grades[i] : null,
      hr: heartRate[i] === null || heartRate[i] === undefined ? null : Math.round(heartRate[i]!),
      cadence: cadence !== null && cadence[i] !== null ? Math.round(cadence[i]!) : null,
    };
  });
};
