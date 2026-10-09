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
import type { ChartHoverEvent } from './chartHover';
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
  reps: IntervalRep[];
  summary: IntervalSummary;
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
}

/** Répétition montrée sur la carte : le violet des tops et des zones de pente. */
const SHOWN_COLOR = '#7b1fa2';
/** Vitesse : le bleu des autres graphes. */
const SPEED_COLOR = '#1e88e5';
const TREND_COLOR = '#757575';
const MEAN_COLOR = '#263238';
/** Répétitions du profil, de la première (claire) à la dernière (foncée). */
const REP_LIGHT = [0x90, 0xca, 0xf9];
const REP_DARK = [0x0d, 0x47, 0xa1];
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

const repColor = (i: number, count: number): string => {
  const f = count > 1 ? i / (count - 1) : 1;
  return `#${REP_LIGHT.map((c, k) => Math.round(c + f * (REP_DARK[k] - c)).toString(16).padStart(2, '0')).join('')}`;
};

/** Écart signé, en pourcentage : « +1.2 % », « −3.0 % ». */
const signedPercent = (fraction: number, decimals = 1): string => {
  const value = Math.abs(fraction * 100).toFixed(decimals);
  if (Number(value) === 0) return `0 %`;
  return `${fraction < 0 ? '−' : '+'}${value} %`;
};

const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.93em', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' };
const cellStyle: CSSProperties = { padding: '0.4em 0.6em', textAlign: 'center' };
const noteStyle: CSSProperties = { color: 'var(--muted)', fontSize: '0.8em', marginTop: '6px', lineHeight: 1.45 };
const chartTooltipStyle = { fontSize: '12px' } as const;

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
  series, stepS, launchFraction, samplingS, speedUnit, distanceUnit, panelId, open, onToggle, selectedLap, onSelectLap, emptyText,
}: IntervalAnalysisProps) {
  const [help, setHelp] = useState(false);
  const inverse = isInverseUnit(speedUnit);
  const noun = inverse ? 'allure' : 'vitesse';
  /** Accélération et seuils : en km/h pour une allure, comme les tops. */
  const rateUnit: SpeedUnit = speedUnit === 'minkm' ? 'kmh' : speedUnit;
  const panelStyle: CSSProperties = { ...CARD_STYLE, ...HALF_PANEL_STYLE, fontSize: '14px' };
  const display = (ms: number | null): number | null =>
    ms === null || !isFinite(ms) || (inverse && ms < MIN_PACE_SPEED_MS) ? null : parseFloat(toDisplaySpeed(ms, speedUnit).toFixed(2));
  const formatRate = (ms2: number): string =>
    rateUnit === 'ms' ? `${ms2.toFixed(2)} m/s²` : `${toDisplaySpeed(ms2, rateUnit).toFixed(1)} ${SPEED_UNIT_LABEL[rateUnit]} par s`;
  const title = (s: IntervalSeriesView) =>
    s.detected ? `≈ ${workoutLabel(s.workout)}, répétitions détectées` : `Séance ${workoutLabel(s.workout)}`;
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
        <div className="ui-alert ui-alert--warning" style={{ marginBottom: '10px', fontSize: '0.9em' }}>
          Un point toutes les {samplingS.toFixed(1)} s en médiane : la trace est trop clairsemée pour le détail d'une
          répétition. Les efforts paraissent plus courts et plus lents qu'ils ne l'étaient, une partie tombant dans le long
          segment de la récupération ; lancé, maintien et profils sont approximatifs.
        </div>
      )}
      {series.map((s, seriesIndex) => {
        const { summary } = s;
        const sparks = new Map(s.reps.map((r) => [r.rep, sparkPoints(r, stepS)]));
        const sparkLength = Math.max(0, ...s.reps.map((r) => r.profile.length));
        const values = [...sparks.values()].flat().filter((v): v is number => v !== null);
        const domain = values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 1 };
        const showDuration = s.detected || s.reps.some((r) => Math.abs(r.work.durationS - s.workout.workS) > 1.5);
        const stat = (label: string, value: ReactNode, detail?: string) => (
          <div className="an-sheet__stat">
            <span className="an-sheet__stat-label">{label}</span>
            <strong className="an-sheet__stat-value">
              {value}
              {detail && <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: '0.75em' }}> {detail}</span>}
            </strong>
          </div>
        );
        return (
          <div key={seriesIndex} style={{ marginBottom: '14px' }}>
            <div style={{ fontWeight: 600, marginBottom: '6px' }}>{title(s)}</div>
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
              <table className="an-ivl-table" style={tableStyle}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Rép.</th>
                    {showDuration && <th style={cellStyle}>Durée</th>}
                    <th style={cellStyle}>Distance</th>
                    <th style={cellStyle}>{inverse ? 'Allure' : 'Vitesse'}</th>
                    <th style={cellStyle} title={`Temps pour atteindre ${Math.round(launchFraction * 100)} % de la vitesse de la répétition`}>Lancé</th>
                    <th style={cellStyle} title="Seconde moitié rapportée à la première, une fois lancé">Maintien</th>
                    <th style={cellStyle}>Profil</th>
                    <th style={{ ...cellStyle, fontWeight: 'normal', color: 'var(--muted)' }}>Repos</th>
                    <th style={cellStyle}>Carte</th>
                  </tr>
                </thead>
                <tbody>
                  {s.reps.map(({ rep, work, rest, launchS, holdRatio }) => {
                    const key = `${seriesIndex}-${rep}`;
                    const shown = selectedLap === key;
                    const reached = work.path.length > 1;
                    return (
                      <tr key={key} style={{ borderTop: '1px solid var(--line-soft)', opacity: reached ? 1 : 0.45 }}>
                        <td className="an-ivl-rep" style={{ ...cellStyle, textAlign: 'left', fontWeight: 'bold' }}>{rep}</td>
                        {showDuration && <td className="an-ivl-dur num" style={cellStyle}>{formatIntervalClock(Math.round(work.durationS))}</td>}
                        <td className="an-ivl-dist" style={cellStyle}>{work.distanceM === null ? '—' : formatShortDistance(work.distanceM, distanceUnit)}</td>
                        <td className="an-ivl-speed" style={{ ...cellStyle, fontWeight: 'bold' }}>{formatSpeed(work.speedMs, speedUnit)}</td>
                        <td className="an-ivl-launch" data-label="lancé" style={cellStyle}>{launchS === null ? '—' : `${Math.round(launchS)} s`}</td>
                        <td className="an-ivl-hold" data-label="maintien" style={cellStyle}>{holdRatio === null ? '—' : signedPercent(holdRatio - 1, 0)}</td>
                        <td className="an-ivl-spark-cell" style={cellStyle}>{sparks.get(rep)?.some((v) => v !== null) && <Sparkline points={sparks.get(rep) ?? []} length={sparkLength} domain={domain} />}</td>
                        <td className="an-ivl-rest" style={{ ...cellStyle, color: 'var(--muted)' }}>
                          {rest ? `${formatIntervalClock(Math.round(rest.durationS))}${rest.distanceM !== null ? ` · ${formatShortDistance(rest.distanceM, distanceUnit)}` : ''}` : '—'}
                        </td>
                        <td className="an-ivl-map" style={cellStyle}>
                          <button type="button" disabled={!reached} onClick={() => onSelectLap(shown ? null : key)}
                            style={{ padding: '2px 8px', fontSize: '11px', cursor: reached ? 'pointer' : 'default', backgroundColor: shown ? SHOWN_COLOR : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
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
        const trend = s.summary.trend;
        const reps = s.reps.filter((r) => r.work.speedMs !== null);
        const first = reps[0]?.rep ?? 1;
        const last = reps[reps.length - 1]?.rep ?? 1;
        const at = (rep: number) => (trend && last > first ? trend.firstMs + ((trend.lastMs - trend.firstMs) * (rep - first)) / (last - first) : null);
        const data = reps.map((r) => {
          const shown = selectedLap === `${seriesIndex}-${r.rep}`;
          return {
            rep: r.rep,
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
            {series.length > 1 && <div style={{ fontWeight: 600, marginBottom: '6px' }}>{title(s)}</div>}
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
                    <Line type="linear" name={inverse ? 'Allure' : 'Vitesse'} dataKey="speed" stroke={SPEED_COLOR} strokeWidth={2} dot={{ r: 4, fill: SPEED_COLOR }} activeDot={{ r: 6 }} isAnimationActive={false} />
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
        {inverse ? 'Allure' : 'Vitesse'} de chaque répétition, avec sa moyenne (trait fin) et sa tendance (pointillé)
        {inverse ? ', axe inversé : plus haut, plus vite' : ''}. Toucher une répétition la montre sur la carte.
      </div>
    </ResizablePanel>
  );

  const profilePanel = (
    <ResizablePanel id={panelId('fractionne-profil')} style={panelStyle}>
      {heading("Profil d'une répétition")}
      {series.map((s, seriesIndex) => {
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
            {series.length > 1 && <div style={{ fontWeight: 600, marginBottom: '6px' }}>{title(s)}</div>}
            {data.length > 1 ? (
              <div style={{ width: '100%', height: `${PROFILE_HEIGHT_PX}px` }}>
                <ResponsiveContainer>
                  <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
                    <XAxis dataKey="t" type="number" domain={[0, length * stepS]}
                      tickFormatter={(v: number) => formatIntervalClock(v)} tick={{ fill: '#555', fontSize: 11 }} />
                    {speedAxis(domain)}
                    <Tooltip formatter={speedFormatter} labelFormatter={(l) => `${formatIntervalClock(Number(l))} après le départ`} contentStyle={chartTooltipStyle} />
                    {s.reps.map((r, i) => (
                      <Line key={r.rep} type="monotone" name={`Rép. ${r.rep}`} dataKey={`r${r.rep}`} stroke={repColor(i, s.reps.length)}
                        strokeWidth={1} dot={false} activeDot={false} connectNulls={false} tooltipType="none" isAnimationActive={false} />
                    ))}
                    <Line type="monotone" name="Moyenne" dataKey="mean" stroke={MEAN_COLOR} strokeWidth={3} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                    {launch !== null && launch > 0 && (
                      <ReferenceLine x={launch} stroke={TREND_COLOR} strokeDasharray="4 3"
                        label={{ value: 'lancé', position: 'insideTopLeft', fill: TREND_COLOR, fontSize: 11 }} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)' }}>Répétitions trop courtes pour un profil.</div>
            )}
          </div>
        );
      })}
      <div style={noteStyle}>
        {inverse ? 'Allure' : 'Vitesse'} seconde par seconde depuis le départ de chaque répétition : chacune en trait fin, de la
        première (claire) à la dernière (foncée), et leur moyenne en trait épais. L'échelle est celle des répétitions une fois
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
