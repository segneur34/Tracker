import { useState, type ReactNode } from 'react';
import { HelpText } from './Help';
import PanelTitle from './PanelTitle';
import { HIGHLIGHT_PODIUM_COLORS } from './highlightColors';
import Button from './ui/Button';
import MapToggle from './ui/MapToggle';
import StatTile from './ui/StatTile';
import type { FlightPumping, FlightSpan, PumpingSummary } from '../core/pumping';
import { formatShortDuration, formatTimeOfDay } from '../core/units';
import type { PumpingStatus } from '../hooks/useSessionPumping';

/** Une colonne propre au module dans les tableaux des vols : son titre et sa case. */
export interface FlightColumn<F> {
  header: string;
  cell: (flight: F) => ReactNode;
}

export interface FlightPumpingPanelProps<F extends FlightSpan> {
  /** Titre du panneau, avec le nombre de vols. */
  label: string;
  helpKey: string;
  open: boolean;
  onToggle: () => void;
  /** Texte de l'aide « ? », sous le titre. */
  help: ReactNode;
  /** Vols listés, dans l'ordre de la session. */
  flights: F[];
  /** Les 3 plus longs vols, le résumé de l'onglet. */
  podium: F[];
  /** Tuiles propres au module, avant celles du pumping. */
  tiles: ReactNode;
  /** Pumping mesuré par vol (par numéro), `null` sans capteurs lus ou Pumping décoché. */
  pumping: ReadonlyMap<number, FlightPumping> | null;
  pumpSummary: PumpingSummary | null;
  /** Surbrillance de l'onglet : un vol (son numéro) ou le podium (`podium`). */
  shown: string | null;
  onShow: (key: string | null) => void;
  /** Couleur du module, pour le bouton « Voir ». */
  accent: string;
  /** Vitesse dans l'unité de l'activité, « — » sans valeur ; `unitLabel` est son unité, dans les titres. */
  speedCell: (ms: number | null) => string;
  unitLabel: string;
  /** Colonnes du module : du podium sans pumping mesuré… */
  podiumColumns?: FlightColumn<F>[];
  /** …de « Tous les vols », toujours, après le décollage… */
  allColumns?: FlightColumn<F>[];
  /** …et de « Tous les vols » sans pumping mesuré, à la place des siennes. */
  allColumnsWithoutPumping?: FlightColumn<F>[];
  /** Pumping coché pour la session (fiche, sinon activité). */
  pumpingOn: boolean;
  /** Lecture des capteurs (`useSessionPumping`). */
  sensors: { status: PumpingStatus; error: string | null };
  /** Note sous les tableaux, Pumping décoché ; rien si absente. */
  offNote?: ReactNode;
}

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' } as const;
const thStyle = { padding: '0.4em 0.5em', whiteSpace: 'nowrap' } as const;
const tdStyle = { padding: '0.35em 0.5em', textAlign: 'center', whiteSpace: 'nowrap' } as const;
const noteStyle = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' } as const;

const orDash = (value: number | null, format: (v: number) => string): string => (value === null ? '—' : format(value));

/**
 * Vols et leur pumping mesuré par les capteurs du téléphone (`core/pumping.ts`),
 * pièce commune aux onglets « vols » du surf et « pumping » de la voile : les
 * tuiles, le podium des 3 plus longs vols, « Tous les vols », la note de
 * l'étoile (vol couvert en partie) et l'état des capteurs. Le panneau
 * redimensionnable reste chez l'appelant, avec son identifiant.
 */
function FlightPumpingPanel<F extends FlightSpan>({
  label, helpKey, open, onToggle, help, flights, podium, tiles, pumping, pumpSummary, shown, onShow, accent, speedCell, unitLabel,
  podiumColumns = [], allColumns = [], allColumnsWithoutPumping = [], pumpingOn, sensors, offNote,
}: FlightPumpingPanelProps<F>) {
  const [allOpen, setAllOpen] = useState(false);
  /** Nom d'un vol dans les tableaux ; une étoile si les capteurs n'en couvrent qu'une partie. */
  const flightLabel = (f: F, pump: FlightPumping | null, named = true): string =>
    `${named ? 'Vol ' : ''}${f.n}${pump && !pump.covered ? ' *' : ''}`;
  const showButton = (f: F) => {
    const isShown = shown === String(f.n);
    return <MapToggle shown={isShown} color={accent} onClick={() => onShow(isShown ? null : String(f.n))} />;
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <PanelTitle label={label} open={open} onToggle={onToggle} helpKey={helpKey} />
        <span style={{ flex: 1 }} />
        {flights.length > 1 && (
          <Button size="s" aria-pressed={shown === 'podium'} onClick={() => onShow(shown === 'podium' ? null : 'podium')}>
            {shown === 'podium' ? 'Masquer les 3 plus longs' : 'Les 3 plus longs'}
          </Button>
        )}
      </div>
      <HelpText helpKey={helpKey} note>{help}</HelpText>
      <div className="an-sheet__stats an-sheet__stats--always">
        {tiles}
        {pumpSummary && (
          <>
            <StatTile label="Coups de pompe" value={pumpSummary.strokes} />
            <StatTile label="Fréquence" value={orDash(pumpSummary.strokesPerMin, (v) => `${Math.round(v)} /min`)} title="Coups de pompe par minute de pumping" />
            <StatTile label="Par coup" value={orDash(pumpSummary.perStrokeM, (v) => `${v.toFixed(1)} m`)} title="Distance pompée divisée par le nombre de coups" />
          </>
        )}
      </div>
      {flights.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: '10px' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                <th style={thStyle}>{flights.length > 1 ? 'Plus longs' : 'Vol'}</th>
                <th style={thStyle}>Durée</th>
                <th style={thStyle}>Distance</th>
                {pumping ? (
                  <>
                    <th style={thStyle}>Décollage ({unitLabel})</th>
                    <th style={thStyle}>Fréquence</th>
                    <th style={thStyle}>m/coup</th>
                  </>
                ) : podiumColumns.map((c) => <th key={c.header} style={thStyle}>{c.header}</th>)}
                <th style={thStyle}>Carte</th>
              </tr>
            </thead>
            <tbody>
              {podium.map((f, k) => {
                const pump = pumping?.get(f.n) ?? null;
                return (
                  <tr key={f.n} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>
                      <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: HIGHLIGHT_PODIUM_COLORS[k], marginRight: '6px' }} />
                      {flightLabel(f, pump)}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{formatShortDuration(f.durationS)}</td>
                    <td style={tdStyle}>{Math.round(f.distanceM)} m</td>
                    {pumping ? (
                      <>
                        <td style={tdStyle}>{speedCell(pump?.takeoffSpeedMs ?? null)}</td>
                        <td style={tdStyle}>{orDash(pump?.strokesPerMin ?? null, (v) => `${Math.round(v)} /min`)}</td>
                        <td style={tdStyle}>{orDash(pump?.perStrokeM ?? null, (v) => v.toFixed(1))}</td>
                      </>
                    ) : podiumColumns.map((c) => <td key={c.header} style={tdStyle}>{c.cell(f)}</td>)}
                    <td style={tdStyle}>{showButton(f)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {flights.length > 3 && (
        <Button size="s" style={{ marginTop: '10px' }} aria-expanded={allOpen} onClick={() => setAllOpen(!allOpen)}>
          {allOpen ? 'Replier les vols ▲' : `Tous les vols (${flights.length}) ▼`}
        </Button>
      )}
      {allOpen && flights.length > 3 && (
        <div style={{ overflowX: 'auto', marginTop: '10px' }}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                <th style={thStyle}>N°</th>
                <th style={thStyle}>Heure</th>
                <th style={thStyle}>Durée</th>
                <th style={thStyle}>Distance</th>
                {pumping && <th style={thStyle}>Décollage ({unitLabel})</th>}
                {allColumns.map((c) => <th key={c.header} style={thStyle}>{c.header}</th>)}
                {pumping ? (
                  <>
                    <th style={thStyle}>Pompage</th>
                    <th style={thStyle}>Distance pompée</th>
                    <th style={thStyle}>Coups</th>
                    <th style={thStyle}>Fréquence</th>
                    <th style={thStyle}>m/coup</th>
                  </>
                ) : allColumnsWithoutPumping.map((c) => <th key={c.header} style={thStyle}>{c.header}</th>)}
                <th style={thStyle}>Carte</th>
              </tr>
            </thead>
            <tbody>
              {flights.map((f) => {
                const pump = pumping?.get(f.n) ?? null;
                return (
                  <tr key={f.n} style={{ borderTop: '1px solid var(--line-soft)' }}>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{flightLabel(f, pump, false)}</td>
                    <td style={tdStyle}>{formatTimeOfDay(f.startMs).slice(0, 5)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{formatShortDuration(f.durationS)}</td>
                    <td style={tdStyle}>{Math.round(f.distanceM)} m</td>
                    {pumping && <td style={tdStyle}>{speedCell(pump?.takeoffSpeedMs ?? null)}</td>}
                    {allColumns.map((c) => <td key={c.header} style={tdStyle}>{c.cell(f)}</td>)}
                    {pumping ? (
                      <>
                        <td style={tdStyle}>{pump ? formatShortDuration(pump.pumpS) : '—'}</td>
                        <td style={tdStyle}>{pump ? `${Math.round(pump.pumpDistanceM)} m` : '—'}</td>
                        <td style={tdStyle}>{pump ? pump.strokes : '—'}</td>
                        <td style={tdStyle}>{orDash(pump?.strokesPerMin ?? null, (v) => `${Math.round(v)} /min`)}</td>
                        <td style={tdStyle}>{orDash(pump?.perStrokeM ?? null, (v) => v.toFixed(1))}</td>
                      </>
                    ) : allColumnsWithoutPumping.map((c) => <td key={c.header} style={tdStyle}>{c.cell(f)}</td>)}
                    <td style={tdStyle}>{showButton(f)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pumping && [...pumping.values()].some((x) => !x.covered) && (
        <div style={noteStyle}>* : capteurs sur une partie du vol seulement.</div>
      )}
      {pumpingOn && sensors.status === 'none' && (
        <div style={noteStyle}>Cette session n'a pas les capteurs : cochez « Mesurer le pumping » dans Enregistrer, téléphone fixé sur la poitrine.</div>
      )}
      {!pumpingOn && offNote && <div style={noteStyle}>{offNote}</div>}
      {sensors.status === 'loading' && <div style={noteStyle}>Lecture des capteurs…</div>}
      {sensors.error && <div style={noteStyle}>Capteurs : {sensors.error}</div>}
    </>
  );
}

export default FlightPumpingPanel;
