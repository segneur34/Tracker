/**
 * Graphes de la voile sur le temps de la session : vitesse, FC, vent et VMG, posés dans leurs onglets
 * (« graphiques », « vent », « vmg ») et sous la carte en plein écran au téléphone (`SailingCompanionCharts`).
 * Chacun lit ses lignes à la plage du zoom `z` (`useSailingChartRows`).
 */
import type { CSSProperties, ReactNode } from 'react';
import { ReferenceLine } from 'recharts';
import type { SailingTab } from '../../core/analysisTabs';
import type { ChartZoom, ChartZoomSource } from '../../hooks/useChartZoom';
import type { useAnalysisHeart } from '../../hooks/useAnalysisHeart';
import type { SailingChartRows } from '../../hooks/useSailingChartRows';
import type { SessionHeartRate } from '../../hooks/useSessionHeartRate';
import type { TimeChartAxis } from '../../hooks/useTimeChartAxis';
import { HoverReadout } from '../ChartReadout';
import HeartRateChart from '../HeartRateChart';
import { CardioCompanion } from '../HeartRatePanel';
import TrackChart from '../TrackChart';
import ZoomView from '../ZoomView';
import { SAILING_SPEED_COLOR } from '../chartStyle';
import { HEART_RATE_COLOR } from '../heartRateColors';
import {
  COMPANION_CHART_STYLE, SAILING_SYNC_ID, SPEED_AXES, SPEED_SERIES, VMG_AXES, VMG_COLOR, VMG_SERIES, WIND_AXES, WIND_COLOR, WIND_SERIES,
  type SailingChartReaders,
} from './sailingChartParts';

type HrZones = ReturnType<typeof useAnalysisHeart>['hrZones'];

interface SailingChartProps {
  rows: SailingChartRows;
  z: ChartZoom;
  timeX: TimeChartAxis['timeX'];
  /** Traits des repères (`markReferenceLines`), en minutes depuis le premier point. */
  markLines: ReactNode;
  onShowOnMap: () => void;
  style: CSSProperties;
}

/** Graphe de vitesse : dans l'onglet « graphiques », et sous la carte en plein écran. */
export function SailingSpeedChart({ rows, z, timeX, markLines, onShowOnMap, style }: SailingChartProps) {
  return (
    <TrackChart rows={rows.speedRowsAt(z.view)} zoom={z} x={timeX} yAxes={SPEED_AXES} series={SPEED_SERIES} syncId={SAILING_SYNC_ID}
      onShowOnMap={onShowOnMap} style={style}>
      {markLines}
    </TrackChart>
  );
}

/** Graphe du vent : dans l'onglet « vent », et sous la carte en plein écran. */
export function SailingWindChart({ rows, z, timeX, markLines, onShowOnMap, style }: SailingChartProps) {
  return (
    <TrackChart rows={rows.windRowsAt(z.view)} zoom={z} x={timeX} yAxes={WIND_AXES} series={WIND_SERIES}
      onShowOnMap={onShowOnMap} style={style}>
      {markLines}
    </TrackChart>
  );
}

/** Graphe de la VMG : dans l'onglet « vmg », et sous la carte en plein écran. */
export function SailingVmgChart({ rows, z, timeX, markLines, onShowOnMap, style }: SailingChartProps) {
  return (
    <TrackChart rows={rows.vmgRowsAt(z.view)} zoom={z} x={timeX} yAxes={VMG_AXES} series={VMG_SERIES}
      onShowOnMap={onShowOnMap} style={style}>
      <ReferenceLine y={0} stroke="var(--ink)" strokeWidth={1} ifOverflow="extendDomain" />
      {markLines}
    </TrackChart>
  );
}

/** Courbe de FC de « graphiques », sur le temps de la session ; ses boutons de zoom quand la vitesse est repliée (`showReset`). */
export function SailingHeartChart({ rows, z, timeX, zones, showReset, hrMarkLines, onShowOnMap, style }: Omit<SailingChartProps, 'markLines'> & {
  zones: HrZones;
  showReset: boolean;
  /** Traits des repères sur l'axe de la FC. */
  hrMarkLines: ReactNode;
}) {
  return (
    <HeartRateChart data={rows.heartRowsAt(z.view)} zoom={z} x={timeX} zones={zones?.bounds ?? null} thresholds={zones ? { s1: zones.s1, s2: zones.s2 } : null}
      syncId={SAILING_SYNC_ID} showReset={showReset} onShowOnMap={onShowOnMap} style={style}>
      {hrMarkLines}
    </HeartRateChart>
  );
}

/** Onglets qui posent leurs graphes sous la carte en plein écran (`useZoomOnMap`). */
type CompanionPanel = Extract<SailingTab, 'graphiques' | 'vent' | 'vmg' | 'cardio'>;

/**
 * Graphes de l'onglet d'où vient « +carte », sous la carte en plein écran (téléphone). Le module ne le pose que
 * quand l'onglet en a (`AnalysisMap` lit `companion` comme une présence).
 */
export function SailingCompanionCharts({
  panel, rows, readers, chartZoom, timeX, markLines, hrMarkLines, folds, heartChartShown, windShown, zones,
  minutes, heart, cardioZoom, onShowOnMap,
}: {
  panel: CompanionPanel;
  rows: SailingChartRows;
  readers: SailingChartReaders;
  /** Zoom commun aux graphes de vitesse, de FC, du vent et de la VMG. */
  chartZoom: ChartZoomSource;
  timeX: TimeChartAxis['timeX'];
  markLines: ReactNode;
  hrMarkLines: ReactNode;
  /** Graphes de « graphiques » dépliés. */
  folds: { vitesse: boolean; fc: boolean };
  heartChartShown: boolean;
  /** Le vent se suit au fil de la session (`windStats`). */
  windShown: boolean;
  zones: HrZones;
  minutes: readonly number[];
  heart: SessionHeartRate;
  cardioZoom: ChartZoomSource;
  onShowOnMap: (panel: CompanionPanel) => void;
}) {
  switch (panel) {
    case 'graphiques':
      return (
        <ZoomView zoom={chartZoom}>
          {(z) => (
            <>
              {folds.vitesse && (
                <>
                  <HoverReadout line read={readers.readSpeed(z)} label="Vitesse" color={SAILING_SPEED_COLOR} />
                  <SailingSpeedChart rows={rows} z={z} timeX={timeX} markLines={markLines} onShowOnMap={() => onShowOnMap('graphiques')} style={COMPANION_CHART_STYLE} />
                </>
              )}
              {heartChartShown && folds.fc && (
                <>
                  <HoverReadout line read={readers.readHeart(z)} label="FC" color={HEART_RATE_COLOR} />
                  <SailingHeartChart rows={rows} z={z} timeX={timeX} zones={zones} showReset={!folds.vitesse} hrMarkLines={hrMarkLines}
                    onShowOnMap={() => onShowOnMap('graphiques')} style={COMPANION_CHART_STYLE} />
                </>
              )}
            </>
          )}
        </ZoomView>
      );
    case 'vent':
      return windShown ? (
        <ZoomView zoom={chartZoom}>
          {(z) => (
            <>
              <HoverReadout line read={readers.windReadout(z)} label="Vent" color={WIND_COLOR} />
              <SailingWindChart rows={rows} z={z} timeX={timeX} markLines={markLines} onShowOnMap={() => onShowOnMap('vent')} style={COMPANION_CHART_STYLE} />
            </>
          )}
        </ZoomView>
      ) : null;
    case 'vmg':
      return rows.vmgChartShown ? (
        <ZoomView zoom={chartZoom}>
          {(z) => (
            <>
              <HoverReadout line read={readers.readVmg(z)} label="VMG" color={VMG_COLOR} />
              <SailingVmgChart rows={rows} z={z} timeX={timeX} markLines={markLines} onShowOnMap={() => onShowOnMap('vmg')} style={COMPANION_CHART_STYLE} />
            </>
          )}
        </ZoomView>
      ) : null;
    case 'cardio':
      return <CardioCompanion minutes={minutes} heart={heart} zoom={cardioZoom} zones={zones} onShowOnMap={() => onShowOnMap('cardio')} style={COMPANION_CHART_STYLE} />;
  }
}
