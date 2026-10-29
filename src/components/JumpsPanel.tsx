import { useState, type CSSProperties, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { jumpDoubtLabel, type SessionJump } from '../core/jumps';
import { JUMP_DETECTION } from '../core/sportProfiles';
import { formatShortDistance, formatSpeed, formatTimeOfDay, type DistanceUnit, type SpeedUnit } from '../core/units';
import type { JumpsStatus } from '../hooks/useSessionJumps';
import { niceTicks } from '../core/chartZoom';
import { useChartZoom } from '../hooks/useChartZoom';
import ChartReadout, { type Readout } from './ChartReadout';
import { NO_TOOLTIP_CONTENT, hoveredRow, inChartView, type ChartHoverEvent } from './chartHover';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import { HIGHLIGHT_PODIUM_COLORS, HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import { HelpText, HelpToggle } from './Help';
import PanelTitle from './PanelTitle';
import ResizablePanel from './ResizablePanel';
import { CARD_STYLE, HALF_PANEL_STYLE } from './styles';
import './JumpsPanel.css';
import StatTile from './ui/StatTile';
import MapToggle from './ui/MapToggle';

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
  onCurveHover: (rows: ReadonlyArray<{ index: number }>) => (e: ChartHoverEvent) => void;
  onCurveLeave: () => void;
  /** Début des `id` des blocs, dont la taille est mémorisée : `sailing`, `running`, `cycling`. */
  panelPrefix?: string;
  /** Couleur des boutons choisis : celle du module. */
  accent?: string;
  /** Voile : l'aide parle de la planche et du foil. */
  sailing?: boolean;
}

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' };
const cellStyle: CSSProperties = { padding: '0.4em 0.6em', textAlign: 'center' };
const noteStyle: CSSProperties = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', lineHeight: 1.45 };

const meters = (m: number) => `${m.toFixed(2)} m`;
const seconds = (s: number) => `${s.toFixed(2)} s`;
const rank = (k: number) => `${k + 1}${k === 0 ? 'er' : 'e'}`;
/** Raisons d'un doute, en clair, pour l'infobulle. */
const doubtText = (jump: SessionJump) => `Mesure douteuse : ${jump.doubts.map((d) => jumpDoubtLabel(d, JUMP_DETECTION)).join(' ; ')}.`;

/** Point d'une courbe, en centièmes de seconde depuis le décollage : les deux courbes partagent leurs instants. */
const curvePoints = (j: SessionJump): Map<number, number> => {
  const points = new Map<number, number>();
  j.curve.heightsM.forEach((h, k) => points.set(Math.round((j.curve.startS + k * j.curve.stepS) * 100), h));
  return points;
};

/** Ligne de la courbe : `t` en secondes depuis le décollage, la hauteur de chaque saut, le point de trace. */
interface CurveRow {
  t: number;
  premier: number | null;
  second: number | null;
  index: number;
}

/**
 * Courbe d'un saut, ou de deux calés sur leur décollage (25/10) : zoom
 * (double-clic, zone tirée, deux doigts) et lecture au-dessus du graphe ; le
 * survol déplace le repère sur la carte. Pas de « +carte » : « Voir »
 * y montre déjà le saut.
 */
function JumpCurveChart({ rows, jumps, numbers, onCurveHover, onCurveLeave }: {
  rows: CurveRow[];
  /** Le saut de la courbe, et celui qu'on lui compare. */
  jumps: SessionJump[];
  /** Numéro de chaque saut dans la séance. */
  numbers: number[];
  onCurveHover: (e: ChartHoverEvent) => void;
  onCurveLeave: () => void;
}) {
  const full = rows.length > 1 ? { min: rows[0].t, max: rows[rows.length - 1].t } : null;
  const zoom = useChartZoom(full, jumps.map((j) => j.takeoffMs).join('-'));
  const [hovered, setHovered] = useState<CurveRow | null>(null);
  const onHover = (e: ChartHoverEvent) => {
    setHovered(hoveredRow(e, rows));
    onCurveHover(e);
  };
  const readout: Readout | null = hovered && inChartView(zoom.view, hovered.t)
    ? {
      values: jumps.map((_, k) => {
        const h = k === 0 ? hovered.premier : hovered.second;
        return { text: `n° ${numbers[k]} : ${h === null ? '—' : `${Math.round(h * 100) / 100} m`}`, color: CURVE_COLORS[k] };
      }),
      at: `${hovered.t} s depuis le décollage`,
    }
    : null;
  return (
    <>
      <ChartReadout line readout={readout} />
      <ZoomableChart zoom={zoom} style={{ height: `${CURVE_HEIGHT_PX}px` }} onLeave={() => {
        setHovered(null);
        onCurveLeave();
      }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} onMouseMove={onHover} onTouchMove={onHover}>
            <ChartZoomProbe />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line-soft)" />
            <XAxis dataKey="t" type="number" allowDataOverflow domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : ['dataMin', 'dataMax']}
              ticks={zoom.view ? niceTicks(zoom.view) : undefined}
              tickFormatter={(v: number) => `${parseFloat(v.toFixed(2))} s`} tick={{ fontSize: 11 }} />
            <YAxis width={42} tickFormatter={(v: number) => `${Math.round(v * 10) / 10} m`} tick={{ fontSize: 11 }} />
            <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
            <ReferenceLine y={0} stroke="var(--line-strong)" />
            <ReferenceLine x={0} stroke="var(--muted)" strokeDasharray="4 3" label={{ value: 'décollage', fontSize: 11, position: 'insideTopLeft' }} />
            {jumps.map((j, k) => (
              <ReferenceLine key={j.takeoffMs} x={Math.round(j.flightS * 100) / 100} stroke={CURVE_COLORS[k]} strokeDasharray="4 3"
                label={k === 0 ? { value: 'atterrissage', fontSize: 11, position: 'insideTopRight' } : undefined} />
            ))}
            <Line type="monotone" dataKey="premier" stroke={CURVE_COLORS[0]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            {jumps.length > 1 && <Line type="monotone" dataKey="second" stroke={CURVE_COLORS[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
          </LineChart>
        </ResponsiveContainer>
      </ZoomableChart>
    </>
  );
}

function JumpsPanel({
  status, error, jumps, hiddenCount, minHeightM, thresholdLabel, speedUnit, distanceUnit, open, onToggle,
  shownJump, onShowJump, podiumShown, onTogglePodium, trackIndexAt, onCurveHover, onCurveLeave,
  panelPrefix = 'sailing', accent = 'var(--voile)', sailing = true,
}: JumpsPanelProps) {
  /** Ancre de la courbe, pour « Détail ». */
  const curveAnchorId = `${panelPrefix}-jump-curve`;
  const [sort, setSort] = useState<JumpSort>('hauteur');
  /** Sauts de la courbe, par l'heure de leur décollage : le premier (le plus haut d'office), et celui qu'on lui compare. */
  const [curveFirst, setCurveFirst] = useState<number | null>(null);
  const [curveSecond, setCurveSecond] = useState<number | null>(null);
  const panelStyle: CSSProperties = { ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' };
  const buttonStyle = (active: boolean, color: string): CSSProperties => ({
    padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: 'pointer', backgroundColor: active ? color : 'var(--surface-sunken)',
    color: active ? 'var(--on-accent)' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px',
  });
  const heading = (label: string, helpKey?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingRight: '28px' }}>
      <PanelTitle label={label} open={open} onToggle={onToggle} helpKey={helpKey} />
    </div>
  );
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
      <ResizablePanel id={`${panelPrefix}.sauts`} style={panelStyle}>
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
    <ResizablePanel id={`${panelPrefix}.sauts`} style={panelStyle}>
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

      <div className="an-jump-sort" role="group" aria-label="Trier les sauts">
        <span style={{ color: 'var(--muted)' }}>Trier par</span>
        {SORTS.map((s) => (
          <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)} style={buttonStyle(sort === s.key, accent)}>
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
        <table className="an-jump-table" style={tableStyle}>
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
                <tr key={j.takeoffMs} style={{ borderTop: '1px solid var(--line-soft)' }}>
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
                      <button type="button" onClick={() => onShowJump(shown ? null : j.takeoffMs)} style={buttonStyle(shown, HIGHLIGHT_SHOWN_COLOR)}>
                        {shown ? 'Masquer' : 'Voir'}
                      </button>
                      <button type="button" onClick={() => showDetail(j)} style={buttonStyle(onCurve, CURVE_COLORS[0])}>
                        Détail
                      </button>
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
  const points = shown.map(curvePoints);
  const instants = [...new Set(points.flatMap((p) => [...p.keys()]))].sort((a, b) => a - b);
  const rows = instants.map((c) => {
    const t = c / 100;
    const owner = points[0].has(c) ? first : second ?? first;
    return { t, premier: points[0].get(c) ?? null, second: points[1]?.get(c) ?? null, index: trackIndexAt(owner.takeoffMs + t * 1000) };
  });
  const select = (value: number | null, onChange: (v: number | null) => void, allowNone: boolean, exclude: number | null) => (
    <select className="ui-field ui-field--s" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">aucun</option>}
      {jumps.filter((j) => j.takeoffMs !== exclude).map((j) => (
        <option key={j.takeoffMs} value={j.takeoffMs}>{jumpLabel(j)}</option>
      ))}
    </select>
  );
  const curvePanel = (
    <ResizablePanel id={`${panelPrefix}.sauts.courbe`} style={panelStyle}>
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
      <JumpCurveChart rows={rows} jumps={shown} numbers={shown.map((j) => order.get(j.takeoffMs) ?? 0)}
        onCurveHover={onCurveHover(rows)} onCurveLeave={onCurveLeave} />
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
