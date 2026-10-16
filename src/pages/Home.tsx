import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import ActivityChart from '../components/ActivityChart';
import MemoryStatus from '../components/MemoryStatus';
import { PermissionsPrompt } from '../components/PermissionsStatus';
import { FAMILY_ICON } from '../components/familyIcons';
import { IconChart, IconChevronRight, IconHelp, IconRoute } from '../components/icons';
import PageHeader from '../components/ui/PageHeader';
import { FAMILY_ACCENT, FAMILY_LABEL } from '../core/activities';
import type { SportFamily } from '../core/sportProfiles';
import { libraryPath } from '../hooks/useLibraryNavigation';
import { useRouteLibrary } from '../hooks/useRouteLibrary';
import { useSessionLibrary } from '../hooks/useSessionLibrary';
import { useVisibility } from '../hooks/useSportSettings';
import { shownRoutes } from '../planning/routeList';
import './Home.css';

/**
 * Accueil : enregistrer ou planifier un itinéraire, le graphe d'activités et
 * ses totaux, puis les familles visibles en grille de deux colonnes (un « ? »
 * déplie ce que chacune analyse), et sous elles, de la même épaisseur, l'entrée
 * de la liste des itinéraires planifiés (leur nombre dès que la mémoire est
 * prête) et celle des statistiques (dès qu'il y a des sessions). Une famille
 * cachée dans Réglages n'y a pas sa carte, une activité cachée pas ses
 * itinéraires dans le nombre (§10, point 100).
 */

const cardStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '18px',
  borderRadius: 'var(--radius-l)',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  textDecoration: 'none',
} as const;

/** Ce que chaque famille analyse, déplié par son « ? ». */
const FAMILY_BLURB: Record<SportFamily, string> = {
  voile: 'Wingfoil, planche, kite, bateau : vitesse, tops, virements et empannages, vent, VMG.',
  course: 'Allure, dénivelé, zones de pente, vitesse et altitude.',
  velo: 'Vitesse, dénivelé, zones de pente, meilleurs segments, puissance et énergie.',
  fractionne: "À pied ou à vélo : compteur de répétitions à l'enregistrement, avec bips, puis l'analyse de la course ou du vélo.",
  surf: 'Vagues, temps sur la vague, vitesse, rame et retour au pic ; sur foil, les vols enchaînés.',
};

function Home() {
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const { status, sessions, error } = useSessionLibrary();
  const { routes: allRoutes } = useRouteLibrary();
  const { activities, families, isShown } = useVisibility();
  const [blurbOf, setBlurbOf] = useState<SportFamily | null>(null);
  const routes = useMemo(() => shownRoutes(allRoutes, activities, isShown), [allRoutes, activities, isShown]);
  // Premier lancement sur le téléphone, ou dossier devenu inaccessible : la mémoire d'abord. Une erreur
  // (écriture refusée, réglages du dossier illisibles) se voit aussi dès l'accueil.
  const memoryNeedsAction = status === 'unavailable' || status === 'needs-permission' || error !== null;

  return (
    <div className="ui-page">
      <PageHeader title={<>Tracker<span className="home-version">v{__APP_VERSION__}</span></>} aside={<span style={{ color: 'var(--muted)', fontSize: 'var(--text-m)' }}>{today}</span>} />

      {memoryNeedsAction && <MemoryStatus />}
      {/* Le dossier de la mémoire d'abord, puis les autorisations (téléphone seulement, s'il en manque). */}
      {!memoryNeedsAction && status === 'ready' && <PermissionsPrompt />}

      <div style={{ ...cardStyle, gap: '14px' }}>
        <span className="ui-eyebrow">Nouvelle session</span>
        <div className="home-new-session">
          <Link to="/enregistrer" className="ui-btn ui-btn--record ui-btn--l">
            <span className="ui-record-dot" />
            Enregistrer
          </Link>
          <Link to="/itineraires" className="ui-btn ui-btn--secondary ui-btn--l">
            <IconRoute size={20} className="home-new-session__icon" />
            Planifier
          </Link>
        </div>
      </div>

      {sessions.length > 0 && <ActivityChart />}

      <div className="home-families">
        {families.map((family) => {
          const Icon = FAMILY_ICON[family];
          const open = blurbOf === family;
          return (
            <div key={family} className="home-family" style={{ '--family-color': FAMILY_ACCENT[family] } as CSSProperties}>
              <Link to={libraryPath(family)} className="home-family__link"><Icon /> <span>{FAMILY_LABEL[family]}</span></Link>
              <button type="button" className="home-family__help" aria-expanded={open}
                aria-label={`Ce qu'analyse ${FAMILY_LABEL[family]}`} onClick={() => setBlurbOf(open ? null : family)}>
                <IconHelp size={18} />
              </button>
            </div>
          );
        })}
        {blurbOf !== null && families.includes(blurbOf) && <p className="home-family__blurb">{FAMILY_BLURB[blurbOf]}</p>}
        <Link to="/itineraires/liste" className="home-link">
          <IconRoute /> <span>Itinéraires planifiés{status === 'ready' ? ` (${routes.length})` : ''}</span> <IconChevronRight />
        </Link>
        {sessions.length > 0 && (
          <Link to="/statistiques" className="home-link">
            <IconChart /> <span>Statistiques</span> <IconChevronRight />
          </Link>
        )}
      </div>
    </div>
  );
}

export default Home;
