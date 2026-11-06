/**
 * Onglet « manœuvres » de la voile : tableau des virements et empannages, tableau par amure, explications
 * repliées sous le « ? », et « Détails » (podiums par métrique, liste de toutes les manœuvres d'un type).
 * Les vues (« Détails », genre du tableau par amure, listes dépliées) et les cases de la carte sont tenues
 * par le module : rendues telles quelles quand l'onglet se ferme puis se rouvre, et lues par la carte.
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDecimal, formatTimeOfDay } from '../../core/units';
import { MANEUVER_LOST_FLIGHT_S } from '../../sailing/sailingConfig';
import { MANEUVER_METRICS, TACK_LABELS, formatMetric, type ManeuverSummary, type windInputWarning } from '../../sailing/sailingAnalytics';
import type { ManeuverLocation, ManeuverStats } from '../../sailing/maneuvers';
import PanelTitle from '../PanelTitle';
import ResizablePanel from '../ResizablePanel';
import { useHelp } from '../helpContext';
import { HIGHLIGHT_PODIUM_COLORS, PODIUM_RANKS } from '../highlightColors';
import { CARD_STYLE, HALF_PANEL_STYLE } from '../styles';
import Button from '../ui/Button';
import MapToggle from '../ui/MapToggle';
import SegmentedControl from '../ui/SegmentedControl';

type ManeuverKind = 'tack' | 'jibe';

/** Vues de l'onglet tenues par le module. */
export interface ManeuversView {
  /** « Détails » plutôt que « Résumé ». */
  details: boolean;
  setDetails: (details: boolean) => void;
  /** Genre montré dans le tableau par amure (note 135) : virements ou empannages. */
  tackType: ManeuverKind;
  setTackType: (type: ManeuverKind) => void;
  /** Liste de toutes les manœuvres d'un type, sous « Détails » : repliée d'office, non mémorisée. */
  listOpen: Record<ManeuverKind, boolean>;
  setListOpen: Dispatch<SetStateAction<Record<ManeuverKind, boolean>>>;
}

/** Cases « Carte » du tableau : virements, empannages, sens incertain. */
export interface ManeuversOnMap {
  tack: boolean;
  jibe: boolean;
  undecided: boolean;
  toggle: (type: ManeuverKind | 'undecided') => void;
}

interface ManeuversPanelProps {
  stats: ManeuverStats;
  summary: ManeuverSummary;
  open: boolean;
  onToggle: () => void;
  /** Vitesse en nœuds vers l'unité de l'activité, sans le symbole. */
  showKn: (kn: number | string) => string;
  /** Seuil en nœuds, tel qu'il s'écrit (`showThreshold` du module). */
  showThreshold: (kn: number) => string;
  speedSymbol: string;
  /** Seuil d'activité de la session, en nœuds : en dessous, une manœuvre est ratée. */
  activeThresholdKn: number;
  foil: boolean;
  /** Vent saisi loin du vent calculé fiable, qui écarte des virages. */
  windWarning: ReturnType<typeof windInputWarning>;
  /** Intervalle médian de la trace, en secondes. */
  samplingS: number;
  pointCount: number;
  /** Vitesse d'entrée de virage retenue, en nœuds. */
  minEntrySpeedKn: number;
  /** Mentions d'une manœuvre (amures, vol perdu, décollage), les mêmes que dans la bulle de la carte. */
  notesOf: (loc: ManeuverLocation) => string[];
  onMap: ManeuversOnMap;
  /** Podium montré sur la carte (`tack:conservation`…), ou `null`. */
  selectedTop: string | null;
  onSelectTop: (key: string | null) => void;
  view: ManeuversView;
}

export default function ManeuversPanel({
  stats: m, summary: maneuverSummary, open, onToggle, showKn, showThreshold, speedSymbol, activeThresholdKn, foil, windWarning,
  samplingS, pointCount, minEntrySpeedKn, notesOf: maneuverNotes, onMap, selectedTop: selectedManeuverTop, onSelectTop, view,
}: ManeuversPanelProps) {
  /** Explications repliées derrière le « ? » : enregistrement, virages écartés, lecture des podiums. */
  const maneuverHelpOpen = useHelp('voile:manoeuvres')?.open ?? false;
  return (
    <ResizablePanel id={view.details ? 'sailing.carte.manoeuvres.details' : 'sailing.carte.manoeuvres'} style={{ ...CARD_STYLE, ...(view.details ? { flex: '1 1 100%' } : HALF_PANEL_STYLE), padding: '12px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <PanelTitle label="Manœuvres" open={open} onToggle={onToggle} helpKey="voile:manoeuvres" />
        <span style={{ color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>ratée si moins de {showThreshold(activeThresholdKn)} {speedSymbol} pendant au moins {MANEUVER_LOST_FLIGHT_S} s</span>
      </div>

      <div className="an-man-scroll">
      <table className="an-man-summary" style={{ borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', marginBottom: '10px' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
            <th style={{ textAlign: 'left' }}>Type</th>
            <th>Réussis</th>
            <th>Ratés</th>
            <th title="Vitesse minimale pendant la manœuvre, moyenne sur toutes les manœuvres">Vmin moy. ({speedSymbol})</th>
            <th title="Meilleure vitesse minimale conservée sur une manœuvre">Vmin max ({speedSymbol})</th>
            <th style={{ padding: '7px 10px' }}>Carte</th>
          </tr>
        </thead>
        <tbody>
          {([
            ['Virements', maneuverSummary.tack, onMap.tack, () => onMap.toggle('tack'), undefined],
            ['Empannages', maneuverSummary.jibe, onMap.jibe, () => onMap.toggle('jibe'), undefined],
            // Virages vus en un seul pas de la trace (lot 44) : la ligne n'apparaît que s'il y en a.
            ...(maneuverSummary.undecided
              ? [['Sens incertain', maneuverSummary.undecided, onMap.undecided, () => onMap.toggle('undecided'),
                'Virage vu en un seul pas de la trace : on connaît le cap avant et après, pas le côté par lequel il est passé. Compté, ni virement ni empannage, et hors du vent.'] as const]
              : []),
          ] as const).map(([label, summary, shown, toggle, hint]) => (
            <tr key={label} className="ui-table__row">
              <td style={{ fontWeight: 700 }} title={hint}>{label}</td>
              <td style={{ textAlign: 'center', color: 'var(--success)', fontWeight: 700, fontSize: 'var(--text-m)' }}>{summary?.success ?? 0}</td>
              <td style={{ textAlign: 'center', color: 'var(--danger)', fontSize: 'var(--text-m)' }}>{summary?.fail ?? 0}</td>
              <td style={{ textAlign: 'center' }}>{summary ? showKn(summary.vminAvg) : '-'}</td>
              <td style={{ textAlign: 'center', fontWeight: 700 }}>{summary ? showKn(summary.vminMax) : '-'}</td>
              <td style={{ padding: '4px 10px', textAlign: 'center' }}>
                <MapToggle shown={shown} color="var(--voile)" title={`Afficher les ${hint ? 'manœuvres de sens incertain' : label.toLowerCase()} sur la carte`} onClick={toggle}
                  style={{ padding: '3px 10px', border: 'none' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/* Vent saisi loin du vent calculé fiable (C1-3, lot 149) : les virages tombent en « sens incertain », on le dit. */}
      {windWarning && (
        <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--warning-soft)', borderLeft: '3px solid var(--warning-line)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
          Le vent saisi ({formatDecimal(windWarning.manualDeg, 0)}°) écarte <strong>{windWarning.unclassified}</strong> virage{windWarning.unclassified > 1 ? 's' : ''}, ni virement ni empannage ; le vent calculé est à {formatDecimal(windWarning.autoDeg, 0)}°. Vérifier la direction.
        </p>
      )}

      {/* Par amure (note 135, 04/11) : virements ou empannages selon l'amure d'avant la manœuvre, médianes. */}
      {(maneuverSummary.tack || maneuverSummary.jibe) && (
        <div className="an-man-scroll" style={{ marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <strong className="ui-subtitle">Par amure</strong>
            <SegmentedControl<'tack' | 'jibe'> label="Manœuvres par amure" accent="var(--voile)" value={view.tackType} onChange={view.setTackType}
              items={[{ key: 'tack', label: 'Virements' }, { key: 'jibe', label: 'Empannages' }]} />
          </div>
          <table className="an-man-summary" style={{ borderCollapse: 'collapse', fontSize: 'var(--text-s)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-sunken)' }}>
                <th style={{ textAlign: 'left' }} title="Amure avant la manœuvre : d'où vient le vent">Amure</th>
                <th title="Manœuvres réussies sur le total de cette amure">Réussis</th>
                <th title="Vitesse minimale pendant la manœuvre, médiane sur cette amure">Vmin méd. ({speedSymbol})</th>
                <th title="Vitesse minimale sur vitesse d'approche, médiane sur cette amure">Conservation</th>
              </tr>
            </thead>
            <tbody>
              {(['starboard', 'port'] as const).map((tack) => {
                const onTack = maneuverSummary.byTack[view.tackType][tack];
                return (
                  <tr key={tack} className="ui-table__row">
                    <td style={{ fontWeight: 700 }}>{TACK_LABELS[tack]}</td>
                    <td style={{ textAlign: 'center' }}>
                      {onTack ? <><span style={{ color: 'var(--success)', fontWeight: 700 }}>{onTack.success}</span>{` / ${onTack.count}`}</> : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{onTack ? showKn(onTack.vminMedian) : '-'}</td>
                    <td style={{ textAlign: 'center' }}>{onTack ? formatMetric('conservation', onTack.conservationMedian) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {maneuverHelpOpen && (<>
      <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
        <strong>Enregistrement :</strong> {pointCount} points, un toutes les {samplingS < 10 ? formatDecimal(samplingS, 1) : Math.round(samplingS)} s en médiane. Entrée de virage retenue au-dessus de {showKn(minEntrySpeedKn)} {speedSymbol}, d'après l'allure de la session.
        {samplingS > 10 && (
          <>
            {' '}Cadence économique : les manœuvres se lisent encore, mais leur qualité
            (Vmin, relance) et les tops courts reposent sur des moyennes de plusieurs
            dizaines de secondes.
          </>
        )}
      </p>

      {(m.rejected.unclassified > 0 ||
        m.rejected.slowEntry > 0 ||
        m.rejected.incoherent > 0 ||
        m.rejected.still > 0 ||
        m.rejected.tooShort > 0 ||
        m.rejected.noFlight > 0 ||
        m.rejected.fullTurn > 0) && (
        <p style={{ margin: '0 0 10px', padding: '8px', backgroundColor: 'var(--bg)', borderLeft: '3px solid var(--line-strong)', borderRadius: '4px', color: 'var(--ink-2)', fontSize: 'var(--text-xs)', lineHeight: '1.6' }}>
          <strong>{m.locations.length} virage{m.locations.length > 1 ? 's' : ''} retenu{m.locations.length > 1 ? 's' : ''}</strong>, et d'autres écartés en chemin :
          {m.rejected.noFlight > 0 && (
            <>
              <br />
              <strong>{m.rejected.noFlight}</strong> demi-tour{m.rejected.noFlight > 1 ? 's' : ''} hors {foil ? 'vol' : 'navigation'} : entamé{m.rejected.noFlight > 1 ? 's' : ''} sous le seuil {foil ? 'de vol' : 'de navigation'}, ni réussi{m.rejected.noFlight > 1 ? 's' : ''} ni raté{m.rejected.noFlight > 1 ? 's' : ''}.
            </>
          )}
          {m.rejected.fullTurn > 0 && (
            <>
              <br />
              <strong>{m.rejected.fullTurn}</strong> tour{m.rejected.fullTurn > 1 ? 's' : ''} complet{m.rejected.fullTurn > 1 ? 's' : ''}, non compté{m.rejected.fullTurn > 1 ? 's' : ''}.
            </>
          )}
          {m.rejected.unclassified > 0 && (
            <>
              <br />
              <strong>{m.rejected.unclassified}</strong> franc{m.rejected.unclassified > 1 ? 's' : ''} et net{m.rejected.unclassified > 1 ? 's' : ''}, mais sans changer d'amures ou ni face au vent ni au vent arrière : ce sont des abattées ou des remontées — ou le vent retenu est faux, ce qui range tous les demi-tours au travers.
            </>
          )}
          {m.rejected.slowEntry > 0 && (
            <>
              <br />
              <strong>{m.rejected.slowEntry}</strong> entamé{m.rejected.slowEntry > 1 ? 's' : ''} trop lentement (moins de {showKn(minEntrySpeedKn)} {speedSymbol} à l'entrée).
            </>
          )}
          {m.rejected.incoherent > 0 && (
            <>
              <br />
              <strong>{m.rejected.incoherent}</strong> dont le cap partait dans tous les sens : chute ou hésitation.
            </>
          )}
          {m.rejected.still > 0 && (
            <>
              <br />
              <strong>{m.rejected.still}</strong> lu{m.rejected.still > 1 ? 's' : ''} planche arrêtée, avant ou après le virage : à l'arrêt le cap n'est que du bruit de position.
            </>
          )}
          {m.rejected.tooShort > 0 && (
            <>
              <br />
              <strong>{m.rejected.tooShort}</strong> sur place (moins de 10 m parcourus : à cette distance le cap n'est que du bruit de position) ou entamé{m.rejected.tooShort > 1 ? 's' : ''} dans les dernières secondes de la trace.
            </>
          )}
        </p>
      )}
      {view.details && (
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 'var(--text-xs)', lineHeight: 1.45 }}>
          Survolez une ligne pour la définition, une case du podium pour l'heure de la manœuvre. Le podium retient la meilleure valeur : conservation la plus haute, relance la plus courte, cap (virements seulement) et distance les plus faibles, gain au vent le plus grand ; à égalité, la meilleure conservation.
        </p>
      )}
      </>)}

      <SegmentedControl<'resume' | 'details'> label="Détails des manœuvres" accent="var(--voile)"
        value={view.details ? 'details' : 'resume'} onChange={(key) => view.setDetails(key === 'details')}
        items={[{ key: 'resume', label: 'Résumé' }, { key: 'details', label: 'Détails' }]} />

      {view.details && (
      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginTop: '12px' }}>
        {([
          ['tack', 'Virements', 'virements', maneuverSummary.tack],
          ['jibe', 'Empannages', 'empannages', maneuverSummary.jibe],
        ] as const).map(([type, title, noun, summary]) => {
          const ofType = m.locations.filter((loc) => loc.type === type);
          const listOpen = view.listOpen[type];
          return (
          <div key={type} className="an-man-detail" style={{ flex: '1 1 380px', backgroundColor: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '6px', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <strong className="ui-subtitle">{title}</strong>
              {summary ? (
                <span style={{ fontSize: 'var(--text-s)' }}>
                  <span style={{ color: 'var(--success)', fontWeight: 700 }}>{summary.success} réussi{summary.success > 1 ? 's' : ''}</span>
                  {' · '}
                  <span style={{ color: 'var(--danger)' }}>{summary.fail} raté{summary.fail > 1 ? 's' : ''}</span>
                  {' · Vmin moy. '}{showKn(summary.vminAvg)}{` ${speedSymbol}, max `}<strong>{showKn(summary.vminMax)}</strong>{` ${speedSymbol}`}
                </span>
              ) : (
                <span style={{ color: 'var(--muted)', fontSize: 'var(--text-s)' }}>aucun</span>
              )}
            </div>

            {summary && (
              <table className="an-man-podium" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px', fontWeight: 'normal' }}>Métrique</th>
                    <th style={{ padding: '3px 4px', fontWeight: 'normal' }}>Moyenne</th>
                    {PODIUM_RANKS.map((rank, idx) => (
                      <th key={rank} style={{ padding: '3px 4px', fontWeight: 'normal', color: HIGHLIGHT_PODIUM_COLORS[idx] }}>{rank}</th>
                    ))}
                    <th style={{ padding: '3px 4px' }} />
                  </tr>
                </thead>
                <tbody>
                  {MANEUVER_METRICS.map((metric) => {
                    const key = `${type}:${metric.key}`;
                    const active = selectedManeuverTop === key;
                    const tops = summary.tops[metric.key];
                    const ranked = metric.ranked.includes(type);
                    return (
                      <tr key={metric.key} title={metric.hint} style={{ borderBottom: '1px solid var(--line-soft)', backgroundColor: active ? 'var(--voile-soft)' : 'transparent' }}>
                        <td style={{ padding: '4px', textAlign: 'left' }}>{metric.label}</td>
                        <td style={{ padding: '4px', textAlign: 'center', fontWeight: 700 }}>
                          {summary.averages[metric.key]}
                          {metric.key === 'relaunch' && summary.withoutRelaunch > 0 && (
                            <span style={{ display: 'block', fontWeight: 'normal', color: 'var(--muted)', fontSize: 'var(--text-xs)' }}>
                              {summary.withoutRelaunch} sans relance
                            </span>
                          )}
                        </td>
                        {[0, 1, 2].map((rank) => (
                          <td key={rank} title={tops[rank] ? formatTimeOfDay(tops[rank].timeMs) : undefined} style={{ padding: '4px', textAlign: 'center' }}>
                            {ranked ? tops[rank]?.label ?? '-' : '—'}
                          </td>
                        ))}
                        <td style={{ padding: '2px 4px', textAlign: 'right' }}>
                          <MapToggle
                            shown={active} color="var(--voile)" labels={['Carte', 'Masquer']} disabled={tops.length === 0}
                            onClick={() => onSelectTop(active ? null : key)}
                            style={{ padding: '2px 7px', opacity: tops.length === 0 ? 0.5 : 1 }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {summary && ofType.length > 0 && (
              <Button size="s" style={{ marginTop: '8px' }} aria-expanded={listOpen}
                onClick={() => view.setListOpen((prev) => ({ ...prev, [type]: !prev[type] }))}>
                {listOpen ? `Replier les ${noun} ▲` : `Tous les ${noun} (${ofType.length}) ▼`}
              </Button>
            )}
            {summary && listOpen && ofType.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: '18px', fontSize: 'var(--text-xs)', color: 'var(--ink-2)', lineHeight: 1.5 }}>
                {ofType.map((loc) => (
                  <li key={loc.timeMs}>
                    {formatTimeOfDay(loc.timeMs)}{' · '}
                    <span style={{ color: loc.success ? 'var(--success)' : 'var(--danger)' }}>{loc.success ? 'réussi' : 'raté'}</span>
                    {` · Vmin ${showKn(loc.vmin)} ${speedSymbol}`}
                    {maneuverNotes(loc).map((note) => ` · ${note}`).join('')}
                  </li>
                ))}
              </ul>
            )}
          </div>
          );
        })}
      </div>
      )}
    </ResizablePanel>
  );
}
