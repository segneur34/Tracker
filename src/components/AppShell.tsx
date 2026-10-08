import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SPORT_FAMILIES, type SportFamily } from '../core/sportProfiles';
import { formatClock } from '../core/units';
import { useIntervalTimer } from '../hooks/useIntervalTimer';
import { useLongPress } from '../hooks/useLongPress';
import { togglePauseRecording, useRecorder } from '../hooks/useRecorder';
import {
  effectiveLongPressMs, effectiveNavHoldMs, rememberNavSecondFamily, useNavFamily, useNavSecondFamily,
} from '../hooks/useSportSettings';
import { formatIntervalClock, phaseName } from '../recording/intervalTimer';
import { recordingDurationMs } from '../recording/session';
import {
  IconBike, IconChevronUp, IconGrid, IconHome, IconPause, IconPlay, IconRoute, IconRun, IconSail, IconSettings, IconStopwatch,
} from './icons';

/**
 * Cadre de toutes les pages : navigation et bandeau d'enregistrement.
 *
 * Sur téléphone (moins de 768 px de large), une barre d'onglets en bas, en
 * cinq cases pour que le bouton rond reste au milieu : Accueil · sport favori
 * · Enregistrer · sport secondaire · Réglages. Les deux sports se choisissent
 * dans Réglages (voile, puis course par défaut) ; un appui long sur le sport
 * secondaire (1 s par défaut, réglable) montre un grand cadran, puis déplie
 * au-dessus de la barre le menu des autres sports : celui qu'on y choisit
 * devient le sport secondaire, retenu. Le bouton rond est vert au repos,
 * rouge pendant un enregistrement.
 * Sur ordinateur, toutes les destinations dans une barre en haut, et
 * « Itinéraires » à côté du bouton Enregistrer (sur téléphone, on y va depuis
 * l'accueil). Le choix se fait en CSS (`AppShell.css`), sans lecture de la
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
const VOILE: Destination = { to: '/voile', label: 'Voile', Icon: IconSail, accent: 'var(--voile)' };
const COURSE: Destination = { to: '/course', label: 'Course', Icon: IconRun, accent: 'var(--course)' };
const VELO: Destination = { to: '/velo', label: 'Vélo', Icon: IconBike, accent: 'var(--velo)' };
const FRACTIONNE: Destination = { to: '/fractionne', label: 'Fractionné', Icon: IconStopwatch, accent: 'var(--fractionne)' };
const SETTINGS: Destination = { to: '/parametres', label: 'Réglages', Icon: IconSettings, accent: 'var(--ink)' };
const FAMILY_TABS: Record<SportFamily, Destination> = { voile: VOILE, course: COURSE, velo: VELO, fractionne: FRACTIONNE };
const RECORD_PATH = '/enregistrer';
const PLAN_PATH = '/itineraires';

/** Sport de la page ouverte : celui dont la route préfixe l'adresse (bibliothèque ou analyse). */
const familyOfPath = (pathname: string): SportFamily | null =>
  SPORT_FAMILIES.find((f) => pathname === FAMILY_TABS[f].to || pathname.startsWith(`${FAMILY_TABS[f].to}/`)) ?? null;

/**
 * Grand cadran au milieu de l'écran pendant un appui long : le doigt cache le
 * bouton tenu. Il se remplit en `pressMs`, à la couleur `color`.
 */
function HoldDial({ pressMs, color, icon, title, hint }: {
  pressMs: number;
  color: string;
  icon: ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="shell-hold" aria-hidden="true"
      style={{ '--press-ms': `${pressMs}ms`, '--hold-color': color } as React.CSSProperties}>
      <div className="shell-hold__dial">
        <svg className="shell-hold__ring" viewBox="0 0 100 100">
          <circle className="shell-hold__track" cx="50" cy="50" r="45" />
          <circle className="shell-hold__fill" cx="50" cy="50" r="45" pathLength="100" />
        </svg>
        <div className="shell-hold__label">
          {icon}
          <span className="shell-hold__title">{title}</span>
          <span className="shell-hold__hint">{hint}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Bandeau du compteur du fractionné sur les autres pages : phase et temps
 * restant, un toucher ramène à Enregistrer. À part, pour que le rafraîchissement
 * du compteur ne redessine que lui.
 */
function IntervalBanner() {
  const { run, state } = useIntervalTimer();
  if (!run || !state?.phase) return null;
  const paused = state.status === 'paused';
  return (
    <Link to={RECORD_PATH} className="shell-banner shell-banner--intervals">
      <span className="shell-banner__text">{paused ? 'Fractionné en pause' : 'Fractionné'} · {phaseName(state.phase, run.workout.reps)}</span>
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
  const { status, stats } = useRecorder();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const busy = status !== 'idle';
  const paused = status === 'paused';
  const clock = formatClock(recordingDurationMs(stats));
  const canToggle = status === 'recording' || paused;
  const onLongPress = useCallback(() => void togglePauseRecording(), []);
  const { pressingMs, handlers } = useLongPress(onLongPress, effectiveLongPressMs, canToggle);

  const navFamily = useNavFamily();
  const secondFamily = useNavSecondFamily();
  const second = FAMILY_TABS[secondFamily];
  const openFamily = familyOfPath(pathname);
  // Menu des sports, ouvert pour l'adresse où on l'a déplié : un changement de page le referme.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const sportsOpen = menuPath === pathname;
  const closeSports = useCallback(() => setMenuPath(null), []);
  // Appui long sur le sport secondaire : le menu pour en changer.
  const openSports = useCallback(() => setMenuPath(window.location.pathname), []);
  const sportHold = useLongPress(openSports, effectiveNavHoldMs, true);

  useEffect(() => {
    if (!sportsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSports();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sportsOpen, closeSports]);

  return (
    <div className="shell">
      <header className="shell-topbar">
        <Link to="/" className="shell-brand">Tracker</Link>
        <nav aria-label="Navigation principale" className="shell-toplinks">
          {topLink(HOME)}
          {SPORT_FAMILIES.map((f) => topLink(FAMILY_TABS[f]))}
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

      <div className="shell-banners">
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
        <Outlet />
      </main>

      {sportsOpen && <div className="shell-sports-backdrop" aria-hidden="true" onClick={closeSports} />}

      <nav aria-label="Navigation principale" className="shell-tabbar">
        {tabLink(HOME)}
        {tabLink(FAMILY_TABS[navFamily])}
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
        {/* Un bouton, pas un lien : la WebView d'Android affiche l'adresse d'un lien tenu longtemps. */}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={sportsOpen}
          aria-label={`${second.label} ; appui long : changer de sport`}
          className={`shell-tab shell-tab--menu${openFamily === secondFamily ? ' active' : ''}`}
          style={{ '--tab-color': second.accent } as React.CSSProperties}
          {...sportHold.handlers}
          onClick={(e) => {
            sportHold.handlers.onClick(e);
            if (e.defaultPrevented) return;
            closeSports();
            navigate(second.to);
          }}>
          <second.Icon size={24} />
          <span className="shell-tab__label">
            {second.label}
            <IconChevronUp size={12} strokeWidth={2.5} className="shell-tab__chevron" />
          </span>
        </button>
        {tabLink(SETTINGS)}
        {sportsOpen && (
          <div className="shell-sports-menu" role="menu" aria-label="Sport secondaire">
            <span className="shell-sports-menu__title">Sport secondaire</span>
            {SPORT_FAMILIES.filter((f) => f !== navFamily).map((f) => {
              const d = FAMILY_TABS[f];
              return (
                <NavLink
                  key={d.to}
                  to={d.to}
                  role="menuitemradio"
                  aria-checked={f === secondFamily}
                  className="shell-sports-menu__item"
                  style={{ '--tab-color': d.accent } as React.CSSProperties}
                  onClick={() => {
                    rememberNavSecondFamily(f);
                    closeSports();
                  }}>
                  <d.Icon size={22} />
                  <span>{d.label}</span>
                </NavLink>
              );
            })}
          </div>
        )}
      </nav>

      {pressingMs !== null && (
        // Le doigt cache l'anneau du bouton : le même remplissage, en grand, au milieu de l'écran.
        <HoldDial pressMs={pressingMs} color={paused ? 'var(--record)' : 'var(--recording)'}
          icon={paused ? <IconPlay size={56} strokeWidth={2.5} /> : <IconPause size={56} strokeWidth={3} />}
          title={paused ? 'Reprise' : 'Pause'} hint="Maintenez le bouton" />
      )}
      {sportHold.pressingMs !== null && (
        <HoldDial pressMs={sportHold.pressingMs} color={second.accent} icon={<IconGrid size={56} strokeWidth={2} />}
          title="Changer de sport" hint="Maintenez le bouton" />
      )}
    </div>
  );
}

export default AppShell;
