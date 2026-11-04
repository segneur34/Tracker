import type { ReactNode } from 'react';
import { useZoomState, type ChartZoom, type ChartZoomSource } from '../hooks/useChartZoom';

/**
 * Bloc de graphes qui suit un zoom (lot 127) : seul ce bloc se redessine à
 * chaque image d'un pincement, d'un double toucher ou d'une zone tirée, pas
 * le module qui le pose. `children` reçoit l'instantané du zoom, à passer aux
 * graphes (`TrackChart`, `HeartRateChart`, `ElevationProfileMini`) et aux
 * lignes et lectures de la plage. Ne pose aucun élément à lui.
 */
export default function ZoomView({ zoom, children }: {
  zoom: ChartZoomSource;
  children: (zoom: ChartZoom) => ReactNode;
}) {
  const state = useZoomState(zoom);
  return <>{children(state)}</>;
}
