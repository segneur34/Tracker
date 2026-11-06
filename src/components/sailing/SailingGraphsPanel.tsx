/**
 * Onglet « graphiques » de la voile : vitesse, FC (si la session en a) et polaire de vitesse, chacun replié à
 * part par son titre pour ne comparer que ceux qui restent ouverts (16/10). Replié, un graphe se réduit à son
 * titre ; sa taille mémorisée l'attend. Les replis sont tenus par le module (la FC et la carte en plein écran
 * les lisent).
 */
import { useMemo, type ReactNode } from 'react';
import { SPEED_UNIT_SYMBOL, knotsToChartValue, type SpeedUnit } from '../../core/units';
import type { ChartZoomSource } from '../../hooks/useChartZoom';
import type { useAnalysisHeart } from '../../hooks/useAnalysisHeart';
import type { SailingChartRows } from '../../hooks/useSailingChartRows';
import type { TimeChartAxis } from '../../hooks/useTimeChartAxis';
import type { PolarBin } from '../../sailing/wind';
import { GraphFoldHead } from '../ChartFold';
import type { Readout } from '../ChartReadout';
import { HelpText } from '../Help';
import PanelTitle from '../PanelTitle';
import ResizablePanel from '../ResizablePanel';
import SpeedPolarChart from '../SpeedPolarChart';
import ZoomView from '../ZoomView';
import { PANEL_BLOCK_STYLE } from '../styles';
import { SailingHeartChart, SailingSpeedChart } from './SailingCharts';
import { FILL_STYLE, SAILING_GRAPH_COLORS, type SailingChartReaders, type SailingGraphFold } from './sailingChartParts';

interface SailingGraphsPanelProps {
  open: boolean;
  onToggle: () => void;
  /** Graphes dépliés et leur repli (`useOpenSections('sailing-graphes', …)` du module). */
  folds: { open: Record<SailingGraphFold, boolean>; toggle: (key: SailingGraphFold) => void };
  /** La courbe de FC a des lignes (FC présente, au moins deux points). */
  heartChartShown: boolean;
  /** Zoom commun aux graphes sur le temps de la session. */
  chartZoom: ChartZoomSource;
  rows: SailingChartRows;
  readers: SailingChartReaders;
  timeX: TimeChartAxis['timeX'];
  markLines: ReactNode;
  /** Traits des repères sur l'axe de la FC. */
  hrMarkLines: ReactNode;
  zones: ReturnType<typeof useAnalysisHeart>['hrZones'];
  onShowOnMap: () => void;
  /** Polaire de vitesse, en nœuds (`useSailingSession`). */
  polar: PolarBin[];
  speedUnit: SpeedUnit;
  /** Comment zoomer, au bout de l'aide. */
  zoomText: string;
}

export default function SailingGraphsPanel({
  open, onToggle, folds, heartChartShown, chartZoom, rows, readers, timeX, markLines, hrMarkLines, zones, onShowOnMap, polar: polarGraphData,
  speedUnit, zoomText,
}: SailingGraphsPanelProps) {
  const speedSymbol = SPEED_UNIT_SYMBOL[speedUnit];
  // Polaire dans l'unité ; en nœuds, celle du hook telle quelle.
  const polarGraphShown = useMemo(
    () => (speedUnit === 'kn' ? polarGraphData : polarGraphData.map((p) => ({ ...p, vitesse: knotsToChartValue(p.vitesse, speedUnit) }))),
    [polarGraphData, speedUnit]
  );
  const graphTitle = (key: SailingGraphFold, label: string, read?: (index: number) => Readout | null) => (
    <GraphFoldHead label={label} color={SAILING_GRAPH_COLORS[key]} open={folds.open[key]} onToggle={() => folds.toggle(key)} read={read}
      title={folds.open[key] ? 'Replier ce graphe' : 'Montrer ce graphe'}
      style={{ justifyContent: read === undefined ? 'center' : undefined, marginBottom: '10px' }} />
  );
  const foldedGraph = (key: SailingGraphFold, label: string, widthPx: number) => (
    <div style={{ flex: 'none', width: `${widthPx}px`, maxWidth: '100%', boxSizing: 'border-box', border: '1px dashed var(--line-strong)', padding: '10px 10px 0', backgroundColor: 'var(--surface)' }}>
      {graphTitle(key, label)}
    </div>
  );

  return (
    <div style={{ ...PANEL_BLOCK_STYLE, display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 100%' }}>
        <PanelTitle label="Graphiques" open={open} onToggle={onToggle} helpKey="voile:graphiques" />
        <HelpText helpKey="voile:graphiques" note>Le survol déplace le repère sur la carte. {zoomText}</HelpText>
      </div>

      {folds.open.vitesse ? (
      <ResizablePanel id="sailing.graph.vitesse" defaultHeight={350} minWidth={250} minHeight={200} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        {/* Le graphe suit le zoom, pas le module ni la polaire (lot 127). */}
        <ZoomView zoom={chartZoom}>
          {(z) => (
            <>
              {graphTitle('vitesse', 'Historique de Vitesse', readers.readSpeed(z))}
              <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                <SailingSpeedChart rows={rows} z={z} timeX={timeX} markLines={markLines} onShowOnMap={onShowOnMap} style={FILL_STYLE} />
              </div>
            </>
          )}
        </ZoomView>
      </ResizablePanel>
      ) : foldedGraph('vitesse', 'Historique de Vitesse', 500)}

      {heartChartShown && (
        folds.open.fc ? (
        <ResizablePanel id="sailing.graph.fc" defaultHeight={250} minWidth={250} minHeight={160} style={{ flex: 'none', width: '500px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
          <ZoomView zoom={chartZoom}>
            {(z) => (
              <>
                {graphTitle('fc', 'Fréquence cardiaque', readers.readHeart(z))}
                <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                  <SailingHeartChart rows={rows} z={z} timeX={timeX} zones={zones} showReset={!folds.open.vitesse} hrMarkLines={hrMarkLines}
                    onShowOnMap={onShowOnMap} style={FILL_STYLE} />
                </div>
              </>
            )}
          </ZoomView>
        </ResizablePanel>
        ) : foldedGraph('fc', 'Fréquence cardiaque', 500)
      )}

      {folds.open.polaire ? (
      <ResizablePanel id="sailing.graph.polaire" defaultHeight={350} minWidth={250} minHeight={250} style={{ flex: 'none', width: '350px', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
        {graphTitle('polaire', 'Polaire de Vitesse (TWA)')}
        <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
          <SpeedPolarChart data={polarGraphShown} unitSymbol={speedSymbol} />
        </div>
      </ResizablePanel>
      ) : foldedGraph('polaire', 'Polaire de Vitesse (TWA)', 350)}
    </div>
  );
}
