import { roundTo, toFixedNumber } from '../core/basics';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ReferenceLine } from 'recharts';
import { jumpCurveRows, jumpDoubtLabel, type JumpCurveRow, type SessionJump } from '../core/jumps';
import { JUMP_DETECTION } from '../core/sportProfiles';
import { formatShortDistance, formatSpeed, formatTimeOfDay, type DistanceUnit, type SpeedUnit } from '../core/units';
import type { JumpsStatus } from '../hooks/useSessionJumps';
import { createHoverStore } from '../hooks/useChartHover';
import { useChartZoom } from '../hooks/useChartZoom';
import { RowReadout, type Readout } from './ChartReadout';
import { clearTrackHover, hoveredRow, inChartView, trackHover, type ChartHoverEvent } from './chartHover';
import { CHART_TICK } from './chartStyle';
import TrackChart, { type TrackSeries, type TrackYAxis } from './TrackChart';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import { HelpText, HelpToggle } from './Help';
import { PanelHeading } from './PanelTitle';
import ResizablePanel from './ResizablePanel';
import { ANALYSIS_PANEL_STYLE } from './styles';
import './JumpsPanel.css';
import StatTile from './ui/StatTile';
import MapToggle from './ui/MapToggle';
import SegmentedControl from './ui/SegmentedControl';

/**
 * Onglet « sauts » des analyses (voile, course, vélo) : les sauts mesurés par les capteurs du
 * téléphone (`core/jumps.ts`, rangés dans la fiche par `useSessionJumps`).
 * Chiffres, podium des trois plus hauts, tableau trié au choix (hauteur, vol,
 * longueur), et courbe d'un saut, ou de deux pour les comparer. Le calcul est
 * ailleurs ; ici, l'affichage.
 */

/** Courbes comparées : le premier saut en bleu, le second en orange. */
const CURVE_COLORS = ['#1565c0', '#ef6c00'];
const CURVE_HEIGHT_PX = 220;
/** Abscisse de la courbe : secondes depuis le décollage. */
const CURVE_X = { key: 't', format: (v: number) => `${toFixedNumber(v, 2)} s` };
/** Hauteur, en mètres, depuis le sol. */
const CURVE_Y: TrackYAxis[] = [{ color: 'var(--chart-axis)', domain: [0, 'auto'], width: 42, tick: CHART_TICK, tickFormatter: (v: number) => `${roundTo(v, 1)} m` }];

/** Tri du tableau. */
type JumpSort = 'hauteur' | 'vol' | 'longueur';

const SORTS: { key: JumpSort; label: string }[] = [
  { key: 'hauteur', label: 'Hauteur' },
  { key: 'vol', label: 'Vol' },
  { key: 'longueur', label: 'Longueur' },
];

const sortValue = (j: SessionJump, sort: JumpSort): number =>
  sort === 'hauteur' ? j.heightM : sort === 'vol' ? j.flightS : (j.lengthM ?? -1);

export interface JumpsPanelProps {
  status: JumpsStatus;
  error: string | null;
  /** Sauts montrés (hauteur minimale atteinte, pris au seuil d'activité ou plus), dans l'ordre du temps. */
  jumps: SessionJump[];
  /** Sauts rangés mais cachés : plus bas que la hauteur minimale, ou pris sous le seuil d'activité. */
  hiddenCount: number;
  /** Hauteur minimale de l'activité, en mètres. */
  minHeightM: number;
  /** Seuil d'activité de la session, en clair, avec son unité. */
  thresholdLabel: string;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  open: boolean;
  onToggle: () => void;
  /** Saut montré sur la carte, par l'heure de son décollage. */
  shownJump: number | null;
  onShowJump: (takeoffMs: number | null) => void;
  podiumShown: boolean;
  onTogglePodium: () => void;
  /** Point de trace le plus proche d'un instant : relie la courbe à la carte. */
  trackIndexAt: (ms: number) => number;
  /** Début des `id` des blocs, dont la taille est mémorisée : `sailing`, `running`, `cycling`. */
  panelPrefix?: string;
  /** Couleur des boutons choisis : celle du module. */
  accent?: string;
  /** Voile : l'aide parle de la planche et du foil. */
  sailing?: boolean;
}

const cellStyle: CSSProperties = { padding: '0.4em 0.6em', textAlign: 'center' };
const noteStyle: CSSProperties = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', lineHeight: 1.45 };

const meters = (m: number) => `${m.toFixed(2)} m`;
const seconds = (s: number) => `${s.toFixed(2)} s`;
const rank = (k: number) => `${k + 1}${k === 0 ? 'er' : 'e'}`;
/** Raisons d'un doute, en clair, pour l'infobulle. */
const doubtText = (jump: SessionJump) => `Mesure douteuse : ${jump.doubts.map((d) => jumpDoubtLabel(d, JUMP_DETECTION)).join(' ; ')}.`;

/**
 * Courbe d'un saut, ou de deux calés sur leur décollage (25/10) : zoom
 * (double-clic, zone tirée, deux doigts) et lecture au-dessus du graphe ; le
 * survol déplace le repère sur la carte. Pas de « +carte » : « Voir »
 * y montre déjà le saut.
 */
function JumpCurveChart({ first, second, numbers, trackIndexAt }: {
  /** Le saut de la courbe, et celui qu'on lui compare. */
  first: SessionJump;
  second: SessionJump | null;
  /** Numéro de chaque saut dans la séance. */
  numbers: number[];
  /** Point de trace le plus proche d'un instant : relie la courbe à la carte. */
  trackIndexAt: (ms: number) => number;
}) {
  const jumps = useMemo(() => (second ? [first, second] : [first]), [first, second]);
  /** Lignes de la courbe, refaites seulement quand les sauts comparés changent, non à chaque survol. */
  const rows = useMemo(() => jumpCurveRows(first, second, trackIndexAt), [first, second, trackIndexAt]);
  const full = rows.length > 1 ? { min: rows[0].t, max: rows[rows.length - 1].t } : null;
  const zoom = useChartZoom(full, jumps.map((j) => j.takeoffMs).join('-'));
  /** Ligne survolée, hors de l'état du graphe : le doigt qui glisse ne redessine que la lecture ; le point de trace va au magasin commun. */
  const [hover] = useState(() => createHoverStore<JumpCurveRow>());
  const onTrackHover = trackHover(rows);
  const onHover = (e: ChartHoverEvent) => {
    hover.set(hoveredRow(e, rows));
    onTrackHover(e);
  };
  const series: TrackSeries<JumpCurveRow>[] = jumps.map((_, k) => (
    { kind: 'line', key: k === 0 ? 'premier' : 'second', name: k === 0 ? 'premier' : 'second', color: CURVE_COLORS[k], width: 2, activeDotR: 4, connectNulls: true }
  ));
  const read = (hovered: JumpCurveRow): Readout | null => (inChartView(zoom.view, hovered.t)
    ? {
      values: jumps.map((_, k) => {
        const h = k === 0 ? hovered.premier : hovered.second;
        return { text: `n° ${numbers[k]} : ${h === null ? '—' : `${roundTo(h, 2)} m`}`, color: CURVE_COLORS[k] };
      }),
      at: `${hovered.t} s depuis le décollage`,
    }
    : null);
  return (
    <>
      <RowReadout line store={hover} read={read} />
      <TrackChart rows={rows} zoom={zoom} x={CURVE_X} yAxes={CURVE_Y} series={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
        onHover={onHover} onLeave={() => {
          hover.set(null);
          clearTrackHover();
        }} style={{ height: `${CURVE_HEIGHT_PX}px` }}>
        <ReferenceLine y={0} stroke="var(--line-strong)" />
        <ReferenceLine x={0} stroke="var(--muted)" strokeDasharray="4 3" label={{ value: 'décollage', fontSize: 11, position: 'insideTopLeft' }} />
        {jumps.map((j, k) => (
          <ReferenceLine key={j.takeoffMs} x={roundTo(j.flightS, 2)} stroke={CURVE_COLORS[k]} strokeDasharray="4 3"
            label={k === 0 ? { value: 'atterrissage', fontSize: 11, position: 'insideTopRight' } : undefined} />
        ))}
      </TrackChart>
    </>
  );
}

function JumpsPanel({
  status, error, jumps, hiddenCount, minHeightM, thresholdLabel, speedUnit, distanceUnit, open, onToggle,
  shownJump, onShowJump, podiumShown, onTogglePodium, trackIndexAt,
  panelPrefix = 'sailing', accent = 'var(--voile)', sailing = true,
}: JumpsPanelProps) {
  /** Ancre de la courbe, pour « Détail ». */
  const curveAnchorId = `${panelPrefix}-jump-curve`;
  const [sort, setSort] = useState<JumpSort>('hauteur');
  /** Sauts de la courbe, par l'heure de leur décollage : le premier (le plus haut d'office), et celui qu'on lui compare. */
  const [curveFirst, setCurveFirst] = useState<number | null>(null);
  const [curveSecond, setCurveSecond] = useState<number | null>(null);
  const heading = (label: string, helpKey?: string) => <PanelHeading label={label} open={open} onToggle={onToggle} helpKey={helpKey} padRight />;
  const hiddenNote = hiddenCount > 0
    ? `${hiddenCount} ${hiddenCount > 1 ? 'autres vols, plus bas' : 'autre vol, plus bas'} que ${meters(minHeightM)} ou pris sous ${thresholdLabel}, ${hiddenCount > 1 ? 'ne sont pas montrés' : "n'est pas montré"}.`
    : null;

  if (status !== 'ready' || jumps.length === 0) {
    const text = status === 'computing'
      ? 'Calcul des sauts…'
      : status === 'error'
        ? `Sauts indisponibles : ${error ?? 'calcul impossible'}.`
        : `Aucun saut d'au moins ${meters(minHeightM)} pris à ${thresholdLabel} ou plus.`;
    return (
      <ResizablePanel id={`${panelPrefix}.sauts`} style={ANALYSIS_PANEL_STYLE}>
        {heading('Sauts')}
        <div style={{ color: 'var(--muted)' }}>{text}</div>
        {status === 'ready' && hiddenNote && <div style={noteStyle}>{hiddenNote}</div>}
      </ResizablePanel>
    );
  }

  const order = new Map(jumps.map((j, k) => [j.takeoffMs, k + 1]));
  const byHeight = [...jumps].sort((a, b) => b.heightM - a.heightM);
  const sorted = [...jumps].sort((a, b) => sortValue(b, sort) - sortValue(a, sort));
  const highest = byHeight[0];
  const longest = jumps.reduce((a, b) => (b.flightS > a.flightS ? b : a));
  const farthest = jumps.reduce<SessionJump | null>((a, b) => (b.lengthM !== null && (a === null || b.lengthM > (a.lengthM ?? 0)) ? b : a), null);
  const first = jumps.find((j) => j.takeoffMs === curveFirst) ?? highest;
  const second = jumps.find((j) => j.takeoffMs === curveSecond && j.takeoffMs !== first.takeoffMs) ?? null;
  const jumpLabel = (j: SessionJump) => `n° ${order.get(j.takeoffMs)} · ${meters(j.heightM)} · ${formatTimeOfDay(j.takeoffMs)}`;
  const stat = (label: string, value: ReactNode, detail?: string) => <StatTile label={label} value={value} detail={detail} />;
  /** « Détail » : le saut sur la courbe, et la page descend jusqu'à elle. */
  const showDetail = (j: SessionJump) => {
    setCurveFirst(j.takeoffMs);
    if (curveSecond === j.takeoffMs) setCurveSecond(null);
    document.getElementById(curveAnchorId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const jumpsPanel = (
    <ResizablePanel id={`${panelPrefix}.sauts`} style={ANALYSIS_PANEL_STYLE}>
      {heading('Sauts', 'analyse:sauts')}
      <HelpText helpKey="analyse:sauts" note>
          Hauteur gagnée par le téléphone, donc par le buste, au-dessus de son niveau au décollage, mesurée par
          l'accéléromètre et le gyroscope : ce n'est pas la hauteur {sailing ? "de la planche au-dessus de l'eau" : 'des pieds ou des roues au-dessus du sol'}. Précision attendue,
          téléphone sur la poitrine : {sailing ? '±0,1 à 0,2 m sans foil, ±0,2 à 0,3 m sur foil' : '±0,1 à 0,2 m'} ; davantage au bras. Vol : du décollage
          à l'atterrissage. Longueur : chemin parcouru pendant le vol, lu sur la trace ; vitesse : au décollage. « ≈ » marque
          une mesure douteuse, dont la raison s'affiche au survol. « Voir » montre le saut sur la carte, « Détail » sur la
          courbe. Sont montrés les sauts d'au moins {meters(minHeightM)} (Réglages, carte de l'activité) pris à {thresholdLabel}
          ou plus (seuil d'activité de la session).
      </HelpText>
      <div className="an-sheet__stats an-sheet__stats--always">
        {stat('Sauts', `${jumps.length}`)}
        {stat('Plus haut', meters(highest.heightM), formatTimeOfDay(highest.takeoffMs))}
        {stat('Plus long vol', seconds(longest.flightS), formatTimeOfDay(longest.takeoffMs))}
        {farthest && farthest.lengthM !== null && stat('Plus long saut', formatShortDistance(farthest.lengthM, distanceUnit), formatTimeOfDay(farthest.takeoffMs))}
      </div>

      <div style={{ margin: '10px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <strong>Les plus hauts</strong>
          <MapToggle shown={podiumShown} color={accent} labels={['Voir (Carte)', 'Masquer (Carte)']} onClick={onTogglePodium} />
        </div>
        <ol className="an-jump-podium">
          {byHeight.slice(0, 3).map((j, k) => (
            <li key={j.takeoffMs}>
              <span className="an-jump-podium__dot" style={{ backgroundColor: HIGHLIGHT_PODIUM_COLORS[k] }} />
              {rank(k)} · <strong>{meters(j.heightM)}</strong> · {formatTimeOfDay(j.takeoffMs)}
            </li>
          ))}
        </ol>
      </div>

      <div className="an-jump-sort">
        <span style={{ color: 'var(--muted)' }}>Trier par</span>
        <SegmentedControl label="Trier les sauts" items={SORTS} value={sort} onChange={setSort} accent={accent} />
      </div>
      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <table className="ui-table ui-table--cards an-jump-table">
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
              <th style={{ ...cellStyle, textAlign: 'left' }} title="Numéro du saut dans la séance">N°</th>
              <th style={cellStyle}>Heure</th>
              <th style={cellStyle}>Hauteur</th>
              <th style={cellStyle}>Vol</th>
              <th style={cellStyle}>Longueur</th>
              <th style={cellStyle}>Vitesse</th>
              <th style={cellStyle} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((j) => {
              const shown = shownJump === j.takeoffMs;
              const doubtful = j.doubts.length > 0;
              const onCurve = j.takeoffMs === first.takeoffMs || j.takeoffMs === second?.takeoffMs;
              return (
                <tr key={j.takeoffMs} className="ui-table__row">
                  <td className="an-jump-num" style={{ ...cellStyle, textAlign: 'left', fontWeight: 700 }}>{order.get(j.takeoffMs)}</td>
                  <td className="an-jump-time num" style={cellStyle}>{formatTimeOfDay(j.takeoffMs)}</td>
                  <td className="an-jump-height" style={{ ...cellStyle, fontWeight: 700 }} title={doubtful ? doubtText(j) : undefined}>
                    {doubtful && <span className="an-jump-doubt" aria-label="mesure douteuse">≈ </span>}
                    {meters(j.heightM)}
                  </td>
                  <td className="an-jump-flight" data-label="vol" style={cellStyle}>{seconds(j.flightS)}</td>
                  <td className="an-jump-length" style={cellStyle}>{j.lengthM === null ? '—' : formatShortDistance(j.lengthM, distanceUnit)}</td>
                  <td className="an-jump-speed" style={cellStyle}>{formatSpeed(j.speedMs, speedUnit)}</td>
                  <td className="an-jump-map" style={cellStyle}>
                    <span className="an-jump-actions">
                      <MapToggle shown={shown} color={HIGHLIGHT_SHOWN_COLOR} onClick={() => onShowJump(shown ? null : j.takeoffMs)} />
                      <MapToggle shown={onCurve} color={CURVE_COLORS[0]} labels={['Détail', 'Détail']} onClick={() => showDetail(j)} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hiddenNote && <div style={noteStyle}>{hiddenNote}</div>}
    </ResizablePanel>
  );

  // Courbe d'un saut, ou de deux calés sur leur décollage : hauteur selon le temps depuis le décollage.
  const shown = second ? [first, second] : [first];
  const select = (value: number | null, onChange: (v: number | null) => void, allowNone: boolean, exclude: number | null) => (
    <select className="ui-field ui-field--s" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">aucun</option>}
      {jumps.filter((j) => j.takeoffMs !== exclude).map((j) => (
        <option key={j.takeoffMs} value={j.takeoffMs}>{jumpLabel(j)}</option>
      ))}
    </select>
  );
  const curvePanel = (
    <ResizablePanel id={`${panelPrefix}.sauts.courbe`} style={ANALYSIS_PANEL_STYLE}>
      <div id={curveAnchorId} className="an-jump-compare">
        <label>
          <span className="an-jump-compare__dot" style={{ backgroundColor: CURVE_COLORS[0] }} />
          Saut {select(first.takeoffMs, (v) => setCurveFirst(v), false, null)}
        </label>
        <label>
          <span className="an-jump-compare__dot" style={{ backgroundColor: CURVE_COLORS[1] }} />
          comparer avec {select(second?.takeoffMs ?? null, (v) => setCurveSecond(v), true, first.takeoffMs)}
        </label>
        <HelpToggle helpKey="analyse:sauts-courbe" label="Courbe des sauts" size="s" />
      </div>
      <HelpText helpKey="analyse:sauts-courbe" note>
        Hauteur du téléphone au-dessus de son niveau au décollage. Les deux sauts comparés partent du même instant.
      </HelpText>
      <div style={{ color: 'var(--muted)', marginBottom: '6px' }}>
        {shown.map((j, k) => (
          <span key={j.takeoffMs} style={{ marginRight: '14px', color: CURVE_COLORS[k] }}>
            n° {order.get(j.takeoffMs)} : {meters(j.heightM)} · {seconds(j.flightS)} de vol
          </span>
        ))}
      </div>
      <JumpCurveChart first={first} second={second} numbers={shown.map((j) => order.get(j.takeoffMs) ?? 0)} trackIndexAt={trackIndexAt} />
    </ResizablePanel>
  );

  return (
    <>
      {jumpsPanel}
      {curvePanel}
    </>
  );
}

export default JumpsPanel;
