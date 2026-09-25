import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { sessionActivity } from '../core/activities';
import { parseGpx } from '../core/gpxParser';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { followTrace } from '../hooks/useFollowedTrace';
import { readSessionGpx, useSessionLibrary } from '../hooks/useSessionLibrary';
import { readStoredActivities } from '../hooks/useSportSettings';
import { followedTraceFromPoints, followedTraceFromRoute } from '../recording/followedTrace';
import Button from './ui/Button';
import Card from './ui/Card';

/**
 * Choix de la trace à suivre pendant l'enregistrement : un itinéraire rangé
 * (page Itinéraires) ou une session déjà enregistrée, pour refaire un
 * parcours. La trace choisie va dans `useFollowedTrace`.
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

function FollowTracePicker({ onClose }: { onClose: () => void }) {
  const { status, sessions } = useSessionLibrary();
  const library = useRouteLibrary();
  const [tab, setTab] = useState<PickerTab>('route');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activities] = useState(readStoredActivities);
  /** Activité retenue dans l'onglet Sessions ; `null` : toutes. */
  const [activityFilter, setActivityFilter] = useState<string | null>(null);

  /** Sessions de la plus récente à la plus ancienne, chacune avec son activité. */
  const sortedSessions = useMemo(
    () => [...sessions]
      .sort((a, b) => b.record.summary.startMs - a.record.summary.startMs)
      .map((session) => ({ ...session, activity: sessionActivity(activities, session.record.activityId, session.record.sport) })),
    [sessions, activities]
  );
  /** Activités présentes parmi les sessions, dans l'ordre des Réglages. */
  const sessionActivities = useMemo(
    () => activities.filter((a) => sortedSessions.some((s) => s.activity?.id === a.id)),
    [activities, sortedSessions]
  );
  const filteredSessions = activityFilter === null
    ? sortedSessions
    : sortedSessions.filter((s) => s.activity?.id === activityFilter);

  const pickRoute = (index: number) => {
    const saved = library.routes[index];
    const trace = saved ? followedTraceFromRoute(saved.record) : null;
    if (!trace) {
      setError('Cet itinéraire n\'a pas assez de points.');
      return;
    }
    followTrace(trace);
    onClose();
  };

  const pickSession = async (file: string, name: string) => {
    setLoading(file);
    setError(null);
    try {
      const text = await readSessionGpx(file);
      if (text === null) throw new Error('Session introuvable dans la mémoire.');
      const trace = followedTraceFromPoints(parseGpx(text).rawPoints, name, 'session');
      if (!trace) throw new Error('Cette session n\'a pas assez de points.');
      followTrace(trace);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lecture de la session impossible.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card heading="Suivre une trace">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: 'var(--text-m)' }}>
        <div className="ui-tabs" role="group" aria-label="Trace à suivre" style={{ paddingBottom: 0 }}>
          <button type="button" className="ui-tab" aria-pressed={tab === 'route'} onClick={() => setTab('route')}>
            Itinéraires ({library.routes.length})
          </button>
          <button type="button" className="ui-tab" aria-pressed={tab === 'session'} onClick={() => setTab('session')}>
            Sessions ({sessions.length})
          </button>
        </div>

        {status !== 'ready' && (
          <div className="ui-alert ui-alert--warning">
            Aucun dossier mémoire ouvert : choisissez-le dans <Link to="/parametres">Réglages</Link> pour retrouver vos traces.
          </div>
        )}
        {error && <div className="ui-alert ui-alert--danger">{error}</div>}

        {tab === 'route' && status === 'ready' && (library.routes.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Aucun itinéraire rangé : planifiez-en un depuis l'accueil.
          </p>
        ) : (
          <ul style={LIST_STYLE}>
            {library.routes.map((saved, i) => (
              <li key={saved.base}>
                <button type="button" style={ROW_STYLE} onClick={() => pickRoute(i)}>
                  <strong>{saved.record.name}</strong>
                  <span style={DETAIL_STYLE}>Rangé le {formatDate(saved.record.updatedAt)}</span>
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
                <select className="ui-field" value={activityFilter ?? ''}
                  onChange={(e) => { setActivityFilter(e.target.value || null); setShown(PAGE_SIZE); }}>
                  <option value="">Toutes ({sortedSessions.length})</option>
                  {sessionActivities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({sortedSessions.filter((s) => s.activity?.id === a.id).length})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ul style={LIST_STYLE}>
              {filteredSessions.slice(0, shown).map(({ file, record, activity }) => {
                const name = record.name ?? record.title ?? file;
                return (
                  <li key={file}>
                    <button type="button" style={ROW_STYLE} disabled={loading !== null}
                      onClick={() => void pickSession(file, name)}>
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
