import { useMemo } from 'react';
import { CHART_MAX_POINTS } from '../core/displayConfig';
import { lastByRange, sampledIndices, sampledIndicesKeeping, visibleIndexRange } from '../core/chartZoom';
import { knotsToChartValue, type SpeedUnit } from '../core/units';
import type { ManeuverStats } from '../sailing/maneuvers';
import type { PointData } from '../sailing/pointData';
import { vmgBridgedHoles, vmgChartRows, vmgManeuverSpans, windChartRows, type WindStats } from '../sailing/sailingAnalytics';
import type { SessionHeartRate } from './useSessionHeartRate';
import type { TimeChartAxis } from './useTimeChartAxis';

interface SailingChartRowsInput {
  trackData: PointData[];
  /** Axe du temps de la session (`useTimeChartAxis`). */
  timeChart: TimeChartAxis;
  heart: SessionHeartRate;
  windStats: WindStats | null;
  /** VMG de chaque point, en nœuds (`null` hors des passages mesurés). */
  vmgSeries: (number | null)[];
  maneuverStats: ManeuverStats | null;
  speedUnit: SpeedUnit;
}

/**
 * Lignes des graphes de la voile (vitesse, FC, vent, VMG) ; les lectures du point survolé sont dans
 * `sailingChartReaders` (`components/sailing/sailingChartParts.tsx`), un hook ne lisant pas les composants.
 *
 * Points de trace des graphes sur une plage, au plus `CHART_MAX_POINTS` : zoomer montre plus de détail. Lus dans
 * les blocs qui suivent le zoom (`ZoomView`), chacun gardé pour la dernière plage (`lastByRange`) : « graphiques »,
 * « vent » et la carte en plein écran lisent les mêmes lignes sans les refaire, et zoomer ne redessine pas le module.
 */
export function useSailingChartRows({ trackData, timeChart, heart, windStats, vmgSeries, maneuverStats, speedUnit }: SailingChartRowsInput) {
  const trackMinutes = timeChart.minutes;
  const speedSeries = useMemo(() => trackData.map((p) => p.smoothedSpeed), [trackData]);
  const visibleRangeAt = useMemo(
    () => lastByRange((view) => (trackData.length === 0 ? null : visibleIndexRange(trackMinutes, view))),
    [trackData, trackMinutes]
  );
  /** Lignes de la vitesse et de la FC : les extrêmes de l'une et de l'autre restent (un pic bref de FC aussi). */
  const chartIndicesAt = useMemo(() => lastByRange((view): number[] => {
    const visibleRange = visibleRangeAt(view);
    if (!visibleRange) return [];
    return sampledIndicesKeeping(visibleRange[0], visibleRange[1], CHART_MAX_POINTS, heart.present ? [speedSeries, heart.smoothed] : [speedSeries]);
  }), [visibleRangeAt, speedSeries, heart]);
  /** Lignes du vent : ses points suivent la vitesse seule. */
  const windIndicesAt = useMemo(() => lastByRange((view): number[] => {
    const visibleRange = visibleRangeAt(view);
    return visibleRange ? sampledIndices(visibleRange[0], visibleRange[1], CHART_MAX_POINTS, speedSeries) : [];
  }), [visibleRangeAt, speedSeries]);
  const speedRowsAt = useMemo(
    () => lastByRange((view) => chartIndicesAt(view).map((i) => ({ index: i, minutes: trackMinutes[i], vitesse: knotsToChartValue(trackData[i].smoothedSpeed, speedUnit) }))),
    [chartIndicesAt, trackMinutes, trackData, speedUnit]
  );
  const heartRowsAt = useMemo(
    () => lastByRange((view) => (heart.present
      ? chartIndicesAt(view).map((i) => ({ index: i, minutes: trackMinutes[i], hr: heart.smoothed[i] === null ? null : Math.round(heart.smoothed[i]!) }))
      : [])),
    [heart, chartIndicesAt, trackMinutes]
  );
  const windRowsAt = useMemo(
    () => lastByRange((view) => (windStats ? windChartRows(trackData, windStats, windIndicesAt(view)) : [])),
    [windStats, trackData, windIndicesAt]
  );
  /** Trous de la VMG que le trait franchit : ceux des rotations ; un arrêt reste un trou (`vmgBridgedHoles`). */
  const vmgBridged = useMemo(() => vmgBridgedHoles(vmgSeries, vmgManeuverSpans(maneuverStats?.locations ?? [])), [vmgSeries, maneuverStats]);
  /** Lignes de la VMG : ses points suivent sa propre courbe, ses extrêmes restent (`vmgChartRows`). */
  const vmgRowsAt = useMemo(() => lastByRange((view) => {
    const visibleRange = visibleRangeAt(view);
    const indices = visibleRange ? sampledIndices(visibleRange[0], visibleRange[1], CHART_MAX_POINTS, vmgSeries) : [];
    return vmgChartRows(vmgSeries, trackMinutes, indices, (kn) => knotsToChartValue(kn, speedUnit), vmgBridged);
  }), [visibleRangeAt, vmgSeries, trackMinutes, speedUnit, vmgBridged]);
  /** La courbe de VMG a au moins une valeur sur la session ; sinon, une phrase à sa place. */
  const vmgChartShown = useMemo(() => vmgSeries.some((v) => v !== null), [vmgSeries]);

  return { speedRowsAt, heartRowsAt, windRowsAt, vmgRowsAt, vmgChartShown };
}

/** Lignes des graphes de la voile, telles que les rend `useSailingChartRows`. */
export type SailingChartRows = ReturnType<typeof useSailingChartRows>;
