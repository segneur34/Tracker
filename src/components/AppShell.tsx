import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { parentPage } from '../core/parentPage';
import type { SportFamily } from '../core/sportProfiles';
import { formatClock } from '../core/units';
import { useIntervalTimer } from '../hooks/useIntervalTimer';
import { useLongPress } from '../hooks/useLongPress';
import { togglePauseRecording, useRecorderStatus, useRecordingClock } from '../hooks/useRecorder';
import { effectiveLongPressMs, useVisibility } from '../hooks/useSportSettings';
import { formatIntervalClock, phaseName } from '../recording/intervalTimer';
import { TIMER_RECORD_PATH } from '../pages/workoutLists';
import { setBackNavigator } from '../platform/backButton';
import { lockOrientation } from '../platform/screen';
import { IconChart, IconHome, IconPause, IconPlay, IconRoute, IconSettings, IconUser } from './icons';
import { FAMILY_ICON } from './familyIcons';
import ErrorBoundary from './ErrorBoundary';
import { HelpProvider } from './Help';
import HoldDial from './ui/HoldDial';

/**
 * Cadre de toutes les pages : navigation et bandeau d'enregistrement.
 *
 * Sur téléphone (moins de 768 px de large, ou tourné : `NARROW_QUERY`), une barre d'onglets en bas, en
 * cinq cases fixes, à la verticale à gauche sur le téléphone tourné, le bouton rond au milieu : Accueil · Profil ·
 * Enregistrer · Statistiques · Réglages. Les sports et les itinéraires s'ouvrent
 * depuis l'accueil. Le bouton rond est vert au repos, rouge pendant un
 * enregistrement.
 * Sur ordinateur, toutes les destinations dans une barre en haut (les
 * statistiques et le profil avant Réglages), et « Itinéraires » à côté du
 * bouton Enregistrer. Une famille cachée dans Réglages n'y est pas ; son
 * adresse s'ouvre toujours (§10, point 100). Le choix se fait en CSS (`AppShell.css`), sans lecture de la
 * taille d'écran en JavaScript.
 *
 * Pendant un enregistrement, un bandeau rouge rappelle sur chaque page qu'il
 * tourne et ramène à la page d'enregistrement ; pendant une séance du
 * compteur du fractionné, un second bandeau dit la phase et son temps restant. Un appui long sur le bouton du
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
const VOILE: Destination = { to: '/voile', label: 'Voile', Icon: FAMILY_ICON.voile, accent: 'var(--voile)' };
const COURSE: Destination = { to: '/course', label: 'À pied', Icon: FAMILY_ICON.course, accent: 'var(--course)' };
const VELO: Destination = { to: '/velo', label: 'Vélo', Icon: FAMILY_ICON.velo, accent: 'var(--velo)' };
const FRACTIONNE: Destination = { to: '/fractionne', label: 'Entraînement', Icon: FAMILY_ICON.fractionne, accent: 'var(--fractionne)' };
const SURF: Destination = { to: '/surf', label: 'Surf', Icon: FAMILY_ICON.surf, accent: 'var(--surf)' };
const SETTINGS: Destination = { to: '/parametres', label: 'Réglages', Icon: IconSettings, accent: 'var(--ink)' };
const FAMILY_TABS: Record<SportFamily, Destination> = { voile: VOILE, course: COURSE, velo: VELO, fractionne: FRACTIONNE, surf: SURF };
const RECORD_PATH = '/enregistrer';
const PLAN_PATH = '/itineraires';
const STATISTIQUES: Destination = { to: '/statistiques', label: 'Statistiques', Icon: IconChart, accent: 'var(--ink-2)' };
const PROFIL: Destination = { to: '/profil', label: 'Profil', Icon: IconUser, accent: 'var(--ink-2)' };

/**
 * Bandeau du compteur sur les autres pages : phase et temps restant, un
 * toucher ramène à Enregistrer (en mode Timer pour une séance du Timer). À
 * part, pour que le rafraîchissement du compteur ne redessine que lui.
 */
function IntervalBanner() {
  const { run, state } = useIntervalTimer();
  if (!run || !state?.phase) return null;
  const paused = state.status === 'paused';
  const name = run.kind === 'timer' ? 'Timer' : 'Fractionné';
  return (
    <Link to={run.kind === 'timer' ? TIMER_RECORD_PATH : RECORD_PATH} className="shell-banner shell-banner--intervals">
      <span className="shell-banner__text">{paused ? `${name} en pause` : name} · {phaseName(state.phase)}</span>
      <span className="num">{formatIntervalClock(state.remainingMs / 1000)}</span>
    </Link>
  );
}

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
  const status = useRecorderStatus();
  const { durationMs } = useRecordingClock(false);
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  // Touche retour d'Android : vers la page au-dessus, en remplaçant l'adresse (l'historique n'y sert plus).
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => setBackNavigator(() => {
    const to = parentPage(locationRef.current.pathname, locationRef.current.search);
    if (to === null) return false;
    navigate(to, { replace: true });
    return true;
  }), [navigate]);
  const busy = status !== 'idle';
  const paused = status === 'paused';
  const clock = formatClock(durationMs);
  const canToggle = status === 'recording' || paused;
  const onLongPress = useCallback(() => void togglePauseRecording(), []);
  const goHome = useCallback(() => navigate('/'), [navigate]);
  const { pressingMs, handlers } = useLongPress(onLongPress, effectiveLongPressMs, canToggle);

  const { families } = useVisibility();

  // Orientation figée par le cadenas d'Enregistrer : rendue libre à la fin de l'enregistrement.
  useEffect(() => {
    if (status === 'idle') lockOrientation(false);
  }, [status]);

  // Hauteur des bandeaux, sous laquelle se fixe ce qui tient à l'écran (carte d'un téléphone tourné).
  const bannersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bannersRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty('--shell-top', `${el.offsetHeight}px`));
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--shell-top');
    };
  }, []);

  return (
    <div className="shell">
      <header className="shell-topbar">
        <Link to="/" className="shell-brand">Tracker</Link>
        <nav aria-label="Navigation principale" className="shell-toplinks">
          {families.map((f) => topLink(FAMILY_TABS[f]))}
          {topLink(STATISTIQUES)}
          {topLink(PROFIL)}
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

      <div className="shell-banners" ref={bannersRef}>
        {busy && pathname !== RECORD_PATH && (
          <Link to={RECORD_PATH} className="shell-banner">
            <span className="shell-banner__dot" />
            <span className="shell-banner__text">{paused ? 'Enregistrement en pause' : 'Enregistrement en cours'}</span>
            <span className="num">{clock}</span>
          </Link>
        )}
        {pathname !== RECORD_PATH && <IntervalBanner />}
      </div>

      <main className="shell-main">
        <HelpProvider resetKey={pathname}>
          {/* Une exception au rendu d'une page n'emporte ni la barre, ni les bandeaux, ni le bouton rond. */}
          <ErrorBoundary key={pathname} onHome={goHome}>
            <Outlet />
          </ErrorBoundary>
        </HelpProvider>
      </main>

      <nav aria-label="Navigation principale" className="shell-tabbar">
        {tabLink(HOME)}
        {tabLink(PROFIL)}
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
        {tabLink(STATISTIQUES)}
        {tabLink(SETTINGS)}
      </nav>

      {pressingMs !== null && (
        // Le doigt cache l'anneau du bouton : le même remplissage, en grand, au milieu de l'écran.
        <HoldDial pressMs={pressingMs} color={paused ? 'var(--record)' : 'var(--recording)'}
          icon={paused ? <IconPlay size={56} strokeWidth={2.5} /> : <IconPause size={56} strokeWidth={3} />}
          title={paused ? 'Reprise' : 'Pause'} hint="Maintenez le bouton" />
      )}
    </div>
  );
}

export default AppShell;
