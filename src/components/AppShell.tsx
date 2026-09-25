import { useCallback, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { formatClock } from '../core/units';
import { useLongPress } from '../hooks/useLongPress';
import { togglePauseRecording, useRecorder } from '../hooks/useRecorder';
import { effectiveLongPressMs } from '../hooks/useSportSettings';
import { recordingDurationMs } from '../recording/session';
import { IconHome, IconPause, IconPlay, IconRoute, IconRun, IconSail, IconSettings } from './icons';

/**
 * Cadre de toutes les pages : navigation et bandeau d'enregistrement.
 *
 * Sur téléphone (moins de 768 px de large), une barre d'onglets en bas :
 * Accueil · Voile · Enregistrer · Course · Réglages, le bouton du milieu
 * vert au repos, rouge pendant un enregistrement. Sur ordinateur, les mêmes
 * destinations dans une barre en haut, et « Itinéraires » à côté du bouton
 * Enregistrer (sur téléphone, on y va depuis la page Enregistrer). Le choix se fait en CSS
 * (`AppShell.css`), sans lecture de la taille d'écran en JavaScript.
 *
 * Pendant un enregistrement, un bandeau rouge rappelle sur chaque page qu'il
 * tourne et ramène à la page d'enregistrement. Un appui long sur le bouton du
 * milieu (2 s par défaut, réglable) met en pause ou relance, depuis n'importe
 * quelle page ; un appui court y ramène, comme au repos.
 */

interface Destination {
  to: string;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  /** Couleur de l'onglet actif. */
  accent: string;
}

const HOME: Destination = { to: '/', label: 'Accueil', Icon: IconHome, accent: 'var(--ink)' };
const VOILE: Destination = { to: '/voile', label: 'Voile', Icon: IconSail, accent: 'var(--voile)' };
const COURSE: Destination = { to: '/course', label: 'Course', Icon: IconRun, accent: 'var(--course)' };
const SETTINGS: Destination = { to: '/parametres', label: 'Réglages', Icon: IconSettings, accent: 'var(--ink)' };
const RECORD_PATH = '/enregistrer';
const PLAN_PATH = '/itineraires';

const tabLink = (d: Destination) => (
  <NavLink
    key={d.to}
    to={d.to}
    end={d.to === '/'}
    className="shell-tab"
    style={{ '--tab-color': d.accent } as React.CSSProperties}>
    <d.Icon size={24} />
    <span>{d.label}</span>
  </NavLink>
);

const topLink = (d: Destination) => (
  <NavLink
    key={d.to}
    to={d.to}
    end={d.to === '/'}
    className="shell-toplink"
    style={{ '--tab-color': d.accent } as React.CSSProperties}>
    {d.label}
  </NavLink>
);

function AppShell() {
  const { status, stats } = useRecorder();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const busy = status !== 'idle';
  const paused = status === 'paused';
  const clock = formatClock(recordingDurationMs(stats));
  const canToggle = status === 'recording' || paused;
  const onLongPress = useCallback(() => void togglePauseRecording(), []);
  const { pressingMs, handlers } = useLongPress(onLongPress, effectiveLongPressMs, canToggle);

  return (
    <div className="shell">
      <header className="shell-topbar">
        <Link to="/" className="shell-brand">Tracker</Link>
        <nav aria-label="Navigation principale" className="shell-toplinks">
          {topLink(HOME)}
          {topLink(VOILE)}
          {topLink(COURSE)}
          {topLink(SETTINGS)}
        </nav>
        <div className="shell-topactions">
          <NavLink to={PLAN_PATH} className="shell-topplan">
            <IconRoute size={18} />
            Itinéraires
          </NavLink>
          <NavLink to={RECORD_PATH} className={`shell-toprecord${busy ? ' shell-toprecord--busy' : ''}`}>
            <span className={`ui-record-dot${busy ? ' ui-record-dot--stop' : ''}`} />
            {busy ? <span className="num">{clock}</span> : 'Enregistrer'}
          </NavLink>
        </div>
      </header>

      {busy && pathname !== RECORD_PATH && (
        <Link to={RECORD_PATH} className="shell-banner">
          <span className="shell-banner__dot" />
          <span className="shell-banner__text">{paused ? 'Enregistrement en pause' : 'Enregistrement en cours'}</span>
          <span className="num">{clock}</span>
        </Link>
      )}

      <main className="shell-main">
        <Outlet />
      </main>

      <nav aria-label="Navigation principale" className="shell-tabbar">
        {tabLink(HOME)}
        {tabLink(VOILE)}
        <div className="shell-tabbar__record">
          {canToggle ? (
            // Un bouton, pas un lien : la WebView d'Android affiche l'adresse d'un lien tenu longtemps.
            <button
              type="button"
              aria-label={`Enregistrement ${paused ? 'en pause' : 'en cours'}, ${clock} ; appui long : ${paused ? 'reprendre' : 'pause'}`}
              className={`shell-record shell-record--busy${paused ? ' shell-record--paused' : ''}`}
              {...handlers}
              onClick={(e) => {
                handlers.onClick(e);
                if (!e.defaultPrevented) navigate(RECORD_PATH);
              }}>
              {paused ? <IconPlay size={24} strokeWidth={2.5} /> : <IconPause size={26} strokeWidth={3} />}
              {pressingMs !== null && (
                <svg className="shell-record__ring" viewBox="0 0 64 64" aria-hidden="true"
                  style={{ '--press-ms': `${pressingMs}ms` } as React.CSSProperties}>
                  <circle cx="32" cy="32" r="30" pathLength="100" />
                </svg>
              )}
            </button>
          ) : (
            <NavLink
              to={RECORD_PATH}
              aria-label={busy ? `Enregistrement en cours, ${clock}` : 'Enregistrer'}
              className={`shell-record${busy ? ' shell-record--busy' : ''}`}>
              <span className={`ui-record-dot${busy ? ' ui-record-dot--stop' : ''}`} />
            </NavLink>
          )}
        </div>
        {tabLink(COURSE)}
        {tabLink(SETTINGS)}
      </nav>
    </div>
  );
}

export default AppShell;
