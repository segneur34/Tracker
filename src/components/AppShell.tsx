import type { ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { formatClock } from '../core/units';
import { useRecorder } from '../hooks/useRecorder';
import { recordingDurationMs } from '../recording/session';
import { IconHome, IconRun, IconSail, IconSettings } from './icons';

/**
 * Cadre de toutes les pages : navigation et bandeau d'enregistrement.
 *
 * Sur téléphone (moins de 768 px de large), une barre d'onglets en bas :
 * Accueil · Voile · Enregistrer · Course · Réglages, le bouton du milieu
 * vert au repos, rouge pendant un enregistrement. Sur ordinateur, les mêmes
 * destinations dans une barre en haut. Le choix se fait en CSS
 * (`AppShell.css`), sans lecture de la taille d'écran en JavaScript.
 *
 * Pendant un enregistrement, un bandeau rouge rappelle sur chaque page qu'il
 * tourne et ramène à la page d'enregistrement.
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
  const busy = status !== 'idle';
  const clock = formatClock(recordingDurationMs(stats));

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
        <NavLink to={RECORD_PATH} className={`shell-toprecord${busy ? ' shell-toprecord--busy' : ''}`}>
          <span className={`ui-record-dot${busy ? ' ui-record-dot--stop' : ''}`} />
          {busy ? <span className="num">{clock}</span> : 'Enregistrer'}
        </NavLink>
      </header>

      {busy && pathname !== RECORD_PATH && (
        <Link to={RECORD_PATH} className="shell-banner">
          <span className="shell-banner__dot" />
          <span className="shell-banner__text">Enregistrement en cours</span>
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
          <NavLink
            to={RECORD_PATH}
            aria-label={busy ? `Enregistrement en cours, ${clock}` : 'Enregistrer'}
            className={`shell-record${busy ? ' shell-record--busy' : ''}`}>
            <span className={`ui-record-dot${busy ? ' ui-record-dot--stop' : ''}`} />
          </NavLink>
        </div>
        {tabLink(COURSE)}
        {tabLink(SETTINGS)}
      </nav>
    </div>
  );
}

export default AppShell;
