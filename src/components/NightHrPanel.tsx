import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ReferenceDot, ReferenceLine } from 'recharts';
import { HoverReadout, type Readout } from './ChartReadout';
import ChartFold from './ChartFold';
import { timeOfDayX } from './chartAxes';
import { inChartView } from './chartHover';
import { CHART_MARK_COLOR } from './chartStyle';
import HeartRateChart from './HeartRateChart';
import { HEART_RATE_COLOR } from './heartRateColors';
import { HelpText, HelpToggle } from './Help';
import { PanelHeading } from './PanelTitle';
import StatTile from './ui/StatTile';
import type { NightHrPlace, NightHrResults } from '../core/nightHeartRate';
import { formatDecimal, formatDuration, formatShortDuration, formatTimeOfDay } from '../core/units';
import { useChartZoomSource, useZoomState } from '../hooks/useChartZoom';
import { useOpenSections } from '../hooks/useOpenSections';
import type { NightHrProtocol } from '../recording/nightHrTest';
import './NightHrPanel.css';

/** Couleur des réveils et des éveils brefs sur la courbe (donnée de graphe, en dur). */
const NIGHT_SURGE_COLOR = '#ef6c00';

/** Place du creux, en clair. */
const NIGHT_PLACE_LABEL: Record<NightHrPlace, string> = {
  debut: 'en début de nuit',
  milieu: 'au milieu de la nuit',
  fin: 'en fin de nuit',
};

/** Cadre de la courbe de la nuit, comme celle de « général » : sans hauteur, le graphe ne se dessine pas. */
const CURVE_BOX = { width: '100%', height: '220px' } as const;

/** Parties repliables du panneau, ouvertes au départ. */
const FOLDS_DEFAULT = { heures: true, qualite: true };

/** Heure locale d'un instant, « 03:42 ». */
const clockTime = (ms: number): string => formatTimeOfDay(ms).slice(0, 5);
/** Heures d'une liste d'instants, « 05:52, 06:32 ». */
const clockTimes = (list: readonly number[]): string => list.map(clockTime).join(', ');
/** Durée d'une limite du protocole : « 1 min », « 3 min », « 2 min 20 ». */
const durationText = (s: number): string => (s >= 60 && s % 60 === 0 ? `${s / 60} min` : formatShortDuration(s));
/** Battements entiers, « 48 bpm », « — » sans valeur. */
const bpmText = (bpm: number | null): string => (bpm === null ? '—' : `${Math.round(bpm)} bpm`);
/** Nombre signé, signe moins typographique : « −5 », « +3 ». */
const signed = (value: number, decimals = 0): string => `${value < 0 ? '−' : value > 0 ? '+' : ''}${formatDecimal(Math.abs(value), decimals)}`;

/**
 * Onglet « test » d'une nuit du test « FC de nuit » (lot 213) : la FC la plus
 * basse, sa place et son heure, l'écart à la FC repos de Pratiquant, la
 * moyenne, les deux moitiés, la stabilisation, les sursauts rangés en réveils,
 * éveils brefs et mouvements (lot 218), la part de nuit calme, l'indice de
 * régularité, la courbe de la nuit lissée en heures d'horloge (creux, réveils
 * et éveils brefs marqués ; pas les mouvements), le tableau par
 * heure, la qualité de l'enregistrement ; chacun avec son aide « ? ». Les
 * chiffres viennent de `nightHrResults` (`core/nightHeartRate.ts`), calculés
 * par le module ; la courbe est déjà décimée au pas du protocole. Posé dans le
 * `ResizablePanel` du module.
 */
export default function NightHrPanel({ results, protocol, restingBpm, minutes, sessionKey, open, onToggle }: {
  results: NightHrResults;
  protocol: NightHrProtocol;
  /** FC repos de Pratiquant, `null` si elle n'est pas saisie. */
  restingBpm: number | null;
  /** Minutes de chaque point de la session depuis le premier (`useTimeChartAxis`) : lecture d'un point survolé ailleurs. */
  minutes: readonly number[];
  /** Session montrée : le zoom revient à « tout voir » quand elle change. */
  sessionKey: unknown;
  open: boolean;
  onToggle: () => void;
}) {
  const folds = useOpenSections('nuit', FOLDS_DEFAULT);
  const { low, quality, curve, startMs } = results;
  const toMin = (ms: number) => (ms - startMs) / 60_000;
  const fullRange = useMemo(() => (curve.length > 1 ? { min: 0, max: results.durationS / 60 } : null), [curve, results.durationS]);
  const zoom = useZoomState(useChartZoomSource(fullRange, sessionKey));
  const x = useMemo(() => timeOfDayX(startMs), [startMs]);
  const rows = useMemo(() => curve.map((c) => ({ index: c.index, minutes: c.minutes, hr: c.bpm })), [curve]);

  /** Lecture au point survolé, ici ou dans un autre graphe de la session : la case de la courbe qui le contient. */
  const read = (hovered: number): Readout | null => {
    const at = minutes[hovered];
    if (at === undefined || !inChartView(zoom.view, at) || curve.length === 0) return null;
    const k = Math.min(curve.length - 1, Math.max(0, Math.floor((at * 60) / protocol.curveStepS)));
    return { values: [{ text: bpmText(curve[k].bpm), color: HEART_RATE_COLOR }], at: clockTime(startMs + at * 60_000) };
  };

  const stableHoldMin = Math.round(protocol.stable.holdS / 60);
  // Réveils et éveils brefs seuls dans la note et sur la courbe : les mouvements, nombreux, n'y sont que comptés.
  const marked = useMemo(() => results.surges.filter((s) => s.kind !== 'mouvement'), [results.surges]);
  const longTimes = clockTimes(marked.filter((s) => s.kind === 'reveil').map((s) => s.peakMs));
  const briefTimes = clockTimes(marked.filter((s) => s.kind === 'bref').map((s) => s.peakMs));
  const { shortS, longS } = protocol.wake;
  const shortText = durationText(shortS);
  const longText = durationText(longS);
  const calmMin = Math.round(protocol.calm.windowS / 60);

  return (
    <>
      <PanelHeading label={`Test ${protocol.label}`} open={open} onToggle={onToggle} helpKey="nuit:test" />
      <HelpText helpKey="nuit:test" note>
        Chiffres de la ceinture sur toute la nuit. Une mesure vaut au plus {protocol.holdS} s : un trou de la ceinture n'est ni comblé ni compté.
        {' '}Cette mesure ne dit rien du sommeil lui-même, ni de votre santé : elle sert à suivre votre récupération d'une nuit à l'autre.
        {' '}Une nuit seule ne dit presque rien. Une FC de nuit plus haute de quelques battements sur plusieurs nuits va souvent avec fatigue,
        chaleur, alcool ou un repas tardif. En cas de doute, parlez-en à un médecin.
      </HelpText>

      {results.incomplete && (
        <div className="ui-alert ui-alert--warning night-alert">
          Nuit incomplète : moins de {Math.round(protocol.shortNightS / 3600)} h enregistrées. Les chiffres sont montrés, mais une nuit entière les rend plus sûrs.
        </div>
      )}

      <div className="an-sheet__stats an-sheet__stats--always">
        <StatTile label={<>FC la plus basse <HelpToggle helpKey="nuit:creux" label="FC la plus basse" /></>}
          value={bpmText(low?.bpm ?? null)} detail={low ? `à ${clockTime(low.atMs)}` : undefined} />
        {low && (
          <StatTile label={<>Place du creux <HelpToggle helpKey="nuit:place" label="Place du creux" /></>}
            value={NIGHT_PLACE_LABEL[low.place]} detail={`${Math.round(low.fraction * 100)} % de la nuit`} />
        )}
        <StatTile label="FC moyenne" value={bpmText(results.avgBpm)} />
        {results.restingGap && restingBpm !== null && (
          <StatTile label="Écart à la FC repos" value={`${signed(results.restingGap.bpm)} bpm`}
            detail={`${signed(results.restingGap.pct)} %, FC repos ${restingBpm} bpm`} />
        )}
        <StatTile label="Première moitié contre seconde moitié"
          value={`${bpmText(results.halves.first)} · ${bpmText(results.halves.second)}`} />
        <StatTile label={<>Réveils <HelpToggle helpKey="nuit:sursauts" label="Réveils" /></>} value={String(results.wakes.long)}
          detail={`plus de ${longText}`} />
        <StatTile label={<>Éveils brefs <HelpToggle helpKey="nuit:sursauts" label="Éveils brefs" /></>} value={String(results.wakes.brief)}
          detail={`de ${shortText} à ${longText}`} />
        <StatTile label={<>Mouvements <HelpToggle helpKey="nuit:sursauts" label="Mouvements" /></>} value={String(results.wakes.movements)}
          detail={`moins de ${shortText}`} />
        <StatTile label={<>Part de nuit calme <HelpToggle helpKey="nuit:calme" label="Part de nuit calme" /></>}
          value={results.calmShare === null ? '—' : `${Math.round(results.calmShare * 100)} %`} />
        <StatTile label={<>Régularité de la nuit <HelpToggle helpKey="nuit:regularite" label="Régularité de la nuit" /></>}
          value={results.regularityBpm === null ? '—' : `${formatDecimal(results.regularityBpm, 1)} bpm`} detail="plus bas : plus régulier" />
        {low && (
          <StatTile label={<>Stabilisation <HelpToggle helpKey="nuit:stable" label="Stabilisation" /></>}
            value={results.stabilizedAtMs === null ? '—' : clockTime(results.stabilizedAtMs)} />
        )}
        {results.nearLowS !== null && (
          <StatTile label={<>Près du creux <HelpToggle helpKey="nuit:stable" label="Près du creux" /></>} value={formatDuration(results.nearLowS * 1000)} />
        )}
        <StatTile label="Durée" value={formatDuration(results.durationS * 1000)}
          detail={`de ${clockTime(results.startMs)} à ${clockTime(results.endMs)}`} />
      </div>
      <HelpText helpKey="nuit:creux" note>
        Le point le plus calme de votre nuit : la moyenne la plus basse sur {Math.round(protocol.lowWindowS / 60)} minutes de suite, sans compter les sursauts.
        Elle est plus basse que votre FC au repos éveillé : c'est normal, ne la saisissez pas comme FC repos.
      </HelpText>
      <HelpText helpKey="nuit:place" note>
        Quand le cœur est le plus calme : en début, au milieu ou en fin de nuit. Un creux tardif suit parfois un repas copieux, de l'alcool
        ou un effort le soir, mais pas toujours. À comparer à vos autres nuits.
      </HelpText>
      <HelpText helpKey="nuit:sursauts" note>
        Moments où le cœur accélère nettement pendant la nuit, rangés par leur durée : un mouvement ou un changement de position (moins
        de {shortText}), un éveil bref (de {shortText} à {longText}), un réveil (plus de {longText}). C'est une estimation, pas une mesure
        du sommeil. Compté : au moins {protocol.surge.riseBpm} bpm au-dessus de la FC des {Math.round(protocol.surge.baselineS / 60)} minutes
        d'avant, tenu {protocol.surge.holdS} s ; sa durée court du début de la montée au retour de la FC à {protocol.surge.returnBpm} bpm
        de celle d'avant. Rien n'est compté dans les {Math.round(protocol.surge.startSkipS / 60)} premières minutes, le temps de se poser.
        {' '}Limite : quand la FC est déjà haute, un réveil la relève moins et peut passer pour un éveil bref.
      </HelpText>
      <HelpText helpKey="nuit:calme" note>
        La part de la nuit où le cœur bat de façon régulière : tranches de {calmMin} minutes sans aucun sursaut, où la FC s'écarte en
        moyenne de {formatDecimal(protocol.calm.sdBpm, 0)} bpm au plus de sa valeur moyenne (écart-type). À comparer d'une nuit à l'autre.
      </HelpText>
      <HelpText helpKey="nuit:regularite" note>
        Indice maison : l'écart-type médian de la FC sur les tranches de {calmMin} minutes sans sursaut, en bpm. Plus il est bas, plus
        la nuit est régulière. Il sert à comparer vos nuits entre elles. Calculé sur la FC seule, sans les intervalles entre deux battements,
        ce n'est pas la variabilité cardiaque que donnent Polar, Oura ou Garmin : ne le comparez pas à leurs chiffres.
      </HelpText>
      <HelpText helpKey="nuit:stable" note>
        Stabilisation : premier moment où la FC lissée reste à moins de {protocol.stable.aboveLowBpm} bpm au-dessus de la plus basse pendant {stableHoldMin} min.
        Près du creux : le temps passé à moins de {protocol.nearLowBpm} bpm au-dessus de la plus basse.
      </HelpText>
      {restingBpm === null && low && (
        <p className="ui-muted ui-text-xs night-note">
          Pour l'écart à la FC repos, saisissez-la dans <Link to="/parametres">Réglages</Link>, bloc « Pratiquant ».
        </p>
      )}
      {marked.length > 0 && (
        <p className="ui-text-s night-note">
          {longTimes && <>Réveils à {longTimes}.</>}
          {longTimes && briefTimes && ' '}
          {briefTimes && <>Éveils brefs à {briefTimes}.</>}
        </p>
      )}

      {rows.length > 1 && (
        <div className="night-curve">
          <HoverReadout read={read} label="FC lissée" color={HEART_RATE_COLOR} line />
          <HeartRateChart data={rows} zoom={zoom} x={x} zones={null} style={CURVE_BOX}>
            {marked.map((s) => (
              <ReferenceLine key={s.startMs} yAxisId="hr" x={toMin(s.peakMs)} stroke={NIGHT_SURGE_COLOR} strokeDasharray="4 3" ifOverflow="hidden" />
            ))}
            {low && (
              <ReferenceDot yAxisId="hr" x={toMin(low.atMs)} y={Math.round(low.bpm)} r={5} fill={CHART_MARK_COLOR} stroke="var(--surface)" strokeWidth={2}
                ifOverflow="hidden" />
            )}
          </HeartRateChart>
          <p className="ui-muted ui-text-xs night-note">
            FC lissée sur {Math.round(protocol.smoothS / 60)} min. Point : la FC la plus basse ; traits orange : les réveils et les éveils brefs.
          </p>
        </div>
      )}

      {results.hourly.length > 0 && (
        <>
          <ChartFold label="Par heure" open={folds.open.heures} onToggle={() => folds.toggle('heures')} className="ui-mt-12" />
          {folds.open.heures && (
            <table className="ui-table night-table">
              <thead>
                <tr className="ui-sunken">
                  <th className="ui-cell ui-cell--left">Heure</th>
                  <th className="ui-cell ui-cell--center">Moyenne</th>
                  <th className="ui-cell ui-cell--center">Plus basse</th>
                  <th className="ui-cell ui-cell--center">Mesurée</th>
                </tr>
              </thead>
              <tbody>
                {results.hourly.map((h) => (
                  <tr key={h.startMs} className={h.avgBpm === null ? 'ui-table__row ui-table__row--empty' : 'ui-table__row'}>
                    <td className="ui-cell ui-cell--bold ui-nowrap">{clockTime(h.startMs)}</td>
                    <td className="ui-cell ui-cell--center">{bpmText(h.avgBpm)}</td>
                    <td className="ui-cell ui-cell--center">{bpmText(h.lowBpm)}</td>
                    <td className="ui-cell ui-cell--center">{Math.round((h.coveredS / Math.max(1, (h.endMs - h.startMs) / 1000)) * 100)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <div className="night-fold-row ui-mt-12">
        <ChartFold label="Qualité de l'enregistrement" open={folds.open.qualite} onToggle={() => folds.toggle('qualite')} />
        <HelpToggle helpKey="nuit:qualite" label="Qualité de l'enregistrement" />
      </div>
      <HelpText helpKey="nuit:qualite" note>
        Montre si la ceinture a bien tenu la nuit. Les trous viennent d'un contact perdu ou d'un téléphone trop loin.
        Un trou : plus de {protocol.gapS} s sans mesure lisible.
      </HelpText>
      {folds.open.qualite && (
        <div className="an-sheet__stats an-sheet__stats--always night-quality">
          <StatTile label="Part mesurée" value={`${Math.round(results.coverage * 100)} %`} detail={`${formatDuration(results.coveredS * 1000)} sur ${formatDuration(results.durationS * 1000)}`} />
          <StatTile label={`Trous de plus de ${protocol.gapS} s`} value={String(quality.gapCount)} />
          {quality.longestGap && (
            <StatTile label="Plus long trou" value={formatShortDuration(quality.longestGap.s)} detail={`à ${clockTime(quality.longestGap.atMs)}`} />
          )}
          <StatTile label="Intervalle médian" value={quality.medianStepS === null ? '—' : `${formatDecimal(quality.medianStepS, 1)} s`}
            detail={quality.maxStepS === null ? undefined : `le plus grand : ${formatShortDuration(quality.maxStepS)}`} />
          {quality.resumes > 0 && <StatTile label="Reprises" value={String(quality.resumes)} detail="pause ou session interrompue puis reprise" />}
        </div>
      )}
    </>
  );
}
