import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Activity } from '../core/activities';
import { sportFamily } from '../core/sportProfiles';
import { DISTANCE_UNIT_SYMBOL, formatDuration, toDisplayDistance } from '../core/units';
import { HelpText, HelpToggle } from './Help';
import { IconChevronRight } from './icons';
import { libraryPath } from '../core/parentPage';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useOpenSections } from '../hooks/useOpenSections';
import { effectiveDistanceUnit, useVisibility } from '../hooks/useSportSettings';
import { useThemedShade } from '../hooks/useTheme';
import { useVisibleStatSessions } from '../hooks/useVisibleStatSessions';
import { activityBarUnit, buildActivityChart, type ChartRange, type ChartSession } from '../library/activityChart';
import './ActivityChart.css';
import { plural } from '../core/basics';

/**
 * Graphe d'activités du profil, venu de l'accueil (maquette du 23 septembre 2026), sur la
 * période choisie en tête de la page : une barre par jour, par semaine ou par mois, une couleur par activité, les sessions d'un même
 * jour empilées ; numéros de semaine ISO en dessous. Toucher une barre
 * affiche ses sessions, chacune ouvrant son analyse. Sous le graphe, les
 * totaux de la période par activité, chacun ouvrant la bibliothèque filtrée
 * sur son activité, précédés de la légende (dates de la période, toucher une
 * barre) ; une ligne fine les replie ou les déplie tous d'un coup.
 * Les sessions d'une activité ou d'une famille cachée n'y sont pas (§10, point 100).
 */

/** Hauteur de la zone des barres, en pixels (4 de marge en haut), hauteur maximale d'une session, et écart entre deux piles (`ActivityChart.css`). */
const PLOT_H = 62;
const UNIT_MAX_H = 17;
const STACK_GAP = 2;
/** Une pile reste visible, si tassée soit-elle. */
const STACK_MIN_H = 1;

/** Totaux par activité dépliés tant qu'on ne les a pas repliés. */
const TOTALS_DEFAULT = { totaux: true };

/** Distance dans l'unité choisie pour l'activité dans Réglages. */
const formatDistance = (m: number, activity: Activity): string => {
  const unit = effectiveDistanceUnit(activity);
  return `${toDisplayDistance(m, unit).toFixed(1).replace('.', ',')} ${DISTANCE_UNIT_SYMBOL[unit]}`;
};

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });


function ActivityChart({ period, nowMs }: { period: ChartRange; nowMs: number }) {
  const { all, activityById } = useVisibleStatSessions();
  const openSession = useOpenSession();
  const navigate = useNavigate();
  const { activities } = useVisibility();
  const shown = useThemedShade();
  // Barre touchée ; la page remonte le graphe à chaque période (`key`), ce qui la referme.
  const [picked, setPicked] = useState<number | null>(null);
  // Totaux par activité : repliés ou dépliés d'un seul geste, choix gardé sur l'appareil.
  const { open, toggle } = useOpenSections('accueil.graphe', TOTALS_DEFAULT);

  // Sessions classées et visibles (les mêmes que le Profil) ; les sessions à classer n'apparaissent pas.
  const chartSessions = useMemo(
    () => all.map((s): ChartSession => ({ file: s.file, startMs: s.startMs, durationS: (s.endMs - s.startMs) / 1000, distanceM: s.distanceM, activityId: s.activityId })),
    [all]
  );

  const chart = useMemo(
    () => buildActivityChart(chartSessions, period, nowMs, activities.map((a) => a.id)),
    [chartSessions, period, nowMs, activities]
  );

  const unitH = activityBarUnit(chart.bars, PLOT_H - 4, STACK_GAP, UNIT_MAX_H);
  const totalSessions = chart.totals.reduce((n, t) => n + t.sessions, 0);
  const bar = picked === null ? null : chart.bars[picked] ?? null;
  // Une barre par semaine ou par mois : le détail donne aussi le jour de chaque session.
  const weekly = period === 'sixmois' || period === 'annee' || period === 'tout';

  return (
    <section className="actchart" aria-label="Activités">
      <div className="actchart__head">
        <h2>{chart.title}<HelpToggle helpKey="profil:activites" label={chart.title} /></h2>
        <span className="num">{plural(totalSessions, 'session')}</span>
      </div>
      <HelpText helpKey="profil:activites" note>Toucher une barre pour le détail de ses sessions.</HelpText>

      <div className="actchart__plot" style={{ height: `${PLOT_H}px`, gap: chart.bars.length > 30 ? '2px' : '3px' }}>
        {chart.bars.map((b, i) => (
          <button
            key={b.startMs}
            type="button"
            className={`actchart__bar${picked === i ? ' actchart__bar--picked' : ''}${b.future ? ' actchart__bar--future' : ''}${b.weekStart ? ' actchart__bar--week' : ''}`}
            aria-label={`${b.title} : ${b.sessions.length ? plural(b.sessions.length, 'session') : 'aucune session'}`}
            aria-pressed={picked === i}
            onClick={() => setPicked(picked === i ? null : i)}>
            {b.stacks.map((s) => (
              <span
                key={s.activityId}
                className="actchart__stack"
                style={{ height: `${Math.max(STACK_MIN_H, s.count * unitH)}px`, background: activityById.get(s.activityId)?.color }} />
            ))}
          </button>
        ))}
      </div>
      <div className="actchart__axis" aria-hidden="true" style={{ gap: chart.bars.length > 30 ? '2px' : '3px' }}>
        {chart.bars.map((b) => (
          <span key={b.startMs} className={chart.bars.length === 7 ? 'actchart__tick actchart__tick--center' : 'actchart__tick'}>
            {b.label}
          </span>
        ))}
      </div>

      {bar !== null && (
        <div className="actchart__detail">
          <strong>{bar.title}</strong>
          {bar.sessions.length === 0 ? (
            <span className="actchart__hint">Aucune session.</span>
          ) : (
            <ul className="actchart__sessions">
              {bar.sessions.map((s) => {
                const activity = activityById.get(s.activityId)!;
                return (
                  <li key={s.file}>
                    <button type="button" onClick={() => openSession(s.file, sportFamily(activity.base))}>
                      <span className="actchart__dot" style={{ background: shown(activity.color) }} />
                      <span className="actchart__name">{activity.name}</span>
                      <span className="actchart__meta num">
                        {weekly && `${new Date(s.startMs).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} · `}
                        {formatTime(s.startMs)} · {formatDuration(s.durationS * 1000)} · {formatDistance(s.distanceM, activity)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {chart.totals.length > 0 && (
        <button type="button" className="actchart__fold" aria-expanded={open.totaux} onClick={() => toggle('totaux')}>
          <span className="actchart__name">Par activité</span>
          <span className="actchart__meta num">
            {chart.totals.length} activité{chart.totals.length > 1 ? 's' : ''}
          </span>
          <IconChevronRight size={16} className="actchart__chevron" style={{ transform: `rotate(${open.totaux ? -90 : 90}deg)` }} />
        </button>
      )}
      {chart.totals.length > 0 && open.totaux && (
        <ul className="actchart__totals">
          <li className="actchart__hint actchart__legend">{chart.range}.</li>
          {chart.totals.map((t) => {
            const activity = activityById.get(t.activityId)!;
            return (
              <li key={t.activityId}>
                <button type="button" onClick={() => navigate(libraryPath(sportFamily(activity.base), activity.id))}>
                  <span className="actchart__swatch" style={{ background: shown(activity.color) }} />
                  <span className="actchart__name">{activity.name}</span>
                  <span className="actchart__meta num">
                    {plural(t.sessions, 'session')} · {formatDuration(t.durationS * 1000)} · {formatDistance(t.distanceM, activity)}
                  </span>
                  <IconChevronRight size={16} className="actchart__chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ActivityChart;
