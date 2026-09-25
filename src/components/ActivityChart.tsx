import { useMemo, useState } from 'react';
import { sessionActivity, type Activity } from '../core/activities';
import { sportFamily } from '../core/sportProfiles';
import { DISTANCE_UNIT_SYMBOL, formatDuration, toDisplayDistance } from '../core/units';
import { useOpenSession } from '../hooks/useLibraryNavigation';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { effectiveDistanceUnit, readStoredActivities } from '../hooks/useSportSettings';
import { CHART_PERIODS, buildActivityChart, type ChartPeriod, type ChartSession } from '../library/activityChart';
import './ActivityChart.css';

/**
 * Graphe d'activités de l'accueil (maquette du 23 septembre 2026) : une barre
 * par jour ou par semaine, une couleur par activité, les sessions d'un même
 * jour empilées ; numéros de semaine ISO en dessous. Toucher une barre
 * affiche ses sessions, chacune ouvrant son analyse. Sous le graphe, les
 * totaux de la période par activité.
 */

/** Hauteur de la zone des barres, en pixels, et hauteur maximale d'une session. */
const PLOT_H = 88;
const UNIT_MAX_H = 24;

/** Distance dans l'unité choisie pour l'activité dans Réglages. */
const formatDistance = (m: number, activity: Activity): string => {
  const unit = effectiveDistanceUnit(activity);
  return `${toDisplayDistance(m, unit).toFixed(1).replace('.', ',')} ${DISTANCE_UNIT_SYMBOL[unit]}`;
};

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const plural = (n: number): string => `${n} session${n > 1 ? 's' : ''}`;

function ActivityChart() {
  const { sessions } = useSessionLibrary();
  const openSession = useOpenSession();
  // Relues à l'ouverture de l'accueil : les activités se changent dans Réglages.
  const [activities] = useState(readStoredActivities);
  const [nowMs] = useState(() => Date.now());
  const [period, setPeriod] = useState<ChartPeriod>('trente');
  const [picked, setPicked] = useState<number | null>(null);

  // Sessions classées, avec leur activité ; les sessions à classer n'apparaissent pas.
  const { chartSessions, activityById } = useMemo(() => {
    const byId = new Map<string, Activity>();
    const list: ChartSession[] = [];
    for (const s of sessions) {
      const activity = sessionActivity(activities, s.record.activityId, s.record.sport);
      if (!activity) continue;
      byId.set(activity.id, activity);
      const { startMs, endMs, distanceM } = s.record.summary;
      list.push({ file: s.file, startMs, durationS: (endMs - startMs) / 1000, distanceM, activityId: activity.id });
    }
    return { chartSessions: list, activityById: byId };
  }, [sessions, activities]);

  const chart = useMemo(
    () => buildActivityChart(chartSessions, period, nowMs, activities.map((a) => a.id)),
    [chartSessions, period, nowMs, activities]
  );

  const maxCount = Math.max(1, ...chart.bars.map((b) => b.sessions.length));
  const unitH = Math.min(UNIT_MAX_H, Math.floor((PLOT_H - 4) / maxCount));
  const totalSessions = chart.totals.reduce((n, t) => n + t.sessions, 0);
  const bar = picked === null ? null : chart.bars[picked] ?? null;
  // Une barre par semaine : le détail donne aussi le jour de chaque session.
  const weekly = period === 'sixmois' || period === 'annee';

  const choosePeriod = (next: ChartPeriod) => {
    setPeriod(next);
    setPicked(null);
  };

  return (
    <section className="actchart" aria-label="Activités">
      <div className="actchart__periods" role="group" aria-label="Période">
        {CHART_PERIODS.map((p) => (
          <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => choosePeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="actchart__head">
        <h2>{chart.title}</h2>
        <span className="num">{plural(totalSessions)}</span>
      </div>

      <div className="actchart__plot" style={{ height: `${PLOT_H}px`, gap: chart.bars.length > 30 ? '2px' : '3px' }}>
        {chart.bars.map((b, i) => (
          <button
            key={b.startMs}
            type="button"
            className={`actchart__bar${picked === i ? ' actchart__bar--picked' : ''}${b.future ? ' actchart__bar--future' : ''}${b.weekStart ? ' actchart__bar--week' : ''}`}
            aria-label={`${b.title} : ${b.sessions.length ? plural(b.sessions.length) : 'aucune session'}`}
            aria-pressed={picked === i}
            onClick={() => setPicked(picked === i ? null : i)}>
            {b.stacks.map((s) => (
              <span
                key={s.activityId}
                className="actchart__stack"
                style={{ height: `${s.count * unitH}px`, background: activityById.get(s.activityId)?.color }} />
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

      <div className="actchart__detail">
        {bar === null ? (
          <span className="actchart__hint">{chart.range}. Toucher une barre pour le détail.</span>
        ) : (
          <>
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
                        <span className="actchart__dot" style={{ background: activity.color }} />
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
          </>
        )}
      </div>

      {chart.totals.length > 0 && (
        <ul className="actchart__totals">
          {chart.totals.map((t) => {
            const activity = activityById.get(t.activityId)!;
            return (
              <li key={t.activityId}>
                <span className="actchart__swatch" style={{ background: activity.color }} />
                <span className="actchart__name">{activity.name}</span>
                <span className="actchart__meta num">
                  {plural(t.sessions)} · {formatDuration(t.durationS * 1000)} · {formatDistance(t.distanceM, activity)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default ActivityChart;
