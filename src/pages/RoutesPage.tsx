import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MemoryStatus from '../components/MemoryStatus';
import RouteList from '../components/RouteList';
import { IconRoute } from '../components/icons';
import Card from '../components/ui/Card';
import PageHeader from '../components/ui/PageHeader';
import { activityCounts } from '../core/activities';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';
import { ROUTE_SORTS, isRouteSort, routeActivity, routeDistanceM, sortRoutes, type RouteSort } from '../planning/routeList';
import { jsonStore } from '../platform/storage';

/**
 * Tous les itinéraires planifiés (point 68), ouverts depuis la carte de
 * l'accueil, qui n'en montre que les derniers : tri au choix, retenu sur
 * l'appareil (`tracker.routeList`), et onglets par activité. Chaque ligne
 * ouvre l'itinéraire, ou part dessus (« Partir »).
 */

const PREFS_KEY = 'tracker.routeList';
/** Onglet des itinéraires rangés sans activité connue. */
const WITHOUT_ACTIVITY = '';

const readSort = (): RouteSort => {
  const stored = jsonStore.read<{ sort?: unknown }>(PREFS_KEY)?.sort;
  return isRouteSort(stored) ? stored : 'recent';
};

function RoutesPage() {
  const { routes, error } = useRouteLibrary();
  // Relues à l'ouverture de la page : les activités se changent dans Réglages.
  const [activities] = useState(readStoredActivities);
  const [sort, setSortState] = useState<RouteSort>(readSort);
  const setSort = (next: RouteSort) => {
    setSortState(next);
    jsonStore.write(PREFS_KEY, { sort: next });
  };
  const [filter, setFilter] = useState<string | null>(null);

  const counts = useMemo(() => activityCounts(routes.map((r) => routeActivity(r, activities)), activities), [routes, activities]);
  const withoutActivity = routes.filter((r) => routeActivity(r, activities) === null).length;
  const distances = useMemo(() => new Map(routes.map((r) => [r.base, routeDistanceM(r.record)])), [routes]);
  const shown = useMemo(() => {
    const filtered = filter === null
      ? routes
      : routes.filter((r) => (routeActivity(r, activities)?.id ?? WITHOUT_ACTIVITY) === filter);
    return sortRoutes(filtered, sort, (r) => distances.get(r.base) ?? 0);
  }, [routes, activities, filter, sort, distances]);
  const tabCount = counts.length + (withoutActivity > 0 ? 1 : 0);

  return (
    <div className="ui-page" style={{ '--tab-accent': 'var(--ink)' } as React.CSSProperties}>
      <PageHeader
        title="Itinéraires planifiés"
        back={{ to: '/', label: 'Accueil' }}
        subtitle={`${routes.length} itinéraire${routes.length > 1 ? 's' : ''}`} />

      <MemoryStatus />
      {error && <div className="ui-alert ui-alert--danger">{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {routes.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-m)' }}>
            <span className="ui-eyebrow">Trier</span>
            <select className="ui-field ui-field--s" value={sort} onChange={(e) => isRouteSort(e.target.value) && setSort(e.target.value)}>
              {ROUTE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        <Link to="/itineraires" className="ui-btn ui-btn--secondary ui-btn--s" style={{ marginLeft: 'auto' }}>
          <IconRoute size={18} /> Planifier
        </Link>
      </div>

      {tabCount > 1 && (
        <div className="ui-tabs">
          <button type="button" className="ui-tab" aria-pressed={filter === null} onClick={() => setFilter(null)}>
            tous ({routes.length})
          </button>
          {counts.map(({ activity, count }) => (
            <button key={activity.id} type="button" className="ui-tab" aria-pressed={filter === activity.id} onClick={() => setFilter(activity.id)}>
              {activity.name} ({count})
            </button>
          ))}
          {withoutActivity > 0 && (
            <button type="button" className="ui-tab" aria-pressed={filter === WITHOUT_ACTIVITY} onClick={() => setFilter(WITHOUT_ACTIVITY)}>
              sans activité ({withoutActivity})
            </button>
          )}
        </div>
      )}

      <Card>
        {shown.length > 0 ? (
          <RouteList routes={shown} activities={activities} />
        ) : (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'var(--text-m)', lineHeight: 1.5 }}>
            Aucun itinéraire pour l'instant. <Link to="/itineraires">Planifiez-en un</Link> : il apparaîtra ici, prêt à suivre.
          </p>
        )}
      </Card>
    </div>
  );
}

export default RoutesPage;
