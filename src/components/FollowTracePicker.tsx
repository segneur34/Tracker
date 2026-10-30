import { errorMessage } from '../core/basics';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionActivity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { hasPositions } from '../core/sportProfiles';
import { useRouteLibrary, type SavedRoute } from '../hooks/useRouteLibrary';
import { followTrace } from '../hooks/useFollowedTrace';
import { readSessionGpx, useLibraryFields } from '../hooks/useSessionLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { shownRoutes } from '../planning/routeList';
import { followedTraceFromPoints, followedTraceFromRoute, type FollowedTrace } from '../recording/followedTrace';
import ActivitySelect from './ActivitySelect';
import Button from './ui/Button';
import Card from './ui/Card';
import SegmentedControl from './ui/SegmentedControl';

/**
 * Choix de la trace à suivre pendant l'enregistrement : un itinéraire rangé
 * (page Itinéraires) ou une session déjà enregistrée, pour refaire un
 * parcours. La trace choisie va dans `useFollowedTrace`, avec son activité ;
 * `onPicked` la reçoit aussi, pour proposer cette activité.
 */

type PickerTab = 'route' | 'session';

/** Sessions montrées d'un coup ; « Afficher plus » en ajoute autant. */
const PAGE_SIZE = 20;

const ROW_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '2px',
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-m)',
  background: 'var(--bg)',
  color: 'var(--ink)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
} as const;

const DETAIL_STYLE = { color: 'var(--muted)', fontSize: 'var(--text-s)' } as const;
const LIST_STYLE = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: 0, padding: 0, listStyle: 'none' } as const;

const formatDate = (ms: number | string) => new Date(ms).toLocaleDateString('fr-FR');

function FollowTracePicker({ onClose, onPicked }: { onClose: () => void; onPicked?: (trace: FollowedTrace) => void }) {
  const { status, sessions } = useLibraryFields('status', 'sessions');
  const library = useRouteLibrary();
  const [tab, setTab] = useState<PickerTab>('route');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ni itinéraire ni session d'une activité cachée dans Réglages (§10, point 100).
  const { activities, isShown } = useVisibility();
  const routes = useMemo(() => shownRoutes(library.routes, activities, isShown), [library.routes, activities, isShown]);
  /** Activité retenue dans l'onglet Sessions ; `null` : toutes. */
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  /** Sessions de la plus récente à la plus ancienne, chacune avec son activité. */
  const sortedSessions = useMemo(
    () => [...sessions]
      .sort((a, b) => b.record.summary.startMs - a.record.summary.startMs)
      .map((session) => ({ ...session, activity: sessionActivity(activities, session.record.activityId, session.record.sport) }))
      // Une session sans trace (muscu) n'est pas une trace à suivre.
      .filter((s) => (s.record.sport === null || hasPositions(s.record.sport)) && (s.activity === null || isShown(s.activity))),
    [sessions, activities, isShown]
  );
  /** Activités présentes parmi les sessions, dans l'ordre des Réglages. */
  const sessionActivities = useMemo(
    () => activities.filter((a) => sortedSessions.some((s) => s.activity?.id === a.id)),
    [activities, sortedSessions]
  );
  const filteredSessions = activityFilter === null
    ? sortedSessions
    : sortedSessions.filter((s) => s.activity?.id === activityFilter);

  const pickRoute = (saved: SavedRoute) => {
    const trace = followedTraceFromRoute(saved.record);
    if (!trace) {
      setError('Cet itinéraire n\'a pas assez de points.');
      return;
    }
    followTrace(trace);
    onPicked?.(trace);
    onClose();
  };

  const pickSession = async (file: string, name: string, activityId: string | null) => {
    setLoading(file);
    setError(null);
    try {
      const text = await readSessionGpx(file);
      if (text === null) throw new Error('Session introuvable dans la mémoire.');
      const trace = followedTraceFromPoints(parseGpx(text).rawPoints, name, 'session', activityId);
      if (!trace) throw new Error('Cette session n\'a pas assez de points.');
      followTrace(trace);
      onPicked?.(trace);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Lecture de la session impossible.'));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card heading="Suivre une trace">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: 'var(--text-m)' }}>
        <SegmentedControl<PickerTab> fit label="Trace à suivre" value={tab} onChange={setTab}
          items={[{ key: 'route', label: `Itinéraires (${routes.length})` }, { key: 'session', label: `Sessions (${sortedSessions.length})` }]} />

        {status !== 'ready' && (
          <div className="ui-alert ui-alert--warning">
            Aucun dossier mémoire ouvert : choisissez-le dans <Link to="/parametres">Réglages</Link> pour retrouver vos traces.
          </div>
        )}
        {error && <div className="ui-alert ui-alert--danger">{error}</div>}

        {tab === 'route' && status === 'ready' && (routes.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Aucun itinéraire enregistré : planifiez-en un depuis l'accueil.
          </p>
        ) : (
          <ul style={LIST_STYLE}>
            {routes.map((saved) => (
              <li key={saved.base}>
                <button type="button" style={ROW_STYLE} onClick={() => pickRoute(saved)}>
                  <strong>{saved.record.name}</strong>
                  <span style={DETAIL_STYLE}>Enregistré le {formatDate(saved.record.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}

        {tab === 'session' && status === 'ready' && (sortedSessions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>Aucune session enregistrée pour l'instant.</p>
        ) : (
          <>
            {sessionActivities.length > 1 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span className="ui-eyebrow">Activité</span>
                <ActivitySelect activities={sessionActivities} value={activityFilter} label="Activité" className="ui-field"
                  placeholder={`Toutes (${sortedSessions.length})`}
                  reset={{ label: `Toutes (${sortedSessions.length})`, onChoose: () => { setActivityFilter(null); setShown(PAGE_SIZE); } }}
                  onChange={(next) => { setActivityFilter(next.id); setShown(PAGE_SIZE); }} />
              </label>
            )}
            <ul style={LIST_STYLE}>
              {filteredSessions.slice(0, shown).map(({ file, record, activity }) => {
                const name = record.name ?? record.title ?? file;
                return (
                  <li key={file}>
                    <button type="button" style={ROW_STYLE} disabled={loading !== null}
                      onClick={() => void pickSession(file, name, activity?.id ?? null)}>
                      <strong>{name}</strong>
                      <span style={DETAIL_STYLE}>
                        {loading === file ? 'Lecture…' : [activity?.name, formatDate(record.summary.startMs)].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {filteredSessions.length > shown && (
              <Button variant="ghost" onClick={() => setShown((n) => n + PAGE_SIZE)}>Afficher plus</Button>
            )}
          </>
        ))}

        <Button variant="ghost" onClick={onClose}>Fermer</Button>
      </div>
    </Card>
  );
}

export default FollowTracePicker;
