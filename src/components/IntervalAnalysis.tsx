import type { SpanHeartRate } from '../core/heartRate';
import type { CadenceShare } from '../running/cadence';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipPayloadEntry, type TooltipValueType,
} from 'recharts';
import { niceTicks } from '../core/chartZoom';
import {
  editSpeedUnit, signedPercent,
  SPEED_UNIT_LABEL, speedUnitLabel, formatShortDistance, formatSpeed, formatSpeedValue, isInverseUnit, toDisplaySpeed,
  type DistanceUnit, type SpeedUnit,
} from '../core/units';
import { formatIntervalClock, workoutLabel, type IntervalWorkout } from '../recording/intervalTimer';
import type { IntervalRep, IntervalSummary } from '../running/intervalStats';
import { intervalChartData, SPARK_SMOOTHING_S, type IntervalProfileRow } from '../running/intervalCharts';
import { createHoverStore } from '../hooks/useChartHover';
import { useChartZoom } from '../hooks/useChartZoom';
import { RowReadout, type Readout } from './ChartReadout';
import { hoveredRow, inChartView, type ChartHoverEvent } from './chartHover';
import TrackChart, { type TrackSeries, type TrackYAxis } from './TrackChart';
import { HIGHLIGHT_PODIUM_COLORS } from './highlightColors';
import { IconChevronRight } from './icons';
import { HelpText } from './Help';
import { PanelHeading } from './PanelTitle';
import ResizablePanel from './ResizablePanel';
import { ANALYSIS_PANEL_STYLE } from './styles';
import './IntervalAnalysis.css';
import StatTile from './ui/StatTile';
import MapToggle from './ui/MapToggle';
import { CHART_GRID_PROPS, CHART_TICK, SPEED_COLOR, TREND_COLOR, chartTick, yAxisLabel } from './chartStyle';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';

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
  /** Clé de la session : une autre session remet le zoom du profil à tout voir. */
  sessionKey: string | null;
}

const MEAN_COLOR = 'var(--ink)';
/**
 * Répétitions d'une séance, de la première à la dernière : vert, orange puis
 * rouge, les couleurs des podiums, pour voir la progression.
 */
const REP_STOPS = [...HIGHLIGHT_PODIUM_COLORS].reverse().map((hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
const EVOLUTION_HEIGHT_PX = 200;
const PROFILE_HEIGHT_PX = 220;
const SPARK_WIDTH = 96;
const SPARK_HEIGHT = 22;
/**
 * Au-delà de ce pas médian entre deux points, la trace est trop clairsemée pour
 * le détail d'une répétition : on le dit (trace Komoot du 21/07, un point
 * toutes les 4 s, un toutes les 20 s à l'arrêt).
 */
const SPARSE_SAMPLING_S = 2;

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

type ProfileRow = IntervalProfileRow;

/** Abscisse du profil : le temps depuis le départ de la répétition. */
const PROFILE_X = { key: 't', format: (v: number) => formatIntervalClock(v) };

/**
 * Profil superposé des répétitions d'une séance (25/10) : zoom (double-clic,
 * zone tirée, deux doigts) et lecture au-dessus du graphe, comme les graphes
 * sur la trace, mais sans « +carte » : les courbes partent toutes du
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
  speedAxis: TrackYAxis;
  formatMs: (ms: number) => string;
  /** Change avec la séance : le zoom revient à tout voir. */
  resetKey: string;
}) {
  const zoom = useChartZoom({ min: 0, max: spanS }, resetKey);
  /** Ligne survolée, hors de l'état du graphe : le doigt qui glisse ne redessine que la lecture. */
  const [hover] = useState(() => createHoverStore<ProfileRow>());
  const onHover = (e: ChartHoverEvent) => hover.set(hoveredRow(e, data));
  const series: TrackSeries<ProfileRow>[] = [
    ...reps.map((r, i): TrackSeries<ProfileRow> => (
      { kind: 'line', key: `r${r.rep}`, name: `Rép. ${r.rep}`, color: repColor(i, reps.length), width: 1.5, activeDotR: false }
    )),
    { kind: 'line', key: 'mean', name: 'Moyenne', color: MEAN_COLOR, width: 3, activeDotR: 4 },
  ];
  const read = (hovered: ProfileRow): Readout | null => {
    const t = hovered.t ?? null;
    const meanMs = hovered.meanMs ?? null;
    return t !== null && inChartView(zoom.view, t)
      ? { values: [{ text: `Moyenne ${meanMs !== null ? formatMs(meanMs) : '—'}`, color: MEAN_COLOR }], at: `${formatIntervalClock(t)} après le départ` }
      : null;
  };
  return (
    <>
      <RowReadout line store={hover} read={read} />
      <TrackChart rows={data} zoom={zoom} x={PROFILE_X} yAxes={[speedAxis]} series={series} onHover={onHover} onLeave={() => hover.set(null)}
        style={{ width: '100%', height: `${PROFILE_HEIGHT_PX}px` }}
        front={launchS !== null && launchS > 0 && (
          <ReferenceLine x={launchS} stroke={TREND_COLOR} strokeDasharray="4 3"
            label={{ value: 'lancé', position: 'insideTopLeft', fill: TREND_COLOR, fontSize: 11 }} />
        )} />
    </>
  );
}

const cellStyle: CSSProperties = { padding: '0.4em 0.6em', textAlign: 'center' };
const noteStyle: CSSProperties = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '6px', lineHeight: 1.45 };
const chartTooltipStyle = { fontSize: 'var(--text-xs)' } as const;

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
  sessionKey,
}: IntervalAnalysisProps) {
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
  /** Graphes de chaque séance, refaits seulement quand les séances ou l'unité changent. */
  const charts = useMemo(() => intervalChartData(series, stepS, speedUnit, distanceUnit), [series, stepS, speedUnit, distanceUnit]);
  const inverse = isInverseUnit(speedUnit);
  const noun = inverse ? 'allure' : 'vitesse';
  /** Accélération et seuils : en km/h pour une allure, comme les tops. */
  const rateUnit: SpeedUnit = editSpeedUnit(speedUnit);
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
  /** Titre d'un des trois panneaux ; `helpKey` : son « ? », dont le texte vient juste dessous. */
  const heading = (label: string, helpKey?: string) => <PanelHeading label={label} open={open} onToggle={onToggle} helpKey={helpKey} padRight />;

  if (emptyText !== null) {
    return (
      <ResizablePanel id={panelId('fractionne')} style={ANALYSIS_PANEL_STYLE}>
        {heading('Fractionné')}
        <div style={{ color: 'var(--muted)' }}>{emptyText}</div>
      </ResizablePanel>
    );
  }

  const repsPanel = (
    <ResizablePanel id={panelId('fractionne')} style={ANALYSIS_PANEL_STYLE}>
      {heading('Répétitions', 'analyse:repetitions')}
      <HelpText helpKey="analyse:repetitions" note>
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
      </HelpText>
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
        const { sparks, sparkDomain: domain, length: sparkLength } = charts[seriesIndex];
        const hasHr = s.heartRates?.some((h) => h !== null) ?? false;
        const hasCadence = s.cadences?.some((c) => c !== null) ?? false;
        const tableClass = ['an-ivl-table', ...(hasHr ? ['an-ivl-table--fc'] : []), ...(hasCadence ? ['an-ivl-table--cad'] : [])].join(' ');
        const showDuration = s.detected || s.reps.some((r) => Math.abs(r.work.durationS - s.workout.workS) > 1.5);
        const stat = (label: string, value: ReactNode, detail?: string) => <StatTile label={label} value={value} detail={detail} />;
        return (
          <div key={seriesIndex} style={{ marginBottom: '14px' }}>
            {seriesTitle(s, seriesIndex)}
            <div className="an-sheet__stats an-sheet__stats--always">
              {stat('Répétitions', s.detected ? `${summary.count}` : `${summary.count} / ${s.workout.reps}`, s.detected ? 'détectées' : undefined)}
              {stat(`Moyenne des répétitions`, formatSpeed(summary.meanSpeedMs, speedUnit, distanceUnit))}
              {summary.best && stat('La plus rapide', formatSpeed(summary.best.speedMs, speedUnit, distanceUnit), `rép. ${summary.best.rep}`)}
              {summary.worst && stat('La plus lente', formatSpeed(summary.worst.speedMs, speedUnit, distanceUnit), `rép. ${summary.worst.rep}`)}
              {summary.trend && stat('Dérive', `${signedPercent(summary.trend.perRep)} par rép.`,
                `de ${formatSpeed(summary.trend.firstMs, speedUnit, distanceUnit)} à ${formatSpeed(summary.trend.lastMs, speedUnit, distanceUnit)}`)}
              {summary.regularity !== null && stat('Régularité', `± ${(summary.regularity * 100).toFixed(1)} %`)}
              {summary.launchS !== null && stat('Mise en vitesse', `${summary.launchS.toFixed(1)} s`,
                summary.accelMs2 !== null ? formatRate(summary.accelMs2) : undefined)}
              {summary.holdRatio !== null && stat('Maintien', signedPercent(summary.holdRatio - 1))}
            </div>
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
              <table className={`ui-table ui-table--cards ${tableClass}`}>
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
                      <tr key={key} className={reached ? 'ui-table__row' : 'ui-table__row ui-table__row--empty'}>
                        <td className="an-ivl-rep" style={{ ...cellStyle, textAlign: 'left', fontWeight: 700, color: repColor(repIndex, s.reps.length) }}>{rep}</td>
                        {showDuration && <td className="an-ivl-dur num" style={cellStyle}>{formatIntervalClock(Math.round(work.durationS))}</td>}
                        <td className="an-ivl-dist" style={cellStyle}>{work.distanceM === null ? '—' : formatShortDistance(work.distanceM, distanceUnit)}</td>
                        <td className="an-ivl-speed" style={{ ...cellStyle, fontWeight: 700 }}>{formatSpeed(work.speedMs, speedUnit, distanceUnit)}</td>
                        <td className="an-ivl-launch" data-label="lancé" style={cellStyle}>{launchS === null ? '—' : `${Math.round(launchS)} s`}</td>
                        <td className="an-ivl-hold" data-label="maintien" style={cellStyle}>{holdRatio === null ? '—' : signedPercent(holdRatio - 1, { decimals: 0 })}</td>
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
                          <MapToggle shown={shown} disabled={!reached} color={HIGHLIGHT_SHOWN_COLOR} onClick={() => onSelectLap(shown ? null : key)} />
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

  /** Axe des vitesses du profil ; avec `domain`, dans l'unité affichée, ce qui en sort est coupé. */
  const profileSpeedAxis = (domain?: [number, number]): TrackYAxis => ({
    color: SPEED_COLOR, unit: speedUnitLabel(speedUnit, distanceUnit), domain: domain ?? ['auto', 'auto'], allowDataOverflow: domain !== undefined,
    reversed: inverse, width: 46, ...(domain ? { ticks: niceTicks({ min: domain[0], max: domain[1] }) } : {}),
    tickFormatter: (v: number) => formatSpeedValue(v, speedUnit),
  });
  /** Axe des vitesses de l'évolution. */
  const speedAxis = () => (
    <YAxis domain={['auto', 'auto']} allowDataOverflow={false} reversed={inverse} width={46}
      tickFormatter={(v: number) => formatSpeedValue(v, speedUnit)} tick={chartTick(SPEED_COLOR)}
      label={yAxisLabel(speedUnitLabel(speedUnit, distanceUnit), SPEED_COLOR)} />
  );
  const speedFormatter = (value: TooltipValueType | undefined, name: string | number | undefined, item: TooltipPayloadEntry): [ReactNode, string | number | undefined] => {
    // Recharts ne type pas la ligne de données : la vitesse en m/s y est rangée sous `<clé>Ms`.
    const row: Record<string, number | null> | undefined = item.payload;
    const ms = row && typeof item.dataKey === 'string' ? row[`${item.dataKey}Ms`] : null;
    return [ms != null ? formatSpeed(ms, speedUnit, distanceUnit) : String(value ?? ''), name];
  };

  const evolutionPanel = (
    <ResizablePanel id={panelId('fractionne-evolution')} style={ANALYSIS_PANEL_STYLE}>
      {heading('Évolution des répétitions', 'analyse:evolution')}
      <HelpText helpKey="analyse:evolution" note>
        {inverse ? 'Allure' : 'Vitesse'} de chaque répétition, de la première (verte) à la dernière (rouge), avec sa moyenne
        (trait fin) et sa tendance (pointillé){inverse ? ', axe inversé : plus haut, plus vite' : ''}. Toucher une répétition
        la montre sur la carte. Toucher le titre d'une séance la replie dans les trois panneaux.
      </HelpText>
      {series.map((s, seriesIndex) => {
        if (folded.has(seriesIndex)) return foldedSeries(s, seriesIndex);
        const trend = s.summary.trend;
        const { first, last, rows } = charts[seriesIndex].evolution;
        // Couleur de chaque répétition et répétition sur la carte, posées au rendu sur les lignes calculées une fois.
        const data = rows.map((row) => {
          const shown = selectedLap === `${seriesIndex}-${row.rep}`;
          return {
            ...row,
            color: repColor(row.repIndex, s.reps.length),
            shown: shown ? row.speed : null, shownMs: shown ? row.speedMs : null,
          };
        });
        // Une répétition sous la souris ou le doigt seulement (`hoveredRow`).
        const pick = (e: ChartHoverEvent) => {
          const row = hoveredRow(e, data);
          if (!row) return;
          const key = `${seriesIndex}-${row.rep}`;
          onSelectLap(selectedLap === key ? null : key);
        };
        return (
          <div key={seriesIndex} style={{ marginBottom: '10px' }}>
            {seriesTitle(s, seriesIndex, true)}
            {data.length > 1 ? (
              <div style={{ width: '100%', height: `${EVOLUTION_HEIGHT_PX}px` }}>
                {/*
                  Sans couche clavier : un clic donne le focus au graphe, et Recharts y active alors la
                  première répétition (navigation au clavier) ; un clic hors du tracé, sur une graduation,
                  la choisissait (banc du lot 61).
                */}
                <ResponsiveContainer>
                  <ComposedChart data={data} onClick={pick} accessibilityLayer={false} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} style={{ cursor: 'pointer' }}>
                    <CartesianGrid {...CHART_GRID_PROPS} />
                    <XAxis dataKey="rep" type="number" domain={[first - 0.5, last + 0.5]}
                      ticks={repTicks(first, last)}
                      tickFormatter={(v: number) => `${v}`} tick={CHART_TICK} />
                    {speedAxis()}
                    <Tooltip formatter={speedFormatter} labelFormatter={(l) => `Répétition ${l}`} contentStyle={chartTooltipStyle} />
                    <Line type="linear" name="Moyenne" dataKey="mean" stroke={TREND_COLOR} strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
                    {trend && <Line type="linear" name="Tendance" dataKey="trend" stroke={TREND_COLOR} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />}
                    <Line type="linear" name={inverse ? 'Allure' : 'Vitesse'} dataKey="speed" stroke={SPEED_COLOR} strokeWidth={2} isAnimationActive={false}
                      dot={({ cx, cy, index }) => (
                        <circle key={index} cx={cx} cy={cy} r={4} fill={data[index]?.color ?? SPEED_COLOR} stroke="var(--surface)" strokeWidth={1} />
                      )}
                      activeDot={{ r: 6 }} />
                    <Line type="linear" name="Sur la carte" dataKey="shown" stroke="none" dot={{ r: 7, fill: HIGHLIGHT_SHOWN_COLOR, stroke: 'var(--surface)', strokeWidth: 2 }} activeDot={false} tooltipType="none" isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)' }}>Une seule répétition : pas d'évolution à montrer.</div>
            )}
          </div>
        );
      })}
    </ResizablePanel>
  );

  const profilePanel = (
    <ResizablePanel id={panelId('fractionne-profil')} style={ANALYSIS_PANEL_STYLE}>
      {heading("Profil d'une répétition", 'analyse:profil-repetition')}
      <HelpText helpKey="analyse:profil-repetition" note>
        {inverse ? 'Allure' : 'Vitesse'} seconde par seconde depuis le départ de chaque répétition : chacune en trait fin, de la
        première (verte) à la dernière (rouge), et leur moyenne en trait épais. L'échelle est celle des répétitions une fois
        lancées : le départ, plus lent, sort par le bas. Le pointillé marque la mise en vitesse moyenne.
      </HelpText>
      {series.map((s, seriesIndex) => {
        if (folded.has(seriesIndex)) return foldedSeries(s, seriesIndex);
        const { length } = charts[seriesIndex];
        const { rows: data, domain } = charts[seriesIndex].profile;
        const launch = s.summary.launchS;
        return (
          <div key={seriesIndex} style={{ marginBottom: '10px' }}>
            {seriesTitle(s, seriesIndex, true)}
            {data.length > 1 ? (
              <IntervalProfileChart data={data} spanS={length * stepS} launchS={launch} reps={s.reps} speedAxis={profileSpeedAxis(domain)}
                formatMs={(ms) => formatSpeed(ms, speedUnit, distanceUnit)} resetKey={`${sessionKey ?? ''}|${seriesIndex}-${s.reps.length}-${length}`} />
            ) : (
              <div style={{ color: 'var(--muted)' }}>Répétitions trop courtes pour un profil.</div>
            )}
          </div>
        );
      })}
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
