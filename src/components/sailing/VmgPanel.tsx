/**
 * Onglet « vmg » de la voile : tableau près et portant par amure, podiums des tops de VMG montrables sur la
 * carte, et la courbe de VMG autour de zéro (près au-dessus, portant en dessous), seule à suivre le zoom.
 */
import type { ReactNode } from 'react';
import type { TopSegment } from '../../core/types';
import type { ChartZoomSource } from '../../hooks/useChartZoom';
import type { SailingChartRows } from '../../hooks/useSailingChartRows';
import type { TimeChartAxis } from '../../hooks/useTimeChartAxis';
import { VMG_WINDOW_S } from '../../sailing/sailingConfig';
import type { VmgStats } from '../../sailing/sailingAnalytics';
import { HoverReadout } from '../ChartReadout';
import { HelpText } from '../Help';
import { PanelHeading } from '../PanelTitle';
import ResizablePanel from '../ResizablePanel';
import ZoomView from '../ZoomView';
import { HIGHLIGHT_PODIUM_COLORS, PODIUM_RANKS, TACK_PORT_COLOR, TACK_STARBOARD_COLOR } from '../highlightColors';
import { PANEL_BLOCK_STYLE } from '../styles';
import MapToggle from '../ui/MapToggle';
import { SailingVmgChart } from './SailingCharts';
import { FILL_STYLE, VMG_COLOR, type SailingChartReaders } from './sailingChartParts';

interface VmgPanelProps {
  vmg: VmgStats;
  open: boolean;
  onToggle: () => void;
  /** Vitesse en nœuds vers l'unité de l'activité, sans le symbole. */
  showKn: (kn: number | string) => string;
  /** La courbe a au moins une valeur sur la session ; sinon, une phrase à sa place. */
  chartShown: boolean;
  /** Zoom commun aux graphes sur le temps de la session. */
  chartZoom: ChartZoomSource;
  rows: SailingChartRows;
  readers: SailingChartReaders;
  timeX: TimeChartAxis['timeX'];
  markLines: ReactNode;
  onShowOnMap: () => void;
  /** Comment zoomer, au bout de l'aide. */
  zoomText: string;
  /** Podium montré sur la carte (`vmgUpwind`, `vmgDownwind`), ou `null`. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

export default function VmgPanel({
  vmg: v, open, onToggle, showKn, chartShown, chartZoom, rows, readers, timeX, markLines, onShowOnMap, zoomText, selected, onSelect,
}: VmgPanelProps) {
  /** Podium de VMG (près, portant) : les tops de vitesse passent par `TopsPanel`. */
  const renderTop3 = (title: string, topKey: string, values: Pick<TopSegment, 'val' | 'path'>[]) => (
    <div className="an-vmg-top">
      <div className="an-vmg-top__head">
        <strong>{title}</strong>
        <MapToggle
          shown={selected === topKey} color="var(--voile)" labels={['Voir (Carte)', 'Masquer (Carte)']}
          onClick={() => onSelect(selected === topKey ? null : topKey)} />
      </div>
      <div className="an-vmg-top__ranks">
        {PODIUM_RANKS.map((rank, idx) => (
          <span key={rank} style={{ color: HIGHLIGHT_PODIUM_COLORS[idx] }}>{rank}: {values[idx] ? showKn(values[idx].val) : '-'}</span>
        ))}
      </div>
    </div>
  );

  return (
    <ResizablePanel id="sailing.carte.vmg" style={PANEL_BLOCK_STYLE}>
      <PanelHeading label="Analyse VMG" open={open} onToggle={onToggle} helpKey="voile:vmg" />
      <HelpText helpKey="voile:vmg" note>
        La VMG est la vitesse utile vers le vent, moyennée sur {VMG_WINDOW_S} s : sur la courbe, au-dessus de zéro au près, en dessous au portant.
        Les manœuvres, le temps de la rotation, sont écartées des chiffres (moyennes, max, tops) comme de la courbe, qui les franchit d'un trait droit. Un arrêt ou un passage sous le seuil d'activité y laisse un trou. {zoomText}
      </HelpText>
      <table className="ui-table" style={{ textAlign: 'center' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)', borderBottom: '1px solid var(--line-strong)' }}>
            <th>Allure</th>
            <th style={{ color: TACK_PORT_COLOR }}>Bâbord (Moy/Max)</th>
            <th style={{ color: TACK_STARBOARD_COLOR }}>Tribord (Moy/Max)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="an-vmg-allure">Près</td>
            <td>{showKn(v.upPort.avg)} / <strong>{showKn(v.upPort.max)}</strong></td>
            <td>{showKn(v.upStbd.avg)} / <strong>{showKn(v.upStbd.max)}</strong></td>
          </tr>
          <tr>
            <td className="an-vmg-allure">Portant</td>
            <td>{showKn(v.downPort.avg)} / <strong>{showKn(v.downPort.max)}</strong></td>
            <td>{showKn(v.downStbd.avg)} / <strong>{showKn(v.downStbd.max)}</strong></td>
          </tr>
        </tbody>
      </table>
      <div className="an-vmg-tops">
        <div>
          {renderTop3("Tops Près (10s)", "vmgUpwind", v.topsUpwind)}
        </div>
        <div>
          {renderTop3("Tops Portant (10s)", "vmgDownwind", v.topsDownwind)}
        </div>
      </div>
      {chartShown ? (
        <ResizablePanel id="sailing.graph.vmg" defaultHeight={250} minWidth={250} minHeight={180} style={{ marginTop: '10px', width: '100%', boxSizing: 'border-box', overflow: 'hidden', border: '1px dashed var(--line-strong)', padding: '10px', backgroundColor: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
          {/* Le graphe seul suit le zoom : ni le tableau ni les podiums ne se redessinent. */}
          <ZoomView zoom={chartZoom}>
            {(z) => (
              <>
                <div className="chart-head" style={{ marginBottom: '10px' }}>
                  <HoverReadout read={readers.readVmg(z)} label="VMG" color={VMG_COLOR} />
                </div>
                <div style={{ flexGrow: 1, width: '100%', position: 'relative' }}>
                  <SailingVmgChart rows={rows} z={z} timeX={timeX} markLines={markLines} onShowOnMap={onShowOnMap} style={FILL_STYLE} />
                </div>
              </>
            )}
          </ZoomView>
        </ResizablePanel>
      ) : (
        <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
          Pas de courbe : aucun passage de {VMG_WINDOW_S} s au-dessus du seuil d'activité, hors des manœuvres.
        </p>
      )}
    </ResizablePanel>
  );
}
