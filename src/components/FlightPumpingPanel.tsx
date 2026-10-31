import { useState, type ReactNode } from 'react';
import { HelpText } from './Help';
import PanelTitle from './PanelTitle';
import { HIGHLIGHT_PODIUM_COLORS } from './highlightColors';
import { FLIGHT_PODIUM_KEY, SERIES_PODIUM_KEY, flightKey, seriesKey, type PumpingHighlightKey } from './pumpingHighlight';
import Button from './ui/Button';
import MapToggle from './ui/MapToggle';
import StatTile from './ui/StatTile';
import Swatch from './ui/Swatch';
import type { FlightPumping, FlightSpan, PumpingSeries, PumpingSummary } from '../core/pumping';
import { formatShortDuration, formatTimeOfDay, formatDecimal } from '../core/units';
import type { PumpingStatus } from '../hooks/useSessionPumping';
import './FlightPumpingPanel.css';

/** Une colonne propre au module dans les tableaux des vols : son titre et sa case. */
export interface FlightColumn<F> {
  header: string;
  cell: (flight: F) => ReactNode;
}

export interface FlightPumpingPanelProps<F extends FlightSpan> {
  helpKey: string;
  open: boolean;
  onToggle: () => void;
  /** Texte de l'aide « ? », sous le titre. */
  help: ReactNode;
  /** Vols listés, dans l'ordre de la session. */
  flights: F[];
  /** Les 3 plus longs vols. */
  podium: F[];
  /** Tuiles propres au module, après celles des vols (Vols, Temps de vol, Plus long vol). */
  extraFlightTiles?: ReactNode;
  /** Pumping mesuré par vol (par numéro), `null` sans capteurs lus ou Pumping décoché. */
  pumping: ReadonlyMap<number, FlightPumping> | null;
  pumpSummary: PumpingSummary | null;
  /** Séries de coups de la session, dans l'ordre (`sessionPumpSeries`), et les 3 plus longues. */
  series: PumpingSeries[];
  seriesPodium: PumpingSeries[];
  /** Surbrillance de l'onglet (`PumpingHighlightKey`) : une série, un vol, ou l'un des deux podiums. */
  shown: string | null;
  onShow: (key: PumpingHighlightKey | null) => void;
  /** Couleur du module, pour le bouton « Voir ». */
  accent: string;
  /** Vitesse dans l'unité de l'activité, « — » sans valeur ; `unitLabel` est son unité, dans les titres. */
  speedCell: (ms: number | null) => string;
  unitLabel: string;
  /** Colonnes du module : du podium des vols sans pumping mesuré… */
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

const thStyle = { padding: '0.4em 0.5em', whiteSpace: 'nowrap' } as const;
const tdStyle = { padding: '0.35em 0.5em', textAlign: 'center', whiteSpace: 'nowrap' } as const;
const boldStyle = { ...tdStyle, fontWeight: 700 } as const;
const noteStyle = { color: 'var(--muted)', fontSize: 'var(--text-xs)', marginTop: '8px' } as const;
const headRowStyle = { backgroundColor: 'var(--surface-sunken)' } as const;

const orDash = (value: number | null, format: (v: number) => string): string => (value === null ? '—' : format(value));
const perMin = (v: number) => `${Math.round(v)} /min`;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Pumping et vols mesurés par les capteurs du téléphone (`core/pumping.ts`),
 * pièce commune aux onglets « vols » du surf et « pumping » de la voile (lot 50).
 * En haut, le pumping : séries de coups validées par leur cadence, tuiles
 * (cadence d'abord), les 3 plus longues séries, « Toutes les séries ». Dessous,
 * à part, les vols : tuiles, les 3 plus longs vols, « Tous les vols ». Sans
 * mesure (capteurs absents, Pumping décoché), les vols seuls. Le panneau
 * redimensionnable reste chez l'appelant, avec son identifiant.
 */
function FlightPumpingPanel<F extends FlightSpan>({
  helpKey, open, onToggle, help, flights, podium, extraFlightTiles, pumping, pumpSummary, series, seriesPodium, shown, onShow, accent,
  speedCell, unitLabel, podiumColumns = [], allColumns = [], allColumnsWithoutPumping = [], pumpingOn, sensors, offNote,
}: FlightPumpingPanelProps<F>) {
  const [allSeriesOpen, setAllSeriesOpen] = useState(false);
  const [allFlightsOpen, setAllFlightsOpen] = useState(false);
  /** Pumping mesuré : la capture touche au moins un vol. */
  const measuring = pumping !== null && pumpSummary !== null && pumpSummary.measured > 0;
  const title = measuring ? `Pumping (${plural(series.length, 'série')})` : `Vols (${flights.length})`;
  const toggleShown = (key: PumpingHighlightKey) => onShow(shown === key ? null : key);
  const mapButton = (key: PumpingHighlightKey) => <MapToggle shown={shown === key} color={accent} onClick={() => toggleShown(key)} />;
  const podiumButton = (key: PumpingHighlightKey, label: string) => (
    <Button size="s" aria-pressed={shown === key} onClick={() => toggleShown(key)}>
      {shown === key ? `Masquer ${label}` : label.charAt(0).toUpperCase() + label.slice(1)}
    </Button>
  );
  /** Nom d'un vol dans les tableaux ; une étoile si les capteurs n'en couvrent qu'une partie. */
  const flightName = (f: F) => `${f.n}${pumping?.get(f.n)?.covered === false ? ' *' : ''}`;
  const totalFlightS = flights.reduce((s, f) => s + f.durationS, 0);
  const longestFlightS = flights.reduce((m, f) => Math.max(m, f.durationS), 0);

  // --- Séries ---
  const seriesTable = (list: PumpingSeries[], podiumRows: boolean) => (
    <div style={{ overflowX: 'auto', marginTop: '10px' }}>
      <table className="ui-table ui-table--cards an-pump-table">
        <thead>
          <tr style={headRowStyle}>
            <th style={thStyle}>Cadence</th>
            <th style={thStyle}>Début</th>
            <th style={thStyle}>Durée</th>
            <th style={thStyle}>Coups</th>
            <th style={thStyle}>m/coup</th>
            <th style={thStyle} title="Vitesse au début, puis à la fin de la série">Vitesse ({unitLabel})</th>
            <th style={thStyle}>Vol</th>
            <th style={thStyle}>Carte</th>
          </tr>
        </thead>
        <tbody>
          {list.map((s, k) => (
            <tr key={s.n} className="ui-table__row">
              <td className="an-pump-lead" style={boldStyle}>
                {podiumRows && <Swatch color={HIGHLIGHT_PODIUM_COLORS[k]} round gap />}
                {perMin(s.strokesPerMin)}
              </td>
              <td className="num" style={tdStyle}>{formatTimeOfDay(s.startMs)}</td>
              <td data-label="durée" style={tdStyle}>{formatShortDuration(s.durationS)}</td>
              <td data-label="coups" style={tdStyle}>{s.strokes}</td>
              <td data-label="m/coup" style={tdStyle}>{formatDecimal(s.perStrokeM, 1)}</td>
              <td data-label={`vitesse (${unitLabel})`} style={tdStyle}>{speedCell(s.speedBeforeMs)} → {speedCell(s.speedAfterMs)}</td>
              <td data-label="vol" style={tdStyle}>{s.flight}</td>
              <td className="an-pump-map" style={tdStyle}>{mapButton(seriesKey(s.n))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // --- Vols ---
  const flightTable = (list: F[], podiumRows: boolean) => {
    const moduleColumns = measuring ? (podiumRows ? [] : allColumns) : podiumRows ? podiumColumns : [...allColumns, ...allColumnsWithoutPumping];
    return (
      <div style={{ overflowX: 'auto', marginTop: '10px' }}>
        <table className="ui-table ui-table--cards an-pump-table">
          <thead>
            <tr style={headRowStyle}>
              <th style={thStyle}>Vol</th>
              <th style={thStyle}>Début</th>
              <th style={thStyle}>Durée</th>
              <th style={thStyle}>Distance</th>
              {measuring && <th style={thStyle}>Décollage ({unitLabel})</th>}
              {moduleColumns.map((c) => <th key={c.header} style={thStyle}>{c.header}</th>)}
              {measuring && (
                <>
                  <th style={thStyle}>Séries</th>
                  <th style={thStyle}>Temps pompé</th>
                </>
              )}
              <th style={thStyle}>Carte</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f, k) => {
              const pump = pumping?.get(f.n) ?? null;
              return (
                <tr key={f.n} className="ui-table__row">
                  <td className="an-pump-lead" style={boldStyle}>
                    {podiumRows && <Swatch color={HIGHLIGHT_PODIUM_COLORS[k]} round gap />}
                    <span className="an-pump-lead__word">Vol </span>{flightName(f)}
                  </td>
                  <td className="num" style={tdStyle}>{formatTimeOfDay(f.startMs)}</td>
                  <td data-label="durée" style={tdStyle}>{formatShortDuration(f.durationS)}</td>
                  <td style={tdStyle}>{Math.round(f.distanceM)} m</td>
                  {measuring && <td data-label={`décollage (${unitLabel})`} style={tdStyle}>{speedCell(pump?.takeoffSpeedMs ?? null)}</td>}
                  {moduleColumns.map((c) => <td key={c.header} data-label={c.header.toLowerCase()} style={tdStyle}>{c.cell(f)}</td>)}
                  {measuring && (
                    <>
                      <td data-label="séries" style={tdStyle}>{pump ? pump.series.length : '—'}</td>
                      <td data-label="pompé" style={tdStyle}>{pump ? formatShortDuration(pump.pumpS) : '—'}</td>
                    </>
                  )}
                  <td className="an-pump-map" style={tdStyle}>{mapButton(flightKey(f.n))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const flightsHead = measuring ? (
    <div className="an-pump-sub">
      <strong>Vols ({flights.length})</strong>
      <span style={{ flex: 1 }} />
      {flights.length > 1 && podiumButton(FLIGHT_PODIUM_KEY, 'les 3 plus longs vols')}
    </div>
  ) : null;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <PanelTitle label={title} open={open} onToggle={onToggle} helpKey={helpKey} />
        <span style={{ flex: 1 }} />
        {measuring
          ? series.length > 1 && podiumButton(SERIES_PODIUM_KEY, 'les 3 plus longues séries')
          : flights.length > 1 && podiumButton(FLIGHT_PODIUM_KEY, 'les 3 plus longs vols')}
      </div>
      <HelpText helpKey={helpKey} note>{help}</HelpText>

      {measuring && pumpSummary && (
        <>
          <div className="an-sheet__stats an-sheet__stats--always">
            <StatTile label="Cadence" value={orDash(pumpSummary.strokesPerMin, perMin)} title="Coups par minute, sur les séries" />
            <StatTile label="Séries" value={pumpSummary.series} />
            <StatTile label="Temps pompé" value={formatShortDuration(pumpSummary.pumpS)} />
            <StatTile label="Coups" value={pumpSummary.strokes} />
            <StatTile label="Par coup" value={orDash(pumpSummary.perStrokeM, (v) => `${formatDecimal(v, 1)} m`)} title="Distance des séries divisée par leurs coups" />
            <StatTile label="Part du vol pompée" value={`${Math.round(pumpSummary.pumpShare * 100)} %`} title="Temps pompé sur le temps de vol couvert par les capteurs" />
          </div>
          {series.length === 0 && (
            <div style={noteStyle}>Aucune série de coups à une cadence régulière : rien n'est compté comme du pumping.</div>
          )}
          {series.length > 0 && seriesTable(seriesPodium, series.length > 1)}
          {series.length > 3 && (
            <Button size="s" style={{ marginTop: '10px' }} aria-expanded={allSeriesOpen} onClick={() => setAllSeriesOpen(!allSeriesOpen)}>
              {allSeriesOpen ? 'Replier les séries ▲' : `Toutes les séries (${series.length}) ▼`}
            </Button>
          )}
          {allSeriesOpen && series.length > 3 && seriesTable(series, false)}
        </>
      )}

      {flightsHead}
      <div className="an-sheet__stats an-sheet__stats--always">
        <StatTile label="Vols" value={flights.length} />
        <StatTile label="Temps de vol" value={formatShortDuration(totalFlightS)} />
        <StatTile label="Plus long vol" value={flights.length > 0 ? formatShortDuration(longestFlightS) : '—'} />
        {extraFlightTiles}
      </div>
      {flights.length > 0 && flightTable(podium, flights.length > 1)}
      {flights.length > 3 && (
        <Button size="s" style={{ marginTop: '10px' }} aria-expanded={allFlightsOpen} onClick={() => setAllFlightsOpen(!allFlightsOpen)}>
          {allFlightsOpen ? 'Replier les vols ▲' : `Tous les vols (${flights.length}) ▼`}
        </Button>
      )}
      {allFlightsOpen && flights.length > 3 && flightTable(flights, false)}

      {pumping && [...pumping.values()].some((x) => !x.covered) && (
        <div style={noteStyle}>* : capteurs sur une partie du vol seulement.</div>
      )}
      {pumping && !measuring && sensors.status === 'ready' && (
        <div style={noteStyle}>Les capteurs de cette session ne couvrent aucun vol.</div>
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
