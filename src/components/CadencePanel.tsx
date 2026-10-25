import ChartFold from './ChartFold';
import { HelpText } from './Help';
import PanelTitle from './PanelTitle';
import { CADENCE_BAND_COLORS } from './cadenceColors';
import { HIGHLIGHT_SHOWN_COLOR } from './highlightColors';
import { SPEED_UNIT_LABEL, formatShortDuration, formatSpeedValue, toDisplaySpeed, type SpeedUnit } from '../core/units';
import { useOpenSections } from '../hooks/useOpenSections';
import type { CadenceAnalysis, CadenceShare } from '../running/cadence';
import { GRADE_ZONES } from '../running/runningAnalytics';

interface Props {
  analysis: CadenceAnalysis;
  speedUnit: SpeedUnit;
  /** Tranche montrée sur la carte (0 sous la première borne), ou `null`. */
  selectedBand: number | null;
  onSelectBand: (band: number | null) => void;
  /** Préfixe des replis gardés sur l'appareil (celui du module). */
  storagePrefix: string;
  open: boolean;
  onToggle: () => void;
}

/** Tableaux de l'onglet, dépliés tant qu'on ne les replie pas. */
const FOLDS_DEFAULT = { tranches: true, vitesse: true, pente: true };

const cell = { padding: '0.4em 0.6em', textAlign: 'center' } as const;
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginTop: '6px' } as const;

const spmText = (spm: number) => `${Math.round(spm)} pas/min`;
const stepText = (m: number | null) => (m === null ? '—' : `${m.toFixed(2)} m`);
const signedPercent = (from: number, to: number) => {
  const pct = from > 0 ? ((to - from) / from) * 100 : 0;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)} %`;
};

/**
 * Onglet « cadence » des analyses à pied (course, marche, fractionné à pied) :
 * chiffres, temps par tranche de cadence avec ses passages sur la carte,
 * cadence et longueur de pas selon la vitesse et selon la pente, dérive.
 * Posé dans le `ResizablePanel` du module ; la courbe est dans « graphiques ».
 */
export default function CadencePanel({ analysis, speedUnit, selectedBand, onSelectBand, storagePrefix, open, onToggle }: Props) {
  const folds = useOpenSections(`${storagePrefix}.cadence`, FOLDS_DEFAULT);
  const { bands, bySpeed, byGrade, drift } = analysis;
  const bandTotal = bands.timesS.reduce((a, b) => a + b, 0);
  const unit = SPEED_UNIT_LABEL[speedUnit];
  const speedText = (ms: number) => formatSpeedValue(toDisplaySpeed(ms, speedUnit), speedUnit);
  // La tranche la plus lente part de l'arrêt : « moins de » sa borne haute.
  const speedRange = (fromMs: number, toMs: number) => (fromMs < 0.5 ? `< ${speedText(toMs)}` : `${speedText(fromMs)} – ${speedText(toMs)}`);
  const shareRow = (key: string, label: string, s: CadenceShare, extra?: string) => (
    <tr key={key} style={{ borderTop: '1px solid var(--line-soft)', opacity: s.timeS > 0 ? 1 : 0.45 }}>
      <td style={{ padding: '0.4em 0.6em', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {label}{extra && <span style={{ color: 'var(--muted)', fontWeight: 'normal', fontSize: 'var(--text-xs)' }}> {extra}</span>}
      </td>
      <td style={cell}>{formatShortDuration(s.timeS)}</td>
      <td style={{ ...cell, fontWeight: 700 }}>{s.timeS > 0 ? spmText(s.spm) : '—'}</td>
      <td style={cell}>{s.timeS > 0 ? stepText(s.stepLengthM) : '—'}</td>
    </tr>
  );
  const shareHead = (first: string) => (
    <thead>
      <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
        <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>{first}</th>
        <th style={cell}>Temps</th>
        <th style={cell}>Cadence</th>
        <th style={cell}>Pas</th>
      </tr>
    </thead>
  );

  return (
    <>
      <div style={{ marginBottom: '10px' }}>
        <PanelTitle label="Cadence" extra={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)', fontWeight: 'normal' }}>(en mouvement)</span>} open={open} onToggle={onToggle} helpKey="analyse:cadence" />
      </div>
      <HelpText helpKey="analyse:cadence" note>
        Cadence comptée par l'accéléromètre du téléphone (ou la montre), en pas par minute ; la courbe est dans l'onglet « graphiques ».
        {bands && ` Tranches de la ${bands.running ? 'course' : 'marche'}, choisies par la cadence moyenne ; « Voir » montre leurs passages sur la carte, en violet.`}
        {bySpeed.length > 0 && " Pour aller plus vite, on presse le pas (cadence) ou on l'allonge (longueur) : la longueur de pas est la distance divisée par les pas."}
      </HelpText>
      <div className="an-sheet__stats an-sheet__stats--always">
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">Cadence moyenne</span><strong className="an-sheet__stat-value">{spmText(analysis.averageSpm)}</strong></div>
        {analysis.maxSpm !== null && (
          <div className="an-sheet__stat"><span className="an-sheet__stat-label">Cadence max (30 s)</span><strong className="an-sheet__stat-value">{spmText(analysis.maxSpm)}</strong></div>
        )}
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">Longueur de pas</span><strong className="an-sheet__stat-value">{stepText(analysis.stepLengthM)}</strong></div>
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">Pas</span><strong className="an-sheet__stat-value">{Math.round(analysis.steps).toLocaleString('fr-FR')}</strong></div>
        <div className="an-sheet__stat"><span className="an-sheet__stat-label">Temps mesuré</span><strong className="an-sheet__stat-value">{Math.round(analysis.measuredShare * 100)} %</strong></div>
      </div>
      {drift && (
        <div style={{ fontSize: 'var(--text-s)', margin: '4px 0 2px' }}>
          <span style={{ color: 'var(--muted)' }}>Dérive, du premier au dernier tiers : </span>
          cadence {Math.round(drift.first.spm)} → {Math.round(drift.last.spm)} pas/min ({signedPercent(drift.first.spm, drift.last.spm)})
          {drift.first.stepLengthM !== null && drift.last.stepLengthM !== null && (
            <>, pas {drift.first.stepLengthM.toFixed(2)} → {drift.last.stepLengthM.toFixed(2)} m ({signedPercent(drift.first.stepLengthM, drift.last.stepLengthM)})</>
          )}
        </div>
      )}

      <ChartFold label={bands.running ? 'Tranches (course)' : 'Tranches (marche)'} open={folds.open.tranches} onToggle={() => folds.toggle('tranches')} style={{ marginTop: '12px' }} />
      {folds.open.tranches && (
        <>
          <table style={tableStyle}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                <th style={{ textAlign: 'left', padding: '0.4em 0.6em' }}>Pas/min</th>
                <th style={cell}>Temps</th>
                <th style={{ ...cell, width: '35%' }}>Part</th>
                <th style={cell}>Carte</th>
              </tr>
            </thead>
            <tbody>
              {bands.timesS.map((s, band) => {
                const share = bandTotal > 0 ? s / bandTotal : 0;
                const shown = selectedBand === band;
                const range = band === 0 ? `< ${bands.bounds[0]}` : band === bands.bounds.length ? `≥ ${bands.bounds[band - 1]}` : `${bands.bounds[band - 1]}-${bands.bounds[band] - 1}`;
                return (
                  <tr key={band} style={{ borderTop: '1px solid var(--line-soft)', opacity: s > 0 ? 1 : 0.45 }}>
                    <td style={{ padding: '0.4em 0.6em', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: CADENCE_BAND_COLORS[band], marginRight: '6px' }} />
                      {range}
                    </td>
                    <td style={cell}>{formatShortDuration(s)}</td>
                    <td style={cell}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ flex: 1, height: '8px', backgroundColor: 'var(--surface-sunken)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ width: `${share * 100}%`, height: '100%', backgroundColor: CADENCE_BAND_COLORS[band] }} />
                        </div>
                        <span style={{ minWidth: '3em', textAlign: 'right', fontSize: 'var(--text-xs)' }}>{Math.round(share * 100)} %</span>
                      </div>
                    </td>
                    <td style={cell}>
                      <button type="button" disabled={s <= 0} onClick={() => onSelectBand(shown ? null : band)}
                        style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', cursor: s > 0 ? 'pointer' : 'default', backgroundColor: shown ? HIGHLIGHT_SHOWN_COLOR : 'var(--surface-sunken)', color: shown ? '#fff' : 'var(--ink)', border: '1px solid var(--line-strong)', borderRadius: '4px' }}>
                        {shown ? 'Masquer' : 'Voir'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {bySpeed.length > 0 && (
        <>
          <ChartFold label="Selon la vitesse" open={folds.open.vitesse} onToggle={() => folds.toggle('vitesse')} style={{ marginTop: '12px' }} />
          {folds.open.vitesse && (
            <table style={tableStyle}>
              {shareHead(unit)}
              <tbody>{bySpeed.map((b) => shareRow(String(b.fromMs), speedRange(b.fromMs, b.toMs), b))}</tbody>
            </table>
          )}
        </>
      )}

      {byGrade && (
        <>
          <ChartFold label="Selon la pente" open={folds.open.pente} onToggle={() => folds.toggle('pente')} style={{ marginTop: '12px' }} />
          {folds.open.pente && (
            <table style={tableStyle}>
              {shareHead('Zone')}
              <tbody>
                {byGrade.map((z) => {
                  const zone = GRADE_ZONES.find((g) => g.key === z.zone)!;
                  return shareRow(z.zone, zone.label, z, zone.range);
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
