import type { SpanHeartRate } from '../core/heartRate';
import type { CadenceShare } from '../running/cadence';
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipPayloadEntry, type TooltipValueType,
} from 'recharts';
import { niceTicks } from '../core/chartZoom';
import {
  SPEED_UNIT_LABEL, formatShortDistance, formatSpeed, formatSpeedValue, isInverseUnit, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { formatIntervalClock, workoutLabel, type IntervalWorkout } from '../recording/intervalTimer';
import type { IntervalRep, IntervalSummary } from '../running/intervalStats';
import { useChartZoom } from '../hooks/useChartZoom';
import ChartReadout, { type Readout } from './ChartReadout';
import { NO_TOOLTIP_CONTENT, hoveredRow, inChartView, type ChartHoverEvent } from './chartHover';
import ZoomableChart, { ChartZoomProbe } from './ZoomableChart';
import { HIGHLIGHT_PODIUM_COLORS } from './highlightColors';
import { IconChevronRight } from './icons';
import PanelTitle from './PanelTitle';
import ResizablePanel from './ResizablePanel';
import { CARD_STYLE, HALF_PANEL_STYLE } from './styles';
import HelpButton from './ui/HelpButton';
import './IntervalAnalysis.css';

/**
 * Onglet « fractionné » des analyses de course, de vélo et de fractionné
 * (§10, point 89) : pour chaque séance, la synthèse et le tableau des
 * répétitions (avec la mini-courbe de chacune), l'évolution de leur vitesse
 * et le profil moyen d'une répétition. Les séances viennent du compteur, ou
 * des répétitions retrouvées dans la vitesse (`running/intervalDetection.ts`).
 * Les calculs sont dans `running/intervalStats.ts` ; ici, l'affichage.
 */

/** Une séance de la session, mesurée sur la trace. */
export interface IntervalSeriesView {
  /** Séance lancée au compteur, ou déduite des répétitions détectées. */
  workout: IntervalWorkout;
  detected: boolean;
  /** Bloc d'une séance à plusieurs blocs de séries : « Série 2 ». */
  name?: string;
  reps: IntervalRep[];
  summary: IntervalSummary;
  /** FC de l'effort de chaque répétition, dans l'ordre de `reps` ; absente sans FC dans la session. */
  heartRates?: (SpanHeartRate | null)[];
  /** Cadence et longueur de pas de l'effort de chaque répétition (à pied) ; absentes sans cadence dans la session. */
  cadences?: (CadenceShare | null)[];
}

interface IntervalAnalysisProps {
  series: IntervalSeriesView[];
  /** Pas du profil de vitesse, en secondes. */
  stepS: number;
  /** Fin de la mise en vitesse, en part de la vitesse de la répétition. */
  launchFraction: number;
  /** Intervalle médian entre deux points de la trace, en secondes. */
  samplingS: number;
  speedUnit: SpeedUnit;
  distanceUnit: DistanceUnit;
  /** Clé de la taille mémorisée de chaque panneau. */
  panelId: (name: string) => string;
  open: boolean;
  onToggle: () => void;
  /** Répétition montrée sur la carte : `séance-répétition`. */
  selectedLap: string | null;
  onSelectLap: (key: string | null) => void;
  /** Rien à montrer : la phrase qui le dit, à la place des panneaux. */
  emptyText: string | null;
  /** Délai de la récupération, en secondes (`HeartRateProfile.recoveryS`), pour l'en-tête. */
  recoveryS?: number;
}

/** Répétition montrée sur la carte : le violet des tops et des zones de pente. */
const SHOWN_COLOR = '#7b1fa2';
/** Vitesse : le bleu des autres graphes. */
const SPEED_COLOR = '#1e88e5';
const TREND_COLOR = '#757575';
const MEAN_COLOR = '#263238';
/**
 * Répétitions d'une séance, de la première à la dernière : vert, orange puis
 * rouge, les couleurs des podiums, pour voir la progression.
 */
const REP_STOPS = [...HIGHLIGHT_PODIUM_COLORS].reverse().map((hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
const EVOLUTION_HEIGHT_PX = 200;
const PROFILE_HEIGHT_PX = 220;
const SPARK_WIDTH = 96;
const SPARK_HEIGHT = 22;
/** Lissage des mini-courbes, pour l'affichage seulement, en secondes. */
const SPARK_SMOOTHING_S = 5;
/**
 * Au-delà de ce pas médian entre deux points, la trace est trop clairsemée pour
 * le détail d'une répétition : on le dit (trace Komoot du 21/07, un point
 * toutes les 4 s, un toutes les 20 s à l'arrêt).
 */
const SPARSE_SAMPLING_S = 2;
/** Une allure sous cette vitesse tend vers l'infini : un trou plutôt qu'une valeur absurde. */
const MIN_PACE_SPEED_MS = 0.3;

/** Numéros de répétition sous le graphe d'évolution : tous jusqu'à 15, sinon de 5 en 5 (et le premier). */
const repTicks = (first: number, last: number): number[] => {
  const step = last - first < 15 ? 1 : 5;
  const ticks = [first];
  for (let r = Math.ceil((first + 1) / step) * step; r <= last; r += step) ticks.push(r);
  return ticks;
};

/** Couleur de la répétition de rang `i` (depuis 0) sur `count` : vert pour la première, rouge pour la dernière. */
const repColor = (i: number, count: number): string => {
  const f = (count > 1 ? i / (count - 1) : 0) * (REP_STOPS.length - 1);
  const k = Math.min(Math.floor(f), REP_STOPS.length - 2);
  const from = REP_STOPS[k];
  const to = REP_STOPS[k + 1];
  return `#${from.map((c, j) => Math.round(c + (f - k) * (to[j] - c)).toString(16).padStart(2, '0')).join('')}`;
};

/** Petite légende du dégradé des répétitions : « rép. 1 », la bande de couleur, « rép. N ». */
function RepGradientLegend({ count }: { count: number }) {
  if (count < 2) return null;
  const band = `linear-gradient(to right, ${repColor(0, 3)}, ${repColor(1, 3)}, ${repColor(2, 3)})`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--muted)', fontSize: 'var(--text-xs)', fontWeight: 'normal' }}>
      rép. 1
      <span aria-hidden="true" style={{ width: '48px', height: '6px', borderRadius: '3px', background: band }} />
      rép. {count}
    </span>
  );
}

/** Ligne du profil d'une répétition : `t` en secondes depuis le départ, puis `mean`, `r<n>` et leur vitesse en m/s (`<clé>Ms`). */
type ProfileRow = Record<string, number | null>;

/**
 * Profil superposé des répétitions d'une séance (25/10) : zoom (double-clic,
 * zone tirée, deux doigts) et lecture au-dessus du graphe, comme les graphes
 * sur la trace, mais sans « Sur la carte » : les courbes partent toutes du
 * départ de leur répétition, aucune n'est un tronçon de la trace. La lecture
 * donne la moyenne ; les répétitions, trop nombreuses pour une ligne, se
 * lisent sur leurs traits.
 */
function IntervalProfileChart({ data, spanS, launchS, reps, speedAxis, formatMs, resetKey }: {
  data: ProfileRow[];
  /** Durée couverte par le profil, en secondes. */
  spanS: number;
  /** Fin de la mise en vitesse moyenne, en secondes, ou `null`. */
  launchS: number | null;
  reps: IntervalRep[];
  speedAxis: ReactNode;
  formatMs: (ms: number) => string;
  /** Change avec la séance : le zoom revient à tout voir. */
  resetKey: string;
}) {
  const zoom = useChartZoom({ min: 0, max: spanS }, resetKey);
  const [hovered, setHovered] = useState<ProfileRow | null>(null);
  const onHover = (e: ChartHoverEvent) => setHovered(hoveredRow(e, data));
  const t = hovered?.t ?? null;
  const meanMs = hovered?.meanMs ?? null;
  const readout: Readout | null = t !== null && inChartView(zoom.view, t)
    ? { values: [{ text: `Moyenne ${meanMs !== null ? formatMs(meanMs) : '—'}`, color: MEAN_COLOR }], at: `${formatIntervalClock(t)} après le départ` }
    : null;
  return (
    <>
      <ChartReadout line readout={readout} />
      <ZoomableChart zoom={zoom} onLeave={() => setHovered(null)} style={{ width: '100%', height: `${PROFILE_HEIGHT_PX}px` }}>
        <ResponsiveContainer>
          <ComposedChart data={data} onMouseMove={onHover} onTouchMove={onHover} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <ChartZoomProbe />
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="t" type="number" allowDataOverflow domain={zoom.shown ? [zoom.shown.min, zoom.shown.max] : [0, spanS]}
              ticks={zoom.view ? niceTicks(zoom.view) : undefined}
              tickFormatter={(v: number) => formatIntervalClock(v)} tick={{ fill: '#555', fontSize: 11 }} />
            {speedAxis}
            <Tooltip content={NO_TOOLTIP_CONTENT} isAnimationActive={false} />
            {reps.map((r, i) => (
              <Line key={r.rep} type="monotone" name={`Rép. ${r.rep}`} dataKey={`r${r.rep}`} stroke={repColor(i, reps.length)}
                strokeWidth={1.5} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            ))}
            <Line type="monotone" name="Moyenne" dataKey="mean" stroke={MEAN_COLOR} strokeWidth={3} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
            {launchS !== null && launchS > 0 && (
              <ReferenceLine x={launchS} stroke={TREND_COLOR} strokeDasharray="4 3"
                label={{ value: 'lancé', position: 'insideTopLeft', fill: TREND_COLOR, fontSize: 11 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </ZoomableChart>
    </>
  );
}

/** Écart signé, en pourcentage : « +1.2 % », « −3.0 % ». */
const signedPercent = (fraction: number, decimals = 1): string => {
  const value = Math.abs(fraction * 100).toFixed(decimals);
  if (Number(value) === 0) return `0 %`;
  return `${fraction < 0 ? '−' : '+'}${value} %`;
};

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' };
const cellStyle: CSSProperties = { padding: '0.4em 0.6em', textAlign: 'center' };
const noteStyle: CSSProperties = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', lineHeight: 1.45 };
const chartTooltipStyle = { fontSize: 'var(--text-xs)' } as const;

/**
 * Points de la mini-courbe d'une répétition : son profil une fois lancé
 * (comme le maintien), lissé sur `SPARK_SMOOTHING_S` pour l'affichage
 * seulement. Avant la mise en vitesse, `null` : l'échelle commune ne
 * s'étire pas jusqu'au départ arrêté, et la baisse en fin de répétition se voit.
 */
const sparkPoints = (rep: IntervalRep, stepS: number): (number | null)[] => {
  const from = rep.launchS ?? 0;
  const half = Math.max(0, Math.round(SPARK_SMOOTHING_S / stepS / 2));
  const launched = (k: number) => (k + 0.5) * stepS >= from;
  return rep.profile.map((v, k) => {
    if (v === null || !launched(k)) return null;
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - half); j <= Math.min(rep.profile.length - 1, k + half); j++) {
      const w = rep.profile[j];
      if (w !== null && launched(j)) {
        sum += w;
        n += 1;
      }
    }
    return sum / n;
  });
};

/**
 * Mini-courbe d'une répétition, aux échelles communes de la séance (temps et
 * vitesse) ; le haut est toujours plus rapide.
 */
function Sparkline({ points, length, domain }: { points: (number | null)[]; length: number; domain: { min: number; max: number } }) {
  const span = domain.max - domain.min || 1;
  const x = (k: number) => (length > 1 ? (k / (length - 1)) * SPARK_WIDTH : SPARK_WIDTH / 2);
  const y = (v: number) => SPARK_HEIGHT - 1 - ((v - domain.min) / span) * (SPARK_HEIGHT - 2);
  let d = '';
  let pen = false;
  points.forEach((v, k) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return (
    <svg className="an-ivl-spark" width={SPARK_WIDTH} height={SPARK_HEIGHT} viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} aria-hidden="true">
      <path d={d} fill="none" stroke={SPEED_COLOR} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function IntervalAnalysis({
  series, stepS, launchFraction, samplingS, speedUnit, distanceUnit, panelId, open, onToggle, selectedLap, onSelectLap, emptyText, recoveryS,
}: IntervalAnalysisProps) {
  const [help, setHelp] = useState(false);
  /**
   * Séances repliées, par indice, dans les trois panneaux à la fois (pour ne garder que le profil des
   * 20-20, par exemple) ; remises à zéro quand les séances changent.
   */
  const [folding, setFolding] = useState<{ of: IntervalSeriesView[]; folded: Set<number> }>({ of: series, folded: new Set() });
  const folded = folding.of === series ? folding.folded : new Set<number>();
  const toggleFold = (index: number) => {
    const next = new Set(folded);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setFolding({ of: series, folded: next });
  };
  const inverse = isInverseUnit(speedUnit);
  const noun = inverse ? 'allure' : 'vitesse';
  /** Accélération et seuils : en km/h pour une allure, comme les tops. */
  const rateUnit: SpeedUnit = speedUnit === 'minkm' ? 'kmh' : speedUnit;
  const panelStyle: CSSProperties = { ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: 'var(--text-s)' };
  const display = (ms: number | null): number | null =>
    ms === null || !isFinite(ms) || (inverse && ms < MIN_PACE_SPEED_MS) ? null : parseFloat(toDisplaySpeed(ms, speedUnit).toFixed(2));
  const formatRate = (ms2: number): string =>
    rateUnit === 'ms' ? `${ms2.toFixed(2)} m/s²` : `${toDisplaySpeed(ms2, rateUnit).toFixed(1)} ${SPEED_UNIT_LABEL[rateUnit]} par s`;
  const title = (s: IntervalSeriesView) =>
    s.detected ? `≈ ${workoutLabel(s.workout)}, répétitions détectées` : `${s.name ?? 'Séance'} ${workoutLabel(s.workout)}`;
  /** Titre d'une séance : un bouton à chevron qui la replie ou la déplie dans les trois panneaux. */
  const seriesTitle = (s: IntervalSeriesView, index: number, legend = false) => {
    const isOpen = !folded.has(index);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <button type="button" aria-expanded={isOpen} onClick={() => toggleFold(index)}
          title={isOpen ? 'Replier cette séance' : 'Déplier cette séance'}
          style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink)', fontWeight: 600, fontSize: 'inherit', textAlign: 'left' }}>
          <IconChevronRight size={14} style={{ transform: `rotate(${isOpen ? 90 : 0}deg)`, transition: 'transform 0.15s', flexShrink: 0 }} />
          {title(s)}
        </button>
        {legend && isOpen && <RepGradientLegend count={s.reps.length} />}
      </div>
    );
  };
  /** Séance repliée : son titre seul. */
  const foldedSeries = (s: IntervalSeriesView, index: number) => (
    <div key={index} style={{ marginBottom: '8px' }}>{seriesTitle(s, index)}</div>
  );
  const heading = (label: string, withHelp = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingRight: '28px' }}>
      <PanelTitle label={label} open={open} onToggle={onToggle} />
      {withHelp && <HelpButton size="s" open={help} onToggle={() => setHelp(!help)} label="Ce que disent ces chiffres" />}
    </div>
  );

  if (emptyText !== null) {
    return (
      <ResizablePanel id={panelId('fractionne')} style={panelStyle}>
        {heading('Fractionné')}
        <div style={{ color: 'var(--muted)' }}>{emptyText}</div>
      </ResizablePanel>
    );
  }

  const repsPanel = (
    <ResizablePanel id={panelId('fractionne')} style={panelStyle}>
      {heading('Répétitions', true)}
      {help && (
        <div style={{ ...noteStyle, marginTop: 0, marginBottom: '10px' }}>
          {series.some((s) => s.detected)
            ? "Répétitions retrouvées dans la vitesse : efforts au-dessus du seuil d'effort, réglable dans l'onglet réglages, chacun parti du creux de vitesse qui le précède. "
            : "Répétitions du compteur, datées par l'horloge du téléphone ; une pause du compteur compte dans la durée de sa phase. "}
          Distance et {noun} lues sur la trace. Lancé : temps pour atteindre {Math.round(launchFraction * 100)} % de la vitesse
          de la répétition, avec l'accélération moyenne jusque-là. Maintien : vitesse de la seconde moitié de la répétition
          rapportée à la première, une fois lancé (négatif : on finit moins vite). Dérive : pente de la droite qui suit les
          répétitions, en part de leur vitesse moyenne (négative : on ralentit d'une répétition à l'autre). Régularité :
          écart-type des répétitions sur leur moyenne. Mini-courbe : la vitesse de chaque répétition une fois lancée, lissée
          sur {SPARK_SMOOTHING_S} s, à la même échelle pour toutes, plus haut plus vite. « Voir » montre la répétition sur la
          carte, en violet.
        </div>
      )}
      {samplingS > SPARSE_SAMPLING_S && (
        <div className="ui-alert ui-alert--warning" style={{ marginBottom: '10px', fontSize: 'var(--text-xs)' }}>
          Un point toutes les {samplingS.toFixed(1)} s en médiane : la trace est trop clairsemée pour le détail d'une
          répétition. Les efforts paraissent plus courts et plus lents qu'ils ne l'étaient, une partie tombant dans le long
          segment de la récupération ; lancé, maintien et profils sont approximatifs.
        </div>
      )}
      {series.some((s) => s.detected) && (
        <div style={{ ...noteStyle, marginTop: 0, marginBottom: '10px' }}>
          Répétitions retrouvées dans la vitesse : la fiche de cette session n'a pas les séances du compteur. Si elle a été
          faite avec lui, « Télécharger la session » sur le téléphone, puis « Importer des GPX » ici, les reprend.
        </div>
      )}
      {series.map((s, seriesIndex) => {
        if (folded.has(seriesIndex)) return foldedSeries(s, seriesIndex);
        const { summary } = s;
        const sparks = new Map(s.reps.map((r) => [r.rep, sparkPoints(r, stepS)]));
        const hasHr = s.heartRates?.some((h) => h !== null) ?? false;
        const hasCadence = s.cadences?.some((c) => c !== null) ?? false;
        const tableClass = ['an-ivl-table', ...(hasHr ? ['an-ivl-table--fc'] : []), ...(hasCadence ? ['an-ivl-table--cad'] : [])].join(' ');
        const sparkLength = Math.max(0, ...s.reps.map((r) => r.profile.length));
        const values = [...sparks.values()].flat().filter((v): v is number => v !== null);
        const domain = values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
        const showDuration = s.detected || s.reps.some((r) => Math.abs(r.work.durationS - s.workout.workS) > 1.5);
        const stat = (label: string, value: ReactNode, detail?: string) => (
          <div className="an-sheet__stat">
            <span className="an-sheet__stat-label">{label}</span>
            <strong className="an-sheet__stat-value">
              {value}
              {detail && <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: 'var(--text-xs)' }}> {detail}</span>}
            </strong>
          </div>
        );
        return (
          <div key={seriesIndex} style={{ marginBottom: '14px' }}>
            {seriesTitle(s, seriesIndex)}
            <div className="an-sheet__stats an-sheet__stats--always">
              {stat('Répétitions', s.detected ? `${summary.count}` : `${summary.count} / ${s.workout.reps}`, s.detected ? 'détectées' : undefined)}
              {stat(`Moyenne des répétitions`, formatSpeed(summary.meanSpeedMs, speedUnit))}
              {summary.best && stat('La plus rapide', formatSpeed(summary.best.speedMs, speedUnit), `rép. ${summary.best.rep}`)}
              {summary.worst && stat('La plus lente', formatSpeed(summary.worst.speedMs, speedUnit), `rép. ${summary.worst.rep}`)}
              {summary.trend && stat('Dérive', `${signedPercent(summary.trend.perRep)} par rép.`,
                `de ${formatSpeed(summary.trend.firstMs, speedUnit)} à ${formatSpeed(summary.trend.lastMs, speedUnit)}`)}
              {summary.regularity !== null && stat('Régularité', `± ${(summary.regularity * 100).toFixed(1)} %`)}
              {summary.launchS !== null && stat('Mise en vitesse', `${summary.launchS.toFixed(1)} s`,
                summary.accelMs2 !== null ? formatRate(summary.accelMs2) : undefined)}
              {summary.holdRatio !== null && stat('Maintien', signedPercent(summary.holdRatio - 1))}
            </div>
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
              <table className={tableClass} style={tableStyle}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Rép.</th>
                    {showDuration && <th style={cellStyle}>Durée</th>}
                    <th style={cellStyle}>Distance</th>
                    <th style={cellStyle}>{inverse ? 'Allure' : 'Vitesse'}</th>
                    <th style={cellStyle} title={`Temps pour atteindre ${Math.round(launchFraction * 100)} % de la vitesse de la répétition`}>Lancé</th>
                    <th style={cellStyle} title="Seconde moitié rapportée à la première, une fois lancé">Maintien</th>
                    <th style={cellStyle}>Profil</th>
                    {hasHr && <th style={cellStyle} title="FC moyenne et maximale de l'effort">FC</th>}
                    {hasHr && <th style={cellStyle} title={`Baisse de la FC ${recoveryS ?? 60} s après la fin de l'effort`}>Récup.</th>}
                    {hasCadence && <th style={cellStyle} title="Cadence moyenne de l'effort, en pas par minute">Cadence</th>}
                    {hasCadence && <th style={cellStyle} title="Longueur de pas moyenne de l'effort : distance ÷ pas">Pas</th>}
                    <th style={{ ...cellStyle, fontWeight: 'normal', color: 'var(--muted)' }}>Repos</th>
                    <th style={cellStyle}>Carte</th>
                  </tr>
                </thead>
                <tbody>
                  {s.reps.map(({ rep, work, rest, launchS, holdRatio }, repIndex) => {
                    const key = `${seriesIndex}-${rep}`;
                    const shown = selectedLap === key;
                    const reached = work.path.length > 1;
                    return (
                      <tr key={key} style={{ borderTop: '1px solid var(--line-soft)', opacity: reached ? 1 : 0.45 }}>
                        <td className="an-ivl-rep" style={{ ...cellStyle, textAlign: 'left', fontWeight: 700, color: repColor(repIndex, s.reps.length) }}>{rep}</td>
                        {showDuration && <td className="an-ivl-dur num" style={cellStyle}>{formatIntervalClock(Math.round(work.durationS))}</td>}
                        <td className="an-ivl-dist" style={cellStyle}>{work.distanceM === null ? '—' : formatShortDistance(work.distanceM, distanceUnit)}</td>
                        <td className="an-ivl-speed" style={{ ...cellStyle, fontWeight: 700 }}>{formatSpeed(work.speedMs, speedUnit)}</td>
                        <td className="an-ivl-launch" data-label="lancé" style={cellStyle}>{launchS === null ? '—' : `${Math.round(launchS)} s`}</td>
                        <td className="an-ivl-hold" data-label="maintien" style={cellStyle}>{holdRatio === null ? '—' : signedPercent(holdRatio - 1, 0)}</td>
                        <td className="an-ivl-spark-cell" style={cellStyle}>{sparks.get(rep)?.some((v) => v !== null) && <Sparkline points={sparks.get(rep) ?? []} length={sparkLength} domain={domain} />}</td>
                        {hasHr && (
                          <td className="an-ivl-hr" data-label="FC" style={cellStyle}>
                            {s.heartRates?.[repIndex] ? `${s.heartRates[repIndex]!.avgBpm} / ${s.heartRates[repIndex]!.maxBpm}` : '—'}
                          </td>
                        )}
                        {hasHr && (
                          <td className="an-ivl-rec" data-label="récup." style={cellStyle}>
                            {s.heartRates?.[repIndex]?.recoveryBpm != null ? `−${s.heartRates[repIndex]!.recoveryBpm} bpm` : '—'}
                          </td>
                        )}
                        {hasCadence && (
                          <td className="an-ivl-cad" data-label="cadence" style={cellStyle}>
                            {s.cadences?.[repIndex] ? `${Math.round(s.cadences[repIndex]!.spm)} pas/min` : '—'}
                          </td>
                        )}
                        {hasCadence && (
                          <td className="an-ivl-step" data-label="pas" style={cellStyle}>
                            {s.cadences?.[repIndex]?.stepLengthM != null ? `${s.cadences[repIndex]!.stepLengthM!.toFixed(2)} m` : '—'}
                          </td>
                        )}
                        <td className="an-ivl-rest" style={{ ...cellStyle, color: 'var(--muted)' }}>
                          {rest ? `${formatIntervalClock(Math.round(rest.durationS))}${rest.distanceM !== null ? ` · ${formatShortDistance(rest.distanceM, distanceUnit)}` : ''}` : '—'}
                        </td>
                        <td className="an-ivl-map" style={cellStyle}>
                          <button type="button" disabled={!reached} onClick={() => onSelectLap(shown ? null : key)}
                            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: reached ? 'pointer' : 'default', backgroundColor: shown ? SHOWN_COLOR : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
                            {shown ? 'Masquer' : 'Voir'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </ResizablePanel>
  );

  /** Axe des vitesses ; avec `domain`, dans l'unité affichée, ce qui en sort est coupé. */
  const speedAxis = (domain?: [number, number]) => (
    <YAxis domain={domain ?? ['auto', 'auto']} allowDataOverflow={domain !== undefined} reversed={inverse} width={46}
      ticks={domain ? niceTicks({ min: domain[0], max: domain[1] }) : undefined}
      tickFormatter={(v: number) => formatSpeedValue(v, speedUnit)} tick={{ fill: SPEED_COLOR, fontSize: 11 }}
      label={{ value: SPEED_UNIT_LABEL[speedUnit], angle: -90, position: 'insideLeft', fill: SPEED_COLOR, fontSize: 11 }} />
  );
  const speedFormatter = (value: TooltipValueType | undefined, name: string | number | undefined, item: TooltipPayloadEntry): [ReactNode, string | number | undefined] => {
    // Recharts ne type pas la ligne de données : la vitesse en m/s y est rangée sous `<clé>Ms`.
    const row: Record<string, number | null> | undefined = item.payload;
    const ms = row && typeof item.dataKey === 'string' ? row[`${item.dataKey}Ms`] : null;
    return [ms != null ? formatSpeed(ms, speedUnit) : String(value ?? ''), name];
  };

  const evolutionPanel = (
    <ResizablePanel id={panelId('fractionne-evolution')} style={panelStyle}>
      {heading('Évolution des répétitions')}
      {series.map((s, seriesIndex) => {
        if (folded.has(seriesIndex)) return foldedSeries(s, seriesIndex);
        const trend = s.summary.trend;
        const reps = s.reps.filter((r) => r.work.speedMs !== null);
        const first = reps[0]?.rep ?? 1;
        const last = reps[reps.length - 1]?.rep ?? 1;
        const at = (rep: number) => (trend && last > first ? trend.firstMs + ((trend.lastMs - trend.firstMs) * (rep - first)) / (last - first) : null);
        const data = reps.map((r) => {
          const shown = selectedLap === `${seriesIndex}-${r.rep}`;
          return {
            rep: r.rep,
            color: repColor(s.reps.indexOf(r), s.reps.length),
            speed: display(r.work.speedMs), speedMs: r.work.speedMs,
            trend: display(at(r.rep)), trendMs: at(r.rep),
            mean: display(s.summary.meanSpeedMs), meanMs: s.summary.meanSpeedMs,
            shown: shown ? display(r.work.speedMs) : null, shownMs: shown ? r.work.speedMs : null,
          };
        });
        const pick = (e: ChartHoverEvent) => {
          const row = data[Number(e.activeTooltipIndex)];
          if (!row || e.activeTooltipIndex === null || e.activeTooltipIndex === undefined) return;
          const key = `${seriesIndex}-${row.rep}`;
          onSelectLap(selectedLap === key ? null : key);
        };
        return (
          <div key={seriesIndex} style={{ marginBottom: '10px' }}>
            {seriesTitle(s, seriesIndex, true)}
            {data.length > 1 ? (
              <div style={{ width: '100%', height: `${EVOLUTION_HEIGHT_PX}px` }}>
                <ResponsiveContainer>
                  <ComposedChart data={data} onClick={pick} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} style={{ cursor: 'pointer' }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                    <XAxis dataKey="rep" type="number" domain={[first - 0.5, last + 0.5]}
                      ticks={repTicks(first, last)}
                      tickFormatter={(v: number) => `${v}`} tick={{ fill: '#555', fontSize: 11 }} />
                    {speedAxis()}
                    <Tooltip formatter={speedFormatter} labelFormatter={(l) => `Répétition ${l}`} contentStyle={chartTooltipStyle} />
                    <Line type="linear" name="Moyenne" dataKey="mean" stroke={TREND_COLOR} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
                    {trend && <Line type="linear" name="Tendance" dataKey="trend" stroke={TREND_COLOR} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />}
                    <Line type="linear" name={inverse ? 'Allure' : 'Vitesse'} dataKey="speed" stroke={SPEED_COLOR} strokeWidth={2} isAnimationActive={false}
                      dot={({ cx, cy, index }) => (
                        <circle key={index} cx={cx} cy={cy} r={4} fill={data[index]?.color ?? SPEED_COLOR} stroke="#fff" strokeWidth={1} />
                      )}
                      activeDot={{ r: 6 }} />
                    <Line type="linear" name="Sur la carte" dataKey="shown" stroke="none" dot={{ r: 7, fill: SHOWN_COLOR, stroke: '#fff', strokeWidth: 2 }} activeDot={false} tooltipType="none" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)' }}>Une seule répétition : pas d'évolution à montrer.</div>
            )}
          </div>
        );
      })}
      <div style={noteStyle}>
        {inverse ? 'Allure' : 'Vitesse'} de chaque répétition, de la première (verte) à la dernière (rouge), avec sa moyenne
        (trait fin) et sa tendance (pointillé){inverse ? ', axe inversé : plus haut, plus vite' : ''}. Toucher une répétition
        la montre sur la carte. Toucher le titre d'une séance la replie dans les trois panneaux.
      </div>
    </ResizablePanel>
  );

  const profilePanel = (
    <ResizablePanel id={panelId('fractionne-profil')} style={panelStyle}>
      {heading("Profil d'une répétition")}
      {series.map((s, seriesIndex) => {
        if (folded.has(seriesIndex)) return foldedSeries(s, seriesIndex);
        const length = Math.max(0, ...s.reps.map((r) => r.profile.length));
        const data = Array.from({ length }, (_, k) => {
          const row: Record<string, number | null> = { t: parseFloat(((k + 0.5) * stepS).toFixed(2)) };
          row.mean = display(s.summary.meanProfile[k] ?? null);
          row.meanMs = s.summary.meanProfile[k] ?? null;
          s.reps.forEach((r) => {
            row[`r${r.rep}`] = display(r.profile[k] ?? null);
            row[`r${r.rep}Ms`] = r.profile[k] ?? null;
          });
          return row;
        });
        const launch = s.summary.launchS;
        // Échelle de la partie lancée de chaque répétition, comme les mini-courbes : le départ arrêté sort par le bas.
        const launched = s.reps.flatMap((r) => sparkPoints(r, stepS)).filter((v): v is number => v !== null);
        let domain: [number, number] | undefined;
        if (launched.length > 1) {
          const lo = Math.min(...launched);
          const hi = Math.max(...launched);
          const pad = Math.max((hi - lo) * 0.25, hi * 0.02);
          const ends = [display(Math.max(lo - pad, MIN_PACE_SPEED_MS)), display(hi + pad)].filter((v): v is number => v !== null);
          if (ends.length === 2) domain = [Math.min(...ends), Math.max(...ends)];
        }
        return (
          <div key={seriesIndex} style={{ marginBottom: '10px' }}>
            {seriesTitle(s, seriesIndex, true)}
            {data.length > 1 ? (
              <IntervalProfileChart data={data} spanS={length * stepS} launchS={launch} reps={s.reps} speedAxis={speedAxis(domain)}
                formatMs={(ms) => formatSpeed(ms, speedUnit)} resetKey={`${seriesIndex}-${s.reps.length}-${length}`} />
            ) : (
              <div style={{ color: 'var(--muted)' }}>Répétitions trop courtes pour un profil.</div>
            )}
          </div>
        );
      })}
      <div style={noteStyle}>
        {inverse ? 'Allure' : 'Vitesse'} seconde par seconde depuis le départ de chaque répétition : chacune en trait fin, de la
        première (verte) à la dernière (rouge), et leur moyenne en trait épais. L'échelle est celle des répétitions une fois
        lancées : le départ, plus lent, sort par le bas. Le pointillé marque la mise en vitesse moyenne.
      </div>
    </ResizablePanel>
  );

  return (
    <>
      {repsPanel}
      {evolutionPanel}
      {profilePanel}
    </>
  );
}

export default IntervalAnalysis;
