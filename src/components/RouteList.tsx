import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Activity } from '../core/activities';
import { formatDistance, formatDuration } from '../core/units';
import { useGoOnRoute } from '../hooks/useGoOnRoute';
import type { SavedRoute } from '../hooks/useRouteLibrary';
import { useRunnerProfile } from '../hooks/useRunnerProfile';
import { effectiveDistanceUnit, effectiveDurationSettings, effectiveElevationProfile } from '../hooks/useSportSettings';
import { routeActivity, routeDistanceM, routeDurationS } from '../planning/routeList';
import Button from './ui/Button';
import './RouteList.css';

/**
 * Liste d'itinéraires rangés : nom, activité, distance dans l'unité de son
 * activité, temps estimé en course et à vélo (niveau de Réglages), date. Commune à l'accueil, aux bibliothèques Voile et Course
 * (vue « Planifiées ») et à la page Itinéraires (« Mes itinéraires »).
 *
 * Toucher un itinéraire l'ouvre dans la page Itinéraires
 * (`/itineraires?itineraire=<base>`), sauf si la page fournit `onOpen`.
 * « Partir » le suit et ouvre la page Enregistrer, son activité proposée : il
 * reste à toucher « Démarrer ». Grisé pendant un enregistrement, où la trace
 * suivie ne se change pas.
 */

interface RouteListProps {
  routes: SavedRoute[];
  activities: Activity[];
  onOpen?: (saved: SavedRoute) => void;
  /** Itinéraire ouvert, souligné. */
  currentBase?: string | null;
  /** Actions au bout de chaque ligne (Supprimer, dans la page Itinéraires). */
  actions?: (saved: SavedRoute) => ReactNode;
  /** Bouton « Partir » sur chaque ligne ; oui par défaut. */
  go?: boolean;
}

const routePath = (saved: SavedRoute): string => `/itineraires?itineraire=${encodeURIComponent(saved.base)}`;

function RouteList({ routes, activities, onOpen, currentBase = null, actions, go: withGo = true }: RouteListProps) {
  const distances = useMemo(() => new Map(routes.map((s) => [s.base, routeDistanceM(s.record)])), [routes]);
  const riderKg = useRunnerProfile().profile.weightKg;
  const durations = useMemo(() => new Map(routes.map((s) => {
    const activity = routeActivity(s, activities);
    const settings = activity ? effectiveDurationSettings(activity, riderKg) : null;
    return [s.base, activity && settings ? routeDurationS(s.record, effectiveElevationProfile(activity).minGainM, settings) : null];
  })), [routes, activities, riderKg]);
  const { go, canGo } = useGoOnRoute();

  return (
    <ul className="route-list">
      {routes.map((saved) => {
        const activity = routeActivity(saved, activities);
        const duration = durations.get(saved.base) ?? null;
        const body = (
          <>
            <strong>{saved.record.name}</strong>
            <span className="route-list__meta">
              <span className="route-list__dot" style={{ background: activity?.color ?? 'var(--faint)' }} />
              <span>{activity?.name ?? 'Sans activité'}</span>
              <span className="num">
                {' · '}
                {formatDistance(distances.get(saved.base) ?? 0, activity ? effectiveDistanceUnit(activity) : 'km')}
                {duration !== null && ` · ≈ ${formatDuration(duration * 1000)}`}
                {' · '}
                {new Date(saved.record.updatedAt).toLocaleDateString('fr-FR')}
              </span>
            </span>
          </>
        );
        return (
          <li key={saved.base} className={`route-list__item${currentBase === saved.base ? ' route-list__item--current' : ''}`}>
            {onOpen ? (
              <button type="button" className="route-list__open" onClick={() => onOpen(saved)}>{body}</button>
            ) : (
              <Link to={routePath(saved)} className="route-list__open">{body}</Link>
            )}
            {withGo && (
              <Button size="s" variant="record" disabled={!canGo} onClick={() => go(saved)}
                title={canGo ? undefined : 'Un enregistrement est en cours'} aria-label={`Partir sur ${saved.record.name}`}>
                Partir
              </Button>
            )}
            {actions?.(saved)}
          </li>
        );
      })}
    </ul>
  );
}

export default RouteList;
