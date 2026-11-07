import { useCallback, useId, useMemo } from 'react';
import { toFixedNumber } from '../core/basics';
import { sampledIndices, visibleIndexRange } from '../core/chartZoom';
import { CHART_MAX_POINTS } from '../core/displayConfig';
import type { GradientStop } from '../core/speedGradient';
import { DISTANCE_UNIT_SYMBOL, commaDecimal, toDisplayDistance, type DistanceUnit } from '../core/units';
import { useChartZoom, type ChartZoom } from '../hooks/useChartZoom';
import { profileGradeStops, type GradeRange, type ProfileRow } from '../planning/route';
import type { Readout } from './ChartReadout';
import { inChartView } from './chartHover';
import { ALTITUDE_COLOR } from './chartStyle';
import type { ElevationProfileRow } from './ElevationProfileMini';

export interface RouteProfileChart {
  zoom: ChartZoom;
  /** Lignes tracées : celles de la plage visible, au plus `CHART_MAX_POINTS` : zoomer montre plus de détail. */
  chartRows: ElevationProfileRow[];
  gradeStops: GradientStop[];
  gradientId: string;
  /** Altitude et pente lues au-dessus du profil (`HoverReadout`), à la ligne survolée de la plage zoomée. */
  readProfile: (index: number) => Readout | null;
}

/**
 * Ce qu'il faut à `ElevationProfileMini` pour tracer un profil à pas régulier
 * (`routeProfileRows`) : le zoom, les lignes de sa plage, les couleurs de la
 * pente et la lecture. L'`index` d'une ligne tracée est son rang dans `profile`,
 * dont la position sert donc au repère de survol sur la carte. `resetKey` :
 * ce qui remet le zoom à « tout voir » quand il change.
 */
export const useRouteProfileChart = (
  profile: ProfileRow[],
  distanceUnit: DistanceUnit,
  gradeRange: GradeRange | null,
  resetKey?: unknown
): RouteProfileChart => {
  /** Distance de chaque ligne du profil, dans l'unité affichée : l'axe du graphe et de son zoom. */
  const profileDist = useMemo(() => profile.map((row) => toDisplayDistance(row.distM, distanceUnit)), [profile, distanceUnit]);
  const zoom = useChartZoom(profileDist.length > 1 ? { min: profileDist[0], max: profileDist[profileDist.length - 1] } : null, resetKey);
  const profileEle = useMemo(() => profile.map((row) => row.eleM), [profile]);
  const chartRows = useMemo<ElevationProfileRow[]>(() => {
    const [first, last] = visibleIndexRange(profileDist, zoom.view);
    return sampledIndices(first, last, CHART_MAX_POINTS, profileEle).map((i) => {
      const { eleM, grade } = profile[i];
      return { index: i, dist: toFixedNumber(profileDist[i], 3), altitude: eleM !== null ? Math.round(eleM) : null, grade };
    });
  }, [profile, profileDist, profileEle, zoom.view]);
  const gradeStops = useMemo(
    () => (gradeRange ? profileGradeStops(chartRows.filter((r) => r.altitude !== null), gradeRange) : []),
    [chartRows, gradeRange]
  );
  const gradientId = `${useId()}-profil`;
  const view = zoom.view;
  const readProfile = useCallback((i: number): Readout | null => {
    const row = profile[i];
    if (!row || !inChartView(view, profileDist[i])) return null;
    return {
      values: [{
        text: row.eleM !== null
          ? `${Math.round(row.eleM)} m${row.grade !== null && isFinite(row.grade) ? `, pente ${Math.round(row.grade * 100)} %` : ''}`
          : '—',
        color: ALTITUDE_COLOR,
      }],
      at: `${commaDecimal(toFixedNumber(profileDist[i], 2))} ${DISTANCE_UNIT_SYMBOL[distanceUnit]}`,
    };
  }, [profile, profileDist, view, distanceUnit]);
  return { zoom, chartRows, gradeStops, gradientId, readProfile };
};
